// Real DOM/browser UX checks, using the real friend service and fake database.
// Actual Supabase/RLS is tested separately by the SQL rehearsal/live checks.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { people, sendRequest, cancelRequest, removeFriend, respondRequest } from '../lib/friends.js';
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
          const response = /\/requests\/([^/]+)\/(accept|deny)$/.exec(path);
          const person = response ? await respondRequest(client, account, response[1], response[2] === 'accept') : req.method() === 'POST' ? await sendRequest(client, account, input.recipientId)
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
  db.rsvps.set(A, new Set(['event-1'])); db.rsvps.set(B, new Set(['event-1']));
  await page.goto(base + '/');
  await page.getByRole('button', { name: 'Friends', exact: true }).first().click();
  await page.waitForURL(base + '/#friends');
  await page.getByText('Your friend list starts here.', { exact: false }).waitFor();
  await page.getByRole('tab', { name: 'Search Friends' }).click(); await status('none');
  await page.getByText('1 shared RSVP', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-person-id]').count(), 1);
  await page.getByRole('button', { name: 'Load more people', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-person-id]').length === 2);
  delay = 180; await action().click();
  await page.waitForFunction(id => document.querySelector(`[data-person-id="${id}"] [data-friend-control="action"]`).disabled, B);
  await page.evaluate(id => friendAction(id), B);
  await card().waitFor({ state: 'detached' }); assert.equal(db.attempts.length, 1);
  delay = 0;
  await page.getByRole('tab', { name: 'Requests', exact: true }).click(); await status('outgoing_pending');
  assert.equal(await action().isEnabled(), true);
  await page.reload();
  await page.getByRole('tab', { name: 'Requests', exact: true }).click(); await status('outgoing_pending');
  await action().click(); await card().waitFor({ state: 'detached' });
  assert.equal(db.attempts[0].Status, 'cancelled');
  await db.rpc(B, 'send_friend_request', { p_recipient_user_id: A });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await status('incoming_pending');
  await card().getByRole('button', { name: 'Accept', exact: false }).click();
  await card().waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'My Friends', exact: true }).click(); await status('friends');
  page.once('dialog', dialog => dialog.dismiss()); await action().click();
  await page.waitForFunction(id => !document.querySelector(`[data-person-id="${id}"] [data-friend-control="action"]`).disabled, B);
  assert.equal(db.status(A, B).relationship, 'friends');
  page.once('dialog', dialog => dialog.accept()); await action().click(); await card().waitFor({ state: 'detached' });
  await db.rpc(B, 'send_friend_request', { p_recipient_user_id: A });
  await page.getByRole('tab', { name: 'Requests', exact: true }).click(); await status('incoming_pending');
  await card().getByRole('button', { name: 'Deny', exact: false }).click(); await card().waitFor({ state: 'detached' });
  assert.equal(db.attempts.at(-1).Status, 'declined');
  await page.getByRole('tab', { name: 'Search Friends' }).click(); await status('none');
  await page.getByLabel('Find someone on Gather').fill('Casey');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('heading', { name: 'Casey', exact: true }).waitFor();
  assert.equal(await card().count(), 0);
  Object.assign(db.users[1], { username: 'campus_blair', first_name: 'Jonathan', last_name: 'Thompson', email: 'blair.student@byu.edu' });
  const searchPeople = async query => {
    const response = page.waitForResponse(response => response.url().includes('/api/friends/people?') && response.url().includes('section=search'));
    await page.getByLabel('Find someone on Gather').fill(query);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await response;
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('friendsRefresh').disabled);
  };
  for (const query of ['@campus_bla', 'Jonathon', 'Thompson', 'student@byu']) {
    await searchPeople(query); await status('none');
    assert.equal(await card().locator('.friend-username').textContent(), '@campus_blair');
  }
  for (const query of ['@campus_blar', 'blar.student@byu.edu']) {
    await searchPeople(query); assert.equal(await card().count(), 0);
  }
  db.users[1].is_private = true;
  for (const query of ['Jonathan', 'student@byu']) {
    await searchPeople(query); assert.equal(await card().count(), 0);
  }
  await searchPeople('@campus'); await status('none');
  await card().getByRole('heading', { name: 'Private account', exact: true }).waitFor();
  assert.equal(await card().locator('.friend-username').textContent(), '@campus_blair');
  db.users[1].is_private = false;
  await searchPeople(''); await status('none');
  failWrite = true; await action().click();
  await card().getByRole('button', { name: 'Refresh status', exact: true }).waitFor();
  assert.equal(await action().isDisabled(), true);
  await card().getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.waitForFunction(id => !document.querySelector(`[data-person-id="${id}"] [data-friend-control="action"]`).disabled, B);
  account = B; await action().click();
  await page.getByRole('button', { name: 'Reload page', exact: true }).waitFor();
  account = A; await page.reload();
  await page.getByText('Your friend list starts here.', { exact: false }).waitFor();
  await page.getByRole('tab', { name: 'My Friends', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.activeElement?.id === 'friends-tab-search');
  await status('none');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  account = null; await page.reload();
  await page.getByText('Sign in to connect with people.', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-person-id]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: tabs, suggested RSVPs, paging, send/cancel, accept/deny, reload, duplicate prevention, remove confirmation, partial username/email search, fuzzy names, private discovery, failed-save recovery, stale accounts, keyboard, guest privacy, mobile.');

} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
