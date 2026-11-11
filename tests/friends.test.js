import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { people, friendBody, userId, requestId } from '../lib/friends.js';
import { friendDatabase, A, B, C } from './helpers/friend-rpc.js';
const source = await readFile(new URL('../public/friend-actions.js', import.meta.url), 'utf8');
async function fixture() {
  const db = friendDatabase(); let actor = A, release, hold = false, failWrite = false, failRead = false;
  const writes = [], messages = [];
  const context = vm.createContext({ console, Map, Set, URL, URLSearchParams, encodeURIComponent,
    document: { activeElement: null, querySelectorAll() { return []; }, querySelector() {}, getElementById() {} } });
  context.window = context; vm.runInContext(source, context);
  const { sendRequest, cancelRequest, removeFriend } = await import('../lib/friends.js');
  const client = who => ({ rpc: (name, args) => db.rpc(who, name, args) });
  const controller = context.GatherFriends.create({ account: () => actor, changed() {}, notify: text => messages.push(text),
    login() { messages.push('login'); }, confirmRemove: () => true,
    async request(path, options = {}) {
      const owner = actor;
      assert.equal(options.headers['X-Gather-Account'], owner);
      if (path.startsWith('/friends/people')) {
        if (failRead) throw Error('Read failed');
        return { accountId: owner, ...await people(client(owner), new URL(path, 'http://fixture').searchParams) };
      }
      writes.push({ path, options });
      if (hold) await new Promise(resolve => { release = resolve; });
      if (failWrite) throw Error('Save failed');
      let person;
      if (options.method === 'POST') person = await sendRequest(client(owner), owner, friendBody(JSON.parse(options.body), true));
      else if (path.includes('/requests/')) person = await cancelRequest(client(owner), owner, path.split('/').at(-1));
      else person = await removeFriend(client(owner), owner, path.split('/').at(-1));
      return { accountId: owner, person };
    },
  });
  return { db, controller, messages, writes, setActor(value) { actor = value; },
    hold() { hold = true; }, release() { hold = false; release(); }, failWrite(value) { failWrite = value; }, failRead(value) { failRead = value; } };
}

test('friend inputs reject forged owner fields, invalid UUIDs and imprecise request IDs', () => {
  assert.equal(userId(B.toUpperCase()), B);
  assert.equal(requestId('9007199254740993'), '9007199254740993');
  for (const invalid of [9007199254740993, '0', '-1', '9223372036854775808']) assert.throws(() => requestId(invalid), { status: 400 });
  assert.throws(() => friendBody({ recipientId: B, UserID: A }, true), { status: 400 });
  assert.throws(() => friendBody({ actor: A }), { status: 400 });
  assert.throws(() => userId('bad'), { status: 400 });
});

test('friend directory pagination is bounded, excludes self and preserves text request IDs', async () => {
  const db = friendDatabase(), client = { rpc: (name, args) => db.rpc(A, name, args) };
  const first = await people(client, new URLSearchParams({ limit: '1' }));
  assert.deepEqual(first.people.map(p => p.id), [B]); assert.equal(first.nextCursor, B);
  const next = await people(client, new URLSearchParams({ after: B, limit: '1' }));
  assert.deepEqual(next.people.map(p => p.id), [C]); assert.equal(next.nextCursor, null);
  await assert.rejects(people(client, new URLSearchParams('limit=51')), { status: 400 });
  await assert.rejects(people(client, new URLSearchParams('limit=1&limit=2')), { status: 400 });
  await assert.rejects(people(client, new URLSearchParams({ personId: A })), { status: 404 });
  db.users[1].display_name = '\t '; db.users[1].username = '\n';
  const fallback = (await people(client, new URLSearchParams({ personId: B }))).people[0];
  assert.equal(fallback.name, 'Member ' + B.slice(0, 8)); assert.equal(fallback.username, null);
});

