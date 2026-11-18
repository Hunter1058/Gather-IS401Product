import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function fixture() {
  let document;
  class Element {
    listeners = new Map(); attributes = {}; inert = false; hidden = false; style = {}; children = [];
    constructor(tag = 'DIV') { this.tagName = tag; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    append(element) { this.children.push(element); }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    focus() { document.activeElement = this; }
    addEventListener(key, callback) { this.listeners.set(key, [...(this.listeners.get(key) || []), callback]); }
    fire(key, data = {}) {
      const event = {target: this, preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}, ...data};
      for (const callback of this.listeners.get(key) || []) { callback(event); if (event.stopped) break; }
      return event;
    }
    querySelector() { return this.children[0]; }
    querySelectorAll() { return this.children; }
  }
  const body = new Element('BODY'), drawer = new Element('ASIDE'), trigger = new Element('BUTTON');
  const header = new Element('HEADER'), main = new Element('MAIN'), footer = new Element('FOOTER');
  const close = new Element('BUTTON'), link = new Element('A');
  drawer.hidden = true; drawer.append(close); drawer.append(link);
  header.append(trigger); body.children = [header, main, drawer, footer];
  main.style.overflow = 'auto'; body.style.overflow = 'clip'; footer.inert = true;
  const doc = new Element();
  document = Object.assign(doc, {body, activeElement: trigger,
    getElementById: id => ({drawer, menuButton: trigger})[id], createElement: tag => new Element(tag.toUpperCase())});
  const window = new Element();
  vm.runInNewContext(await readFile(new URL('../public/mobile-nav.js', import.meta.url), 'utf8'), {window, document, getComputedStyle: () => ({display: trigger.display || 'block'})});
  return {nav:window.GatherMobileNav, window, document, body, drawer, trigger, header, main, footer, close, link};
}

test('outside clicks are consumed before bookmark/share handlers; closing restores focus, scroll and prior inert state', async () => {
  const f = await fixture(); f.nav.toggle();
  assert.equal(f.drawer.hidden, false); assert.equal(f.main.inert, true); assert.equal(f.header.inert, true);
  assert.equal(f.body.style.overflow, 'hidden'); assert.equal(f.document.activeElement, f.close);
  assert.equal(f.drawer.attributes['aria-modal'], 'true');
  for (const target of [f.main, f.header, f.body.children.at(-1)]) {
    f.nav.set(true);
    let activated = false;
    const click = f.document.fire('click', {target});
    if (!click.stopped) activated = true;
    assert.equal(activated, false); assert.equal(click.prevented, true);
    assert.equal(f.drawer.hidden, true); assert.equal(f.document.activeElement, f.trigger);
  }
  assert.equal(f.main.inert, false); assert.equal(f.footer.inert, true);
  assert.equal(f.body.style.overflow, 'clip'); assert.equal(f.trigger.attributes['aria-expanded'], 'false');
});

test('inside actions stay usable and Escape and Tab remain within the drawer', async () => {
  const f = await fixture(); f.nav.set(true);
  assert.equal(f.document.fire('click', {target:f.close}).stopped, undefined);
  let event = f.document.fire('keydown', {key:'Tab', shiftKey:true});
  assert.equal(event.prevented, true); assert.equal(f.document.activeElement, f.link);
  event = f.document.fire('keydown', {key:'Tab', shiftKey:false});
  assert.equal(event.prevented, true); assert.equal(f.document.activeElement, f.close);
  event = f.document.fire('keydown', {key:'Escape'});
  assert.equal(event.stopped, true); assert.equal(f.drawer.hidden, true);
});

test('navigation and desktop resize clear backdrop and scroll lock, including repeated opens', async () => {
  const f = await fixture();
  for (const reason of ['hashchange','pagehide','resize']) {
    f.nav.set(true); f.nav.set(true);
    if (reason === 'resize') f.trigger.display = 'none';
    f.window.fire(reason);
    assert.equal(f.drawer.hidden, true); assert.equal(f.main.inert, false);
    assert.equal(f.body.children.at(-1).hidden, true); assert.equal(f.body.style.overflow, 'clip');
  }
});

test('every shared-shell page loads the drawer helper before its page controller', async () => {
  for (const page of ['index','events','login','signup','recover']) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /defer src="\/mobile-nav.js"/);
    assert(html.indexOf('/mobile-nav.js') < html.indexOf(page === 'recover' ? '/recovery-nav.js' : page === 'index' ? 'src="app.js"' : page === 'events' ? '/events.js' : '/auth.js'));
  }
});
