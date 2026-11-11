
"use strict";

/*
 * Gather standalone Events page
 * ------------------------------
 * This file owns the event discovery experience at /events. It fetches database
 * events from the Node server, then handles filtering, bookmarking, RSVPs,
 * event details, the list view, and the calendar view.
 */

// Small browser helpers used throughout this page.
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const today = new Date();
today.setHours(0, 0, 0, 0);
// YYYY-MM-DD is used consistently for comparing dates and for calendar cells.
const key = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;

// Events begin empty and are populated from Supabase after the page boots.
// Demo/local state is kept separately in the browser for quick prototype use.
let events = [];
let availableCategories = [];
let data = { saved:[], rsvp:[], user:null, friends:[] };
try { const stored = JSON.parse(localStorage.getItem("gather-events-v1")); if (stored) data = { ...data, ...stored }; } catch {}

let mode = "upcoming", view = new URL(location.href).searchParams.get("view") === "calendar" ? "calendar" : "list";
let filters = { q:"", category:[], campus:"", location:"", club:"", major:"", from:"", to:"" };
let filtersOpen = false;
let toolbarCollapsed = false;
let month = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDay = "";
let backendMode = "demo";
let stateReady = false;
let planLoadError = "";
let detailId = null;

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


// Presentation helpers convert database values into readable text and icons.
function time(value) { if (!value) return "Time TBA"; const [h,m] = value.split(":").map(Number); return `${h%12||12}${m?":"+String(m).padStart(2,"0"):""} ${h<12?"AM":"PM"}`; }
function pretty(value, full=false) { if (!value) return "Date TBA"; return new Date(value+"T12:00:00").toLocaleDateString("en-US", { weekday:full?"long":undefined, month:"short", day:"numeric", year:full?"numeric":undefined }); }
function ended(event) { return !event.end ? new Date(event.date+"T23:59:59") < new Date() : new Date(event.date+"T"+event.end) < new Date(); }
function icon(name) { return `<i data-lucide="${name}" aria-hidden="true"></i>`; }
function icons() { window.lucide?.createIcons(); }
function toast(message) { const el=$("toast"); el.textContent=message; clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.textContent="",3500); }
function categoryClass(event) { return "category-"+({ Social:"social", Arts:"arts", Culture:"culture", Service:"service", Spiritual:"spiritual" }[event.category]||"primary"); }
function categoryIcon(event) { return ({ Social:"party-popper", Arts:"music-2", Career:"lightbulb", Service:"heart-handshake", Sports:"trophy", Culture:"globe-2", Spiritual:"sun" }[event.category]||"calendar-days"); }
function poster(event, extra = "") {
  const classes = `poster ${categoryClass(event)} ${extra}`;
  const imageUrl = event.imageUrl?.trim();
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    return `
      <div class="${classes} event-photo-poster ${event.imageType === "stock" ? "stock-image" : "real-flyer"}">
        <img src="${esc(imageUrl)}" alt="" loading="lazy">
      </div>`;
  }

  return `
    <div class="${classes}" role="img" aria-label="Flyer for ${esc(event.name)}">
      <span class="shape">${icon(categoryIcon(event))}</span>
      <small>${esc(event.club || "Not Specified")} · ${pretty(event.date)}</small>
      <strong>${esc(event.poster || categoryLabel(event).toUpperCase())}</strong>
    </div>`;
}

// Server communication: API responses use JSON and session cookies.
async function api(path, options={}) {
  const response = await fetch("/api"+path, { credentials:"same-origin", headers:{"Content-Type":"application/json"}, ...options });
  const body = await response.json();
  if (!response.ok) throw Error(body.error||"Request failed.");
  return body;
}
function persistDemo() {
  try { localStorage.setItem("gather-events-v1", JSON.stringify(data)); }
  catch { toast("Browser storage is unavailable; demo changes last for this visit."); }
}
function requireAccount() {
  if (backendMode === "demo") return true;
  if (!stateReady) { toast("Your plans have not loaded. Reload to try again."); return false; }
  if (!data.user) { closeModal(); location.assign("/login"); return false; }
  return true;
}
function toggleMenu() { const open=$("drawer").hidden; $("drawer").hidden=!open; $("menuButton").setAttribute("aria-expanded",String(open)); }

