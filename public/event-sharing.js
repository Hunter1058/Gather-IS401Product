"use strict";

// Shared public event links and native sharing for every event surface.
function shareButton(event) {
  return `<button type="button" class="event-share" aria-label="Share ${esc(event.name)}" onclick="openEventShare('${event.id}')">${icon("share-2")}<span>Share</span></button>`;
}
function eventShareUrl(id) {
  const url = new URL("/events", location.href);
  url.searchParams.set("event", id);
  return url.href;
}
// The share menu has its own dialog, so opening it never redraws event details.
let eventShareState = null;
const externalSharesPending = new Set(), gatherShareAttempts = new Map();
function shareDialog() {
  let dialog = document.getElementById("eventShareDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "eventShareDialog";
    dialog.setAttribute("aria-labelledby", "eventShareTitle");
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => { if (!dialog.open) eventShareState = null; });
    document.body.append(dialog);
  }
  return dialog;
}
function openEventShare(id) {
  const event = events.find(item => item.id === id);
  if (!event) return;
  const dialog = shareDialog();
  eventShareState = {id, owner:data.user?.id, friends:[], loaded:false, loading:false,
    next:null, selected:"", pending:false, sent:false, error:"", attempts:new Map()};
  renderEventShare();
  if (!dialog.open) dialog.showModal();
}
function renderEventShare() {
  const state = eventShareState;
  if (!state) return;
  const event = events.find(item => item.id === state.id);
  const canSend = backendMode === "supabase" && state.owner && data.user?.id === state.owner;
  shareDialog().innerHTML = `<button type="button" class="close" aria-label="Close share dialog" onclick="shareDialog().close()">✕</button>
    <div class="dialog-body event-share-body"><header class="event-share-header"><h2 id="eventShareTitle" tabindex="-1">Share ${esc(event?.name || "this event")}</h2><p class="muted">Share an event link with anyone.</p></header>
    <div class="row event-share-options">${navigator.share ? `<button type="button" onclick="shareEvent('${state.id}')">Share with device</button>` : ""}
    <button type="button" onclick="copyEventLink('${state.id}')">Copy link</button></div>
    <label class="event-share-link">Event share link<input id="eventShareLink" readonly value="${esc(eventShareUrl(state.id))}" onclick="this.select()"></label>
    <p id="eventCopyStatus" role="status"></p>
    ${canSend ? `<section class="event-share-friends" aria-labelledby="eventShareFriendsTitle"><h3 id="eventShareFriendsTitle">Send to a Gather friend</h3>
      ${!state.loaded ? `<button type="button" onclick="loadEventShareFriends()" ${state.loading || state.blocked ? "disabled" : ""}>${state.loading ? "Loading friends…" : "Choose a friend"}</button>` : `<label for="eventShareFriend">Choose a friend</label><select id="eventShareFriend" onchange="selectEventShareFriend(this.value)" ${state.pending || state.sent ? "disabled" : ""}><option value="">Select a friend</option>${state.friends.map(person => `<option value="${person.id}" ${state.selected === person.id ? "selected" : ""}>${esc(person.name)}</option>`).join("")}</select>
      ${!state.friends.length ? '<p class="muted">No accepted friends yet. Add friends from the Friends page.</p>' : ""}
      ${state.next ? `<button type="button" onclick="loadEventShareFriends(true)" ${state.loading || state.pending || state.sent ? "disabled" : ""}>Load more friends</button>` : ""}
      <button type="button" class="primary" onclick="sendGatherEvent()" ${!state.selected || state.pending || state.sent ? "disabled" : ""} aria-busy="${state.pending}">${state.pending ? "Sending…" : state.sent ? "Sent" : "Send event"}</button>`}
      <p role="status">${state.sent ? "Event sent to your friend." : ""}</p>
      ${state.error ? `<p role="alert" class="error">${esc(state.error)}</p>` : ""}</section>` : '<p class="muted event-share-signin">Sign in to send events to your Gather friends.</p>'}
    </div>`;
}
async function sharingApi(path, owner, options = {}) {
  const response = await fetch("/api" + path, {credentials:"same-origin", ...options,
    headers:{"Content-Type":"application/json", "X-Gather-Account":owner}});
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || "Sharing is unavailable. Please try again."),{status:response.status,code:result.code});
  if (data.user?.id !== owner || result.accountId !== owner)
    throw Object.assign(Error("Your account changed. Reload the page."),{status:409});
  return result;
}
async function loadEventShareFriends(more = false) {
  const state = eventShareState;
  if (!state || state.loading || state.pending || state.sent || state.blocked || !state.owner) return;
  state.loading = true; state.error = ""; renderEventShare();
  try {
    const result = await sharingApi("/friends/people?section=friends&limit=50" + (more && state.next ? "&after=" + encodeURIComponent(state.next) : ""), state.owner);
    if (eventShareState !== state) return;
    const friends = result.people.filter(person => person.relationship === "friends");
    state.friends = [...new Map([...(more ? state.friends : []), ...friends].map(person => [person.id,person])).values()];
    state.next = result.nextCursor; state.loaded = true;
  } catch(error) {
    if (eventShareState === state) {
      state.error = error.message;
      if ([401,409].includes(error.status)) { state.friends=[]; state.selected=""; state.loaded=false; state.blocked=true; }
    }
  }
  finally { if (eventShareState === state) { state.loading = false; renderEventShare(); document.getElementById("eventShareFriend")?.focus(); } }
}
function selectEventShareFriend(id) {
  const state = eventShareState;
  if (!state || state.pending || state.sent) return;
  state.selected = state.friends.some(person => person.id === id) ? id : "";
  state.error = ""; renderEventShare();
  document.getElementById("eventShareFriend")?.focus();
}
async function sendGatherEvent() {
  const state = eventShareState;
  if (!state || state.pending || state.sent || state.blocked || !state.selected || data.user?.id !== state.owner) return;
  const key = `${state.owner}:${state.id}:${state.selected}`;
  let attempt = state.attempts.get(key) || gatherShareAttempts.get(key);
  if (attempt?.pending) return;
  // Keep an uncertain request ID for explicit retries, even after closing the menu.
  try {
    if (!attempt || attempt.sent) attempt = {requestId:crypto.randomUUID(), pending:false, sent:false};
    state.attempts.set(key,attempt); gatherShareAttempts.set(key,attempt);
    attempt.pending = true; state.pending = true; state.error = ""; renderEventShare();
    await sharingApi(`/events/${encodeURIComponent(state.id)}/share`,state.owner,{
      method:"POST",body:JSON.stringify({channel:"in_app",recipientId:state.selected,requestId:attempt.requestId}),
    });
    attempt.sent = true;
    if (eventShareState === state && data.user?.id === state.owner) { state.sent = true; toast("Event sent to your friend."); }
  } catch(error) {
    if (eventShareState === state) {
      state.error = error.message || "Unable to send. Please retry.";
      if ([401,409].includes(error.status)) { state.friends=[]; state.selected=""; state.loaded=false; state.blocked=true; }
    }
  }
  finally {
    if (attempt) attempt.pending = false;
    if (eventShareState === state) { state.pending = false; renderEventShare();
      document.getElementById(state.sent ? "eventShareTitle" : "eventShareFriend")?.focus(); }
  }
}
async function logExternalShare(id, channel, owner) {
  if (backendMode !== "supabase" || !owner || data.user?.id !== owner) return;
  try {
    await sharingApi(`/events/${encodeURIComponent(id)}/share`,owner,{
      method:"POST",body:JSON.stringify({channel,requestId:crypto.randomUUID()}),
    });
  } catch(error) {
    console.warn("External share logging failed:", error.code || error.status || "network error", "; no automatic retry.");
  }
}
async function shareEvent(id) {
  const event = events.find(item => item.id === id);
  if (!event || externalSharesPending.has(id)) return;
  if (!navigator.share) return copyEventLink(id);
  const owner = data.user?.id;
  externalSharesPending.add(id);
  let fallback = false;
  try {
    await navigator.share({title:event.name,text:`Check out ${event.name} on Gather`,url:eventShareUrl(id)});
    // Browser completion confirms the share process, not delivery to a recipient.
    void logExternalShare(id,"native",owner);
  } catch(error) { fallback = error.name !== "AbortError"; }
  finally { externalSharesPending.delete(id); }
  if (fallback) return copyEventLink(id);
}
async function copyEventLink(id) {
  if (!events.some(event => event.id === id) || externalSharesPending.has(id)) return;
  const owner = data.user?.id, menu = eventShareState;
  externalSharesPending.add(id);
  try {
    await navigator.clipboard.writeText(eventShareUrl(id));
    toast("Event link copied! Send it to anyone.");
    if (eventShareState?.id === id) $("eventCopyStatus").textContent = "Link copied.";
    void logExternalShare(id,"copy_link",owner);
  } catch {
    // Displaying/selecting the URL cannot confirm a copy and creates no analytics.
    if (menu && eventShareState !== menu) return;
    if (eventShareState?.id !== id || !document.getElementById("eventShareDialog")?.open) openEventShare(id);
    $("eventCopyStatus").textContent = "Copy was unavailable. Select the link to copy it manually, or try Copy link again.";
    $("eventShareLink").focus(); $("eventShareLink").select();
  } finally { externalSharesPending.delete(id); }
}

