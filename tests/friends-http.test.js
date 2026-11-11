import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import { database } from './helpers/database.js';
import { friendDatabase, A, B, C } from './helpers/friend-rpc.js';

test('friend HTTP endpoints authenticate, validate actors, persist transitions and preserve history', { skip: !modules.registerHooks }, async () => {
  process.env.NODE_ENV = 'test'; process.env.SUPABASE_URL = 'https://fixture.invalid'; process.env.SUPABASE_KEY = 'test-key';
  process.env.SUPABASE_ACCOUNT_DELETION_KEY = 'test-deletion-key';
  const deletions = [];
  const baseDB = database(), db = friendDatabase(), sessions = new Map(); let counter = 0;
  db.users[1].Email = 'private-target@example.test'; db.users[1].Password = 'do-not-expose';
  globalThis.__friendClientFactory = key => {
    if (key === 'test-deletion-key') return { auth: { admin: {
      async deleteUser(id, soft) { deletions.push({ id, soft }); return { error: null }; },
    } } };
    let actor = null, current = null;
    return { ...baseDB.client, rpc: (name, args) => db.rpc(actor, name, args), auth: {
      async signInWithPassword({ email, password }) {
        if (password !== 'test-pass-123') return { error: { status: 400 } };
        actor = email.startsWith('a@') ? A : email.startsWith('b@') ? B : C;
        current = { access_token: 'access-' + ++counter, refresh_token: 'refresh-' + counter, user: { id: actor, email } };
        sessions.set(current.access_token, current); return { data: { user: current.user, session: current }, error: null };
      },
      async setSession(input) {
        current = sessions.get(input.access_token);
        if (!current || current.refresh_token !== input.refresh_token) return { data: {}, error: { status: 401 } };
        actor = current.user.id; return { data: { session: current }, error: null };
      },
      async getUser() { return { data: { user: current?.user || null }, error: null }; },
      async signOut() { sessions.delete(current?.access_token); return { error: null }; },
    } };
  };
  const hooks = modules.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@supabase/supabase-js') return {
      url: 'data:text/javascript,export const createClient = (_url, key) => globalThis.__friendClientFactory(key);', shortCircuit: true,
    };
    return next(specifier, context);
  } });
  const { server } = await import('../server.js'); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(email) {
    const res = await fetch(base + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'test-pass-123' }) });
    assert.equal(res.status, 200);
    return res.headers.getSetCookie().filter(c => !c.startsWith('gather_session=')).map(c => c.split(';')[0]).join('; ');
  }
  const call = (path, cookie, actor, method = 'GET', body, extra = {}) => fetch(base + '/api/friends' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...(actor ? { 'X-Gather-Account': actor } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await call('/people')).status, 401);
    const a = await login('a@example.test'), b = await login('b@example.test'), c = await login('c@example.test');
    const deleteAccount = (cookie, actor, body, origin) => fetch(base + '/api/auth/account', {
      method: 'DELETE',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Gather-Account': actor,
        ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
    const confirmation = { password: 'test-pass-123', confirmation: 'DELETE', userId: A };
    assert.equal((await deleteAccount(null, C, confirmation)).status, 401);
    assert.equal((await deleteAccount(c, A, confirmation)).status, 409);
    assert.equal((await deleteAccount(c, C, confirmation, 'https://attacker.example')).status, 403);
    assert.equal((await deleteAccount(c, C, { ...confirmation, password: 'wrong' })).status, 403);
    assert.equal((await deleteAccount(c, C, { ...confirmation, confirmation: '' })).status, 400);
    assert.deepEqual(deletions, []);
    const deleted = await deleteAccount(c, C, confirmation);
    assert.equal(deleted.status, 200);
    assert(deleted.headers.getSetCookie().some(cookie => cookie.includes('Max-Age=0')));
    assert.deepEqual(deletions, [{ id: C, soft: false }]);
    const listing = await call('/people?limit=1', a, A); assert.equal(listing.status, 200);
    const page = await listing.json(); assert.equal(page.accountId, A); assert.equal(page.nextCursor, B);
    assert.deepEqual(Object.keys(page.people[0]).sort(), ['connectionDegree', 'id', 'isPrivate', 'mutualFriends', 'name', 'photoUrl', 'relationship', 'requestId', 'sharedEvents', 'sharedInterests', 'username']);
    assert(!JSON.stringify(page).includes('private-target')); assert(!JSON.stringify(page).includes('do-not-expose'));
    db.interests.set(A,new Set(['arts'])); db.interests.set(B,new Set(['arts']));
    const recommendations = await call('/people?section=search&search=',a,A);
    assert.equal(recommendations.status,200);
    const suggested = await recommendations.json();
    assert.deepEqual(suggested.people.map(p=>p.id),[B]);
    assert.equal(suggested.people[0].sharedInterests,1);
    assert.equal(db.calls.at(-1).name,'get_friend_recommendations');
    db.errors.set('get_friend_recommendations','PGRST202');
    assert.equal((await call('/people?section=search',a,A)).status,503);
    db.errors.clear();
    assert.equal((await call('/people?limit=51', a, A)).status, 400);
    assert.equal((await call('/requests', a, null, 'POST', { recipientId: B })).status, 409);
    assert.equal((await call('/requests', a, B, 'POST', { recipientId: B })).status, 409);
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: B }, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: B, UserID: C })).status, 400);
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: A })).status, 400);
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: 'invalid' })).status, 400);
    const sent = await call('/requests', a, A, 'POST', { recipientId: B }); assert.equal(sent.status, 200);
    const person = (await sent.json()).person; assert.equal(person.relationship, 'outgoing_pending');
    assert.equal(person.requestId, '9007199254740993');
    const retry = await call('/requests', a, A, 'POST', { recipientId: B }); assert.equal(retry.status, 200); assert.equal(db.attempts.length, 1);
    assert.equal((await (await call('/people?personId=' + B, a, A)).json()).people[0].requestId, person.requestId);
    assert.equal((await (await call('/people?personId=' + A, b, B)).json()).people[0].relationship, 'incoming_pending');
    assert.equal((await call('/requests/' + person.requestId, c, C, 'DELETE', {})).status, 403);
    assert.equal((await call('/requests/' + person.requestId, b, B, 'DELETE', {})).status, 403);
    assert.equal((await call('/requests/9223372036854775808', a, A, 'DELETE', {})).status, 400);
    const cancelled = await call('/requests/' + person.requestId, a, A, 'DELETE', {});
    assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).person.relationship, 'none');
    assert.equal(db.attempts[0].Status, 'cancelled');
    await call('/requests', a, A, 'POST', { recipientId: B });
    const secondId = db.attempts[1].FriendRequestID; assert.notEqual(secondId, person.requestId);
    assert.equal((await call('/requests/' + secondId + '/accept', a, A, 'POST', {})).status, 403);
    assert.equal((await call('/requests/' + secondId + '/accept', c, C, 'POST', {})).status, 403);
    const accepted = await call('/requests/' + secondId + '/accept', b, B, 'POST', {});
    assert.equal(accepted.status, 200); assert.equal((await accepted.json()).person.relationship, 'friends');
    const friends = await (await call('/people?section=friends', a, A)).json();
    assert.deepEqual(friends.people.map(p => p.id), [B]);
    assert.equal((await call('/people?section=invalid', a, A)).status, 400);
    assert.equal((await (await call('/people?personId=' + B, a, A)).json()).people[0].relationship, 'friends');
    const removed = await call('/' + B, a, A, 'DELETE', {}); assert.equal(removed.status, 200);
    assert.equal((await removed.json()).person.relationship, 'none');
    assert.deepEqual(db.attempts.map(r => r.Status), ['cancelled', 'accepted']);
    assert.equal((await call('/' + B, a, A, 'DELETE', {})).status, 200);
    await call('/requests', c, C, 'POST', { recipientId: A });
    const incoming = (await (await call('/people?section=requests', a, A)).json()).people[0];
    const denied = await call('/requests/' + incoming.requestId + '/deny', a, A, 'POST', {});
    assert.equal(denied.status, 200); assert.equal((await denied.json()).person.relationship, 'none');
    assert.equal(db.attempts.at(-1).Status, 'declined');
    const wrongAccount = await call('/requests', b, A, 'POST', { recipientId: C });
    assert.equal(wrongAccount.status, 409); assert.equal((await wrongAccount.json()).code, 'ACCOUNT_CHANGED');
    Object.assign(db.users[1], { username: 'campus_blair', first_name: 'Jonathan', last_name: 'Thompson', email: 'blair.student@byu.edu' });
    const querySearch = async text => {
      const result = await call('/people?' + new URLSearchParams({ section: 'search', search: text }), a, A);
      assert.equal(result.status, 200); return result.json();
    };
    for (const text of ['@campus_bla', 'Jonathon', 'Thompson', 'student@byu']) {
      const result = await querySearch(text);
      assert.deepEqual(result.people.map(p => p.id), [B], text);
      assert(!JSON.stringify(result).includes('blair.student@byu.edu'));
    }
    assert.deepEqual((await querySearch('@campus_blar')).people, []);
    assert.deepEqual((await querySearch('blar.student@byu.edu')).people, []);
    db.users[1].is_private = true;
    assert.deepEqual((await querySearch('student@byu')).people, []);
    assert.deepEqual((await querySearch('Jonathan')).people, []);
    assert.deepEqual((await querySearch('@campus')).people.map(p => p.id), [B]);
    db.errors.set('search_friend_people', 'PGRST202');
    assert.equal((await call('/people', a, A)).status, 503);
    db.errors.clear();
    db.errors.set('send_friend_request', 'XX000');
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: C })).status, 503);
    assert.equal(db.attempts.length, 3, 'a failed write never creates a local success');
    db.errors.clear();db.users[1].is_private=false;
    db.rsvps.set(A,new Set(['1']));db.rsvps.set(B,new Set(['1','2']));
    db.eventRecords.set('1',{name:'Shared jazz',date:'2026-11-15',location:'Music Building'});
    assert.equal((await call('/people/'+B+'/connections?kind=events')).status,401);
    assert.equal((await call('/people/'+B+'/connections?kind=events',a,B)).status,409);
    assert.equal((await call('/people/'+B+'/connections?kind=unknown',a,A)).status,400);
    const shared=await call('/people/'+B+'/connections?kind=events',a,A);
    assert.equal(shared.status,200);assert.deepEqual((await shared.json()).items.map(e=>e.id),['1']);
    db.users[1].is_private=true;
    const hidden=await call('/people/'+B+'/connections?kind=events',a,A);
    assert.equal(hidden.status,200);assert.deepEqual((await hidden.json()).items,[]);

  } finally {
    await new Promise(resolve => server.close(resolve)); hooks.deregister(); delete globalThis.__friendClientFactory;
  }
});
