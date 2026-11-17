import test from 'node:test';
import assert from 'node:assert/strict';
import {readFriendAttendance} from '../lib/event-attendance.js';
import {readPlans} from '../lib/event-plans.js';
import {database, USER_A, USER_B} from './helpers/database.js';

const row = (id='1', label='Blair') => ({event_id:id, friend_count:'1',friends:[{id:USER_B,label}]});
function paged(rows) {
  const calls=[];
  return {calls, async rpc(name,args) {
    calls.push({name,args});
    return {data:rows.filter(r=>args.p_after_event_id===null||BigInt(r.event_id)>BigInt(args.p_after_event_id)).slice(0,2)};
  }};
}
test('attendance follows server cursors even when an upstream row cap shortens pages',async()=>{
  const client=paged([row('1'),row('2'),row('9007199254740993'),row('9223372036854775807')]);
  const state=await readFriendAttendance(client);
  assert.deepEqual(state.friendsGoing,['1','2','9007199254740993','9223372036854775807']);
  assert.equal(client.calls.length,3);
  assert(client.calls.every(c=>c.name==='gather_event_friend_attendance'&&Object.keys(c.args).sort().join(',')==='p_after_event_id,p_limit'));
  assert.equal(client.calls[2].args.p_after_event_id,'9223372036854775807');
});
test('counts stay exact strings and summaries expose only two bounded preview profiles',async()=>{
  const sample={...row(),friend_count:'9223372036854775807',email:'must-not-leak',
    friends:[{id:USER_A,label:'Alex',email:'secret@example.invalid'},{id:USER_B,label:'Blair'}]};
  const state=await readFriendAttendance(paged([sample]));
  assert.equal(state.friendAttendance['1'].count,'9223372036854775807');
  assert.deepEqual(state.friendAttendance['1'].friends,[{id:USER_A,label:'Alex'},{id:USER_B,label:'Blair'}]);
  assert(!JSON.stringify(state).includes('email'));
});
test('unsafe IDs, malformed previews and duplicate or unordered pages are not accepted as valid attendance',async()=>{
  const cases=[null, {...row(),event_id:9007199254740993}, {...row(),event_id:'0'},
    {...row(),event_id:'9223372036854775808'}, {...row(),friend_count:1}, {...row(),friend_count:'0'},
    {...row(),friends:[]}, {...row(),friend_count:'2'}, {...row(),friends:[{id:USER_B,label:''}]},
    {...row(),friends:[{id:'forged',label:'Name'}]}, {...row(),friends:[{id:USER_B,label:'x'.repeat(81)}]},
    {...row(),friend_count:'2',friends:[{id:USER_B,label:'Blair'},{id:USER_B,label:'Blair'}]}];
  for(const sample of cases)await assert.rejects(readFriendAttendance({async rpc(){return {data:[sample]};}}));
  await assert.rejects(readFriendAttendance({async rpc(){return {data:[row('2'),row('1')]};}}));
  await assert.rejects(readFriendAttendance({async rpc(){return {data:[row()]};}}));
});
test('a later-page failure discards partial attendance while keeping personal bookmark/RSVP state',async()=>{
  const db=database();db.rows.Bookmark.push({UserID:USER_A,EventID:'1'});
  db.rows.RSVP.push({UserID:USER_A,EventID:'2',RSVPGoing:true});
  db.client.rpc=async(_name,args)=>args.p_after_event_id===null?{data:[row()]}:{error:{code:'42501'}};
  const state=await readPlans(db.client,USER_A);
  assert.deepEqual(state.saved,['1']);assert.deepEqual(state.rsvp,['2']);
  assert.deepEqual(state.friendsGoing,[]);assert.deepEqual(state.friendAttendance,{});
  assert.match(state.friendsGoingError,/could not be loaded/);
});
test('a continuously nonempty source hits a safety limit instead of returning a truncated success',async()=>{
  let id=0n;
  await assert.rejects(readFriendAttendance({async rpc(){return {data:Array.from({length:250},()=>row(String(++id)))};}}),/page limit/);
});
