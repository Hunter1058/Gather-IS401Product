import test from 'node:test';
import assert from 'node:assert/strict';
import { connections } from '../lib/friends.js';
import { friendDatabase,A,B,C } from './helpers/friend-rpc.js';
function fixture() {
  const db=friendDatabase(), client={rpc:(name,args)=>db.rpc(A,name,args)};
  db.friendships.add([A,C].sort().join(':')); db.friendships.add([B,C].sort().join(':'));
  db.rsvps.set(A,new Set(['1','9007199254740993'])); db.rsvps.set(B,new Set(['1','9007199254740993','4']));
  db.interests.set(A,new Set(['1'])); db.interests.set(B,new Set(['1','2']));
  const read=(kind,extra={})=>connections(client,A,B,new URLSearchParams({kind,...extra}));
  return {db,client,read};
}
test('shared details return only intersections and preserve bigint text IDs through pagination', async()=>{
  const f=fixture();
  assert.deepEqual((await f.read('friends')).items.map(p=>p.id),[C]);
  const first=await f.read('events',{limit:'1'});
  assert.equal(first.items[0].id,'1'); assert.equal(first.nextCursor,'1');
  const next=await f.read('events',{limit:'1',after:first.nextCursor});
  assert.equal(next.items[0].id,'9007199254740993'); assert.equal(next.nextCursor,null);
  assert.deepEqual((await f.read('interests')).items.map(p=>p.id),['1']);
});
test('private targets expose no shared details and private mutual profiles stay hidden', async()=>{
  const f=fixture(); f.db.users[2].is_private=true;
  assert.deepEqual((await f.read('friends')).items,[]);
  f.db.users[1].is_private=true;
  f.db.calls.length=0;
  const result=await f.read('events');
  assert.equal(result.person.isPrivate,true); assert.deepEqual(result.items,[]);
  assert(!f.db.calls.some(call=>call.name==='get_friend_connections'));
});
test('connection lookup validates ownership fields, kinds, page sizes, UUIDs and cursor types', async()=>{
  const f=fixture();
  for (const extra of [{limit:'51'},{after:'bad'},{UserID:C}]) await assert.rejects(f.read('friends',extra),{status:400});
  await assert.rejects(f.read('events',{after:'9223372036854775808'}),{status:400});
  await assert.rejects(f.read('passwords'),{status:400});
  await assert.rejects(connections(f.client,A,A,new URLSearchParams({kind:'friends'})),{status:400});
});
test('missing SQL setup and read errors fail rather than looking like empty connections', async()=>{
  const f=fixture();f.db.errors.set('get_friend_connections','PGRST202');
  await assert.rejects(f.read('events'),{status:503,code:'FRIENDS_SETUP_REQUIRED'});
});
