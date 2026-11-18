// Browser contract checks use mocked APIs; live Supabase/RLS is a separate check.
import assert from 'node:assert/strict';
import {checkDrawer} from './helpers/mobile-layout.js';
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
  const writes = [], views = [];
  let viewFailure = false;
  let attendanceFailure = false;
  const attendance = {a:{'1':{count:'2',friends:[
    {id:'11111111-1111-4111-8111-111111111111',label:'Blair <friend>'},
    {id:'22222222-2222-4222-8222-222222222222',label:'Casey'},
  ]}},b:{}};
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
    else if (path === '/api/state') body = { accountId: account, state: { ...records[account], friendAttendance:attendanceFailure?{}:attendance[account], friendsGoing:attendanceFailure?[]:Object.keys(attendance[account]), friendsGoingError:attendanceFailure?'Attendance unavailable':'', attended: [], friends: [], interests: [], reminders: {}, surveys: {} } };
    else if (/\/api\/events\/\d+\/view$/.test(path)) {
      views.push({path, account:req.headers()['x-gather-account']});
      status = viewFailure ? 503 : 201; body = viewFailure ? {error:'Unavailable'} : {logged:true};
    }
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
  const summary=()=>page.locator('.event-card [data-friend-attendance="1"]');
  await summary().getByText('2 friends RSVP’d',{exact:true}).waitFor();
  assert.match(await summary().textContent(),/Blair <friend>, Casey/);
  assert.equal(await summary().locator('img').count(),0);
  await page.getByRole('button',{name:'Friends’ RSVPs',exact:true}).click();
  assert.equal(await page.locator('.event-card').count(),1);
  await page.getByRole('button',{name:'All upcoming',exact:true}).click();
  attendance.a['1']={count:'1',friends:[attendance.a['1'].friends[0]]};
  await page.reload();await summary().getByText('1 friend RSVP’d',{exact:true}).waitFor();
  assert.doesNotMatch(await summary().textContent(),/Casey/);
  delete attendance.a['1'];
  await page.reload();await page.waitForSelector('.event-card');
  assert.equal(await page.locator('[data-friend-attendance]').count(),0);
  assert.equal(await page.locator('.event-card').count(),2);
  attendanceFailure=true;
  await page.reload();await page.locator('.event-friend-notice').waitFor();
  assert.equal(await control('bookmark').isEnabled(),true);
  attendanceFailure=false;
  attendance.a['1']={count:'1',friends:[{id:'11111111-1111-4111-8111-111111111111',label:'Blair <friend>'}]};
  await page.reload();await summary().waitFor();
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.locator('#toolbarReopenButton').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#toolbar').isVisible(), false);
  assert.equal(await page.getByRole('textbox', { name: 'Search events' }).isVisible(), false);
  await page.getByRole('button', { name: 'Show search & filters', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search events' }).isVisible(), true);

  for (const width of [320, 390, 480, 600, 768]) {
    await page.setViewportSize({ width, height: 740 });
    await page.locator('#eventFiltersButton').click();
    await page.locator('.category-dropdown summary').click();
    const issues = await page.locator('#toolbar').evaluate(toolbar => {
      const issues = [];
      if (document.documentElement.scrollWidth > innerWidth) issues.push('page overflow');
      for (const element of toolbar.querySelectorAll('button, select, input:not([type="checkbox"]), summary, .category-options label')) {
        if (!element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < 0 || rect.right > innerWidth) issues.push('control outside viewport');
        if (rect.height < 44) issues.push('touch target below 44px');
      }
      if (getComputedStyle(document.getElementById('eventSearchControls')).overflowY === 'auto') issues.push('nested scroll');
      return issues;
    });
    assert.deepEqual(issues, [], `event filters at ${width}px`);
    await page.getByRole('checkbox', { name: /Arts/ }).check();
    assert.equal(await page.locator('.event-card').count(), 2);
    await page.getByLabel('From date', { exact: true }).fill(dateKey);
    assert.equal(await page.locator('.event-card').count(), 2);
    await page.getByRole('button', { name: 'Reset search and filters', exact: true }).click();
    assert.equal(await page.locator('#eventFilters').isVisible(), false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole('button', { name: 'Calendar view', exact: true }).click();
  await page.getByRole('button', { name: 'List view', exact: true }).waitFor();
  await page.locator('.calendar').first().waitFor();
  assert.equal(await page.locator('.calendar-month').count(), 1);
  const expectedMonths = [0].map(offset => new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  assert.deepEqual(await page.locator('.calendar-month h2').allTextContents(), expectedMonths);
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  assert.equal(await page.locator('.calendar-month h2').textContent(), nextMonth);
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  assert.deepEqual(await page.locator('.calendar-month h2').allTextContents(), expectedMonths);
  // Follow the fixture date when a test runs near the end of the month.
  await page.evaluate(() => { month = new Date(events[0].date + 'T12:00:00'); month.setDate(1); renderResults(); });
  // Busy dates stay fixed and reveal the complete schedule in a dialog.
  await page.evaluate(() => {
    const source = events[0];
    for (let index = 0; index < 20; index++) events.push({ ...source, id: `busy-${index}`, name: `Extra event ${index} with a very long title` });
    renderResults();
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const heights = await page.locator('.calendar-month .day').evaluateAll(days => days.map(day => day.getBoundingClientRect().height));
    assert.equal(new Set(heights).size, 1);
    assert.equal(heights[0], width === 390 ? 82 : 156);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const busyDay = page.locator('.calendar-day').filter({ has: page.locator('.calendar-more') }).first();
    assert.equal(await busyDay.locator('.calevent').count(), 2);
    await busyDay.click();
    await page.locator('#dayModal').waitFor();
    assert.equal(await page.locator('#dayModal .event-card').count(), 22);
    await page.locator('#dayModal .event-card').first().click();
    assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), true);
    await page.getByRole('button', { name: 'Close event details', exact: true }).click();
    assert.equal(await page.locator('#dayModal').evaluate(dialog => dialog.open), true);
    await page.getByRole('button', { name: 'Close day schedule', exact: true }).click();
    assert.equal(await page.locator('#dayModal').evaluate(dialog => dialog.open), false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { events = events.filter(event => !String(event.id).startsWith('busy-')); renderResults(); });
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar view', exact: true }).waitFor();
  await page.locator('.event-card').first().waitFor();

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
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false, 'list action must not open a modal');
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
  assert.equal(await page.locator('[data-friend-attendance]').count(),0);
  await page.reload(); await pressed('bookmark', false); await pressed('rsvp', false, '2');
  await control('bookmark').click(); await pressed('bookmark', true);
  assert.deepEqual(records.a.saved, []);

  await page.getByRole('button', { name: 'View details for Jazz & friends', exact: true }).click();
  await page.locator('dialog [data-plan-kind="rsvp"]').click();
  await page.waitForFunction(() => document.querySelector('dialog [data-plan-kind="rsvp"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), true);
  await page.getByRole('button', { name: 'Close event details' }).click();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../artifacts/events-desktop.png', import.meta.url).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkDrawer(page, control('bookmark'));
  await checkDrawer(page, page.locator('.event-card .event-share').first());
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
  // Six events exercise a recommendation outside the five featured slides.
  events.push(...['3','4','5','6'].map(id => ({...events[0], id, name:'More campus plans '+id})));
  await page.goto(base + '/');
  await page.waitForSelector('.discover-view-event');
  assert.equal(await page.locator('.discover-recommendations .card .event-title').count(), 1);
  await checkDrawer(page, page.locator('.discover-recommendations [data-plan-kind="bookmark"]').first());
  assert.equal(await page.locator('.discover-feature--no-image').count(), 1);
  for (const width of [390, 1280]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert((await page.locator('.discover-recommendations .card').boundingBox()).height < 260, 'Discover recommendations do not reserve tall empty cards');
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.discover-view-event').click();
  await page.locator('#modal .event-share').waitFor();
  await page.evaluate(() => {
    navigator.share = async payload => { window.sharedEvent = payload; };
  });
  await page.locator('#modal .event-share').click();
  await page.getByRole('button', {name:'Share with device',exact:true}).click();
  await page.getByRole('button', {name:'Close share dialog',exact:true}).click();
  const shared = await page.evaluate(() => window.sharedEvent);
  assert.equal(shared.url, base + '/events?event=1');
  await page.locator('#modal [data-plan-kind="rsvp"]').click();
  await page.waitForFunction(() => document.querySelector('#modal [data-plan-kind="rsvp"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'home mobile should not overflow');
  events.splice(2);
  await page.goto(shared.url);
  await page.waitForFunction(() => document.getElementById('modal').open);
  assert.match(await page.locator('dialog h2').textContent(), /Jazz/);
  // Exercise native Escape and redraw behavior in both real page implementations.
  for (const path of ['/events', '/']) {
    await page.goto(base + path);
    await page.waitForFunction(() => backendMode === 'supabase' && events.length === 2 && data.user?.id === 'a' && stateReady);
    let start = views.length;
    const opened = page.waitForResponse(response => response.url().endsWith('/events/1/view'));
    await page.evaluate(() => openEvent('1')); await opened;
    assert.equal(views.length, start + 1);
    await page.locator('#modal [data-plan-kind="bookmark"]').click();
    await page.waitForFunction(() => !plans.busy('bookmark', '1'));
    await page.locator('#modal [data-plan-kind="rsvp"]').click();
    await page.waitForFunction(() => !plans.busy('rsvp', '1'));
    assert.equal(views.length, start + 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('modal').open && detailId === null);
    const reopen = page.waitForResponse(response => response.url().endsWith('/events/1/view'));
    await page.evaluate(() => openEvent('1')); await reopen;
    assert.equal(views.length, start + 2);
    await page.getByRole('button', {name:'Close event details'}).click();
    viewFailure = true;
    const failed = page.waitForResponse(response => response.url().endsWith('/events/2/view'));
    await page.evaluate(() => openEvent('2')); assert.equal((await failed).status(), 503);
    assert.equal(await page.locator('#modal').evaluate(el => el.open), true);
    await page.evaluate(() => openEvent('2'));
    assert.equal(views.length, start + 3);
    viewFailure = false;
  }
  assert.deepEqual(errors, []);
  assert(writes.every(write => !('UserID' in write.payload)));
  console.log('PASS: persistence/reload, errors, pending, focus, concurrent actions, filters, Saved integration, account isolation, modal, guest redirect, mobile, account-service outages, login/reload, shared event links, home Share/Going controls, view logging/redraw suppression/native Escape/failures on both pages, friend attendance badges/filter/reload/errors/account isolation.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