test('send/cancel/resend/accept/remove restore confirmed server state across controller reloads', async () => {
  const f = await fixture(); await f.controller.load();
  await f.controller.act(B);
  let person = f.controller.view().people.find(p => p.id === B);
  assert.equal(person.relationship, 'outgoing_pending'); assert.equal(person.requestId, '9007199254740993');
  await f.controller.load(); assert.equal(f.controller.view().people[0].relationship, 'outgoing_pending');
  await f.controller.act(B); assert.equal(f.db.attempts[0].Status, 'cancelled');
  assert.equal(f.controller.view().people[0].relationship, 'none');
  await f.controller.act(B); const second = f.db.attempts.at(-1);
  assert.notEqual(second.FriendRequestID, f.db.attempts[0].FriendRequestID);
  await f.db.rpc(B, 'respond_to_friend_request', { p_request_id: second.FriendRequestID, p_accept: true });
  await f.controller.load(); assert.equal(f.controller.view().people[0].relationship, 'friends');
  await f.controller.act(B); assert.equal(f.controller.view().people[0].relationship, 'none');
  assert.deepEqual(f.db.attempts.map(r => r.Status), ['cancelled', 'accepted']);
  await f.controller.load(); assert.equal(f.controller.view().people[0].relationship, 'none');
});

test('pending guards suppress duplicate clicks and preserve concurrent changes to other people', async () => {
  const f = await fixture(); await f.controller.load(); f.hold();
  const first = f.controller.act(B); await Promise.resolve();
  assert.equal(f.controller.view().people[0].pending, true);
  await f.controller.act(B); assert.equal(f.writes.length, 1);
  f.release(); await first;
  await Promise.all([f.controller.act(B), f.controller.act(C)]);
  assert.equal(f.controller.view().people.find(p => p.id === B).relationship, 'none');
  assert.equal(f.controller.view().people.find(p => p.id === C).relationship, 'outgoing_pending');
});

test('failed writes require authoritative refresh before another action and never report success', async () => {
  const f = await fixture(); await f.controller.load(); f.failWrite(true);
  await f.controller.act(B);
  assert.equal(f.controller.view().people[0].relationship, 'none');
  assert.match(f.controller.view().people[0].error, /Save failed/); assert.deepEqual(f.messages, []);
  await f.controller.act(B); assert.equal(f.writes.length, 1);
  f.failWrite(false); await f.controller.refreshPerson(B);
  assert.equal(f.controller.view().people[0].error, '');
  await f.controller.act(B); assert.equal(f.controller.view().people[0].relationship, 'outgoing_pending');
});

test('read failures are not empty successful results; incoming requests cannot be auto-accepted', async () => {
  const f = await fixture(); f.failRead(true); await f.controller.load();
  assert.equal(f.controller.view().ready, false); assert.match(f.controller.view().error, /Read failed/);
  await f.controller.act(B); assert.equal(f.writes.length, 0);
  f.failRead(false); await f.db.rpc(B, 'send_friend_request', { p_recipient_user_id: A }); await f.controller.load();
  assert.equal(f.controller.view().people[0].relationship, 'incoming_pending');
  await f.controller.act(B); assert.equal(f.writes.length, 0);
});

test('account switches discard in-flight responses and clear prior people and state', async () => {
  const f = await fixture(); await f.controller.load(); f.hold();
  const writing = f.controller.act(B); await Promise.resolve(); f.setActor(C);
  assert.equal(f.controller.view().people.length, 0);
  f.release(); await writing; assert.deepEqual(f.messages, []);
  await f.controller.load();
  assert.equal(f.controller.view().people.some(p => p.id === C), false);
  assert(f.controller.view().people.every(p => p.relationship === 'none'));
  f.setActor(null); await f.controller.act(B); assert.equal(f.messages.at(-1), 'login');
});


test('a committed send with a failed status read is recovered without creating another attempt', async () => {
  const f = await fixture(); await f.controller.load();
  f.db.errors.set('search_friend_people', 'XX000');
  await f.controller.act(B);
  assert.equal(f.db.attempts.length, 1); assert.equal(f.db.attempts[0].Status, 'pending');
  assert.equal(f.controller.view().people[0].relationship, 'none');
  assert(f.controller.view().people[0].error); assert.deepEqual(f.messages, []);
  await f.controller.act(B); assert.equal(f.db.attempts.length, 1);
  f.db.errors.clear(); await f.controller.refreshPerson(B);
  assert.equal(f.controller.view().people[0].relationship, 'outgoing_pending');
  assert.equal(f.db.attempts.length, 1);
});