// Filtering and search: the filters object describes the current query.
function setMode(next) { mode=next; selectedDay=""; renderToolbar(); renderResults(); }
function setFilter(keyName, value) {
  filters[keyName] = value;
  if (keyName === "campus") {
    filters.location = "";
    renderToolbar();
  }
  renderResults();
}
function toggleCategory(category, checked) {
  filters.category = checked
    ? [...new Set([...filters.category, category])]
    : filters.category.filter(value => value !== category);
  renderResults();
}
function clearFilters() { Object.keys(filters).forEach((k)=>filters[k]=Array.isArray(filters[k])?[]:typeof filters[k]==="boolean"?false:""); filtersOpen=false; renderToolbar(); renderResults(); }
function filteredEvents() {
  return events.filter((event) => {
    const past=ended(event);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const withinSixMonths =
      new Date(event.date + "T23:59:59") >= sixMonthsAgo;
      const allowed =
      mode === "past"
        ? past && withinSixMonths &&
          (data.saved.includes(event.id) || data.rsvp.includes(event.id))
        : mode === "saved"
        ? data.saved.includes(event.id) && !past
        : mode === "savedPast"
        ? data.saved.includes(event.id) && past
        : mode === "friendsGoing"
        ? (data.friendsGoing || []).includes(event.id) && !past
        : mode === "rsvp"
        ? data.rsvp.includes(event.id) && !past
        : !past;
    return allowed && (!filters.q || `${event.name} ${event.club||""} ${event.location}`.toLowerCase().includes(filters.q.toLowerCase())) && (!filters.category.length||filters.category.some(category=>eventCategories(event).includes(category))) && (!filters.location||event.location===filters.location) && (!filters.club||(event.club||"")===filters.club) && (!filters.major||event.major===filters.major||event.major=== "All majors") && (!filters.from||event.date>=filters.from) && (!filters.to||event.date<=filters.to) && (!filters.campus||event.campusLocation===filters.campus);
  }).sort((a,b)=>`${a.date || "9999-12-31"}${a.start || ""}`.localeCompare(`${b.date || "9999-12-31"}${b.start || ""}`));
}
function options(values, current) { return `<option value="">All</option>`+values.map((value)=>`<option ${value===current?"selected":""}>${esc(value)}</option>`).join(""); }
function filterSelect(label, keyName, values) { return `<label>${label}<select onchange="setFilter('${keyName}',this.value)">${options(values,filters[keyName])}</select></label>`; }
function renderToolbar() {
  const categoryValues = availableCategories.length
    ? availableCategories
    : [...new Set(events.flatMap(eventCategories))].sort();
  const locationValues = [...new Set(events
    .filter(event => !filters.campus || event.campusLocation === filters.campus)
    .map(event => event.location)
    .filter(Boolean))].sort();
  const categoryEmojis = {
    "Sports": "🏀",
    "Arts": "🎨",
    "Music": "🎵",
    "Dance": "💃",
    "Games": "🎮",
    "Social": "🎉",
    "Food": "🍕",
    "Outdoors": "🏕️",
    "Fitness": "💪",
    "Career & Networking": "💼",
    "Academic": "📚",
    "Technology": "💻",
    "Culture": "🌎",
    "Service & Volunteering": "🤝",
    "Spiritual & Religious": "✨"
  };
  const categoryCheckboxes = `<div class="category-filter">
    <label>Category / type</label>
    <details class="category-dropdown">
      <summary>${filters.category.length ? filters.category.length + " categories selected" : "All categories"}</summary>
      <div class="category-options">${
        categoryValues.map(category => `<label><input type="checkbox" value="${esc(category)}" ${
          filters.category.includes(category) ? "checked" : ""
        } onchange="toggleCategory(this.value,this.checked)"> ${categoryEmojis[category] || "📌"} ${esc(category)}</label>`).join("")
      }</div>
    </details>
  </div>`;
  $("toolbar").innerHTML=`<div class="row"><input class="search" aria-label="Search events" placeholder="Search events, clubs, or places…" value="${esc(filters.q)}" oninput="filters.q=this.value;renderResults()"><button type="button" id="eventFiltersButton" aria-controls="eventFilters" onclick="filtersOpen=!filtersOpen;renderToolbar();document.getElementById('eventFiltersButton').focus()" aria-expanded="${filtersOpen}">${icon("sliders-horizontal")} Filters</button><button onclick="toggleView()">${view=== "calendar"?icon("list")+" List view":icon("calendar-days")+" Calendar view"}</button></div><div class="chips">${[["upcoming","All upcoming"],["rsvp","RSVP’d"],["saved","Bookmarked"],["friendsGoing","Friends going"],["past","Past saved events"]].map(([value,label])=>`<button class="${mode===value?"active":""}" aria-pressed="${mode===value}" onclick="setMode('${value}')">${label}</button>`).join("")}</div><div id="eventFilters" class="filters" ${filtersOpen?"":"hidden"}>${categoryCheckboxes}${filterSelect("Campus location","campus",["on-campus","off-campus"])}${filterSelect("Location","location",locationValues)}${filterSelect("Club / organizer","club",[...new Set(events.map((e)=>e.club).filter(Boolean))])}${filterSelect("Major relevance","major",["Information Systems","Business","Humanities","Fine Arts"])}<label>From date<input type="date" value="${filters.from}" onchange="setFilter('from',this.value)"></label><label>Through date<input type="date" value="${filters.to}" onchange="setFilter('to',this.value)"></label></div>`;
  const toolbar = $("toolbar");
  toolbar.className = `toolbar event-toolbar${toolbarCollapsed ? " is-collapsed" : ""}`;
  toolbar.innerHTML = `<div id="eventSearchControls" ${toolbarCollapsed ? "hidden" : ""}>${toolbar.innerHTML}</div><div class="toolbar-collapse-row"><button type="button" class="toolbar-reset" onclick="clearFilters()" aria-label="Reset search and filters">${icon("rotate-ccw")} Reset filters</button><button type="button" id="toolbarCollapseButton" class="toolbar-collapse" aria-controls="eventSearchControls" aria-expanded="${!toolbarCollapsed}" onclick="toggleToolbar()">${icon(toolbarCollapsed ? "chevron-down" : "chevron-up")}<span>${toolbarCollapsed ? "Show search & filters" : "Minimize"}</span></button></div>`;
  $("toolbarReopenButton").hidden = !toolbarCollapsed;
  positionToolbarReopen();
  icons();
}
function positionToolbarReopen() {
  const header = document.querySelector("header");
  if (!header) return;
  const rect = header.getBoundingClientRect();
  const button = $("toolbarReopenButton");
  button.style.top = `${rect.bottom + 8}px`;
  button.style.left = `${rect.right - 44}px`;
}
async function toggleToolbar() {
  const toolbar = $("toolbar");
  if (!toolbarCollapsed && toolbar.animate) {
    const animation = toolbar.animate([
      { opacity: 1, transform: "translateY(0) scaleY(1)" },
      { opacity: 0, transform: "translateY(-24px) scaleY(0.8)" },
    ], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160, easing: "ease-in", transformOrigin: "top" });
    await animation.finished;
  }
  toolbarCollapsed = !toolbarCollapsed;
  renderToolbar();
  if (!toolbarCollapsed) {
    toolbar.scrollIntoView({ block: "nearest" });
  }
  $(toolbarCollapsed ? "toolbarReopenButton" : "toolbarCollapseButton").focus();
}
window.addEventListener("resize", positionToolbarReopen);
window.addEventListener("scroll", () => {
  if (toolbarCollapsed) positionToolbarReopen();
}, { passive: true });

