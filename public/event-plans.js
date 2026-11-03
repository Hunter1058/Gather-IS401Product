/* Shared per-event persistence for /events and the legacy Saved/home pages.
 * An explicit desired state makes retries safe. Only successful responses change
 * local state; controls stay disabled while their individual request is pending.
 */
"use strict";
window.GatherPlans = {
  create({ request, state, isDemo, requireAccount, render, notify, persistDemo }) {
    const pending = new Set();
    function busy(kind, id) { return pending.has(`${kind}:${id}`); }
    async function set(kind, id) {
      if (busy(kind, id) || !requireAccount()) return;
      const account = state().user?.id;
      const list = kind === "bookmark" ? "saved" : "rsvp";
      const field = kind === "bookmark" ? "bookmarked" : "going";
      const wanted = !state()[list].includes(id);
      const demo = isDemo();
      const trigger = document.activeElement;
      const restoreFocus = trigger?.dataset?.planKind === kind && trigger.dataset.eventId === id;
      pending.add(`${kind}:${id}`);
      render();
      try {
        const result = demo ? { [field]: wanted } : await request(
          `/events/${encodeURIComponent(id)}/${kind}`,
          { method: "PUT", headers: { "Content-Type": "application/json", "X-Gather-Account": account }, body: JSON.stringify({ [field]: wanted }) },
        );
        if (!demo && state().user?.id !== account) return;
        const current = state();
        current[list] = current[list].filter(value => value !== id);
        if (result[field]) current[list].push(id);
        if (demo) persistDemo();
        notify(kind === "bookmark"
          ? result[field] ? "Event bookmarked" : "Bookmark removed"
          : result[field] ? "You're going!" : "RSVP canceled");
      } catch (error) {
        notify(error.message || "Could not save this change. Please try again.");
      } finally {
        pending.delete(`${kind}:${id}`);
        render();
        if (restoreFocus) {
          const dialog = document.querySelector("dialog[open]");
          const buttons = [...document.querySelectorAll("[data-plan-kind]")];
          buttons.find(button => button.dataset.planKind === kind && button.dataset.eventId === id &&
            !button.disabled && (dialog ? dialog.contains(button) : !button.closest("dialog")))?.focus();
        }
      }
    }
    return { busy, set, hasPending: () => pending.size > 0 };
  },
};
