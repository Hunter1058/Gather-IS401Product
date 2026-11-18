/* Shared-looking navigation, isolated from recovery credentials and form state. */
(() => {
  'use strict';
  const menuButton = document.getElementById('menuButton');
  const drawer = document.getElementById('drawer');
  const closeButton = document.getElementById('closeNavigation');
  const accountButton = document.getElementById('userButton');
  const sideLink = document.getElementById('sideUserButton');
  const background = [document.querySelector('header'), document.querySelector('main'), document.querySelector('footer')];

  function setMenu(open) {
    if (window.GatherMobileNav) { window.GatherMobileNav.set(open); return; }
    drawer.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    for (const element of background) if (element) element.inert = open;
    if (open) {
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      closeButton.focus();
    } else {
      drawer.removeAttribute('role');
      drawer.removeAttribute('aria-modal');
      menuButton.focus();
    }
  }

  menuButton.addEventListener('click', () => setMenu(drawer.hidden));
  closeButton.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (window.GatherMobileNav || drawer.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false);
    } else if (event.key === 'Tab') {
      const controls = [...drawer.querySelectorAll('button:not(:disabled), a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });

  // The shared account-menu script owns account button navigation. If it did
  // not load, keep a normal sign-in action without breaking the recovery form.
  if (!globalThis.accountMenu) accountButton.addEventListener('click', () => location.assign('/login'));

  async function loadAccount() {
    try {
      const response = await fetch('/api/auth/session', {credentials: 'same-origin', cache: 'no-store'});
      if (!response.ok) return;
      const {user} = await response.json();
      if (!user || typeof user.id !== 'string') return;
      const name = String(user.name || user.email || 'Account');
      accountButton.textContent = name.trim().split(/\s+/).slice(0, 2)
        .map(part => Array.from(part)[0]).join('').toUpperCase() || 'U';
      accountButton.title = name;
      accountButton.classList.add('profile-avatar');
      sideLink.textContent = 'Account';
      sideLink.href = '/settings';
      if (!globalThis.accountMenu) return;
      globalThis.accountMenu.update(user, async () => {
        const result = await fetch('/api/auth/logout', {
          method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: '{}',
        });
        if (!result.ok) throw Error('Could not sign out. Please try again.');
        location.assign('/login');
      });
    } catch {
      // Header availability never controls whether recovery can be used.
    }
  }
  void loadAccount();
})();
