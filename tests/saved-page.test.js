import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('Saved deep link filters to bookmarks and removes a card after unsaving', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', hidden: true, open: false,
      classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {},
    });
    return elements.get(id);
  };
  const events = ['1', '2'].map(id => ({
    id, name: 'Event ' + id, category: 'Arts', categories: ['Arts', 'Spiritual'], poster: 'ARTS',
    date: '2099-11-05', start: '18:30:00', end: null,
    club: 'Campus organizer', major: 'All majors', friends: [],
    location: 'Music Building', price: 0, food: false,
  }));
  let saved = ['2'];
  const context = vm.createContext({
    console, URL, Date, Map, Set, encodeURIComponent,
    localStorage: { getItem() { return null; } },
    location: { protocol: 'http:', hash: '#saved' },
    document: { getElementById: element, addEventListener() {}, querySelectorAll() { return []; } },
    matchMedia() { return { matches: false }; },
    setInterval() { return 1; }, setTimeout() { return 1; }, clearTimeout() {},
    addEventListener() {}, scrollTo() {},
    async fetch(path, options = {}) {
      let body;
      if (path === '/api/config') body = { mode: 'supabase' };
      else if (path === '/api/events') body = { events };
      else if (path === '/api/auth/session') body = { user: { id: 'a', name: 'Student' } };
      else if (path === '/api/state') body = { accountId: 'a', state: { saved, rsvp: [] } };
      else if (path === '/api/events/2/bookmark') {
        const { bookmarked } = JSON.parse(options.body);
        saved = bookmarked ? ['2'] : [];
        body = { eventId: '2', bookmarked };
      } else throw Error('Unexpected endpoint: ' + path);
      return { ok: true, async json() { return structuredClone(body); } };
    },
  });
  context.window = context;
  vm.runInContext(await readFile(new URL('../public/event-plans.js', import.meta.url), 'utf8'), context);
  // Expose the real boot promise so this test waits for state loading/rendering.
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/boot\(\);\s*$/, 'globalThis.bootPromise = boot();');
  vm.runInContext(source, context);
  await context.bootPromise;
  assert.equal(vm.runInContext('mode', context), 'saved');
  assert.match(element('app').innerHTML, /data-event-id="2"/);
  assert.doesNotMatch(element('app').innerHTML, /data-event-id="1"/);
  vm.runInContext('filters.category = "Spiritual"; filters.spiritual = true; render();', context);
  assert.match(element('app').innerHTML, /data-event-id="2"/);
  assert.match(element('app').innerHTML, /Arts · Spiritual/);
  await vm.runInContext('bookmark("2")', context);
  assert.deepEqual(saved, []);
  assert.doesNotMatch(element('app').innerHTML, /data-event-id="2"/);
});
