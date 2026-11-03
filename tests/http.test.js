import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import { database, USER_A, USER_B } from './helpers/database.js';

test('HTTP auth, owner mapping, validation, CSRF and individual writes', { skip: !modules.registerHooks && 'Requires Node 22.15+ for a dependency-isolated HTTP test' }, async () => {
  const db = database();
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_KEY = 'publishable-test';
  globalThis.__gatherTestClientFactory = () => {
    let user = null;
    return { ...db.client, auth: {
      async signInWithPassword({ email }) {
        user = { id: email.startsWith('a@') ? USER_A : USER_B, email };
        return { data: { user, session: { access_token: 'test' } }, error: null };
      },
      async getSession() { return { data: { session: user ? {} : null }, error: null }; },
      async getUser() { return { data: { user }, error: null }; },
      async signOut() { user = null; },
    } };
  };
  const hooks = modules.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@supabase/supabase-js') return {
        url: 'data:text/javascript,export const createClient = (...args) => globalThis.__gatherTestClientFactory(...args);',
        shortCircuit: true,
      };
      return next(specifier, context);
    },
  });
  const { server } = await import('../server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(email) {
    const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  const call = (path, cookie, method = 'GET', body, extra = {}) => fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    // Exercise the real event endpoint with both PostgREST relation shapes.
    db.rows.Events[0].categoryLinks = { category: { EventCatagory: 'Arts' } };
    db.rows.Events[1].categoryLinks = [
      { category: { EventCatagory: 'Spiritual' } },
      { category: { EventCatagory: 'Arts' } },
      { category: { EventCatagory: 'Arts' } },
      { category: null },
    ];
    db.rows.Events.push({ EventID: '3', categoryLinks: [] });
    const listing = await call('/events');
    assert.equal(listing.status, 200);
    const listed = (await listing.json()).events;
    assert.equal(listed.length, 3, 'joining categories must not duplicate events');
    assert.deepEqual(listed[0].categories, ['Arts']);
    assert.deepEqual(listed[1].categories, ['Arts', 'Spiritual']);
    assert.equal(listed[1].category, 'Arts');
    assert.equal(listed[2].category, 'Campus event');
    assert.deepEqual(listed[2].categories, []);
    assert.match(db.calls.find(c => c.table === 'Events').projection,
      /categoryLinks:Event_Category_Linking_Table\(category:EventCategory\(EventCatagory\)\)/);
    db.errors.set('Events', { message: 'category listing denied' });
    assert.equal((await call('/events')).status, 500);
    db.errors.delete('Events');
    assert.equal((await call('/state')).status, 401);
    assert.equal((await call('/events/1/bookmark', null, 'PUT', { bookmarked: true })).status, 401);
    const a = await login('a@example.test');
    const b = await login('b@example.test');
    assert.equal((await call('/events/1/bookmark', a, 'PUT', { bookmarked: true })).status, 200);
    assert.equal((await call('/events/2/bookmark', a, 'PUT', { bookmarked: true })).status, 200);
    assert.equal((await call('/events/1/rsvp', a, 'PUT', { going: true })).status, 200);
    assert.equal((await call('/events/1/rsvp', a, 'PUT', { going: false })).status, 200);
    assert.deepEqual((await (await call('/state', a)).json()).state.saved, ['1', '2']);
    assert.deepEqual((await (await call('/state', a)).json()).state.rsvp, []);
    assert.deepEqual((await (await call('/state', b)).json()).state.saved, []);
    assert.equal(db.rows.Bookmark[0].UserID, USER_A);
    assert.equal((await call('/events/1/bookmark', a, 'PUT', { bookmarked: true, UserID: USER_B })).status, 400);
    assert.equal((await call('/events/nope/rsvp', a, 'PUT', { going: true })).status, 400);
    assert.equal((await call('/events/99/rsvp', a, 'PUT', { going: true })).status, 404);
    assert.equal((await call('/events/1/rsvp', a, 'PUT', { going: true }, { Origin: 'https://elsewhere.test' })).status, 403);
    assert.equal((await call('/events/1/rsvp', b, 'PUT', { going: true }, { 'X-Gather-Account': USER_A })).status, 409);
    assert.equal((await call('/state', a, 'PUT', { saved: [] })).status, 405);
    db.errors.set('Bookmark', { code: '42501', message: 'denied' });
    assert.equal((await call('/state', a)).status, 500);
    db.errors.delete('Bookmark');
    await call('/auth/logout', a, 'POST', {});
    assert.equal((await call('/state', a)).status, 401);
    assert.equal((await call('/state', b)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    hooks.deregister();
    delete globalThis.__gatherTestClientFactory;
  }
});