// Card surfaces open details while their controls retain independent actions.
function activateEventCard(event, id) {
  if (event.target.closest("button, a, input, select, textarea, summary")) return;
  if (event.type === "keydown") {
    if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
  }
  openEvent(id);
}

function eventLocationLink(event) {
  if (!event.location?.trim()) return "Not Specified";
  const query = encodeURIComponent(event.location + " BYU Provo Utah");
  return `<a class="event-location" href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener" aria-label="Open ${esc(event.location)} in Maps">${esc(event.location)}</a>`;
}

function eventWhereTile(event) {
  if (!event.location?.trim()) return `<div><span class="detail-label">${icon("map-pin")} Where</span><b>Not Specified</b></div>`;
  const query = encodeURIComponent(event.location + " BYU Provo Utah");
  return `<a class="detail-location" href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener" aria-label="Open ${esc(event.location)} in Maps"><span class="detail-label">${icon("map-pin")} Where ${icon("external-link")}</span><b>${esc(event.location)}</b><span>Open in Maps</span></a>`;
}

function eventAdmission(event) {
  return typeof event.price === "number" && Number.isFinite(event.price)
    ? event.price === 0 ? "Free" : "$" + event.price.toFixed(0)
    : "Not Specified";
}
function eventFood(event) {
  return event.food === true ? "Food provided" : event.food === false ? "Food not provided" : "Food: Not Specified";
}
function eventAdmissionTag(event) {
  const free = event.price === 0;
  return `<span class="${free ? "tag event-free" : "event-admission muted"}">${eventAdmission(event)}</span>${event.food === true ? '<span class="event-admission muted">Food provided</span>' : ""}`;
}

