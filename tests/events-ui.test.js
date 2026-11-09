import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Run the real page scripts with a small document/HTTP fixture. This exercises
// page logic and rendered markup; it does not replace a real-browser layout test.
async function pageFixture({ user = { id: 'a', name: 'Student' }, saved = [], rsvp = [], stateError = false, sessionError = false, href = 'http://fixture/events', navigator = {} } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', open: false, hidden: true,
      classList: { add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(id);
  };
  const records = { saved: [...saved], rsvp: [...rsvp] }, writes = [];
  let failure = false, release, held = false;
  const context = vm.createContext({ URL, console, Map, Set, Date, encodeURIComponent,
    clearTimeout, setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    localStorage: { getItem() { return JSON.stringify({ saved: ['stale-demo'], rsvp: ['stale-demo'] }); }, setItem() {} },
    navigator,
    location: { href, assign(path) { this.redirect = path; } },
    history: { replaceState() {} },
    document: { getElementById: element, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, activeElement: null },
    addEventListener() {},
    async fetch(path, options = {}) {
      let payload;
      if (path === '/api/config') payload = { mode: 'supabase' };
      else if (path === '/api/events') payload = { events: [{ id: '1', name: 'Jazz <friends>', category: 'Arts', categories: ['Arts', 'Spiritual'], location: 'Music Building', date: '2099-11-05', start: null, end: null, price: 0, food: false }] };
      else if (path === '/api/auth/session') {
        if (sessionError) return { ok: false, async json() { return { error: 'Account service unavailable' }; } };
        payload = { user };
      }
      else if (path === '/api/state') {
        if (stateError) return { ok: false, async json() { return { error: 'Plans could not be loaded' }; } };
        payload = { accountId: user?.id, state: records };
      } else {
        if (held) await new Promise(resolve => { release = resolve; });
        if (failure) { failure = false; return { ok: false, async json() { return { error: 'Save failed' }; } }; }
        const [, id, kind] = /\/events\/(\d+)\/(bookmark|rsvp)/.exec(path);
        const field = kind === 'bookmark' ? 'bookmarked' : 'going', list = kind === 'bookmark' ? 'saved' : 'rsvp';
        const input = JSON.parse(options.body);
        writes.push({ path, input, headers: options.headers });
        records[list] = input[field] ? [...new Set([...records[list], id])] : records[list].filter(value => value !== id);
        payload = { [field]: input[field] };
      }
      return { ok: true, async json() { return structuredClone(payload); } };
    },
  });
  context.window = context;
  vm.runInContext(await readFile(new URL('../public/event-sharing.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../public/event-plans.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../public/events.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, element, records, writes, run: code => vm.runInContext(code, context), fail() { failure = true; }, hold() { held = true; }, release() { held = false; release(); } };
}

test('page restores account plans, escapes titles and renders styled share and plan controls', async () => {
  const page = await pageFixture({ saved: ['1'] });
  const html = page.element('results').innerHTML;
  assert.match(html, /Jazz &lt;friends&gt;/);
  assert.match(html, /data-plan-kind="bookmark"/);
  assert.match(html, /data-plan-kind="rsvp"/);
  assert.match(html, /class="event-share"/);
  assert.match(html, /data-lucide="share-2"/);
  assert.match(html, /Time TBA/);
  assert.equal(page.run('data.saved.includes("stale-demo")'), false);
});

test('list clicks persist individual states, never open details, and share filter state', async () => {
  const page = await pageFixture();
  await page.run('bookmark("1")');
  await page.run('rsvp("1")');
  assert.deepEqual(page.records, { saved: ['1'], rsvp: ['1'] });
  assert.equal(page.element('modal').open, false);
  assert.equal(page.writes[0].headers['X-Gather-Account'], 'a');
  assert.deepEqual(page.writes[0].input, { bookmarked: true });
  page.run('setMode("saved")');
  await page.run('bookmark("1")');
  assert.match(page.element('results').innerHTML, /No events match/);
  await page.run('rsvp("1")');
  assert.deepEqual(page.records.rsvp, []);
});

test('failed saves do not change confirmed state or display success', async () => {
  const page = await pageFixture();
  page.fail(); await page.run('bookmark("1")');
  assert.deepEqual(page.records.saved, []);
  assert.equal(page.run('data.saved.length'), 0);
  assert.equal(page.element('toast').textContent, 'Save failed');
});

test('pending requests disable the control and suppress duplicate clicks', async () => {
  const page = await pageFixture();
  page.hold(); const request = page.run('bookmark("1")');
  await Promise.resolve();
  assert.match(page.element('results').innerHTML, /aria-busy="true" disabled/);
  await page.run('bookmark("1")');
  page.release(); await request;
  assert.equal(page.writes.length, 1);
});

test('guest cannot save, and failed initial state is never treated as empty success', async () => {
  const guest = await pageFixture({ user: null });
  await guest.run('bookmark("1")');
  assert.equal(guest.context.location.redirect, '/login');
  assert.equal(guest.writes.length, 0);
  const broken = await pageFixture({ stateError: true });
  assert.match(broken.element('results').innerHTML, /Plans could not be loaded/);
  assert.match(broken.element('results').innerHTML, /Jazz &lt;friends&gt;/);
  assert.match(broken.element('results').innerHTML, /disabled/);
  await broken.run('bookmark("1")');
  assert.equal(broken.writes.length, 0);
});


test('category checkboxes match any selected linked category and clear correctly', async () => {
  const page = await pageFixture();
  assert.match(page.element('results').innerHTML, /event-arts[^>]*>Arts<\/span>.*event-spiritual[^>]*>Spiritual<\/span>/s);
  assert.match(page.element('toolbar').innerHTML,
    /<input[^>]*type="checkbox"[^>]*value="Spiritual"[^>]*onchange="toggleCategory\(this.value,this.checked\)"/);
  page.run('toggleCategory("Spiritual", true)');
  assert.match(page.element('results').innerHTML, /Jazz &lt;friends&gt;/,
    'selecting a secondary linked category includes the event');
  page.run('toggleCategory("Sports", true)');
  assert.match(page.element('results').innerHTML, /Jazz &lt;friends&gt;/,
    'multiple selected categories match any category rather than requiring all');
  page.run('toggleCategory("Spiritual", false)');
  assert.match(page.element('results').innerHTML, /No events match/,
    'only the nonmatching category remains selected');
  page.run('toggleCategory("Sports", false)');
  assert.match(page.element('results').innerHTML, /Jazz &lt;friends&gt;/,
    'unchecking all categories restores the event');
  page.run('toggleCategory("Sports", true); clearFilters()');
  assert.equal(page.run('Array.isArray(filters.category) && filters.category.length === 0'), true);
  assert.match(page.element('results').innerHTML, /Jazz &lt;friends&gt;/);
});


test('public events still render during an account-session outage', async () => {
  const page = await pageFixture({ sessionError: true });
  assert.match(page.element('results').innerHTML, /Jazz &lt;friends&gt;/);
  assert.match(page.element('results').innerHTML, /Account service unavailable/);
  assert.equal(page.run('stateReady'), false);
  await page.run('bookmark("1")');
  assert.equal(page.writes.length, 0);
  assert.equal(page.context.location.redirect, undefined);
});


test('share copies a public event link and a guest recipient opens its details', async () => {
  let copied;
  const page = await pageFixture({ navigator: { clipboard: { async writeText(url) { copied = url; } } } });
  await page.run('shareEvent("1")');
  assert.equal(copied, 'http://fixture/events?event=1');
  assert.match(page.element('toast').textContent, /link copied/);
  const recipient = await pageFixture({ user: null, href: copied });
  assert.equal(recipient.element('modal').open, true);
  assert.match(recipient.element('modal').innerHTML, /Jazz &lt;friends&gt;/);
});

test('native share includes the direct link and cancellation is quiet', async () => {
  let payload;
  const page = await pageFixture({ navigator: { async share(value) { payload = value; } } });
  await page.run('shareEvent("1")');
  assert.equal(payload.url, 'http://fixture/events?event=1');
  page.context.navigator.share = async () => { const error = new Error(); error.name = 'AbortError'; throw error; };
  await page.run('shareEvent("1")');
  assert.equal(page.element('modal').open, false);
});

test('missing shared events produce a clear message', async () => {
  const page = await pageFixture({ href: 'http://fixture/events?event=missing' });
  assert.equal(page.element('modal').open, false);
  assert.match(page.element('toast').textContent, /no longer available/);
});

test('unknown event details do not claim free admission or food availability', async () => {
  const page = await pageFixture();
  assert.equal(page.run('eventAdmission({ price: null })'), 'Not Specified');
  assert.equal(page.run('eventAdmission({ price: 0 })'), 'Free');
  assert.equal(page.run('eventAdmission({ price: 12 })'), '$12');
  assert.equal(page.run('eventFood({ food: null })'), 'Food: Not Specified');
  assert.equal(page.run('eventFood({ food: false })'), 'Food not provided');
  page.run('events[0].price = null; events[0].food = null; openEvent("1")');
  assert.match(page.element('modal').innerHTML, /Food: Not Specified/);
  assert.match(page.element('modal').innerHTML, /event-description/);
  assert.match(page.element('modal').innerHTML, /detail-location/);
  assert.doesNotMatch(page.element('modal').innerHTML, /View location/);
});

test('mode switches update the selected toolbar chip', async () => {
  const page = await pageFixture();
  page.run('setMode("rsvp")');
  assert.match(page.element('toolbar').innerHTML, /class="active" aria-pressed="true" onclick="setMode\('rsvp'\)/);
  page.run('setMode("past")');
  assert.match(page.element('toolbar').innerHTML, /class="active" aria-pressed="true" onclick="setMode\('past'\)/);
});
