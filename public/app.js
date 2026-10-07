"use strict";
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
function dateAt(offset) {
  let d = new Date(today);
  d.setDate(d.getDate() + offset);
  return key(d);
}
const seeds = [
  [
    "fall-social",
    "Fall social on the lawn",
    "Social",
    "Maeser Lawn",
    1,
    "18:00",
    "20:00",
    0,
    true,
    "BYUSA",
    "All majors",
    "Bring a blanket and meet someone new. Enjoy lawn games, music, and treats as the sun sets over campus.",
    "FALL / TOGETHER",
    "",
    "✳",
  ],
  [
    "jazz",
    "An evening of jazz",
    "Arts",
    "Music Building",
    3,
    "19:00",
    "21:00",
    5,
    false,
    "School of Music",
    "Fine Arts",
    "An intimate evening of student jazz ensembles. Arrive 15 minutes early; seating is first come, first served.",
    "AFTER HOURS",
    "",
    "♪",
  ],
  [
    "tech",
    "Build something together",
    "Career",
    "Tanner Building",
    5,
    "17:30",
    "19:30",
    0,
    true,
    "IS Club",
    "Information Systems",
    "Meet other builders at a collaborative technology workshop. Bring a laptop; beginners are welcome.",
    "IDEAS → IMPACT",
    "",
    "↗",
  ],
  [
    "service",
    "A little time. A big difference.",
    "Service",
    "Wilkinson Center",
    7,
    "16:00",
    "18:00",
    0,
    false,
    "Y-Serve",
    "All majors",
    "Help assemble community care kits. Supplies are provided and friends are welcome.",
    "GIVE / TOGETHER",
    "",
    "✦",
  ],
  [
    "volley",
    "Cougar game night",
    "Sports",
    "Smith Fieldhouse",
    9,
    "19:00",
    "21:00",
    8,
    false,
    "Campus Recreation",
    "All majors",
    "Cheer with fellow students at a sample campus sports night. Wear blue and bring your student ID.",
    "BRING THE BLUE",
    "",
    "Y",
  ],
  [
    "french",
    "Crêpes & conversation",
    "Culture",
    "Wilkinson Center",
    11,
    "18:00",
    "19:30",
    0,
    true,
    "French Club",
    "Humanities",
    "Practice French over crêpes and casual conversation. All language levels are welcome.",
    "BONSOIR, BYU",
    "",
    "◎",
  ],
  [
    "reflect",
    "Pause & reflect",
    "Spiritual",
    "Marriott Center",
    14,
    "11:00",
    "12:00",
    0,
    false,
    "Campus Community",
    "All majors",
    "A sample gathering for reflection, faith, and community. Please arrive before the start time.",
    "A MOMENT / TO PAUSE",
    "",
    "☀",
  ],
  [
    "art",
    "Sketch your Saturday",
    "Arts",
    "Museum of Art",
    18,
    "10:00",
    "12:00",
    0,
    false,
    "Art Club",
    "Fine Arts",
    "Join a relaxed sketching session. Bring a sketchbook; pencils and inspiration are provided.",
    "LOOK / A LITTLE CLOSER",
    "",
    "✎",
  ],
  [
    "career",
    "Meet your next opportunity",
    "Career",
    "Tanner Building",
    33,
    "15:00",
    "17:00",
    0,
    false,
    "Career Studio",
    "Business",
    "Practice introductions and connect with peers. Bring a résumé if you would like informal feedback.",
    "HELLO, FUTURE",
    "",
    "↗",
  ],
  [
    "past",
    "Welcome week mixer",
    "Social",
    "Maeser Lawn",
    -3,
    "18:00",
    "20:00",
    0,
    true,
    "BYUSA",
    "All majors",
    "A relaxed start-of-semester mixer with games and treats.",
    "GOOD / TO MEET YOU",
    "",
    "✳",
  ],
  [
    "past2",
    "Community service afternoon",
    "Service",
    "Wilkinson Center",
    -8,
    "14:00",
    "16:00",
    0,
    false,
    "Y-Serve",
    "All majors",
    "Students assembled care kits for community partners.",
    "SMALL ACTS / BIG HEART",
    "",
    "✦",
  ],
];
let events = seeds.map((s, i) => ({
  id: s[0],
  name: s[1],
  category: s[2],
  location: s[3],
  date: dateAt(s[4]),
  start: s[5],
  end: s[6],
  price: s[7],
  food: s[8],
  club: s[9],
  major: s[10],
  description: s[11],
  poster: s[12],
  color: undefined,
  symbol: s[14],
  offset: s[4],
  friends: i % 3 === 0 ? ["Emma", "Noah"] : i % 3 === 1 ? ["Sofia"] : [],
}));
let data = {
  saved: ["fall-social", "past"],
  rsvp: [],
  attended: ["past2"],
  reminders: {},
  surveys: {},
  friends: ["Emma", "Noah"],
  interests: ["Social", "Arts"],
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
let categories = [...new Set(events.map((e) => e.category))];
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
  let [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}
function pretty(d, full = false) {
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
    : new Date(e.date + "T" + e.end) < new Date();
}
function toggleMenu() {
  const open = $("drawer").hidden;
  $("drawer").hidden = !open;
  $("menuButton").setAttribute("aria-expanded", String(open));
}
function go(p) {
  page = p;
  mode = p === "saved" ? "saved" : "upcoming";
  selectedDay = "";
  $("drawer").hidden = true;
  $("menuButton").setAttribute("aria-expanded", "false");
  render();
  window.scrollTo(0, 0);
}
function setMode(m) {
  mode = m;
  selectedDay = "";
  render();
}
function bookmark(id) {
  if (!requireAccount()) return;
  data.saved.includes(id)
    ? (data.saved = data.saved.filter((x) => x !== id))
    : data.saved.push(id);
  persist();
  render();
  if ($("modal").open && detailId) openEvent(detailId);
  toast(
    data.saved.includes(id)
      ? "Added to your saved events"
      : "Removed from saved events",
  );
}
function rsvp(id) {
  if (!requireAccount()) return;
  data.rsvp.includes(id)
    ? (data.rsvp = data.rsvp.filter((x) => x !== id))
    : data.rsvp.push(id);
  persist();
  render();
  openEvent(id);
  toast(
    data.rsvp.includes(id)
      ? backendMode === "demo"
        ? "You’re on the demo RSVP list"
        : "Your RSVP has been saved"
      : "RSVP canceled",
  );
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
        (!filters.category || e.category === filters.category) &&
        (!filters.location || e.location === filters.location) &&
        (!filters.club || e.club === filters.club) &&
        (!filters.major ||
          e.major === filters.major ||
          e.major === "All majors") &&
        (!filters.from || e.date >= filters.from) &&
        (!filters.to || e.date <= filters.to) &&
        (!filters.food || e.food) &&
        (!filters.free || e.price === 0) &&
        (!filters.spiritual || e.category === "Spiritual")
      );
    })
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
function card(e) {
  return `<article class="card">${poster(e)}<div class="card-body"><div><div class="row between"><span class="tag">${esc(e.category)}</span><span class="muted" style="font-size:12px">${e.price ? "$" + Number(e.price).toFixed(0) : "Free"}${e.food ? " · Food provided" : ""}</span></div><h3>${esc(e.name)}</h3><div class="metadata"><span>${icon("clock")} ${pretty(e.date)} · ${time(e.start)}–${time(e.end)}</span><span>${icon("map-pin")} ${esc(e.location)}</span></div>${e.friends.some((f) => data.friends.includes(f)) ? '<small class="muted">Friends interested · ' + esc(e.friends.filter((f) => data.friends.includes(f)).join(", ")) + "</small>" : ""}</div><div class="card-actions"><button onclick="openEvent('${e.id}')">${ended(e) ? "View & reflect" : "View event"} ↗</button><button class="save ${data.saved.includes(e.id) ? "active" : ""}" aria-pressed="${data.saved.includes(e.id)}" onclick="bookmark('${e.id}')">${data.saved.includes(e.id) ? icon("bookmark-check") + " Saved" : icon("bookmark") + " Save"}</button></div></div></article>`;
}
function empty() {
  return `<div class="empty"><h3>No upcoming events match current filters</h3><p class="muted">Try a different date, clear your filters, or explore all events.</p><button onclick="clearFilters()">Clear filters</button> <button onclick="mode='upcoming';clearFilters()">Explore events</button></div>`;
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
  return `<div class="toolbar"><div class="row"><input class="search" aria-label="Search events" placeholder="Search events, clubs, or places…" value="${esc(filters.q)}" oninput="filters.q=this.value;updateResults()"><button onclick="filtersOpen=!filtersOpen;render()" aria-expanded="${filtersOpen}">${icon("sliders-horizontal")} Filters ${Object.values(filters).filter(Boolean).length ? "(" + Object.values(filters).filter(Boolean).length + ")" : ""}</button><button onclick="go(page==='calendar'?'list':'calendar')">${page === "calendar" ? icon("list") + " List view" : icon("calendar-days") + " Calendar view"}</button></div><div class="chips">${[["upcoming", "All upcoming"], ["saved", "Bookmarked"], ["rsvp", "RSVP’d"], ["past", "Past events"], ...(page === "saved" ? [["savedPast", "Past saved events"]] : [])].map(([m, l]) => `<button class="${mode === m ? "active" : ""}" onclick="setMode('${m}')">${l}</button>`).join("")}</div><div class="filters" ${filtersOpen ? "" : "hidden"}>${filterSelect("Category / type", "category", categories)}${filterSelect("Location", "location", [...new Set(events.map((e) => e.location))])}${filterSelect("Club / organizer", "club", [...new Set(events.map((e) => e.club))])}${filterSelect("Major relevance", "major", ["Information Systems", "Business", "Humanities", "Fine Arts"])}<label>From date<input type="date" value="${filters.from}" onchange="setFilter('from',this.value)"></label><label>Through date<input type="date" value="${filters.to}" onchange="setFilter('to',this.value)"></label><div>${[
    ["food", "Has food"],
    ["free", "Free events"],
    ["spiritual", "Spiritual"],
  ]
    .map(
      ([k, l]) =>
        `<label><input type="checkbox" ${filters[k] ? "checked" : ""} onchange="setFilter('${k}',this.checked)"> ${l}</label>`,
    )
    .join(
      "",
    )}</div><button onclick="clearFilters()">Clear filters</button></div></div>`;
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
}
function moveSlide(n) {
  slide = (slide + n + 3) % 3;
  renderHero();
}
function renderHero() {
  if ($("heroHost")) $("heroHost").innerHTML = hero();
  icons();
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
      `<div class="day"><button class="daynum ${d === key(today) ? "today" : ""}" aria-label="View events on ${d}" onclick="selectDay('${d}')">${n}</button>${es.map((e) => `<button class="calevent" onclick="openEvent('${e.id}')">${time(e.start)}<br>${esc(e.name)}</button>`).join("")}</div>`,
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
    `<button class="close" aria-label="Close event details" onclick="closeModal()">✕</button>${poster(e, "detail-poster")}<div class="dialog-body"><span class="tag">${esc(e.category)}${ended(e) ? " · Past event" : ""}</span><h2 style="margin-top:12px">${esc(e.name)}</h2><div class="detail-grid"><div><span class="muted">When</span><b>${pretty(e.date, true)}</b>${time(e.start)}–${time(e.end)}</div><div><span class="muted">Where</span><b>${esc(e.location)}</b>BYU · Provo, Utah</div><div><span class="muted">Admission</span><b>${e.price ? "$" + Number(e.price).toFixed(0) : "Free"}</b>${e.food ? "Food provided" : "Food not provided"}</div><div><span class="muted">Hosted by</span><b>${esc(e.club)}</b>${esc(e.major)}</div></div><p>${esc(e.description)}</p><details><summary>More information</summary><p>Sample listing for the digital mockup. ${e.food ? "Food is included; ask the organizer about dietary options." : "Bring water and any materials noted above."} Visit the organizer’s site to verify real event details.</p><a href="https://www.byu.edu/" target="_blank" rel="noopener">BYU website ↗</a></details><div class="notice">${esc(e.friends.filter((f) => data.friends.includes(f)).join(", ") || "No friends yet")}${e.friends.some((f) => data.friends.includes(f)) ? " interested · demo friend activity" : ""}</div><div class="row"><button class="${data.saved.includes(id) ? "active" : ""}" onclick="bookmark('${id}')">${data.saved.includes(id) ? icon("bookmark-check") + " Saved" : icon("bookmark") + " Save event"}</button>${ended(e) ? `<button onclick="attend('${id}')">${data.attended.includes(id) ? "✓ Attended" : "Mark attended"}</button>${data.saved.includes(id) || data.attended.includes(id) ? `<button class="primary" onclick="survey('${id}')">${data.surveys[id] ? "Edit reflection" : "Rate this event"}</button>` : ""}` : `<button class="primary" onclick="rsvp('${id}')">${data.rsvp.includes(id) ? "✓ RSVP’d · Cancel" : "RSVP to event"}</button>`}<button onclick="shareEvent('${id}')">Share ↗</button><button onclick="eventMap('${id}')">View location</button></div>${
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
async function shareEvent(id) {
  let e = events.find((e) => e.id === id),
    url = new URL(location.href);
  url.hash = "event=" + id;
  let text =
    e.name +
    " · " +
    pretty(e.date) +
    " · " +
    time(e.start) +
    " · " +
    e.location +
    "\n" +
    (location.protocol === "file:"
      ? "Open the Gather mockup and find this event."
      : url.href);
  try {
    await navigator.clipboard.writeText(text);
    toast("Event details copied");
  } catch (err) {
    showModal(
      `<div class="dialog-body"><h2>Share this event</h2><p>Copy these details to send to a friend.</p><textarea aria-label="Event sharing text" rows="5" style="width:100%" readonly>${esc(text)}</textarea><button onclick="openEvent('${id}')">Back to event</button></div>`,
      "Share event",
    );
  }
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
function friendsPage() {
  return `<div class="eyebrow">Better with company</div><h1>Your people. Your interests.</h1><p class="muted">Keep a list of friends and discover what you have in common.</p><div class="notice">Demo profiles and activity are fictional. Adding a friend here does not send an invitation.</div><div class="grid">${["Emma", "Noah", "Sofia", "Liam", "Olivia", "Ethan"].map((n, i) => `<div class="card friend"><span class="avatar">${n[0]}</span><div class="info"><h3>${n}</h3><p class="muted">${["Social & service", "Sports & technology", "Arts & culture"][i % 3]}</p></div><button onclick="toggleFriend('${n}')">${data.friends.includes(n) ? "✓ Added · Remove" : "+ Add friend"}</button></div>`).join("")}</div><div class="prefs"><h2>What are you into?</h2><p class="muted">These interests shape your home page recommendations.</p><div class="chips">${categories.map((c) => `<button class="${data.interests.includes(c) ? "active" : ""}" aria-pressed="${data.interests.includes(c)}" onclick="toggleInterest('${c}')">${c}</button>`).join("")}</div></div>`;
}
function toggleFriend(n) {
  if (!requireAccount()) return;
  data.friends.includes(n)
    ? (data.friends = data.friends.filter((x) => x !== n))
    : data.friends.push(n);
  persist();
  render();
}
function toggleInterest(c) {
  if (!requireAccount()) return;
  data.interests.includes(c)
    ? (data.interests = data.interests.filter((x) => x !== c))
    : data.interests.push(c);
  persist();
  render();
}
function demoAuth(signup = false) {
  if (data.user && !signup)
    return `<div class="auth"><span class="eyebrow">Welcome back</span><h2>${esc(data.user.name)}</h2><p class="muted">Your plans are saved in this browser.</p><button class="primary" onclick="go('saved')">View saved events</button><button onclick="signOut()">Sign out</button></div>`;
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Find your place</span><h2>${signup ? "Make yourself at home." : "Welcome back."}</h2><p class="muted">${signup ? "Create a demo profile to personalize your visit." : "Sign in to your demo profile."}</p><div class="notice">Prototype only. Use fictional details and a demo password. For a quick tour: <b>student / gather123</b>.</div>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="off"></label><label>Email<input name="email" type="email" required autocomplete="off"></label>' : ""}<label>Username<input name="username" required autocomplete="off"></label><label>Password<input name="password" type="password" minlength="6" required autocomplete="off"></label><div id="authError" class="error" role="alert"></div><button class="primary">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "New here? Create an account"}</button><button type="button" onclick="go('home')">Continue as guest →</button></form>`;
}
async function hash(s) {
  if (!crypto.subtle) throw Error("secure");
  let bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(bytes))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function demoAuthenticate(ev, signup) {
  ev.preventDefault();
  let f = Object.fromEntries(new FormData(ev.target)),
    u = f.username.trim().toLowerCase();
  if (!u || (signup && !f.name.trim())) {
    $("authError").textContent =
      "Enter a name and username that are not blank.";
    return;
  }
  if (signup) {
    if (u === "student" || data.accounts.some((a) => a.username === u)) {
      $("authError").textContent =
        "That username is already taken. Try another.";
      return;
    }
    try {
      let a = {
        name: f.name.trim(),
        username: u,
        passwordHash: await hash(f.password),
      };
      data.accounts.push(a);
      data.user = { name: a.name, username: u };
    } catch (e) {
      $("authError").textContent =
        "Account creation requires a supported browser. Use the demo sign-in or continue as guest.";
      return;
    }
  } else {
    let a = data.accounts.find((a) => a.username === u),
      valid = u === "student" && f.password === "gather123";
    if (a)
      try {
        valid = a.passwordHash === (await hash(f.password));
      } catch (e) {}
    if (!valid) {
      $("authError").textContent =
        "Username or password is incorrect. Please try again.";
      return;
    }
    data.user = { name: a ? a.name : "Student", username: u };
  }
  persist();
  go("home");
  toast(signup ? "Demo account created" : "Welcome back");
}
function renderBase() {
  let links = [
    ["home", "Discover"],
    ["list", "Events"],
    ["calendar", "Calendar"],
    ["saved", "Saved"],
    ["friends", "Friends"],
  ];
  $("topnav").innerHTML = links
    .map(
      ([p, n]) =>
        `<button class="${page === p ? "active" : ""}" onclick="go('${p}')">${n}</button>`,
    )
    .join("");
  $("sideNav").innerHTML = [
    ...links,
    ["login", data.user ? "Account" : "Sign in"],
  ]
    .map(([p, n]) => `<button onclick="go('${p}')">${n}</button>`)
    .join("");
  $("userButton").textContent = data.user ? data.user.name + " ↗" : "Sign in ↗";
  $("menuButton").hidden = page === "login" || page === "signup";
  $("app").innerHTML =
    page === "home"
      ? home()
      : ["list", "calendar", "saved"].includes(page)
        ? browse()
        : page === "friends"
          ? friendsPage()
          : page === "login" || page === "signup"
            ? auth(page === "signup")
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
  return `<div class="poster ${categoryClass(e)} ${cls}" role="img" aria-label="Sample flyer for ${esc(e.name)}"><span class="shape">${icon(categoryIcon(e))}</span><small>${esc(e.club)} · ${pretty(e.date)}</small><strong>${esc(e.poster.replaceAll(" / ", " · "))}</strong></div>`;
}
function hero() {
  let upcoming = events.filter((e) => !ended(e)).slice(0, 3);
  let e = upcoming[slide % upcoming.length];
  if (!e)
    return '<div class="empty"><h2>A little more campus in your life.</h2><p>New events will appear here when they’re available.</p></div>';
  return `<div class="hero"><div class="hero-copy"><span class="eyebrow">${icon("sparkles")} Make room for a good time</span><h1>Your next favorite<br>campus memory.</h1><p class="muted">Find something you love.<br>Bring someone along.</p><button class="primary" style="margin-top:16px" onclick="go('list')">Explore events ${icon("arrow-up-right")}</button></div><div class="hero-art ${categoryClass(e)}"><span class="bigmark">${icon(categoryIcon(e))}</span><small>FEATURED ON CAMPUS</small><b>${esc(e.name)}</b><p>${pretty(e.date)} · ${time(e.start)}<br>${esc(e.location)}</p><div class="row"><button onclick="openEvent('${e.id}')">View event ${icon("arrow-up-right")}</button><div class="hero-controls"><button aria-label="Previous flyer" onclick="moveSlide(-1)">${icon("chevron-left")}</button><span class="count">${(slide % upcoming.length) + 1} / ${upcoming.length}</span><button aria-label="Next flyer" onclick="moveSlide(1)">${icon("chevron-right")}</button><button aria-label="${paused ? "Play" : "Pause"} slideshow" onclick="paused=!paused;renderHero()">${icon(paused ? "play" : "pause")}</button></div></div></div></div>`;
}
function home() {
  let upcoming = events.filter((e) => !ended(e)),
    recommended = upcoming
      .filter((e) => data.interests.includes(e.category))
      .slice(0, 4);
  if (!recommended.length) recommended = upcoming.slice(0, 4);
  let saved = upcoming.filter((e) => data.saved.includes(e.id)).slice(0, 3);
  return `<div class="welcome"><div class="row between"><span class="eyebrow">${icon("sparkles")} A little more campus in your life</span><span class="muted">${today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div><h1>Good things are happening.</h1><p class="muted">Discover your next plan, find your people, and make the most of BYU.</p></div><div class="home-layout"><div><div id="heroHost">${hero()}</div><div class="quick"><button onclick="go('list')"><span class="symbol">${icon("compass")}</span><span><b>Explore events</b><small>Find your next thing</small></span></button><button onclick="go('calendar')"><span class="symbol">${icon("calendar-days")}</span><span><b>Plan your month</b><small>See what’s coming up</small></span></button><button onclick="go('saved')"><span class="symbol">${icon("bookmark")}</span><span><b>Your saved plans</b><small>Keep a good idea</small></span></button></div><div class="row between section-head"><h2>Picked for you</h2><button onclick="go('friends')">Edit interests ${icon("arrow-right")}</button></div><div class="grid">${recommended.map(card).join("") || empty()}</div><div class="row between section-head"><h2>More to look forward to</h2><button onclick="go('list')">View all ${icon("arrow-right")}</button></div><div class="list">${
    upcoming
      .filter((e) => !recommended.includes(e))
      .slice(0, 3)
      .map(card)
      .join("") || '<p class="muted">You’re all caught up.</p>'
  }</div></div><aside class="sidebar"><section class="glass-panel panel-pad"><h2 class="side-title">${icon("bookmark")} Your next plans</h2><p>Good ideas you kept for later.</p>${saved.map((e) => `<div class="mini-event"><span class="date-chip">${new Date(e.date + "T12:00").toLocaleDateString("en-US", { month: "short" })}<b>${Number(e.date.slice(-2))}</b></span><div><button onclick="openEvent('${e.id}')">${esc(e.name)}</button><p>${time(e.start)} · ${esc(e.location)}</p></div></div>`).join("") || '<p class="notice">Tap a bookmark on any event to keep it here.</p>'}<button class="primary" onclick="go('saved')">View saved events ${icon("arrow-right")}</button></section><section class="glass-panel panel-pad"><h2 class="side-title">${icon("users")} Better together</h2><div class="friend-preview">${data.friends
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
  syncTimer,
  syncChain = Promise.resolve(),
  syncFailed = false,
  booting = true,
  pendingSaves = 0,
  stateReady = true;
const emptyState = () => ({
  saved: [],
  rsvp: [],
  attended: [],
  reminders: {},
  surveys: {},
  friends: [],
  interests: ["Social", "Arts"],
  user: null,
  accounts: [],
});
function statePayload() {
  const { saved, rsvp, attended, reminders, surveys, friends, interests } =
    data;
  return { saved, rsvp, attended, reminders, surveys, friends, interests };
}
async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw Error(body.error || "Unable to complete that request.");
  return body;
}
function persist() {
  if (backendMode === "demo") {
    persistDemo();
    return;
  }
  if (!data.user || !stateReady) return;
  const payload = statePayload();
  pendingSaves++;
  syncChain = syncChain
    .catch(() => {})
    .then(() => api("/state", { method: "PUT", body: JSON.stringify(payload) }))
    .then(() => {
      syncFailed = false;
      $("footerMode").textContent = "Connected · Your plans are synced";
    })
    .catch(() => {
      syncFailed = true;
      $("footerMode").innerHTML =
        'Changes are not synced. <button onclick="persist()">Retry saving</button>';
      toast("Could not sync your plans. Use Retry saving below.");
    })
    .finally(() => pendingSaves--);
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
  if ($("footerMode") && !syncFailed)
    $("footerMode").textContent =
      backendMode === "demo"
        ? "Demo mode · Sample events · Plans saved in this browser"
        : data.user
          ? "Connected to Supabase · Your personal plans"
          : "Connected to Supabase · Sign in to save plans";
}
function auth(signup = false) {
  if (backendMode === "demo") return demoAuth(signup);
  if (data.user && !signup)
    return `<div class="auth"><span class="eyebrow">Your account</span><h2>${esc(data.user.name)}</h2><p class="muted">${esc(data.user.email)}</p><button class="primary" onclick="go('saved')">View saved plans</button><button onclick="signOut()">Sign out</button></div>`;
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Your campus, connected</span><h2>${signup ? "Find your place." : "Welcome back."}</h2><p class="muted">${signup ? "Create your Gather account." : "Sign in to keep your plans together."}</p>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="name"></label>' : ""}<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="${signup ? "new-password" : "current-password"}"></label><div id="authError" class="error" role="alert"></div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "Create an account"}</button><button type="button" onclick="go('home')">Continue as guest</button></form>`;
}
async function loadState() {
  stateReady = false;
  const result = await api("/state");
  data = { ...emptyState(), ...result.state, user: data.user };
  stateReady = true;
}
async function authenticate(ev, signup) {
  if (backendMode === "demo") return demoAuthenticate(ev, signup);
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  const btn = ev.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const result = await api("/auth/" + (signup ? "signup" : "login"), {
      method: "POST",
      body: JSON.stringify(f),
    });
    if (!result.user) {
      $("authError").textContent =
        result.message ||
        "Check your email to confirm your account, then sign in.";
      return;
    }
    data = { ...emptyState(), user: result.user };
    try {
      await loadState();
    } catch (e) {
      go("home");
      toast("Signed in, but plans could not load. Reload to retry.");
      return;
    }
    go("home");
    toast("Welcome to Gather");
  } catch (e) {
    $("authError").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
async function signOut() {
  if (backendMode === "supabase") {
    clearTimeout(syncTimer);
    try {
      await syncChain;
      if (syncFailed) {
        toast("Save your changes before signing out. Use Retry saving below.");
        return;
      }
      await api("/auth/logout", { method: "POST", body: "{}" });
    } catch (e) {
      toast("Could not sign out. Please try again.");
      return;
    }
    data = emptyState();
  } else {
    data.user = null;
    persistDemo();
  }
  go("home");
}
async function boot() {
  if (location.protocol !== "file:") {
    try {
      const config = await api("/config");
      backendMode = config.mode;
      if (backendMode === "supabase") {
        data = emptyState();
        events = [];
        render();
        const [listing, session] = await Promise.all([
          api("/events"),
          api("/auth/session"),
        ]);
        events = listing.events;
        categories = [...new Set(events.map((e) => e.category))];
        data.user = session.user;
        if (data.user) await loadState();
      }
    } catch (e) {
      $("app").innerHTML =
        '<div class="empty"><h2>We couldn’t load Gather.</h2><p>Check the server connection and Supabase configuration, then try again.</p><button onclick="boot()">Try again</button></div>';
      return;
    }
  }
  booting = false;
  render();
  if (location.hash.startsWith("#event="))
    openEvent(decodeURIComponent(location.hash.slice(7)));
}
window.addEventListener("beforeunload", (e) => {
  if (backendMode === "supabase" && (pendingSaves || syncFailed)) {
    /* Browsers may warn only after user interaction. */ e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("drawer").hidden) toggleMenu();
});
boot();
