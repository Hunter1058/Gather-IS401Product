import test from 'node:test';
import assert from 'node:assert/strict';
import { authSessions } from '../lib/auth-session.js';
import { isSameOrigin } from '../lib/request-origin.js';

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}
const request = cookie => ({ headers: { cookie } });

test('sessions rotate HttpOnly cookies and use verified identities on a fresh client', async () => {
  let clients = 0;
  const sessions = authSessions(() => {
    clients++;
    return { auth: {
      async setSession(input) {
        assert.deepEqual(input, { access_token: 'old', refresh_token: 'refresh' });
        return { data: { session: { access_token: 'new', refresh_token: 'rotated', user: { id: 'untrusted' } } }, error: null };
      },
      async getUser() { return { data: { user: { id: 'verified' } }, error: null }; },
    } };
  }, { secure: true });
  const res = response();
  const result = await sessions.restore(request('gather_access=old; gather_refresh=refresh'), res);
  assert.equal(result.user.id, 'verified');
  assert.equal(clients, 1);
  const cookies = res.headers['Set-Cookie'];
  assert(cookies.some(c => c.startsWith('gather_access=new;')));
  assert(cookies.some(c => c.startsWith('gather_refresh=rotated;')));
  assert(cookies.every(c => c.includes('Secure') && c.includes('HttpOnly') && c.includes('SameSite=Lax')));
});

test('invalid tokens clear cookies, while an Auth outage preserves them for retry', async () => {
  let failure = { status: 401 };
  const sessions = authSessions(() => ({ auth: {
    async setSession() { return { data: {}, error: failure }; },
  } }));
  const req = request('gather_access=token; gather_refresh=refresh');
  const invalid = response();
  assert.equal(await sessions.restore(req, invalid), null);
  assert(invalid.headers['Set-Cookie'].every(c => c.includes('Max-Age=0')));
  failure = { status: 503 };
  const outage = response();
  await assert.rejects(sessions.restore(req, outage), { status: 503 });
  assert.equal(outage.headers['Set-Cookie'], undefined);
});

test('unverified users, partial cookies and malformed or duplicate cookies cannot sign in', async () => {
  let verified = false;
  const sessions = authSessions(() => ({ auth: {
    async setSession() { return { data: { session: { access_token: 'token', refresh_token: 'refresh' } }, error: null }; },
    async getUser() { verified = true; return { data: { user: null }, error: { status: 401 } }; },
  } }));
  for (const cookie of ['gather_session=' + 'a'.repeat(64), 'gather_access=token', 'gather_access=%ZZ; gather_refresh=r',
    'gather_access=a; gather_access=b; gather_refresh=r'])
    assert.equal(await sessions.restore(request(cookie), response()), null);
  assert.equal(verified, false);
  assert.equal(await sessions.restore(request('gather_access=token; gather_refresh=refresh'), response()), null);
  assert.equal(verified, true);
});

test('origin validation supports Vercel HTTPS, localhost, explicit origins and rejects cross-site requests', () => {
  const req = { headers: { host: 'gather-is-401-product.vercel.app', origin: 'https://gather-is-401-product.vercel.app' } };
  assert.equal(isSameOrigin(req, { VERCEL: '1' }), true);
  assert.equal(isSameOrigin(req, {}), false);
  assert.equal(isSameOrigin(req, { APP_ORIGIN: 'https://gather-is-401-product.vercel.app/' }), true);
  assert.equal(isSameOrigin({ headers: { ...req.headers, origin: 'https://attacker.example' } }, { VERCEL: '1' }), false);
  assert.equal(isSameOrigin({ headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }, {}), true);
  assert.equal(isSameOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }, { VERCEL: '1' }), false);
  assert.equal(isSameOrigin(req, { APP_ORIGIN: 'not a URL' }), false);
});
