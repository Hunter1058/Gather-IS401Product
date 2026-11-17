import test from 'node:test';
import assert from 'node:assert/strict';
import { people } from '../lib/friends.js';
import { friendDatabase } from './helpers/friend-rpc.js';

function fixture() {
  const db = friendDatabase();
  const ids = Array.from({length: 10}, (_, i) => `${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`);
  db.users.splice(0,db.users.length,...ids.map((id,i) => ({user_id:id, display_name:'Person '+i, username:'person_'+i,is_private:false})));
  const actor = ids[0], link = (a,b) => db.friendships.add([ids[a],ids[b]].sort().join(':'));
  link(0,1); link(1,2); link(2,3); link(3,6);
  db.rsvps.set(actor,new Set(['1','2'])); db.rsvps.set(ids[4],new Set(['1','2']));
  db.interests.set(actor,new Set(['art','sports','service']));
  db.interests.set(ids[5],new Set(['art','sports','service']));
  const list = (query={}) => people({rpc:(name,args)=>db.rpc(actor,name,args)},new URLSearchParams({section:'search',...query}));
  return {db,ids,actor,link,list};
}

test('suggestions prioritize shortest connection degree, then shared RSVPs, then interests', async () => {
  const f=fixture(), {people: rows}=await f.list();
  assert.deepEqual(rows.map(p=>p.id),[f.ids[2],f.ids[3],f.ids[4],f.ids[5]]);
  assert.deepEqual(rows.map(p=>p.connectionDegree),[2,3,null,null]);
  assert.equal(rows[2].sharedEvents,2); assert.equal(rows[3].sharedInterests,3);
  assert.equal(f.db.calls.at(-1).name,'get_friend_recommendations');
  assert(!rows.some(p=>[f.actor,f.ids[1],f.ids[6],f.ids[7]].includes(p.id)));
});

test('higher RSVP count wins within the same degree, then shared interests break ties', async () => {
  const f=fixture(); f.link(1,4); f.link(1,5);
  f.db.rsvps.set(f.ids[2],new Set(['1']));
  assert.deepEqual((await f.list()).people.map(p=>p.id),[f.ids[4],f.ids[2],f.ids[5],f.ids[3]]);
  f.db.rsvps.set(f.ids[5],new Set(['1']));
  assert.deepEqual((await f.list()).people.slice(0,3).map(p=>p.id),[f.ids[4],f.ids[5],f.ids[2]]);
});

test('cycles retain shortest distance and unrelated/private people and private paths are excluded', async () => {
  const f=fixture(); f.link(1,3); f.link(2,3);
  assert.equal((await f.list()).people.find(p=>p.id===f.ids[3]).connectionDegree,2);
  f.db.users[1].is_private=true;
  f.db.users[4].is_private=true;
  const rows=(await f.list()).people;
  assert.deepEqual(rows.map(p=>p.id),[f.ids[5]],'private intermediary cannot reveal an indirect connection');
});

test('both request directions are excluded; cancelling restores an otherwise eligible recommendation', async () => {
  const f=fixture();
  await f.db.rpc(f.actor,'send_friend_request',{p_recipient_user_id:f.ids[2]});
  await f.db.rpc(f.ids[4],'send_friend_request',{p_recipient_user_id:f.actor});
  assert.deepEqual((await f.list()).people.map(p=>p.id),[f.ids[3],f.ids[5]]);
  await f.db.rpc(f.actor,'cancel_friend_request',{p_request_id:f.db.attempts[0].FriendRequestID});
  assert((await f.list()).people.some(p=>p.id===f.ids[2]));
});

test('static recommendation pages preserve ordering without duplicate candidates', async () => {
  const f=fixture(); let after, collected=[];
  do {
    const page=await f.list({limit:'1',...(after?{after}: {})});
    collected.push(...page.people.map(p=>p.id)); after=page.nextCursor;
  } while(after);
  assert.deepEqual(collected,[f.ids[2],f.ids[3],f.ids[4],f.ids[5]]);
  assert.equal(new Set(collected).size,collected.length);
});

test('zero signals yield an empty suggestion list while typed search still finds people', async () => {
  const f=fixture(); f.db.friendships.clear();f.db.rsvps.clear();f.db.interests.clear();
  assert.deepEqual((await f.list()).people,[]);
  const found=await f.list({search:'@person_7'});
  assert.deepEqual(found.people.map(p=>p.id),[f.ids[7]]);
  assert.equal(f.db.calls.at(-1).name,'get_friend_directory');
});

test('recommendation read errors are surfaced rather than replaced with random people', async () => {
  const f=fixture(); f.db.errors.set('get_friend_recommendations','PGRST202');
  await assert.rejects(f.list(),{status:503,code:'FRIENDS_SETUP_REQUIRED'});
});