// Display switching: toggling changes the URL as well as the rendered page.
function toggleView() { view=view=== "calendar"?"list":"calendar"; history.replaceState(null,"",view=== "calendar"?"/events?view=calendar":"/events"); $("pageTitle").textContent=view=== "calendar"?"Your campus calendar.":"What’s happening at BYU."; renderToolbar(); renderResults(); }

// Both list and modal controls use the same per-event persistence controller.
function bookmark(id) { return plans.set("bookmark", id); }
function rsvp(id) { return plans.set("rsvp", id); }
function planButton(kind, event, compact = false) {
  const saved = kind === "bookmark";
  const selected = data[saved ? "saved" : "rsvp"].includes(event.id);
  const pending = plans.busy(kind, event.id);
  const notReady = backendMode === "supabase" && !stateReady;
  const unavailable = !saved && ended(event) && !selected;
  const label = saved
    ? `${selected ? "Remove bookmark for" : "Bookmark"} ${event.name}`
    : `${selected ? "Cancel RSVP for" : "RSVP to"} ${event.name}`;
  return `<button type="button" class="${saved ? "event-bookmark" : "event-rsvp"}"
    data-plan-kind="${kind}" data-event-id="${esc(event.id)}"
    aria-label="${esc(label)}" title="${esc(notReady ? "Reload to load your plans" : label)}" ${notReady ? "" : `aria-pressed="${selected}"`}
    aria-busy="${pending}" ${pending || unavailable || notReady ? "disabled" : ""}
    onclick="${saved ? "bookmark" : "rsvp"}('${event.id}')">
    ${icon(saved ? selected ? "bookmark-check" : "bookmark" : selected ? "check" : "user-check")}
    ${saved && compact ? "" : `<span>${notReady ? "Unavailable" : pending ? "Saving…" : saved ? selected ? "Saved" : "Save" : unavailable ? "Event ended" : selected ? "Going" : "Going?"}</span>`}
  </button>`;
}

