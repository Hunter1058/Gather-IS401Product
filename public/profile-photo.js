/* Separate native dialog keeps the person's information open underneath. */
"use strict";
window.GatherProfilePhoto = (() => {
  let active = null, start = null;
  const pointers = new Set();
  function source(person) {
    if (person?.isPrivate !== false || typeof person.photoUrl !== "string") return null;
    const value = person.photoUrl;
    if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* Unsupported or missing image: use the normal heading. */ }
    return null;
  }
  function close(restore = true) {
    const previous = active;
    active = start = null; pointers.clear();
    const dialog = document.getElementById("profilePhotoViewer");
    if (!previous && !dialog?.open) return;
    if (dialog?.open) dialog.close();
    const image = document.getElementById("profilePhotoImage");
    if (image) { image.onload = image.onerror = null; image.removeAttribute("src"); image.alt = ""; }
    if (restore && previous?.trigger?.isConnected) previous.trigger.focus({ preventScroll: true });
  }
  function open(person, trigger, allowed = () => true) {
    const src = source(person);
    if (!src || !allowed()) return false;
    close(false);
    const dialog = document.getElementById("profilePhotoViewer");
    const image = document.getElementById("profilePhotoImage");
    const status = document.getElementById("profilePhotoStatus");
    if (!dialog || !image || !status) return false;
    const session = active = { trigger, allowed };
    image.hidden = true;
    status.textContent = "Loading photo…";
    image.alt = `Profile photo of ${person.name}`;
    image.onload = () => {
      if (active !== session) return;
      if (!allowed()) { close(false); return; }
      image.hidden = false; status.textContent = "";
    };
    image.onerror = () => {
      if (active !== session) return;
      if (!allowed()) { close(false); return; }
      image.hidden = true; status.textContent = "This photo could not be loaded. Close to return to the profile.";
    };
    image.src = src;
    dialog.showModal();
    document.getElementById("profilePhotoClose").focus({ preventScroll: true });
    return true;
  }
  function prepareThumbnail(button) {
    const image = button?.querySelector("img");
    if (!image) return;
    const unavailable = () => {
      button.hidden = true;
      if (document.activeElement === button) document.getElementById("friendDetailTitle")?.focus();
    };
    image.onerror = unavailable;
    if (image.complete && !image.naturalWidth) unavailable();
  }
  const dialog = document.getElementById("profilePhotoViewer");
  if (dialog) {
    document.getElementById("profilePhotoClose").addEventListener("click", () => close());
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { if (active && !dialog.open) close(); });
    // Only a click that starts and ends on the surrounding surface closes it.
    let outside = false;
    dialog.addEventListener("pointerdown", event => {
      outside = event.target === dialog;
      if (event.pointerType !== "touch") return;
      pointers.add(event.pointerId);
      start = pointers.size === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    });
    dialog.addEventListener("pointerup", event => {
      const gesture = start; start = null; pointers.delete(event.pointerId);
      if (event.pointerType !== "touch" || !gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (dy >= 90 && dy > Math.abs(dx) * 1.5 && (window.visualViewport?.scale || 1) <= 1) close();
    });
    dialog.addEventListener("pointercancel", event => { start = null; pointers.delete(event.pointerId); outside = false; });
    dialog.addEventListener("click", event => {
      if (outside && event.target === dialog) close();
      outside = false;
    });
    // Browser Back/Forward and navigation cannot leave a photo over another page.
    window.addEventListener("hashchange", () => close(false));
    window.addEventListener("pagehide", () => close(false));
  }
  return { source, open, close, prepareThumbnail };
})();
