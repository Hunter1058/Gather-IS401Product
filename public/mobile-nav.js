/* One modal drawer contract for Discover, Events, Friends and account pages. */
"use strict";
window.GatherMobileNav = (() => {
  const drawer = document.getElementById("drawer"), trigger = document.getElementById("menuButton");
  if (!drawer || !trigger) return { set() {}, toggle() {} };
  const backdrop = document.createElement("div");
  backdrop.className = "navigation-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  document.body.append(backdrop);
  const restored = new Map();
  let overflow = "", opened = false;
  function set(open, restoreFocus = true) {
    if (open === opened) return;
    opened = open;
    if (open) {
      overflow = document.body.style.overflow;
      for (const element of document.body.children) {
        if (element === drawer || element === backdrop || element.tagName === "SCRIPT") continue;
        restored.set(element, element.inert);
        element.inert = true;
      }
      document.body.style.overflow = "hidden";
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
    } else {
      for (const [element, inert] of restored) element.inert = inert;
      restored.clear();
      document.body.style.overflow = overflow;
      drawer.removeAttribute("role");
      drawer.removeAttribute("aria-modal");
    }
    drawer.hidden = backdrop.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    trigger.setAttribute("aria-controls", "drawer");
    if (open) drawer.querySelector("button, a[href]")?.focus();
    else if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  // Capture phase prevents inline bookmark/share handlers from seeing the tap,
  // including programmatic or synthetic clicks that bypass pointer hit testing.
  document.addEventListener("click", event => {
    if (!opened || drawer.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    set(false);
  }, true);
  document.addEventListener("keydown", event => {
    if (!opened) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); set(false);
    } else if (event.key === "Tab") {
      const controls = [...drawer.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  }, true);
  drawer.addEventListener("click", event => {
    if (event.target.closest("a[href]")) set(false, false);
  });
  window.addEventListener("hashchange", () => set(false, false));
  window.addEventListener("pagehide", () => set(false, false));
  window.addEventListener("resize", () => {
    if (opened && getComputedStyle(trigger).display === "none") set(false, false);
  });
  return { set, toggle: () => set(!opened) };
})();
