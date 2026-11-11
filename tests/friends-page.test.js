import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { people, sendRequest, cancelRequest, removeFriend, respondRequest, connections } from '../lib/friends.js';
import { friendDatabase, A, B } from './helpers/friend-rpc.js';

async function fixture({ guest = false, eventsFail = false, stateFail = false, confirm = true } = {}) {
  const logs = [];
  const db = friendDatabase(), user = guest ? null : { id: A, name: 'Alex' }, elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: true, open: false,
      showModal() { this.open=true; }, close() { this.open=false; },
      classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, focus() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ console: { ...console, error: (...args) => logs.push(args) }, URL, URLSearchParams, Date, Map, Set, encodeURIComponent,
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
        if (url.pathname.endsWith('/connections')) body = { accountId: A, ...await connections(client,A,url.pathname.split('/')[4],url.searchParams) };
        else if (url.pathname === '/api/friends/people') body = { accountId: A, ...await people(client, url.searchParams) };
        else {
          const input = JSON.parse(options.body);
          const response = /\/requests\/([^/]+)\/(accept|deny)$/.exec(path);
          const person = response ? await respondRequest(client, A, response[1], response[2] === 'accept') : options.method === 'POST' ? await sendRequest(client, A, input.recipientId)
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

test('tabs separate friends, suggested people, and sent requests across reloads', async () => {
  const f = await fixture();
  assert.match(f.html(), /My Friends/); assert.doesNotMatch(f.html(), /Blair &lt;friend&gt;/);
  f.db.rsvps.set(A, new Set(['event-1'])); f.db.rsvps.set(B, new Set(['event-1']));
  await f.run("selectFriendsTab('search')");
  assert.match(f.html(), /Blair &lt;friend&gt;/); assert.match(f.html(), /1 shared RSVP/);
  assert.doesNotMatch(f.html(), /Fictional old friend/);
  await f.run(`friendAction('${B}')`); assert.match(f.html(), /Cancel request/);
  await f.run('refreshPeople()'); assert.match(f.html(), /Cancel request/);
  await f.run("selectFriendsTab('requests')"); assert.match(f.html(), /Cancel request/);
  await f.run('refreshPeople()'); assert.match(f.html(), /Cancel request/);
  await f.run(`friendAction('${B}')`); assert.equal(f.db.attempts[0].Status, 'cancelled');
  assert.doesNotMatch(f.html(), /Blair &lt;friend&gt;/);
});

test('friends function independently of event listing and event-plan outages', async () => {
  const f = await fixture({ eventsFail: true, stateFail: true });
  f.db.interests.set(A, new Set(['arts'])); f.db.interests.set(B, new Set(['arts']));
  await f.run("selectFriendsTab('search')"); assert.match(f.html(), /Blair &lt;friend&gt;/);
  assert.equal(f.logs.length, 1);
  await f.run(`friendAction('${B}')`); assert.equal(f.db.attempts[0].Status, 'pending');
});

test('incoming requests can be accepted or denied and accepted friends require removal confirmation', async () => {
  const f = await fixture({ confirm: false });
  await f.db.rpc(B, 'send_friend_request', { p_recipient_user_id: A });
  await f.run("selectFriendsTab('requests')");
  assert.match(f.html(), />Accept</); assert.match(f.html(), />Deny</);
  await f.run(`friendAction('${B}', 'accept')`);
  assert.equal(f.db.status(A, B).relationship, 'friends'); assert.doesNotMatch(f.html(), /Blair &lt;friend&gt;/);
  await f.run("selectFriendsTab('friends')"); assert.match(f.html(), /Remove friend/);
  await f.run(`friendAction('${B}')`); assert.equal(f.db.status(A, B).relationship, 'friends');
  f.context.confirm = () => true;
  await f.run(`friendAction('${B}')`); assert.equal(f.db.status(A, B).relationship, 'none');
  await f.db.rpc(B, 'send_friend_request', { p_recipient_user_id: A });
  await f.run("selectFriendsTab('requests')"); await f.run(`friendAction('${B}', 'deny')`);
  assert.equal(f.db.attempts.at(-1).Status, 'declined');
});

test('guest friends page offers sign-in without exposing profiles or making directory requests', async () => {
  const f = await fixture({ guest: true }); assert.match(f.html(), /Sign in to connect/);
  assert.doesNotMatch(f.html(), /Blair|Send request/); assert.equal(f.db.calls.length, 0);
});


test('private request cards hide names and show escaped usernames beneath the heading', async () => {
  const f = await fixture();
  Object.assign(f.db.users[1], { is_private: true, display_name: 'Hidden Real Name',
    username: 'blair<handle>', photo_url: 'https://example.test/private-photo.jpg' });
  await f.db.rpc(B, 'send_friend_request', { p_recipient_user_id: A });
  await f.run("selectFriendsTab('requests')");
  assert.match(f.html(), /data-friend-heading="[^"]+"><button[^>]*>Private account<\/button><\/h3><p class="muted friend-username">@blair&lt;handle&gt;<\/p>/);
  assert.doesNotMatch(f.html(), /Hidden Real Name|private-photo\.jpg/);
  assert.match(f.html(), />Accept</); assert.match(f.html(), />Deny</);
  await f.run(`friendAction('${B}', 'accept')`);
  await f.run("selectFriendsTab('friends')");
  assert.match(f.html(), /Private account<\/button><\/h3><p class="muted friend-username">@blair&lt;handle&gt;<\/p>/);
  assert.match(f.html(), /Remove friend/);
});

test('public cards show names above usernames and missing usernames have no placeholder line', async () => {
  const f = await fixture();
  f.db.users[1].username = 'blair';
  f.db.friendships.add([A, B].sort().join(':'));
  await f.run("selectFriendsTab('friends')");
  assert.match(f.html(), /Blair &lt;friend&gt;<\/button><\/h3><p class="muted friend-username">@blair<\/p>/);
  for (const isPrivate of [true, false]) {
    f.db.users[1].is_private = isPrivate;
    f.db.users[1].username = null;
    await f.run('refreshPeople()');
    assert.doesNotMatch(f.html(), /friend-username|@null|@undefined/);
    assert.match(f.html(), isPrivate ? />Private account<\/button><\/h3>/ : />Blair &lt;friend&gt;<\/button><\/h3>/);
  }
});

test('search result order stays relevant rather than regrouping by recommendations', async () => {
  const f = await fixture();
  Object.assign(f.db.users[1], { username: 'jon_username', first_name: 'Other', last_name: 'Person' });
  Object.assign(f.db.users[2], { username: 'other', first_name: 'Jonathan', last_name: 'Thompson', display_name: 'Jonathan Thompson' });
  const C = f.db.users[2].user_id;
  f.db.rsvps.set(A, new Set(['1'])); f.db.rsvps.set(C, new Set(['1']));
  await f.run("selectFriendsTab('search')");
  await f.run("friendsSearch = 'jon'; refreshPeople()");
  assert(f.html().indexOf(`data-person-id="${B}"`) < f.html().indexOf(`data-person-id="${C}"`));
  assert.match(f.html(), /placeholder="Username, public name, or email"/);
  assert.match(f.html(), /Private profiles can be found by username only/);
  assert.match(f.html(), /maxlength="254"/);
  await f.run(`friendAction('${B}')`);
  assert.match(f.html(), /Cancel request/);
  assert.match(f.html(), new RegExp(`data-person-id="${B}"`));
});

test('suggestions explain shared interests and omit unrelated people while search still finds them', async () => {
  const f=await fixture();
  await f.run("selectFriendsTab('search')");
  assert.match(f.html(),/No suggestions yet/); assert.doesNotMatch(f.html(),/Explore people|data-person-id=/);
  f.db.interests.set(A,new Set(['art'])); f.db.interests.set(B,new Set(['art']));
  await f.run('refreshPeople()');
  assert.match(f.html(),/1 shared interest/); assert.match(f.html(),/Blair &lt;friend&gt;/);
  assert.doesNotMatch(f.html(),/Casey/);
  await f.run("friendsSearch='Casey'; refreshPeople()");
  assert.match(f.html(),/Casey/);
});

test('suggestions remain actionable after send/cancel and refresh, then reset on tab departure', async()=>{
  const f=await fixture();
  f.db.rsvps.set(A,new Set(['1']));f.db.rsvps.set(B,new Set(['1']));
  await f.run("selectFriendsTab('search')");
  await f.run(`friendAction('${B}')`);
  assert.match(f.html(),/Cancel request/);
  await f.run('refreshPeople()');assert.match(f.html(),/Cancel request/);
  await f.run(`friendAction('${B}')`);assert.match(f.html(),/Add friend/);
  await f.run(`friendAction('${B}')`);
  await f.run("selectFriendsTab('friends')"); await f.run("selectFriendsTab('search')");
  assert.doesNotMatch(f.html(),new RegExp(`data-person-id="${B}"`));
});

test('shared connection dialog escapes names, events and interests and hides private details', async()=>{
  const f=await fixture(), C=f.db.users[2].user_id;
  f.db.friendships.add([A,C].sort().join(':'));f.db.friendships.add([B,C].sort().join(':'));
  f.db.rsvps.set(A,new Set(['9007199254740993']));f.db.rsvps.set(B,new Set(['9007199254740993']));
  f.db.eventRecords.set('9007199254740993',{name:'Jazz <script>',date:'2026-11-15',location:'Hall & garden'});
  f.db.interests.set(A,new Set(['1']));f.db.interests.set(B,new Set(['1']));f.db.categoryRecords.set('1','Arts <fun>');
  await f.run(`openFriend('${B}')`);
  const html=f.run("document.getElementById('modal').innerHTML");
  assert.match(html,/Casey/);assert.match(html,/Jazz &lt;script&gt;/);assert.match(html,/Arts &lt;fun&gt;/);
  assert.match(html,/\/events\?event=9007199254740993/);assert.doesNotMatch(html,/<script>/);
  f.run('closeModal()'); assert.equal(f.run("document.getElementById('modal').open"),false);
  f.db.users[1].is_private=true;
  await f.run(`openFriend('${B}')`);
  const privateHtml=f.run("document.getElementById('modal').innerHTML");
  assert.match(privateHtml,/This profile is private/);assert.doesNotMatch(privateHtml,/Jazz|Casey|Arts/);
});

test('closing the shared details dialog ignores late reads and does not reopen it', async()=>{
  const f=await fixture();const original=f.context.fetch;let release;
  const held=new Promise(resolve=>release=resolve);
  f.context.fetch=async(path,options)=>{if(path.includes('/connections?')) await held;return original(path,options);};
  const pending=f.run(`openFriend('${B}')`);f.run('closeModal()');release();await pending;
  assert.equal(f.run("document.getElementById('modal').open"),false);
});

test('a connection read failure shows Retry without presenting a successful empty result', async()=>{
  const f=await fixture();f.db.errors.set('get_friend_connections','XX000');
  await f.run(`openFriend('${B}')`);
  assert.match(f.run("document.getElementById('modal').innerHTML"),/role="alert"/);
  assert.match(f.run("document.getElementById('modal').innerHTML"),/>Retry</);
});

test('connection sections load subsequent pages without replacing earlier shared items', async()=>{
  const f=await fixture(), ids=Array.from({length:11},(_,i)=>String(i+1));
  f.db.interests.set(A,new Set(ids));f.db.interests.set(B,new Set(ids));
  await f.run(`openFriend('${B}')`);
  assert.equal(f.run('friendDetail.lists.interests.items.length'),10);
  assert.equal(f.run('friendDetail.lists.interests.nextCursor'),'10');
  await f.run("moreFriendConnections('interests')");
  assert.equal(f.run('friendDetail.lists.interests.items.length'),11);
  assert.equal(f.run('friendDetail.lists.interests.nextCursor'),null);
});
