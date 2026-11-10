import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import { database } from './helpers/database.js';
import { friendDatabase, A, B, C } from './helpers/friend-rpc.js';

test('friend HTTP endpoints authenticate, validate actors, persist transitions and preserve history', { skip: !modules.registerHooks }, async () => {
  process.env.NODE_ENV = 'test'; process.env.SUPABASE_URL = 'https://fixture.invalid'; process.env.SUPABASE_KEY = 'test-key';
  const baseDB = database(), db = friendDatabase(), sessions = new Map(); let counter = 0;
  db.users[1].Email = 'private-target@example.test'; db.users[1].Password = 'do-not-expose';
  globalThis.__friendClientFactory = () => {
    let actor = null, current = null;
    return { ...baseDB.client, rpc: (name, args) => db.rpc(actor, name, args), auth: {
      async signInWithPassword({ email }) {
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
      url: 'data:text/javascript,export const createClient = () => globalThis.__friendClientFactory();', shortCircuit: true,
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
    const listing = await call('/people?limit=1', a, A); assert.equal(listing.status, 200);
    const page = await listing.json(); assert.equal(page.accountId, A); assert.equal(page.nextCursor, B);
    assert.deepEqual(Object.keys(page.people[0]).sort(), ['id', 'isPrivate', 'name', 'photoUrl', 'relationship', 'requestId', 'username']);
    assert(!JSON.stringify(page).includes('private-target')); assert(!JSON.stringify(page).includes('do-not-expose'));
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
    await db.rpc(B, 'respond_to_friend_request', { p_request_id: secondId, p_accept: true });
    assert.equal((await (await call('/people?personId=' + B, a, A)).json()).people[0].relationship, 'friends');
    const removed = await call('/' + B, a, A, 'DELETE', {}); assert.equal(removed.status, 200);
    assert.equal((await removed.json()).person.relationship, 'none');
    assert.deepEqual(db.attempts.map(r => r.Status), ['cancelled', 'accepted']);
    assert.equal((await call('/' + B, a, A, 'DELETE', {})).status, 200);
    const wrongAccount = await call('/requests', b, A, 'POST', { recipientId: C });
    assert.equal(wrongAccount.status, 409); assert.equal((await wrongAccount.json()).code, 'ACCOUNT_CHANGED');
    db.errors.set('search_friend_people', 'PGRST202');
    assert.equal((await call('/people', a, A)).status, 503);
    db.errors.clear();
    db.errors.set('send_friend_request', 'XX000');
    assert.equal((await call('/requests', a, A, 'POST', { recipientId: C })).status, 503);
    assert.equal(db.attempts.length, 2, 'a failed write never creates a local success');
  } finally {
    await new Promise(resolve => server.close(resolve)); hooks.deregister(); delete globalThis.__friendClientFactory;
  }
});