// Event cards share the same actions as the details dialog.
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
function calendar(eventsToShow) {
  const year=month.getFullYear(), monthIndex=month.getMonth();
  const first=new Date(year,monthIndex,1).getDay(), days=new Date(year,monthIndex+1,0).getDate(), cells=[];
  for(let index=0;index<Math.ceil((first+days)/7)*7;index++){ const day=index-first+1; if(day<1||day>days){cells.push('<div class="day dim"></div>');continue;} const date=key(new Date(year,monthIndex,day)); const dayEvents=eventsToShow.filter((event)=>event.date===date); cells.push(`<div class="day"><button class="daynum ${date===key(today)?"today":""}" onclick="selectDay('${date}')">${day}</button>${dayEvents.map((event)=>`<div class="calendar-event"><button class="calevent" onclick="openEvent('${event.id}')">${time(event.start)}<br>${esc(event.name)}</button><div class="row calendar-event-actions">${planButton("rsvp", event)}${shareButton(event)}</div></div>`).join("")}</div>`); }
  return `<div class="row between section-head"><div class="row"><h2>${month.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</h2><button onclick="month=new Date(today.getFullYear(),today.getMonth(),1);selectedDay='';renderResults()">Today</button></div><div class="row"><button aria-label="Previous month" onclick="changeMonth(-1)">←</button><button aria-label="Next month" onclick="changeMonth(1)">→</button></div></div><div class="calendar"><div class="calhead">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d)=>"<div>"+d+"</div>").join("")}</div><div class="calgrid">${cells.join("")}</div></div><div id="dayList" class="day-list">${selectedDay?`<div class="row between section-head"><h2>${pretty(selectedDay,true)}</h2><button onclick="selectedDay='';renderResults()">Back to month</button></div><div class="list">${eventsToShow.filter((event)=>event.date===selectedDay).map(card).join("")||'<div class="empty">No events on this day match your filters.</div>'}</div>`:'<p class="muted">Select a date to see its schedule, or an event to see the details.</p>'}</div>`;
}
function changeMonth(offset) { month=new Date(month.getFullYear(),month.getMonth()+offset,1); selectedDay=""; renderResults(); }
function selectDay(date) { selectedDay=date; renderResults(); $("dayList")?.scrollIntoView({behavior:"smooth",block:"start"}); }
function renderResults() {
  if (mode === "friendsGoing" && (!data.user || data.friendsGoingError || !stateReady)) {
    $("results").innerHTML = `<div class="empty" role="status">${esc(!data.user ? "Sign in to see events your friends are going to." : data.friendsGoingError || "Friends’ attendance could not be loaded. Reload to try again.")}</div>`;
    $("resultCount").textContent = "";
    return;
  }
  if(filters.from&&filters.to&&filters.from>filters.to){$("results").innerHTML='<div class="empty" role="alert">The end date must be on or after the start date.</div>';$("resultCount").textContent="0 events";return;}
  const list=filteredEvents(); $("resultCount").textContent=`${list.length} event${list.length===1?"":"s"}`;
  const notice = planLoadError ? `<div class="notice" role="status">Events are available, but your account plans could not be loaded. ${esc(planLoadError)} <button onclick="boot()">Retry account</button></div>` : "";
  $("results").innerHTML=notice + (view=== "calendar"?calendar(list):list.length?`<div class="list">${list.map(card).join("")}</div>`:(mode === "past"
  ? `<div class="empty">
      <h3>No past saved events yet.</h3>
      <p class="muted">Events you've bookmarked or RSVP'd to from the past six months will appear here!</p>
      <button onclick="clearFilters();setMode('upcoming')">Explore events</button>
    </div>`
  : mode === "rsvp" && !data.rsvp.some(id => events.some(event => event.id === id && !ended(event)))
  ? `<div class="empty">
      <h3>You haven't RSVP'd to any upcoming events yet!</h3>
      <p class="muted">Explore upcoming events and RSVP to something that interests you.</p>
      <button onclick="clearFilters();setMode('upcoming')">Explore events</button>
    </div>`
  : '<div class="empty"><h3>No events match current filters</h3><p class="muted">Try a different date or clear your filters.</p><button onclick="clearFilters()">Clear filters</button></div>'));
  icons();
}

