// Browser contract checks use mocked APIs; live Supabase/RLS is a separate check.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || '@playwright/test');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const server = http.createServer(async (req, res) => {
  let path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') path = '/index.html';
  if (['/events', '/login'].includes(path)) path += '.html';
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'text/plain');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  const date = new Date(); date.setDate(date.getDate() + 3);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const events = ['1', '2'].map(id => ({ id, name: id === '1' ? 'Jazz & friends' : 'Campus games', category: 'Arts', location: 'Music Building', date: dateKey, start: '18:30:00', end: null, description: 'A friendly campus event.', poster: 'ARTS', friends: [], price: 0, food: false, club: 'Campus organizer', major: 'All majors' }));
  let account = 'a', failure = false, wait = 0, sessionFailure = false, plansFailure = false;
  const writes = [];
  const records = { a: { saved: [], rsvp: [] }, b: { saved: [], rsvp: [] } };
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let status = 200, body;
    if (path === '/api/config') body = { mode: 'supabase' };
    else if (path === '/api/events') body = { events };
    else if (path === '/api/auth/login') {
      account = 'a'; body = { user: { id: account, name: 'Student a' } };
    }
    else if (path === '/api/auth/session' && sessionFailure) { status = 503; body = { error: 'Account service unavailable' }; }
    else if (path === '/api/state' && plansFailure) { status = 503; body = { error: 'Plans service unavailable' }; }
    else if (path === '/api/auth/session') body = { user: account ? { id: account, name: 'Student ' + account } : null };
    else if (path === '/api/state') body = { accountId: account, state: { ...records[account], attended: [], friends: [], interests: [], reminders: {}, surveys: {} } };
    else if (/\/api\/events\/\d+\/(bookmark|rsvp)$/.test(path)) {
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (failure) { status = 500; body = { error: 'Unable to save. Try again.' }; failure = false; }
      else if (req.headers()['x-gather-account'] !== account) { status = 409; body = { error: 'Your account changed in another tab. Reload before saving.' }; }
      else {
        const [, id, kind] = /\/events\/(\d+)\/(bookmark|rsvp)$/.exec(path);
        const payload = req.postDataJSON(), field = kind === 'bookmark' ? 'bookmarked' : 'going', list = kind === 'bookmark' ? 'saved' : 'rsvp';
        writes.push({ account, id, kind, payload });
        records[account][list] = records[account][list].filter(value => value !== id);
        if (payload[field]) records[account][list].push(id);
        body = { eventId: id, [field]: payload[field] };
      }
    } else { status = 404; body = { error: 'Unknown mock endpoint' }; }
    await route.fulfill({ status, json: body });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const control = (kind, id = '1') => page.locator(`.event-card [data-plan-kind="${kind}"][data-event-id="${id}"]`);
  const pressed = (kind, expected, id = '1') => page.waitForFunction(({kind, id, expected}) => document.querySelector(`.event-card [data-plan-kind="${kind}"][data-event-id="${id}"]`)?.getAttribute('aria-pressed') === expected, { kind, id, expected: String(expected) });
  await page.goto(base + '/events');
  await page.waitForSelector('.event-card');
  assert.equal(await page.locator('.event-card').count(), 2);
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.locator('#toolbarReopenButton').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#toolbar').isVisible(), false);
  assert.equal(await page.getByRole('textbox', { name: 'Search events' }).isVisible(), false);
  await page.getByRole('button', { name: 'Show search & filters', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search events' }).isVisible(), true);

  await page.locator('.event-card .metadata').first().click();
  await page.waitForFunction(() => document.getElementById('modal').open);
  await page.getByRole('button', { name: 'Close event details' }).click();
  await page.locator('.event-card').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('modal').open);
  await page.getByRole('button', { name: 'Close event details' }).click();

  assert.equal(await page.getByRole('button', { name: /^Share/ }).count(), 2);


  wait = 250;
  await control('bookmark').click();
  await page.waitForFunction(() => document.querySelector('.event-card [data-plan-kind="bookmark"]').disabled);
  await pressed('bookmark', true);
  assert.equal(await control('bookmark').evaluate(el => el === document.activeElement), true);
  wait = 0;
  await control('rsvp').click(); await pressed('rsvp', true);
  assert.equal(await page.locator('dialog').evaluate(el => el.open), false, 'list action must not open a modal');
  await page.reload(); await pressed('bookmark', true); await pressed('rsvp', true);

  failure = true;
  await control('bookmark', '2').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Unable to save'));
  await pressed('bookmark', false, '2');
  await page.evaluate(() => Promise.all([bookmark('2'), rsvp('2')]));
  await pressed('bookmark', true, '2'); await pressed('rsvp', true, '2');
  await control('rsvp').click(); await pressed('rsvp', false);
  assert.deepEqual(records.a.rsvp, ['2']);

  await page.getByRole('button', { name: 'Bookmarked', exact: true }).click();
  await control('bookmark').click();
  await page.waitForSelector('.card [data-event-id="1"]', { state: 'detached' });
  await page.getByRole('button', { name: 'All upcoming', exact: true }).click();
  await pressed('bookmark', false);
  await page.getByRole('button', { name: 'All upcoming', exact: true }).click();

  // The legacy Saved page must read the same server preferences and API.
  await page.goto(base + '/#saved');
  await page.waitForSelector('.card [data-plan-kind="bookmark"][data-event-id="2"]');
  await page.locator('.card [data-plan-kind="bookmark"][data-event-id="2"]').click();
  await page.waitForFunction(() => !document.querySelector('.card [data-plan-kind="bookmark"][data-event-id="2"]'));
  assert.deepEqual(records.a.saved, []);

  await page.goto(base + '/events'); await page.waitForSelector('.event-card');
  account = 'b';
  await control('bookmark').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('account changed'));
  assert.deepEqual(records.b.saved, []);
  await page.reload(); await pressed('bookmark', false); await pressed('rsvp', false, '2');
  await control('bookmark').click(); await pressed('bookmark', true);
  assert.deepEqual(records.a.saved, []);

  await page.getByRole('button', { name: 'View details for Jazz & friends', exact: true }).click();
  await page.locator('dialog [data-plan-kind="rsvp"]').click();
  await page.waitForFunction(() => document.querySelector('dialog [data-plan-kind="rsvp"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
  await page.getByRole('button', { name: 'Close event details' }).click();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../artifacts/events-desktop.png', import.meta.url).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile should not overflow');
  assert.equal(await control('bookmark').evaluate(el => el.getBoundingClientRect().height >= 44), true);
  assert.equal(await control('rsvp').evaluate(el => el.getBoundingClientRect().height >= 44), true);
  await page.screenshot({ path: new URL('../artifacts/events-mobile.png', import.meta.url).pathname, fullPage: true });
  plansFailure = true;
  await page.reload(); await page.waitForSelector('.event-card');
  assert.equal(await control('bookmark').isDisabled(), true);
  assert.equal(await page.getByText(/Plans service unavailable/).count(), 1);
  plansFailure = false;
  sessionFailure = true;
  await page.reload(); await page.waitForSelector('.event-card');
  assert.equal(await control('rsvp').isDisabled(), true);
  assert.equal(await page.getByText(/Account service unavailable/).count(), 1);
  sessionFailure = false;
  account = null;
  await page.reload(); await page.waitForSelector('.event-card');
  await control('bookmark').click(); await page.waitForURL('**/login');
  await page.getByLabel('Email', { exact: true }).fill('a@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-pass-123');
  await page.locator('form.auth')
  .getByRole('button', { name: 'Sign in', exact: true })
  .click();
  await page.waitForURL(base + '/');
  await page.goto(base + '/events'); await page.waitForSelector('.event-card');
  assert.equal(await page.locator('#userButton').textContent(), 'SA');
  await page.reload(); await page.waitForSelector('.event-card');
  assert.equal(await page.locator('#userButton').textContent(), 'SA');
  records.a.saved = ['1'];
  await page.goto(base + '/');
  await page.waitForSelector('.grid .card .event-share');
  assert.equal(await page.locator('.grid .card .event-rsvp').count(), 2);
  assert.equal(await page.locator('.hero-art .event-share').count(), 1);
  assert.equal(await page.locator('.mini-event .event-share').count(), 1);
  await page.evaluate(() => {
    navigator.share = async payload => { window.sharedEvent = payload; };
  });
  await page.locator('.grid .card .event-share').first().click();
  const shared = await page.evaluate(() => window.sharedEvent);
  assert.equal(shared.url, base + '/events?event=1');
  await page.locator('.grid .card [data-plan-kind="rsvp"]').first().click();
  await page.waitForFunction(() => document.querySelector('.grid .card [data-plan-kind="rsvp"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'home mobile should not overflow');
  await page.goto(shared.url);
  await page.waitForFunction(() => document.getElementById('modal').open);
  assert.match(await page.locator('dialog h2').textContent(), /Jazz/);
  assert.deepEqual(errors, []);
  assert(writes.every(write => !('UserID' in write.payload)));
  console.log('PASS: persistence/reload, errors, pending, focus, concurrent actions, filters, Saved integration, account isolation, modal, guest redirect, mobile, account-service outages, login/reload, shared event links, home Share/Going controls.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
