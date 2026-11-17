import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the real viewer's events without requiring a browser installation.
async function fixture() {
  class Element {
    listeners = new Map(); open = false; isConnected = true;
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    fire(type, options = {}) {
      const event = { target: this, preventDefault() { this.prevented = true; }, ...options };
      for (const fn of this.listeners.get(type) || []) fn(event);
      return event;
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
    focus() { document.activeElement = this; }
    removeAttribute(key) { delete this[key]; }
  }
  const elements = new Map(['profilePhotoViewer', 'profilePhotoImage', 'profilePhotoStatus', 'profilePhotoClose', 'friendDetailTitle'].map(id => [id, new Element()]));
  const document = { getElementById: id => elements.get(id), activeElement: null };
  const window = new Element(); window.visualViewport = { scale: 1 };
  vm.runInNewContext(await readFile(new URL('../public/profile-photo.js', import.meta.url), 'utf8'), { window, document, URL });
  const trigger = new Element(); const image = elements.get('profilePhotoImage');
  const dialog = elements.get('profilePhotoViewer');
  return { viewer: window.GatherProfilePhoto, elements, trigger, image, dialog, document, window };
}
const person = { isPrivate: false, name: 'Alex <friend>', photoUrl: 'https://example.org/portrait.jpg' };

test('photos require an explicitly public profile and a supported safe image URL', async () => {
  const { viewer } = await fixture();
  assert.equal(viewer.source(person), person.photoUrl);
  for (const value of [null, undefined, true]) assert.equal(viewer.source({ ...person, isPrivate: value }), null);
  for (const photoUrl of ['', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://name:password@example.org/photo', '//example.org/photo'])
    assert.equal(viewer.source({ ...person, photoUrl }), null);
  assert.equal(viewer.source({ ...person, photoUrl: 'data:image/jpeg;base64,YWJj' }), 'data:image/jpeg;base64,YWJj');
});

test('open, load, X and Escape clear the image and restore focus without reopening profile details', async () => {
  const f = await fixture();
  assert.equal(f.viewer.open(person, f.trigger), true);
  assert.equal(f.dialog.open, true);
  assert.equal(f.image.hidden, true);
  assert.equal(f.document.activeElement, f.elements.get('profilePhotoClose'));
  f.image.onload(); assert.equal(f.image.hidden, false);
  assert.equal(f.image.alt, 'Profile photo of Alex <friend>');
  f.elements.get('profilePhotoClose').fire('click');
  assert.equal(f.dialog.open, false); assert.equal(f.image.src, undefined);
  assert.equal(f.document.activeElement, f.trigger);
  f.viewer.open(person, f.trigger);
  assert.equal(f.dialog.fire('cancel').prevented, true);
  assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.trigger);
});

test('outside click dismisses but the photo and drags starting on it do not', async () => {
  const f = await fixture(); f.viewer.open(person, f.trigger);
  f.dialog.fire('pointerdown', { target: f.image });
  f.dialog.fire('click', { target: f.image }); assert.equal(f.dialog.open, true);
  f.dialog.fire('click'); assert.equal(f.dialog.open, true);
  f.dialog.fire('pointerdown'); f.dialog.fire('click'); assert.equal(f.dialog.open, false);
});

test('only a deliberate downward single-touch swipe closes; zoom, horizontal, short and cancelled gestures stay open', async () => {
  const f = await fixture();
  const down = (id = 1) => f.dialog.fire('pointerdown', { pointerType: 'touch', pointerId: id, clientX: 100, clientY: 100 });
  const up = (x, y, type = 'touch', id = 1) => f.dialog.fire('pointerup', { pointerType: type, pointerId: id, clientX: x, clientY: y });
  f.viewer.open(person, f.trigger);
  for (const [x, y] of [[100, 140], [100, 0], [300, 240]]) { down(); up(x, y); assert.equal(f.dialog.open, true); }
  down(); up(100, 300, 'mouse'); assert.equal(f.dialog.open, true);
  down(); f.dialog.fire('pointercancel', { pointerId: 1 }); up(100, 300); assert.equal(f.dialog.open, true);
  down(); down(2); up(100, 300); up(100, 300, 'touch', 2); assert.equal(f.dialog.open, true);
  f.window.visualViewport.scale = 2; down(); up(100, 300); assert.equal(f.dialog.open, true);
  f.window.visualViewport.scale = 1; down(); up(110, 250); assert.equal(f.dialog.open, false);
});

test('broken images show a readable error; closed/replaced reads cannot update another photo', async () => {
  const f = await fixture(); f.viewer.open(person, f.trigger);
  const lateLoad = f.image.onload;
  f.image.onerror(); assert.match(f.elements.get('profilePhotoStatus').textContent, /could not be loaded/);
  assert.equal(f.image.hidden, true);
  f.viewer.close(); f.viewer.open(person, f.trigger);
  lateLoad(); assert.equal(f.image.hidden, true);
  let allowed = true;
  f.viewer.open(person, f.trigger, () => allowed); allowed = false;
  f.image.onload(); assert.equal(f.dialog.open, false);
  assert.equal(f.viewer.open(person, f.trigger, () => false), false);
});

test('failed thumbnails hide only the photo control and navigation clears enlarged photos', async () => {
  const f = await fixture();
  f.trigger.querySelector = () => f.image;
  f.viewer.prepareThumbnail(f.trigger); f.trigger.focus(); f.image.onerror();
  assert.equal(f.trigger.hidden, true);
  assert.equal(f.document.activeElement, f.elements.get('friendDetailTitle'));
  f.viewer.open(person, f.trigger); f.window.fire('hashchange'); assert.equal(f.dialog.open, false);
  f.viewer.open(person, f.trigger); f.window.fire('pagehide'); assert.equal(f.image.src, undefined);
});
