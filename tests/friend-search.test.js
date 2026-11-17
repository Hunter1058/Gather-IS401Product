// These use a Supabase-shaped fixture for API contracts and page state.
// The generated SQL rehearsal tests the actual database matching functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { people } from '../lib/friends.js';
import { friendDatabase, A, B, C } from './helpers/friend-rpc.js';

function fixture() {
  const db = friendDatabase();
  Object.assign(db.users[1], { username: 'campus_blair', first_name: 'Jonathan', last_name: 'Thompson',
    display_name: 'Jonathan Thompson', email: 'blair.student@byu.edu' });
  Object.assign(db.users[2], { username: 'private_casey', first_name: 'Secret', last_name: 'Person',
    display_name: 'Secret Person', email: 'hidden@private.test', is_private: true });
  const client = { rpc: (name, args) => db.rpc(A, name, args) };
  const search = async (text, extra = {}) => people(client, new URLSearchParams({ section: 'search', search: text, ...extra }));
  return { db, client, search, ids: async text => (await search(text)).people.map(p => p.id) };
}

test('search preserves explicit username/email queries and validates length and aliases', async () => {
  const f = fixture();
  assert.deepEqual(await f.ids(' @CAMPUS '), [B]);
  assert.equal(f.db.calls.at(-1).args.p_search, '@CAMPUS');
  assert.deepEqual(await f.ids('STUDENT@BYU'), [B]);
  await assert.rejects(f.search('x'.repeat(255)), { status: 400 });
  await assert.rejects(people(f.client, new URLSearchParams('section=search&search=a&q=b')), { status: 400 });
  assert.deepEqual((await f.search('x'.repeat(254))).people, []);
});

test('username and email matches are literal case-insensitive substrings, not typo matches', async () => {
  const f = fixture();
  for (const query of ['@CAMPUS', '@pus_bla', 'student@BYU', '@byu.edu', 'blair.student@byu.edu'])
    assert.deepEqual(await f.ids(query), [B], query);
  for (const query of ['@campus_blar', 'blar.student@byu.edu', 'student@byuu.edu', '%', '_%', '@'])
    assert.deepEqual(await f.ids(query), [], query);
});

test('names match first, last, partial/reversed full names and bounded close spellings', async () => {
  const f = fixture();
  for (const query of ['Jonathan', 'THOMPSON', 'jon thomp', 'Thompson Jonathan', '  JON   THOMP ', 'Jonathon', 'Thompsen'])
    assert.deepEqual(await f.ids(query), [B], query);
  assert.deepEqual(await f.ids('Zebediah'), []);
  assert.deepEqual(await f.ids('Jna'), [], 'three-letter typos do not use fuzzy matching');
});

test('private profiles match only usernames and emails never appear in result DTOs', async () => {
  const f = fixture();
  for (const query of ['Secret', 'Person', 'hidden@private.test', 'private.test'])
    assert.deepEqual(await f.ids(query), [], query);
  const found = await f.search('@PRIVATE_CASE');
  assert.deepEqual(found.people.map(p => p.id), [C]);
  assert.equal(found.people[0].isPrivate, true); assert.equal(found.people[0].photoUrl, null);
  assert(!JSON.stringify(found).includes('Secret'));
  assert(!JSON.stringify(found).includes('hidden@private.test'));
  const publicResult = await f.search('student@byu');
  assert(!JSON.stringify(publicResult).includes('blair.student@byu.edu'));
});

test('search ranks usernames before names before emails across pages, regardless of suggestions', async () => {
  const f = fixture();
  Object.assign(f.db.users[1], { username: 'jon_handle', first_name: 'Unrelated', last_name: 'One', email: 'one@example.test' });
  Object.assign(f.db.users[2], { username: 'second', first_name: 'Jonathan', last_name: 'Thompson', is_private: false, email: 'two@example.test' });
  const D = '44444444-4444-4444-8444-444444444444';
  f.db.users.push({ user_id: D, username: 'third', first_name: 'Unrelated', last_name: 'Three', display_name: 'Unrelated Three', is_private: false, email: 'jon@mail.test' });
  f.db.rsvps.set(A, new Set(['1','2','3'])); f.db.rsvps.set(D, new Set(['1','2','3']));
  const first = await f.search('jon', { limit: '1' });
  assert.deepEqual(first.people.map(p => p.id), [B]); assert.equal(first.nextCursor, B);
  const second = await f.search('jon', { limit: '1', after: first.nextCursor });
  assert.deepEqual(second.people.map(p => p.id), [C]); assert.equal(second.nextCursor, C);
  const third = await f.search('jon', { limit: '1', after: second.nextCursor });
  assert.deepEqual(third.people.map(p => p.id), [D]); assert.equal(third.nextCursor, null);
});

test('typed search finds existing friends and requests while blank search keeps new suggestions', async () => {
  const f = fixture();
  await f.db.rpc(A, 'send_friend_request', { p_recipient_user_id: B });
  assert.deepEqual((await f.search('campus')).people.map(p => p.relationship), ['outgoing_pending']);
  assert(!(await f.search('')).people.some(p => p.id === B));
  const id = f.db.attempts[0].FriendRequestID;
  await f.db.rpc(B, 'respond_to_friend_request', { p_request_id: id, p_accept: true });
  assert.deepEqual((await f.search('campus')).people.map(p => p.relationship), ['friends']);
});