// Recipient inbox belongs to the existing Friends tab, with bounded pagination.
let receivedEventShares = null;
function receivedEventSharesState() {
  const owner = data.user?.id;
  if (!receivedEventShares || receivedEventShares.owner !== owner)
    receivedEventShares = {owner,items:[],next:null,loading:false,ready:false,error:""};
  return receivedEventShares;
}
function receivedEventSharesMarkup() {
  const state = receivedEventSharesState();
  return `<h2>Shared with Me</h2><p class="muted">Events your Gather friends sent you.</p>
    <button type="button" onclick="loadReceivedEventShares()" ${state.loading ? "disabled" : ""}>Refresh shared events</button>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
    ${state.loading ? '<p role="status">Loading shared events…</p>' : ""}
    <div class="list">${state.items.map(item => `<article class="card shared-event"><div class="card-body"><h3>${esc(item.eventName)}</h3><p>From ${esc(item.senderName)}</p><p class="muted"><time datetime="${esc(item.createdAt)}">${esc(new Date(item.createdAt).toLocaleString())}</time></p><a class="primary" href="${esc(eventShareUrl(item.eventId))}">Open event details</a></div></article>`).join("")}</div>
    ${state.ready && !state.items.length ? '<p class="notice">No events have been shared with you yet.</p>' : ""}
    ${state.next ? `<button type="button" onclick="loadReceivedEventShares(true)" ${state.loading ? "disabled" : ""}>Load more shared events</button>` : ""}`;
}
async function loadReceivedEventShares(more = false) {
  const state = receivedEventSharesState();
  if (!state.owner || state.loading) return;
  state.loading = true; state.error = ""; render();
  try {
    const result = await sharingApi("/shared-events?limit=20" + (more && state.next ? "&after=" + encodeURIComponent(state.next) : ""),state.owner);
    if (receivedEventShares !== state || data.user?.id !== state.owner) return;
    state.items = [...new Map([...(more ? state.items : []),...result.shares].map(item=>[item.id,item])).values()];
    state.next = result.nextCursor; state.ready = true;
  } catch(error) {
    if (receivedEventShares === state) {
      state.error = error.message;
      if ([401,409].includes(error.status)) { state.items=[]; state.next=null; state.ready=false; }
    }
  } finally {
    state.loading = false;
    if (receivedEventShares === state && data.user?.id === state.owner && page === "friends" && friendsTab === "shared") render();
  }
}