test('people pagination appends distinct profiles without replacing earlier states', async () => {
  const f = await fixture();
  for (let i = 0; i < 25; i++) f.db.users.push({ user_id: '44444444-4444-4444-8444-' + String(i).padStart(12, '0'), display_name: 'Member ' + i, username: null });
  await f.controller.load(); assert.equal(f.controller.view().people.length, 24); assert.equal(f.controller.view().hasMore, true);
  await f.controller.act(B); await f.controller.load(true);
  assert.equal(f.controller.view().people.length, 27); assert.equal(f.controller.view().hasMore, false);
  assert.equal(f.controller.view().people[0].relationship, 'outgoing_pending');
});

test('an account mismatch in a response disables further actions until the page reloads', async () => {
  const context = vm.createContext({ console, Map, Set, URLSearchParams, encodeURIComponent, document: { activeElement: null } }); context.window = context;
  vm.runInContext(source, context); let calls = 0;
  const controller = context.GatherFriends.create({ account: () => A, changed() {}, notify() {}, login() {},
    async request() { calls++; return { accountId: B, people: [], nextCursor: null }; },
  });
  await controller.load(); assert.equal(controller.view().accountChanged, true);
  assert.equal(controller.view().ready, false); await controller.act(B); await controller.load(); assert.equal(calls, 1);
});

test('directory contract errors fail closed instead of rounding numeric request IDs', async () => {
  const client = { async rpc() { return { data: [{ user_id: B, display_name: 'Blair', username: null,
    relationship: 'outgoing_pending', request_id: 9007199254740993 }], error: null }; } };
  await assert.rejects(people(client, new URLSearchParams()), { status: 503 });
});

test('private search results expose only the username and no photo', async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'search_friend_people');
    assert.equal(args.p_query, 'blair');
    return { data: [{ user_id: B, username: 'blair', display_name: 'Full Name',
      is_private: true, photo_url: 'https://example.com/photo.jpg', relationship: 'friends' }] };
  } };
  const result = await people(client, new URLSearchParams({ q: '@blair' }));
  assert.equal(result.people[0].name, '@blair');
  assert.equal(result.people[0].photoUrl, null);
});

test('directory filters and ranks suggestions using shared RSVPs and mutual friends', async () => {
  const db = friendDatabase(), client = { rpc: (name, args) => db.rpc(A, name, args) };
  // Add a fourth profile: B is a friend, C shares an event, D knows B.
  const D = '44444444-4444-4444-8444-444444444444';
  db.users.push({ user_id: D, display_name: 'Dana', username: 'dana', is_private: false });
  db.friendships.add([A, B].sort().join(':')); db.friendships.add([B, D].sort().join(':'));
  db.rsvps.set(A, new Set(['event-1'])); db.rsvps.set(C, new Set(['event-1']));
  const suggestions = await people(client, new URLSearchParams({ section: 'search' }));
  assert.deepEqual(suggestions.people.map(p => p.id), [C, D]);
  assert.equal(suggestions.people[0].sharedEvents, 1); assert.equal(suggestions.people[1].mutualFriends, 1);
  const friends = await people(client, new URLSearchParams({ section: 'friends' }));
  assert.deepEqual(friends.people.map(p => p.id), [B]);
  const matching = await people(client, new URLSearchParams({ section: 'search', search: 'DANA' }));
  assert.deepEqual(matching.people.map(p => p.id), [D]);
  await db.rpc(C, 'send_friend_request', { p_recipient_user_id: A });
  const requests = await people(client, new URLSearchParams({ section: 'requests' }));
  assert.deepEqual(requests.people.map(p => p.id), [C]);
  assert.equal(requests.people[0].relationship, 'incoming_pending');
  await assert.rejects(people(client, new URLSearchParams({ section: 'unknown' })), { status: 400 });
  await assert.rejects(people(client, new URLSearchParams({ section: 'search', search: 'a'.repeat(255) })), { status: 400 });
});
