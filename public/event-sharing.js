"use strict";

// Shared public event links and native sharing for every event surface.
function shareButton(event) {
  return `<button type="button" class="event-share" aria-label="Share ${esc(event.name)}" onclick="shareEvent('${event.id}')">${icon("share-2")}<span>Share</span></button>`;
}
function eventShareUrl(id) {
  const url = new URL("/events", location.href);
  url.searchParams.set("event", id);
  return url.href;
}
async function shareEvent(id) {
  const event = events.find(item => item.id === id);
  if (!event) return;
  const url = eventShareUrl(id);
  if (navigator.share) {
    try {
      await navigator.share({ title: event.name, text: `Check out ${event.name} on Gather`, url });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Event link copied! Send it to anyone.");
  } catch {
    showModal(`<button class="close" aria-label="Close share dialog" onclick="closeModal()">✕</button><div class="dialog-body"><h2>Share this event</h2><p>Copy this link and send it to anyone.</p><input id="eventShareLink" aria-label="Event share link" readonly value="${esc(url)}" style="width:100%" onclick="this.select()"></div>`);
    $("eventShareLink").focus();
    $("eventShareLink").select();
  }
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
