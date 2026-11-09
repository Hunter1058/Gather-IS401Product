// Real DOM/browser UX checks, using the real friend service and fake database.
// Actual Supabase/RLS is tested separately by the SQL rehearsal/live checks.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { people, sendRequest, cancelRequest, removeFriend } from '../lib/friends.js';
import { friendDatabase, A, B } from './helpers/friend-rpc.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || '@playwright/test');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const server = http.createServer(async (req, res) => {
  let path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') path = '/index.html';
  if (path === '/login') path = '/login.html';
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  const db = friendDatabase(); let account = A, delay = 0, failWrite = false;
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()); let status = 200, payload;
    try {
      const path = url.pathname;
      if (path === '/api/config') payload = { mode: 'supabase' };
      else if (path === '/api/auth/session') payload = { user: account ? { id: account, name: 'Test member' } : null };
      else if (path === '/api/state') payload = { accountId: account, state: { saved: [], rsvp: [] } };
      else if (path === '/api/events') payload = { events: [] };
      else if (path.startsWith('/api/friends/')) {
        if (!account) throw Object.assign(Error('Sign in'), { status: 401 });
        if (req.headers()['x-gather-account'] !== account)
          throw Object.assign(Error('Your account changed. Reload the page.'), { status: 409, code: 'ACCOUNT_CHANGED' });
        const client = { rpc: (name, args) => db.rpc(account, name, args) };
        if (path === '/api/friends/people') {
          // One-row pages intentionally exercise Load more with the small fixture.
          if (!url.searchParams.has('personId')) url.searchParams.set('limit', '1');
          payload = { accountId: account, ...await people(client, url.searchParams) };
        } else {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          if (failWrite) { failWrite = false; throw Object.assign(Error('Simulated save failure'), { status: 503 }); }
          const input = req.postDataJSON();
          const person = req.method() === 'POST' ? await sendRequest(client, account, input.recipientId)
            : path.includes('/requests/') ? await cancelRequest(client, account, path.split('/').at(-1))
            : await removeFriend(client, account, path.split('/').at(-1));
          payload = { accountId: account, person };
        }
      } else throw Object.assign(Error('Unknown fixture endpoint'), { status: 404 });
    } catch (error) { status = error.status || 500; payload = { error: error.message, code: error.code }; }
    await route.fulfill({ status, json: payload });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const card = () => page.locator(`[data-person-id="${B}"]`);
  const action = () => card().locator('[data-friend-control="action"]');
  const status = expected => page.waitForFunction(({ id, expected }) =>
    document.querySelector(`[data-person-id="${id}"] [data-friend-status]`)?.dataset.friendStatus === expected, { id: B, expected });
  await page.goto(base + '/');
  await page.getByRole('button', { name: 'Friends', exact: true }).first().click();
  await page.waitForURL(base + '/#friends'); await status('none');
  assert.equal(await page.locator('[data-person-id]').count(), 1);
  await page.getByRole('button', { name: 'Load more people', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-person-id]').length === 2);
  delay = 180;
  await action().click();
  await page.waitForFunction(id => document.querySelector(`[data-person-id="${id}"] [data-friend-control="action"]`).disabled, B);
  await page.evaluate(id => friendAction(id), B); // duplicate while the first is pending
  await status('outgoing_pending'); assert.equal(db.attempts.length, 1);
  assert.equal(await action().evaluate(el => el === document.activeElement), true);
  delay = 0;
  await page.reload(); await status('outgoing_pending');
  await action().click(); await status('none'); assert.equal(db.attempts[0].Status, 'cancelled');
  await action().click(); await status('outgoing_pending');
  await db.rpc(B, 'respond_to_friend_request', { p_request_id: db.attempts[1].FriendRequestID, p_accept: true });
  await page.getByRole('button', { name: 'Refresh people', exact: true }).click(); await status('friends');
  page.once('dialog', dialog => dialog.dismiss()); await action().click(); await status('friends');
  page.once('dialog', dialog => dialog.accept()); await action().click(); await status('none');
  assert.deepEqual(db.attempts.map(row => row.Status), ['cancelled', 'accepted']);
  failWrite = true;
  await action().click();
  await card().getByRole('button', { name: 'Refresh status', exact: true }).waitFor();
  assert.equal(await action().isDisabled(), true); assert.equal(db.attempts.length, 2);
  await card().getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.waitForFunction(id => !document.querySelector(`[data-person-id="${id}"] [data-friend-control="action"]`).disabled, B);
  await action().click(); await status('outgoing_pending');
  account = B;
  await action().click();
  await page.getByRole('button', { name: 'Reload page', exact: true }).waitFor();
  assert.equal(db.attempts.at(-1).Status, 'pending');
  await page.reload();
  await page.locator(`[data-person-id="${A}"] [data-friend-status="incoming_pending"]`).waitFor();
  assert.equal(await page.locator(`[data-person-id="${A}"] [data-friend-control="action"]`).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  account = null; await page.reload();
  await page.getByText('Sign in to connect with people.', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-person-id]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real people, paging, send/cancel/reload, duplicate prevention, focus, remove confirmation, retained history, failed-save recovery, stale accounts, incoming status, guest privacy, mobile.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
