
"use strict";

/*
 * Gather legacy/shell application script
 * --------------------------------------
 * This script currently powers the original dynamic home shell. The Events
 * experience is now moving into public/events.js and /events, while this file
 * continues to own the home, navigation, and remaining legacy pages.
 * Login and sign-up are owned by auth.js at /login and /signup.
 */

// Browser and rendering helpers.
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = new Date();
today.setHours(0, 0, 0, 0);
const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Runtime data starts empty; database mode loads events and account state on boot.
let events = [];
let data = {
  saved: [],
  rsvp: [],
  attended: [],
  reminders: {},
  surveys: {},
  friends: [],
  interests: [],
  user: null,
  accounts: [],
};
try {
  let old = JSON.parse(localStorage.getItem("gather-v1"));
  if (old) data = { ...data, ...old };
} catch (e) {}

let page = "home",
  mode = "upcoming",
  filters = {
    q: "",
    category: "",
    location: "",
    club: "",
    major: "",
    from: "",
    to: "",
    food: false,
    free: false,
    spiritual: false,
  },
  filtersOpen = false,
  month = new Date(today.getFullYear(), today.getMonth(), 1),
  selectedDay = "",
  slide = 0,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  detailId = null;

// Keep all linked categories available to filters and labels; old fixtures
// that supply a single category remain compatible.
function eventCategories(event) {
  return event.categories?.length ? event.categories : [event.category || "Campus event"];
}
function categoryLabel(event) { return eventCategories(event).join(" · "); }
function categoryTags(event) {
  const colors = { "campus event": "campus", sports: "sports", career: "career", spiritual: "spiritual", service: "service", arts: "arts", social: "social" };
  return eventCategories(event).map(category => {
    const color = colors[category.trim().toLowerCase()];
    return `<span class="tag${color ? ` event-${color}` : ""}">${esc(category)}</span>`;
  }).join(" ");
}


// Derived category values and demo-browser persistence.
let categories = [...new Set(events.flatMap(eventCategories))];
function persistDemo() {
  try {
    localStorage.setItem("gather-v1", JSON.stringify(data));
  } catch (e) {
    toast(
      "Changes are available for this visit; browser storage is unavailable.",
    );
  }
}
function toast(s) {
  $("toast").textContent = s;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => ($("toast").textContent = ""), 3500);
}
function time(t) {
  if (!t) return "Time TBA";
  let [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}
function pretty(d, full = false) {
  if (!d) return "Date TBA";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: full ? "long" : undefined,
    month: "short",
    day: "numeric",
    year: full ? "numeric" : undefined,
  });
}
function ended(e) {
  return e.ends_at
    ? new Date(e.ends_at) < new Date()
    : new Date(e.date + "T" + (e.end || "23:59:59")) < new Date();
}
function toggleMenu() {
  const open = $("drawer").hidden;
  $("drawer").hidden = !open;
  $("menuButton").setAttribute("aria-expanded", String(open));
}
function go(p) {
  if (p === "login" || p === "signup") {
    location.assign("/" + p);
    return;
  }
  if (p === "list" || p === "calendar") {
    location.assign(p === "calendar" ? "/events?view=calendar" : "/events");
    return;
  }
  page = p;
  mode = p === "saved" ? "saved" : "upcoming";
  selectedDay = "";
  $("drawer").hidden = true;
  $("menuButton").setAttribute("aria-expanded", "false");
  if (location.protocol !== "file:")
    history.replaceState(null, "", p === "friends" ? "/#friends" : p === "saved" ? "/#saved" : "/");
  render();
  if (p === "friends" && backendMode === "supabase" && data.user && !booting) void friendActions.load();
  window.scrollTo(0, 0);
}
function setMode(m) {
  mode = m;
  selectedDay = "";
  render();
}
function bookmark(id) { return plans.set("bookmark", id); }
function rsvp(id) { return plans.set("rsvp", id); }
function planButton(kind, event, compact = false) {
  if (kind === "rsvp") return goingButton(event);
  const selected = data.saved.includes(event.id);
  return `<button type="button" class="event-bookmark" data-plan-kind="bookmark" data-event-id="${esc(event.id)}" aria-label="${selected ? "Remove bookmark for" : "Bookmark"} ${esc(event.name)}" aria-pressed="${selected}" onclick="bookmark('${event.id}')">${icon(selected ? "bookmark-check" : "bookmark")}${compact ? "" : `<span>${selected ? "Saved" : "Save"}</span>`}</button>`;
}
function goingButton(event) {
  const selected = data.rsvp.includes(event.id);
  const unavailable = ended(event) && !selected;
  return `<button type="button" class="event-rsvp" data-plan-kind="rsvp" data-event-id="${esc(event.id)}" aria-label="${selected ? "Cancel RSVP for" : "RSVP to"} ${esc(event.name)}" aria-pressed="${selected}" ${unavailable ? "disabled" : ""} onclick="rsvp('${event.id}')">${icon(selected ? "check" : "user-check")}<span>${unavailable ? "Event ended" : selected ? "Going" : "Going?"}</span></button>`;
}
function refreshPlanControls() {
  document.querySelectorAll("[data-plan-kind]").forEach(button => {
    const { planKind, eventId } = button.dataset;
    const event = events.find(item => item.id === eventId);
    button.disabled = plans.busy(planKind, eventId) || (planKind === "rsvp" && event && ended(event) && !data.rsvp.includes(eventId));
    button.setAttribute("aria-busy", String(button.disabled));
    button.setAttribute("aria-pressed", String(data[planKind === "bookmark" ? "saved" : "rsvp"].includes(eventId)));
  });
}
function attend(id) {
  if (!requireAccount()) return;
  data.attended.includes(id)
    ? (data.attended = data.attended.filter((x) => x !== id))
    : data.attended.push(id);
  persist();
  render();
  openEvent(id);
}

