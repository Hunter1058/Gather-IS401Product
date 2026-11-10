import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { people, sendRequest, cancelRequest, removeFriend } from '../lib/friends.js';
import { friendDatabase, A, B } from './helpers/friend-rpc.js';

async function fixture({ guest = false, eventsFail = false, stateFail = false, confirm = true } = {}) {
  const logs = [];
  const db = friendDatabase(), user = guest ? null : { id: A, name: 'Alex' }, elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: true, open: false,
      classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, focus() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ console: { ...console, error: (...args) => logs.push(args) }, URL, Date, Map, Set, encodeURIComponent,
    localStorage: { getItem() { return JSON.stringify({ friends: ['Fictional old friend'] }); } },
    location: { protocol: 'http:', hash: '#friends', assign(path) { this.redirect = path; } },
    history: { replaceState() {} },
    document: { getElementById: el, addEventListener() {}, querySelectorAll() { return []; }, querySelector() {}, activeElement: null },
    matchMedia() { return { matches: false }; },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    addEventListener() {}, scrollTo() {}, confirm() { return confirm; },
    async fetch(path, options = {}) {
      let body;
      if (path === '/api/config') body = { mode: 'supabase' };
      else if (path === '/api/auth/session') body = { user };
      else if (path === '/api/events') {
        if (eventsFail) return { ok: false, async json() { return { error: 'Events unavailable' }; } };
        body = { events: [] };
      } else if (path === '/api/state') {
        if (stateFail) return { ok: false, async json() { return { error: 'Plans unavailable' }; } };
        body = { accountId: A, state: { saved: [], rsvp: [] } };
      } else {
        assert(user); const client = { rpc: (name, args) => db.rpc(user.id, name, args) };
        const url = new URL(path, 'http://fixture');
        if (url.pathname === '/api/friends/people') body = { accountId: A, ...await people(client, url.searchParams) };
        else {
          const input = JSON.parse(options.body);
          const person = options.method === 'POST' ? await sendRequest(client, A, input.recipientId)
            : path.includes('/requests/') ? await cancelRequest(client, A, path.split('/').at(-1))
            : await removeFriend(client, A, path.split('/').at(-1));
          body = { accountId: A, person };
        }
      }
      return { ok: true, async json() { return structuredClone(body); } };
    },
  });
  context.window = context;
  for (const name of ['event-sharing.js', 'event-plans.js', 'friend-actions.js'])
    vm.runInContext(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'), context);
  vm.runInContext((await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/boot\(\);\s*$/, 'globalThis.bootPromise = boot();'), context);
  await context.bootPromise;
  return { db, context, logs, html: () => el('app').innerHTML, run: code => vm.runInContext(code, context) };
}

test('real friends page loads real profiles and send/cancel restore after reloading state', async () => {
  const f = await fixture(); assert.match(f.html(), /Blair &lt;friend&gt;/); assert.match(f.html(), /Send request/);
  assert.doesNotMatch(f.html(), /Fictional old friend|Emma|Adding a friend here does not send/);
  await f.run(`friendAction('${B}')`); assert.match(f.html(), /Cancel request/);
  await f.run('refreshPeople()'); assert.match(f.html(), /Cancel request/);
  await f.run(`friendAction('${B}')`); assert.match(f.html(), /Send request/); assert.equal(f.db.attempts[0].Status, 'cancelled');
});

test('friends function independently of event listing and event-plan outages', async () => {
  const f = await fixture({ eventsFail: true, stateFail: true });
  assert.match(f.html(), /Blair &lt;friend&gt;/);
  assert.equal(f.logs.length, 1);
  await f.run(`friendAction('${B}')`); assert.equal(f.db.attempts[0].Status, 'pending');
});

test('accepted friends require removal confirmation and incoming requests have no send/cancel action', async () => {
  const f = await fixture({ confirm: false });
  await f.db.rpc(B, 'send_friend_request', { p_recipient_user_id: A }); await f.run('refreshPeople()');
  assert.match(f.html(), /Request received/); const id = f.db.attempts[0].FriendRequestID;
  await f.db.rpc(A, 'respond_to_friend_request', { p_request_id: id, p_accept: true }); await f.run('refreshPeople()');
  assert.match(f.html(), /Remove friend/);
  await f.run(`friendAction('${B}')`); assert.equal(f.db.status(A, B).relationship, 'friends');
  f.context.confirm = () => true;
  await f.run(`friendAction('${B}')`); assert.equal(f.db.status(A, B).relationship, 'none');
  assert.equal(f.db.attempts[0].Status, 'accepted');
});

test('guest friends page offers sign-in without exposing profiles or making directory requests', async () => {
  const f = await fixture({ guest: true }); assert.match(f.html(), /Sign in to connect/);
  assert.doesNotMatch(f.html(), /Blair|Send request/); assert.equal(f.db.calls.length, 0);
});