function showModal(html) { $("modal").innerHTML=html; if(!$("modal").open)$("modal").showModal(); icons(); }
function closeModal() { if($("modal").open)$("modal").close(); detailId = null; }
function openEvent(id) { const event=events.find((item)=>item.id===id); if(!event)return; detailId = id; showModal(`<button class="close" aria-label="Close event details" onclick="closeModal()">✕</button><div class="dialog-body event-detail-body"><header class="event-detail-heading"><h2 id="eventDetailTitle">${esc(event.name)}</h2><div class="event-tags">${categoryTags(event)}${ended(event)?'<span class="tag">Past event</span>':""}</div></header><div class="detail-grid"><div><span class="muted">When</span><b>${pretty(event.date,true)}</b>${time(event.start)}${event.end?"–"+time(event.end):""}</div>${eventWhereTile(event)}<div><span class="muted">Admission</span><b>${eventAdmission(event)}</b>${eventFood(event)}</div><div><span class="muted">Hosted by</span><b>${esc(event.club||"Not Specified")}</b>Major relevance: ${esc(event.major||"Not Specified")}</div></div><section class="event-description" aria-labelledby="eventDescriptionTitle"><h3 id="eventDescriptionTitle">About this event</h3><p>${esc(event.description || "Not Specified")}</p></section><div class="row event-detail-actions">${planButton("bookmark", event)}${planButton("rsvp", event)}${shareButton(event)}</div></div>`); }

// Boot sequence: discover server mode, load data, load account state, and render.

function renderUserProfile() {
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
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    if (!userButton.querySelector(".account-avatar-image")) userButton.textContent = initials;
    userButton.classList.add("profile-avatar");
    userButton.title = data.user.name || data.user.email || "My account";
  } else {
    userButton.textContent = "Sign in ↗";
    userButton.classList.remove("profile-avatar");
    userButton.title = "Sign in";
  }
  $("sideUserButton").textContent = data.user
    ? `${data.user.name || data.user.email || "Account"} ↗`
    : "Sign in";
}

async function boot() {
  try {
    const config = await api("/config");
    backendMode = config.mode;

    if (backendMode === "supabase") {
      // Do not carry demo data or another account's saved plans into this session.
      data = { saved: [], rsvp: [], user: null, friends: [] };
      stateReady = false;

      planLoadError = "";
      // Public events must not depend on whether account services are healthy.
      const [listingResult, sessionResult] = await Promise.allSettled([
        api("/events"), api("/auth/session"),
      ]);
      if (listingResult.status === "rejected") throw listingResult.reason;
      availableCategories = Array.isArray(listingResult.value.categories)
        ? listingResult.value.categories
        : [];
      events = listingResult.value.events.map(event => ({
        ...event, poster: event.poster || categoryLabel(event).toUpperCase(),
      }));
      if (sessionResult.status === "fulfilled") {
        data.user = sessionResult.value.user;
        if (data.user) {
          try {
            const result = await api("/state");
            if (result.accountId !== data.user.id)
              throw Error("Your account changed. Reload to load its plans.");
            data = { ...data, ...result.state, user: data.user };
            stateReady = true;
          } catch (error) { planLoadError = error.message; }
        } else stateReady = true;
      } else planLoadError = sessionResult.reason.message;
      renderUserProfile();
      $("footerMode").textContent = data.user
        ? "Connected to Supabase · Your personal plans"
        : "Connected to Supabase · Sign in to save plans";
    } else {
      stateReady = true;
      // Demo mode uses the browser's locally stored preferences.
      renderUserProfile();
    }
  } catch (error) {
    console.error("Unable to load events:", error);
    $("results").innerHTML =
      `<div class="empty"><h2>We couldn’t load events.</h2><p>${esc(error.message)}</p><button onclick="boot()">Try again</button></div>`;
    return;
  }

  $("pageTitle").textContent = view === "calendar"
    ? "Your campus calendar."
    : "What’s happening at BYU.";
  renderToolbar();
  renderResults();
  const sharedId = new URL(location.href).searchParams.get("event");
  if (sharedId) {
    if (events.some(event => event.id === sharedId)) openEvent(sharedId);
    else toast("This event is no longer available.");
  }
}

$("modal").addEventListener("click",(event)=>{ if(event.target===$("modal")) closeModal(); });
document.addEventListener("click", (event) => {
  if (!$("drawer").hidden && !$("drawer").contains(event.target) && !$("menuButton").contains(event.target)) toggleMenu();
});
document.addEventListener("keydown",(event)=>{ if(event.key=== "Escape"&&!$("drawer").hidden)toggleMenu(); });
const plans = window.GatherPlans.create({
  request: api, state: () => data, isDemo: () => backendMode === "demo",
  requireAccount, notify: toast, persistDemo,
  render: () => {
    renderResults();
    if ($("modal").open && detailId) openEvent(detailId);
  },
});
window.addEventListener("beforeunload", event => {
  if (plans.hasPending()) { event.preventDefault(); event.returnValue = ""; }
});
boot();