// Event discovery, cards, filters, calendar, and event dialogs.
function listEvents() {
  return events
    .filter((e) => {
      let past = ended(e);
      let allowed =
        mode === "past"
          ? past && (data.saved.includes(e.id) || data.attended.includes(e.id))
          : mode === "saved"
            ? data.saved.includes(e.id) && !past
            : mode === "savedPast"
              ? data.saved.includes(e.id) && past
              : mode === "rsvp"
                ? data.rsvp.includes(e.id) && !past
                : !past;
      return (
        allowed &&
        (!filters.q ||
          `${esc(e.name)} ${esc(e.club)} ${esc(e.location)}`
            .toLowerCase()
            .includes(filters.q.toLowerCase())) &&
        (!filters.category || eventCategories(e).includes(filters.category)) &&
        (!filters.location || e.location === filters.location) &&
        (!filters.club || e.club === filters.club) &&
        (!filters.major ||
          e.major === filters.major ||
          e.major === "All majors") &&
        (!filters.from || e.date >= filters.from) &&
        (!filters.to || e.date <= filters.to) &&
        (!filters.food || e.food) &&
        (!filters.free || e.price === 0) &&
        (!filters.spiritual || eventCategories(e).includes("Spiritual"))
      );
    })
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
function card(event) {
  return `<article class="card event-card" data-event-id="${esc(event.id)}" tabindex="0" aria-label="View details for ${esc(event.name)}" onclick="activateEventCard(event, '${event.id}')" onkeydown="activateEventCard(event, '${event.id}')">
    ${poster(event)}
    <div class="card-body">
      <div class="event-card-heading">
        <div class="row">${categoryTags(event)}
          ${eventAdmissionTag(event)}
        </div>
        ${planButton("bookmark", event, true)}
      </div>
      <h3><button type="button" class="event-title" onclick="openEvent('${event.id}')" aria-label="View details for ${esc(event.name)}">${esc(event.name)}</button></h3>
      <div class="metadata">
        <span>${icon("clock")} ${pretty(event.date)} · ${time(event.start)}${event.end ? "–" + time(event.end) : ""}</span>
        <span>${icon("map-pin")} ${eventLocationLink(event)}</span>
      </div>
      <div class="card-actions event-card-actions">
        ${planButton("rsvp", event)}
        ${shareButton(event)}
      </div>
    </div>
  </article>`;
}
function empty() {
  if (mode === "past" && page !== "home") {
    return `<div class="empty">
      <h3>No past saved events yet.</h3>
      <p class="muted">Events you've bookmarked or RSVP'd to from the past six months will appear here!</p>
      <button onclick="mode='upcoming';clearFilters()">Explore events</button>
    </div>`;
  }

  return `<div class="empty">
    <h3>No upcoming events match current filters</h3>
    <p class="muted">Try a different date or clear your filters.</p>
    <button onclick="clearFilters()">Clear filters</button>
    <button onclick="mode='upcoming';clearFilters()">Explore events</button>
  </div>`;
}
function options(values, current) {
  return (
    '<option value="">All</option>' +
    values
      .map(
        (v) => `<option ${v === current ? "selected" : ""}>${esc(v)}</option>`,
      )
      .join("")
  );
}
function filterSelect(label, k, vals) {
  return `<label>${label}<select onchange="setFilter('${k}',this.value)">${options(vals, filters[k])}</select></label>`;
}

function toolbar() {
  const tabs = [
    ["upcoming", "All upcoming"],
    ["rsvp", "RSVP’d"],
    ["past", "Past saved events"],
  ];

  const tabButtons = tabs.map(([m, l]) =>
    `<button class="${mode === m ? "active" : ""}"
      onclick="setMode('${m}')">${l}</button>`
  ).join("");

  const foodFilters = [
    ["food", "Has food"],
    ["free", "Free events"],
    ["spiritual", "Spiritual"],
  ].map(([k, l]) =>
    `<label><input type="checkbox"
      ${filters[k] ? "checked" : ""}
      onchange="setFilter('${k}',this.checked)"> ${l}</label>`
  ).join("");

  return `
    <div class="toolbar">
      <div class="row">
        <input class="search"
          aria-label="Search events"
          placeholder="Search events, clubs, or places…"
          value="${esc(filters.q)}"
          oninput="filters.q=this.value;updateResults()">

        <button onclick="filtersOpen=!filtersOpen;render()"
          aria-expanded="${filtersOpen}">
          ${icon("sliders-horizontal")}
          Filters ${Object.values(filters).filter(Boolean).length
            ? "(" + Object.values(filters).filter(Boolean).length + ")"
            : ""}
        </button>

        <button onclick="go(page==='calendar'?'list':'calendar')">
          ${page === "calendar"
            ? icon("list") + " List view"
            : icon("calendar-days") + " Calendar view"}
        </button>
      </div>

      <div class="chips">${tabButtons}</div>

      <div class="filters" ${filtersOpen ? "" : "hidden"}>
        ${filterSelect("Category / type", "category", categories)}
        ${filterSelect("Location", "location",
          [...new Set(events.map(e => e.location))])}
        ${filterSelect("Club / organizer", "club",
          [...new Set(events.map(e => e.club).filter(Boolean))])}
        ${filterSelect("Major relevance", "major",
          ["Information Systems", "Business", "Humanities", "Fine Arts"])}

        <label>From date
          <input type="date" value="${filters.from}"
            onchange="setFilter('from',this.value)">
        </label>

        <label>Through date
          <input type="date" value="${filters.to}"
            onchange="setFilter('to',this.value)">
        </label>

        <div>${foodFilters}</div>
        <button onclick="clearFilters()">Clear filters</button>
      </div>
    </div>`;
}

function setFilter(k, v) {
  filters[k] = v;
  updateResults();
}
function clearFilters() {
  Object.keys(filters).forEach(
    (k) => (filters[k] = typeof filters[k] === "boolean" ? false : ""),
  );
  render();
}
function updateResults() {
  if ($("results")) $("results").innerHTML = results();
  if ($("resultCount"))
    $("resultCount").textContent = listEvents().length + " events";
  icons();
  refreshPlanControls();
}
function moveSlide(n) {
  slide = (slide + n + 3) % 3;
  renderHero();
}
function renderHero() {
  if ($("heroHost")) $("heroHost").innerHTML = hero();
  icons();
  refreshPlanControls();
}
setInterval(() => {
  if (
    page === "home" &&
    !paused &&
    !document.hidden &&
    !$("modal").open &&
    !$("heroHost")?.matches(":hover") &&
    !$("heroHost")?.contains(document.activeElement)
  )
    moveSlide(1);
}, 6500);
function results() {
  if (filters.from && filters.to && filters.from > filters.to)
    return '<div class="empty" role="alert">The end date must be on or after the start date. Adjust the date range.</div>';
  let arr = listEvents();
  if (page === "calendar") return calendar(arr);
  return arr.length
    ? `<div class="list">${arr.map(card).join("")}</div>`
    : empty();
}
function calendar(arr) {
  let y = month.getFullYear(),
    m = month.getMonth(),
    first = new Date(y, m, 1).getDay(),
    days = new Date(y, m + 1, 0).getDate(),
    cells = [];
  for (let i = 0; i < Math.ceil((first + days) / 7) * 7; i++) {
    let n = i - first + 1;
    if (n < 1 || n > days) {
      cells.push('<div class="day dim"></div>');
      continue;
    }
    let d = key(new Date(y, m, n)),
      es = arr.filter((e) => e.date === d);
    cells.push(
      `<div class="day"><button class="daynum ${d === key(today) ? "today" : ""}" aria-label="View events on ${d}" onclick="selectDay('${d}')">${n}</button>${es.map((e) => `<div class="calendar-event"><button class="calevent" onclick="openEvent('${e.id}')">${time(e.start)}<br>${esc(e.name)}</button><div class="row calendar-event-actions">${goingButton(e)}${shareButton(e)}</div></div>`).join("")}</div>`,
    );
  }
  return `<div class="row between section-head"><div class="row"><h2>${month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2><button onclick="month=new Date(today.getFullYear(),today.getMonth(),1);selectedDay='';updateResults()">Today</button></div><div class="row"><button aria-label="Previous month" onclick="changeMonth(-1)">←</button><button aria-label="Next month" onclick="changeMonth(1)">→</button></div></div><div class="calendar"><div class="calhead">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => "<div>" + d + "</div>").join("")}</div><div class="calgrid">${cells.join("")}</div></div>${!arr.some((e) => e.date.startsWith(key(month).slice(0, 7))) ? '<p class="notice">No matching events this month. Change months or adjust your filters.</p>' : ""}<div id="dayList" class="day-list">${
    selectedDay
      ? `<div class="row between section-head"><h2>${pretty(selectedDay, true)}</h2><button onclick="selectedDay='';updateResults()">Back to month</button></div><div class="list">${
          arr
            .filter((e) => e.date === selectedDay)
            .map(card)
            .join("") ||
          '<div class="empty">No events on this day match your filters.</div>'
        }</div>`
      : '<p class="muted">Select a date to see its schedule, or an event to see the details.</p>'
  }</div>`;
}
function changeMonth(n) {
  month = new Date(month.getFullYear(), month.getMonth() + n, 1);
  selectedDay = "";
  updateResults();
}
function selectDay(d) {
  selectedDay = d;
  updateResults();
  $("dayList").scrollIntoView({ behavior: "smooth", block: "start" });
}
function browse() {
  return `<div class="eyebrow">${page === "saved" ? "Make it a plan" : "Discover & connect"}</div><h1>${page === "calendar" ? "Your campus calendar." : page === "saved" ? "Good things, saved." : "What’s happening at BYU."}</h1><p class="muted">${page === "saved" ? "Your bookmarks stay here, even after an event ends." : "Find something that fits your day. All event times are local to BYU Provo."}</p>${toolbar()}<div class="row between"><span id="resultCount" class="muted">${listEvents().length} events</span>${page === "saved" ? "<button onclick=\"setMode('savedPast')\">Past saved events →</button>" : ""}</div><div id="results" style="margin-top:16px">${results()}</div>`;
}
function showModal(html, label) {
  $("modal").innerHTML = html;
  $("modal").setAttribute("aria-label", label);
  if (!$("modal").open) $("modal").showModal();
  icons();
  refreshPlanControls();
}
function openEvent(id) {
  let e = events.find((e) => e.id === id);
  if (!e) {
    showModal(
      '<div class="dialog-body"><h2>Event not found</h2><p>This event is unavailable.</p><button onclick="closeModal();go(\'list\')">Explore events</button></div>',
      "Event not found",
    );
    return;
  }
  detailId = id;
  showModal(
    `<button class="close" aria-label="Close event details" onclick="closeModal()">✕</button><div class="dialog-body event-detail-body"><header class="event-detail-heading"><h2 id="eventDetailTitle">${esc(e.name)}</h2><div class="event-tags">${categoryTags(e)}${ended(e) ? '<span class="tag">Past event</span>' : ""}</div></header><div class="detail-grid"><div><span class="muted">When</span><b>${pretty(e.date, true)}</b>${time(e.start)}${e.end ? "–" + time(e.end) : ""}</div>${eventWhereTile(e)}<div><span class="muted">Admission</span><b>${eventAdmission(e)}</b>${eventFood(e)}</div><div><span class="muted">Hosted by</span><b>${esc(e.club || "Not Specified")}</b>Major relevance: ${esc(e.major || "Not Specified")}</div></div><section class="event-description" aria-labelledby="eventDescriptionTitle"><h3 id="eventDescriptionTitle">About this event</h3><p>${esc(e.description || "Not Specified")}</p></section><div class="row event-detail-actions"><button class="${data.saved.includes(id) ? "active" : ""}" data-plan-kind="bookmark" data-event-id="${id}" onclick="bookmark('${id}')">${data.saved.includes(id) ? icon("bookmark-check") + " Saved" : icon("bookmark") + " Save event"}</button>${ended(e) ? `<button onclick="attend('${id}')">${data.attended.includes(id) ? "✓ Attended" : "Mark attended"}</button>${data.saved.includes(id) || data.attended.includes(id) ? `<button class="primary" onclick="survey('${id}')">${data.surveys[id] ? "Edit reflection" : "Rate this event"}</button>` : ""}` : `<button class="primary" data-plan-kind="rsvp" data-event-id="${id}" onclick="rsvp('${id}')">${data.rsvp.includes(id) ? "✓ RSVP’d · Cancel" : "RSVP to event"}</button>`}${shareButton(e)}</div>${
      !ended(e)
        ? `<label>Event reminder<select onchange="remind('${id}',this.value)">${[
            ["", "No reminder"],
            ["60", "1 hour before"],
            ["1440", "1 day before"],
          ]
            .map(
              ([v, l]) =>
                `<option value="${v}" ${data.reminders[id] === v ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></label><p class="muted" style="font-size:12px">Download a calendar reminder to receive an alert through your calendar app.</p>`
        : ""
    }</div>`,
    "Event details: " + e.name,
  );
}
function closeModal() {
  $("modal").close();
  detailId = null;
}
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) {
    let r = $("modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
function eventMap(id) {
  let e = events.find((e) => e.id === id);
  showModal(
    `<button class="close" onclick="openEvent('${id}')">← Back</button><div class="dialog-body"><div class="eyebrow">Find your way</div><h2>${esc(e.location)}</h2><p>BYU campus · Provo, Utah</p><div class="notice">Open this location on a map for directions and building details.</div><a class="primary" style="display:inline-block;padding:12px;border-radius:8px;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location + " BYU Provo Utah")}">Open location in Google Maps ↗</a></div>`,
    "Event location",
  );
}
function remind(id, v) {
  if (!requireAccount()) return;
  if (!v) {
    delete data.reminders[id];
    persist();
    toast(
      "Reminder preference removed. Remove any imported alert in your calendar app.",
    );
    return;
  }
  data.reminders[id] = v;
  persist();
  let e = events.find((e) => e.id === id),
    stamp = (d, t) => d.replaceAll("-", "") + "T" + t.replace(":", "") + "00",
    ical = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Gather Demo//EN",
      "BEGIN:VEVENT",
      "UID:" + id + "@gather-demo",
      "DTSTAMP:" +
        new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, ""),
      "DTSTART;TZID=America/Denver:" + stamp(e.date, e.start),
      "DTEND;TZID=America/Denver:" + stamp(e.date, e.end),
      "SUMMARY:" + e.name,
      "LOCATION:" + e.location,
      "DESCRIPTION:Sample BYU event from the Gather prototype.",
      "BEGIN:VALARM",
      "TRIGGER:-PT" + v + "M",
      "ACTION:DISPLAY",
      "DESCRIPTION:Event reminder",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  let u = URL.createObjectURL(new Blob([ical], { type: "text/calendar" })),
    a = document.createElement("a");
  a.href = u;
  a.download = id + "-reminder.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
  toast("Calendar file downloaded. Import it to enable the reminder.");
}
function survey(id) {
  let s = data.surveys[id] || {};
  showModal(
    `<button class="close" onclick="openEvent('${id}')">✕</button><form class="dialog-body" onsubmit="saveSurvey(event,'${id}')"><div class="eyebrow">A moment to reflect</div><h2>How was it?</h2><p class="muted">${esc(events.find((e) => e.id === id).name)} · Optional, private feedback</p><label>How satisfied were you?<select name="rating" required><option value="">Choose a rating</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(s.rating) === String(n) ? "selected" : ""}>${n} — ${["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"][n - 1]}</option>`).join("")}</select></label><label>Was the event as advertised?<select name="accuracy" required><option value="">Choose a response</option>${["Yes, completely", "Mostly yes", "Neutral", "Mostly no", "No, not at all"].map((v) => `<option ${s.accuracy === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>How could your experience be better?<textarea name="feedback" rows="3" maxlength="2000">${esc(s.feedback || "")}</textarea></label><label>Would you attend another event from this organizer?<select name="again" required><option value="">Choose a response</option>${["Yes", "No"].map((v) => `<option ${s.again === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><div class="row"><button class="primary" type="submit">Save reflection</button><button type="button" onclick="openEvent('${id}')">Skip for now</button></div><p class="muted" style="font-size:12px">${backendMode === "demo" ? "Saved in this browser." : "Saved to your account."} Your feedback is not sent to the organizer.</p></form>`,
    "Event satisfaction survey",
  );
}
function saveSurvey(ev, id) {
  ev.preventDefault();
  if (!requireAccount()) return;
  data.surveys[id] = Object.fromEntries(new FormData(ev.target));
  persist();
  openEvent(id);
  toast("Your reflection has been saved");
}

// Stable friend data/control attributes are the handoff to the UI coworker.
function friendCard(person, state) {
  const labels = { none: "Send request", outgoing_pending: "Cancel request", friends: "Remove friend", incoming_pending: "Request received" };
  const descriptions = { none: "", outgoing_pending: "Request sent", friends: "Friends", incoming_pending: "This person has sent you a request." };
  const disabled = state.loading || !state.ready || state.accountChanged || person.pending || Boolean(person.error) || person.relationship === "incoming_pending";
  const label = person.pending ? ({ send: "Sending…", cancel: "Cancelling…", remove: "Removing…", refresh: "Refreshing…" })[person.pendingAction] : labels[person.relationship];
  const initials = person.name.trim().split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join("").toUpperCase() || "M";
  return `<article class="card friend" data-person-id="${person.id}"><span class="avatar" aria-hidden="true">${esc(initials)}</span><div class="info" style="min-width:0;overflow-wrap:anywhere"><h3 tabindex="-1" data-friend-heading="${person.id}">${esc(person.name)}</h3>${person.username ? `<p class="muted">@${esc(person.username)}</p>` : ""}<p class="muted" data-friend-status="${person.relationship}" role="status">${descriptions[person.relationship]}</p>${person.error ? `<p class="error" role="alert">${esc(person.error)}</p>` : ""}</div><div class="friend-controls row"><button type="button" data-friend-user-id="${person.id}" data-friend-control="action" aria-label="${esc(label + " — " + person.name)}" aria-busy="${person.pending}" ${disabled ? "disabled" : ""} onclick="friendAction('${person.id}')">${esc(label)}</button>${person.error ? `<button type="button" data-friend-user-id="${person.id}" data-friend-control="refresh" ${person.pending || state.accountChanged ? "disabled" : ""} onclick="refreshFriend('${person.id}')">Refresh status</button>` : ""}</div></article>`;
}
function friendsPage() {
  const heading = '<div class="eyebrow">Better with company</div><h1>Your people.</h1><p class="muted">Connect with people on Gather.</p>';
  if (booting) return heading + '<p role="status">Loading your account…</p>';
  if (backendMode !== "supabase") return heading + '<p class="notice">Friend requests require a connected account.</p>';
  if (!data.user) return heading + '<div class="notice">Sign in to connect with people. <button onclick="go(\'login\')">Sign in</button></div>';
  const state = friendActions.view();
  const notice = state.error ? `<div class="notice" role="alert">${esc(state.error)} <button onclick="${state.accountChanged ? "location.reload()" : "refreshPeople()"}">${state.accountChanged ? "Reload page" : "Retry"}</button></div>` : "";
  const content = state.people.length ? `<div class="grid">${state.people.map(person => friendCard(person, state)).join("")}</div>`
    : state.ready ? '<div class="empty">No other people are available yet.</div>' : '';
  return heading + `<div class="row"><button type="button" id="friendsRefresh" onclick="refreshPeople()" ${state.loading || friendActions.hasPending() || state.accountChanged ? "disabled" : ""}>Refresh people</button></div>` + notice
    + (state.loading || (!state.ready && !state.error) ? '<p role="status">Loading people…</p>' : '') + content
    + (state.hasMore ? `<button type="button" id="friendsMore" onclick="loadMorePeople()" ${state.loading || !state.ready || friendActions.hasPending() ? "disabled" : ""}>Load more people</button>` : '')
    + `<div class="prefs"><h2>Event interests</h2><div class="chips">${categories.map(c => `<button class="${data.interests.includes(c) ? "active" : ""}" aria-pressed="${data.interests.includes(c)}" onclick="toggleInterest(${esc(JSON.stringify(c))})">${esc(c)}</button>`).join("")}</div></div>`;
}
function friendAction(id) { return friendActions.act(id); }
function refreshFriend(id) { return friendActions.refreshPerson(id); }
function refreshPeople() { return friendActions.load(); }
function loadMorePeople() { return friendActions.load(true); }
function toggleInterest(c) {
  if (!requireAccount()) return;
  data.interests.includes(c)
    ? (data.interests = data.interests.filter((x) => x !== c))
    : data.interests.push(c);
  persist();
  render();
}

// Shell navigation and page selection. Standalone routes are dispatched here.
function renderBase() {
  let links = [
    ["home", "Discover"],
    ["list", "Events"],
    ["bookmarked", "Bookmarked"],
    ["calendar", "Calendar"],
    ["friends", "Friends"],
  ];
  $("topnav").innerHTML = links
    .map(
      ([p, n]) =>
        p === "bookmarked"
          ? `<button type="button" disabled title="Bookmarked page coming soon">${n}</button>`
          : `<button class="${page === p ? "active" : ""}" onclick="go('${p}')">${n}</button>`,
    )
    .join("");
  $("sideNav").innerHTML = [
    ...links,
    ["login", data.user ? "Account" : "Sign in"],
  ]
    .map(([p, n]) => p === "bookmarked"
      ? `<button type="button" disabled title="Bookmarked page coming soon">${n}</button>`
      : `<button onclick="go('${p}')">${n}</button>`)
    .join("");

    const userButton = $("userButton");
      globalThis.accountMenu?.update(data.user, async () => {
        if (backendMode === "supabase") await api("/auth/logout", { method: "POST", body: "{}" });
        else { data.user = null; persistDemo(); }
        location.assign("/");
      });

    if (data.user) {
      const initials = (data.user.name || data.user.email || "U")
        .trim()
        .split(/\s+/)
        .map(part => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      userButton.textContent = initials;
      userButton.classList.add("profile-avatar");
      userButton.title = data.user.name || "My account";
    } else {
      userButton.textContent = "Sign in ↗";
      userButton.classList.remove("profile-avatar");
    }

  $("app").innerHTML =
    page === "home"
      ? home()
      : ["list", "calendar", "saved"].includes(page)
        ? browse()
        : page === "friends"
          ? friendsPage()
          : '<div class="empty"><h1>Page not found</h1><p>Let’s get you back to campus.</p><button onclick="go(\'home\')">Go home</button></div>';
}

/* Presentation helpers — Lucide icons and semantic category classes. */
function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}
function icons() {
  window.lucide?.createIcons();
}
function categoryClass(e) {
  return (
    "category-" +
    ({
      Social: "social",
      Arts: "arts",
      Culture: "culture",
      Service: "service",
      Spiritual: "spiritual",
    }[e.category] || "primary")
  );
}
function categoryIcon(e) {
  return (
    {
      Social: "party-popper",
      Arts: "music-2",
      Career: "lightbulb",
      Service: "heart-handshake",
      Sports: "trophy",
      Culture: "globe-2",
      Spiritual: "sun",
    }[e.category] || "calendar-days"
  );
}
function poster(e, cls = "") {
  const classes = `poster ${categoryClass(e)} ${cls}`;
  const imageUrl = e.imageUrl?.trim();

  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    return `
      <div class="${classes} event-photo-poster">
        <img src="${esc(imageUrl)}" alt="" loading="lazy">
      </div>`;
  }

  return `
    <div class="${classes}" role="img" aria-label="Sample flyer for ${esc(e.name)}">
      <span class="shape">${icon(categoryIcon(e))}</span>
      <small>${esc(e.club || "Not Specified")} · ${pretty(e.date)}</small>
      <strong>${esc((e.poster || "Campus event").replaceAll(" / ", " · "))}</strong>
    </div>`;
}
function hero() {
  let upcoming = events.filter((e) => !ended(e)).slice(0, 3);
  let e = upcoming[slide % upcoming.length];
  if (!e)
    return '<div class="empty"><h2>A little more campus in your life.</h2><p>New events will appear here when they’re available.</p></div>';
  const imageUrl = e.imageUrl?.trim();
  const featuredArt = imageUrl && /^https?:\/\//i.test(imageUrl)
  ? `<img class="hero-flyer" src="${esc(imageUrl)}" alt="">`
  : `<span class="bigmark">${icon(categoryIcon(e))}</span>`;
  return `<div class="hero"><div class="hero-copy"><span class="eyebrow">${icon("sparkles")} Make room for a good time</span><h1>Your next favorite<br>campus memory.</h1><p class="muted">Find something you love.<br>Bring someone along.</p><button class="primary" style="margin-top:16px" onclick="go('list')">Explore events ${icon("arrow-up-right")}</button></div><div class="hero-art ${categoryClass(e)}" tabindex="0" aria-label="View details for ${esc(e.name)}" onclick="activateEventCard(event, '${e.id}')" onkeydown="activateEventCard(event, '${e.id}')">${featuredArt}<small>FEATURED ON CAMPUS</small><b>${esc(e.name)}</b><p>${pretty(e.date)} · ${time(e.start)}<br>${eventLocationLink(e)}</p><div class="hero-event-actions">${goingButton(e)}${shareButton(e)}</div><div class="row hero-navigation"><div class="hero-controls"><button aria-label="Previous flyer" onclick="moveSlide(-1)">${icon("chevron-left")}</button><span class="count">${(slide % upcoming.length) + 1} / ${upcoming.length}</span><button aria-label="Next flyer" onclick="moveSlide(1)">${icon("chevron-right")}</button><button aria-label="${paused ? "Play" : "Pause"} slideshow" onclick="paused=!paused;renderHero()">${icon(paused ? "play" : "pause")}</button></div></div></div></div>`;
}
function home() {
  let upcoming = events.filter((e) => !ended(e)),
    recommended = upcoming
      .filter((e) => eventCategories(e).some(category => data.interests.includes(category)))
      .slice(0, 4);
  if (!recommended.length) recommended = upcoming.slice(0, 4);
  let saved = upcoming.filter((e) => data.saved.includes(e.id)).slice(0, 3);
  return `<div class="welcome"><div class="row between"><span class="eyebrow">${icon("sparkles")} A little more campus in your life</span><span class="muted">${today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div><h1>Good things are happening.</h1><p class="muted">Discover your next plan, find your people, and make the most of BYU.</p></div><div class="home-layout"><div><div id="heroHost">${hero()}</div><div class="quick"><button onclick="go('list')"><span class="symbol">${icon("compass")}</span><span><b>Explore events</b><small>Find your next thing</small></span></button><button onclick="go('calendar')"><span class="symbol">${icon("calendar-days")}</span><span><b>Plan your month</b><small>See what’s coming up</small></span></button><button onclick="go('saved')"><span class="symbol">${icon("bookmark")}</span><span><b>Your saved plans</b><small>Keep a good idea</small></span></button></div><div class="row between section-head"><h2>Picked for you</h2><button onclick="go('friends')">Edit interests ${icon("arrow-right")}</button></div><div class="grid">${recommended.map(card).join("") || empty()}</div><div class="row between section-head"><h2>More to look forward to</h2><button onclick="go('list')">View all ${icon("arrow-right")}</button></div><div class="list">${
    upcoming
      .filter((e) => !recommended.includes(e))
      .slice(0, 3)
      .map(card)
      .join("") || '<p class="muted">You’re all caught up.</p>'
  }</div></div><aside class="sidebar"><section class="glass-panel panel-pad"><h2 class="side-title">${icon("bookmark")} Your next plans</h2><p>Good ideas you kept for later.</p>${saved.map((e) => `<div class="mini-event" tabindex="0" aria-label="View details for ${esc(e.name)}" onclick="activateEventCard(event, '${e.id}')" onkeydown="activateEventCard(event, '${e.id}')"><span class="date-chip">${new Date(e.date + "T12:00").toLocaleDateString("en-US", { month: "short" })}<b>${Number(e.date.slice(-2))}</b></span><div><button onclick="openEvent('${e.id}')">${esc(e.name)}</button><p>${time(e.start)} · ${eventLocationLink(e)}</p><div class="row mini-event-actions">${goingButton(e)}${shareButton(e)}</div></div></div>`).join("") || '<p class="notice">Tap a bookmark on any event to keep it here.</p>'}<button class="primary" onclick="go('saved')">View saved events ${icon("arrow-right")}</button></section><section class="glass-panel panel-pad"><h2 class="side-title">${icon("users")} Better together</h2><div class="friend-preview">${data.friends
    .slice(0, 5)
    .map(
      (n) => `<span class="avatar" aria-label="${esc(n)}">${esc(n[0])}</span>`,
    )
    .join(
      "",
    )}</div><p>Find familiar faces at something new.</p><button onclick="go('friends')">Your friends & interests ${icon("arrow-up-right")}</button></section><section class="glass-panel panel-pad"><span class="eyebrow">Make it your campus</span><h2 style="margin-top:13px">A little curiosity<br>goes a long way.</h2><p>Music, service, new ideas. There’s a place for you here.</p><div class="chips">${data.interests.map((c) => `<span class="tag">${esc(c)}</span>`).join("")}</div></section></aside></div>`;
}

/* API integration. File previews are demo-only; Node enables Supabase mode. */
let backendMode = "demo",
  syncFailed = false,
  booting = true,
  stateReady = true;
const emptyState = () => ({
  saved: [],
  rsvp: [],
  attended: [],
  reminders: {},
  surveys: {},
  friends: [],
  interests: [],
  user: null,
  accounts: [],
});
async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(Error(body.error || "Unable to complete that request."), { status: res.status, code: body.code });
  return body;
}
function persist() {
  if (backendMode === "demo") { persistDemo(); return; }
  // These legacy prototype preferences have no database tables yet. In
  // particular, they must never rewrite bookmarks/RSVPs as a side effect.
  toast("This prototype preference is available for this visit only.");
}
function requireAccount() {
  if (backendMode !== "supabase") return true;
  if (!data.user) {
    closeModal();
    go("login");
    toast("Sign in to save your plans.");
    return false;
  }
  if (!stateReady) {
    toast("Your saved plans have not loaded. Reload to try again.");
    return false;
  }
  return true;
}

function render() {
  renderBase();
  icons();
  refreshPlanControls();
  if ($("footerMode") && !syncFailed)
    $("footerMode").textContent =
      backendMode === "demo"
        ? "Demo mode · Sample events · Plans saved in this browser"
        : data.user
          ? "Connected to Supabase · Your personal plans"
          : "Connected to Supabase · Sign in to save plans";
}
async function loadState() {
  stateReady = false;
  const result = await api("/state");
  if (result.accountId !== data.user.id) throw Error("Your account changed. Reload to load its plans.");
  data = { ...emptyState(), ...result.state, user: data.user };
  stateReady = true;
}
async function boot() {
  booting = true;
  const legacyPage = location.hash.slice(1);
  if (["login", "signup"].includes(legacyPage)) {
    location.replace("/" + legacyPage);
    return;
  }
  if (["saved", "friends"].includes(legacyPage)) {
    page = legacyPage;
    mode = legacyPage === "saved" ? "saved" : "upcoming";
  }
  if (location.protocol !== "file:") {
    try {
      const config = await api("/config");
      backendMode = config.mode;
      if (backendMode === "supabase") {
        data = emptyState();
        events = [];
        render();

        const session = await api("/auth/session");
        data.user = session.user;

        // Show the signed-in profile immediately, before event loading.
        render();

        if (data.user) {
          try {
            await loadState();
          } catch (error) {
            console.error("Unable to load saved user data:", error);
          }
        }

        // Load events separately so failures cannot hide the signed-in profile.
        try {
          const listing = await api("/events");
          events = listing.events;
          categories = [...new Set(events.flatMap(eventCategories))];
        } catch (error) {
          if (page !== "friends") throw error;
          // Event discovery and personal event preferences do not gate friends.
          events = []; categories = [];
        }
      }
    } catch (e) {
      booting = false;
      $("app").innerHTML =
        '<div class="empty"><h2>We couldn’t load Gather.</h2><p>Check the server connection and Supabase configuration, then try again.</p><button onclick="boot()">Try again</button></div>';
      return;
    }
  }
  booting = false;
  render();
  if (page === "friends" && backendMode === "supabase" && data.user) await friendActions.load();
  if (location.hash.startsWith("#event="))
    openEvent(decodeURIComponent(location.hash.slice(7)));
}

// Support legacy account links even when only the URL fragment changes.
window.addEventListener("hashchange", () => {
  const target = location.hash.slice(1);
  if (["login", "signup"].includes(target)) location.replace("/" + target);
  else if (["saved", "friends"].includes(target)) go(target);
});
window.addEventListener("beforeunload", (e) => {
  if (backendMode === "supabase" && (plans.hasPending() || friendActions.hasPending() || syncFailed)) {
    /* Browsers may warn only after user interaction. */ e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("drawer").hidden) toggleMenu();
});
const plans = window.GatherPlans.create({
  request: api, state: () => data, isDemo: () => backendMode === "demo",
  requireAccount, notify: toast, persistDemo,
  render: () => {
    render();
    if ($("modal").open && detailId) openEvent(detailId);
  },
});
const friendActions = window.GatherFriends.create({
  request: api, account: () => data.user?.id,
  changed: () => { if (page === "friends") render(); },
  notify: toast, login: () => go("login"),
  confirmRemove: person => window.confirm(`Remove ${person.name} from your friends?`),
});
boot();
