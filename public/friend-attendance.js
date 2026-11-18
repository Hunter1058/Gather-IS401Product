/* Shared attendance presentation for events, Discover and Saved cards. */
'use strict';
window.GatherAttendance = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  function render(event, data, ready, past = false) {
    if (!ready || !data.user || data.friendsGoingError) return '';
    const summary = data.friendAttendance?.[event.id];
    if (!summary || typeof summary.count !== 'string' || !/^[1-9]\d{0,18}$/.test(summary.count) ||
        !Array.isArray(summary.friends) || !summary.friends.length ||
        summary.friends.some(friend => !friend || typeof friend.label !== 'string')) return '';
    const count = BigInt(summary.count), friends = summary.friends.slice(0, 2);
    const names = friends.map(friend => String(friend.label || 'Gather friend')).join(', ');
    const more = count - BigInt(friends.length);
    return `<div class="event-friend-attendance" data-friend-attendance="${escape(event.id)}">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <div><span class="event-friend-count">${escape(count.toLocaleString())} ${count === 1n ? 'friend' : 'friends'} RSVP’d</span>
      <span class="event-friend-names">${escape(names)}${more > 0n ? ` · +${escape(more.toLocaleString())} more` : ''}</span></div>
    </div>`;
  }
  function notice(data, ready) {
    return ready && data.user && data.friendsGoingError
      ? '<div class="notice event-friend-notice" role="status">Friends’ attendance could not be loaded. Reload to try again. Your own saved plans are still available.</div>'
      : '';
  }
  function invalidate(data, status, body) {
    if (status !== 401 && !(status === 409 &&
        (body?.code === 'ACCOUNT_CHANGED' || /^Your account changed/i.test(body?.error || '')))) return;
    data.friendAttendance = {};
    data.friendsGoing = [];
    data.friendsGoingError = 'Your account session changed. Reload to load its friends.';
  }
  return {render, notice, invalidate};
})();
