// Shared account disclosure for the signed-in header.
globalThis.accountMenu = (() => {
  const trigger = document.getElementById("userButton");
  const wrapper = document.createElement("div");
  wrapper.className = "account-menu";
  trigger.before(wrapper);
  wrapper.append(trigger);

  const panel = document.createElement("div");
  panel.id = "accountMenu";
  panel.hidden = true;
  panel.innerHTML = '<a href="/settings">Profile settings</a><a href="/#saved">Saved plans</a><button type="button">Sign out</button>';
  wrapper.append(panel);

  let user;
  let signOut;

  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  }

  trigger.addEventListener("click", () => {
    location.assign(user ? "/settings" : "/login");
  });

  wrapper.addEventListener("pointerenter", (event) => {
    if (user && event.pointerType === "mouse") setOpen(true);
  });

  wrapper.addEventListener("pointerleave", () => {
    if (!panel.contains(document.activeElement)) setOpen(false);
  });

  trigger.addEventListener("focus", () => {
    if (user && trigger.matches(":focus-visible")) setOpen(true);
  });

  panel.querySelector("button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await signOut();
    } catch {
      document.getElementById("toast").textContent = "Could not sign out. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  panel.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setOpen(false);
      trigger.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !wrapper.contains(event.target)) setOpen(false);
  });
  wrapper.addEventListener("focusout", (event) => {
    if (!panel.hidden && !wrapper.contains(event.relatedTarget)) setOpen(false);
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      trigger.focus();
    }
  });

  return {
    update(currentUser, logout) {
      if (user !== currentUser) setOpen(false);
      user = currentUser;
      signOut = logout;
      if (user) {
        trigger.setAttribute("aria-controls", panel.id);
        trigger.setAttribute("aria-expanded", String(!panel.hidden));
        trigger.setAttribute("aria-label", "Account options");
      } else {
        trigger.removeAttribute("aria-controls");
        trigger.removeAttribute("aria-expanded");
        trigger.removeAttribute("aria-label");
      }
    }
  };
})();
