"use strict";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const today = new Date();
today.setHours(0, 0, 0, 0);
const key = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dateAt = (offset) => { const date = new Date(today); date.setDate(date.getDate()+offset); return key(date); };

const seedRows = [
  ["fall-social","Fall social on the lawn","Social","Maeser Lawn",1,"18:00","20:00",0,true,"BYUSA","All majors","Bring a blanket and meet someone new. Enjoy lawn games, music, and treats as the sun sets over campus."],
  ["jazz","An evening of jazz","Arts","Music Building",3,"19:00","21:00",5,false,"School of Music","Fine Arts","An intimate evening of student jazz ensembles."],
  ["tech","Build something together","Career","Tanner Building",5,"17:30","19:30",0,true,"IS Club","Information Systems","Meet other builders at a collaborative technology workshop."],
  ["service","A little time. A big difference.","Service","Wilkinson Center",7,"16:00","18:00",0,false,"Y-Serve","All majors","Help assemble community care kits."],
  ["volley","Cougar game night","Sports","Smith Fieldhouse",9,"19:00","21:00",8,false,"Campus Recreation","All majors","Cheer with fellow students at a campus sports night."],
  ["french","Crêpes & conversation","Culture","Wilkinson Center",11,"18:00","19:30",0,true,"French Club","Humanities","Practice French over crêpes and casual conversation."],
  ["reflect","Pause & reflect","Spiritual","Marriott Center",14,"11:00","12:00",0,false,"Campus Community","All majors","A gathering for reflection, faith, and community."],
  ["art","Sketch your Saturday","Arts","Museum of Art",18,"10:00","12:00",0,false,"Art Club","Fine Arts","Join a relaxed sketching session."],
  ["career","Meet your next opportunity","Career","Tanner Building",33,"15:00","17:00",0,false,"Career Studio","Business","Practice introductions and connect with peers."],
  ["past","Welcome week mixer","Social","Maeser Lawn",-3,"18:00","20:00",0,true,"BYUSA","All majors","A relaxed start-of-semester mixer."],
  ["past2","Community service afternoon","Service","Wilkinson Center",-8,"14:00","16:00",0,false,"Y-Serve","All majors","Students assembled care kits."]
];
let events = seedRows.map((s) => ({ id:s[0], name:s[1], category:s[2], location:s[3], date:dateAt(s[4]), start:s[5], end:s[6], price:s[7], food:s[8], club:s[9], major:s[10], description:s[11], poster:"GATHER / TOGETHER", friends:[] }));
let data = { saved:["fall-social","past"], rsvp:[], user:null, friends:[] };
try { const stored = JSON.parse(localStorage.getItem("gather-events-v1")); if (stored) data = { ...data, ...stored }; } catch {}

let mode = "upcoming", view = new URL(location.href).searchParams.get("view") === "calendar" ? "calendar" : "list";
let filters = { q:"", category:"", location:"", club:"", major:"", from:"", to:"", food:false, free:false, spiritual:false };
let filtersOpen = false;
let month = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDay = "";
let backendMode = "demo";

function time(value) { const [h,m] = value.split(":").map(Number); return `${h%12||12}${m?":"+String(m).padStart(2,"0"):""} ${h<12?"AM":"PM"}`; }
function pretty(value, full=false) { return new Date(value+"T12:00:00").toLocaleDateString("en-US", { weekday:full?"long":undefined, month:"short", day:"numeric", year:full?"numeric":undefined }); }
function ended(event) { return !event.end ? new Date(event.date+"T23:59:59") < new Date() : new Date(event.date+"T"+event.end) < new Date(); }
function icon(name) { return `<i data-lucide="${name}" aria-hidden="true"></i>`; }
function icons() { window.lucide?.createIcons(); }
function toast(message) { const el=$("toast"); el.textContent=message; clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.textContent="",3500); }
function categoryClass(event) { return "category-"+({ Social:"social", Arts:"arts", Culture:"culture", Service:"service", Spiritual:"spiritual" }[event.category]||"primary"); }
function categoryIcon(event) { return ({ Social:"party-popper", Arts:"music-2", Career:"lightbulb", Service:"heart-handshake", Sports:"trophy", Culture:"globe-2", Spiritual:"sun" }[event.category]||"calendar-days"); }
function poster(event, extra="") { return `<div class="poster ${categoryClass(event)} ${extra}" role="img" aria-label="Flyer for ${esc(event.name)}"><span class="shape">${icon(categoryIcon(event))}</span><small>${esc(event.club)} · ${pretty(event.date)}</small><strong>${esc(event.poster||event.category.toUpperCase())}</strong></div>`; }

async function api(path, options={}) {
  const response = await fetch("/api"+path, { credentials:"same-origin", headers:{"Content-Type":"application/json"}, ...options });
  const body = await response.json();
  if (!response.ok) throw Error(body.error||"Request failed.");
  return body;
}
function persist() {
  if (backendMode === "demo") { try { localStorage.setItem("gather-events-v1",JSON.stringify(data)); } catch {} return; }
  if (!data.user) return;
  api("/state", { method:"PUT", body:JSON.stringify({ saved:data.saved, rsvp:data.rsvp, attended:[], reminders:{}, surveys:{}, friends:data.friends, interests:["Social","Arts"] }) }).catch(()=>toast("Could not sync your saved plans."));
}
function requireAccount() { if (backendMode === "demo") return true; if (!data.user) { closeModal(); location.assign("/#login"); toast("Sign in to save your plans."); return false; } return true; }
function toggleMenu() { const open=$("drawer").hidden; $("drawer").hidden=!open; $("menuButton").setAttribute("aria-expanded",String(open)); }

function setMode(next) { mode=next; selectedDay=""; renderResults(); }
function setFilter(keyName, value) { filters[keyName]=value; renderResults(); }
function clearFilters() { Object.keys(filters).forEach((k)=>filters[k]=typeof filters[k]==="boolean"?false:""); filtersOpen=false; renderToolbar(); renderResults(); }
function filteredEvents() {
  return events.filter((event) => {
    const past=ended(event);
    const allowed=mode=== "past" ? past && data.saved.includes(event.id) : mode=== "saved" ? data.saved.includes(event.id)&&!past : mode=== "savedPast" ? data.saved.includes(event.id)&&past : mode=== "rsvp" ? data.rsvp.includes(event.id)&&!past : !past;
    return allowed && (!filters.q || `${event.name} ${event.club||""} ${event.location}`.toLowerCase().includes(filters.q.toLowerCase())) && (!filters.category||event.category===filters.category) && (!filters.location||event.location===filters.location) && (!filters.club||(event.club||"")===filters.club) && (!filters.major||event.major===filters.major||event.major=== "All majors") && (!filters.from||event.date>=filters.from) && (!filters.to||event.date<=filters.to) && (!filters.food||event.food) && (!filters.free||event.price===0) && (!filters.spiritual||event.category=== "Spiritual");
  }).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
}
function options(values, current) { return `<option value="">All</option>`+values.map((value)=>`<option ${value===current?"selected":""}>${esc(value)}</option>`).join(""); }
function filterSelect(label, keyName, values) { return `<label>${label}<select onchange="setFilter('${keyName}',this.value)">${options(values,filters[keyName])}</select></label>`; }
function renderToolbar() {
  const categoryValues=[...new Set(events.map((e)=>e.category))].sort();
  $("toolbar").innerHTML=`<div class="row"><input class="search" aria-label="Search events" placeholder="Search events, clubs, or places…" value="${esc(filters.q)}" oninput="filters.q=this.value;renderResults()"><button onclick="filtersOpen=!filtersOpen;renderToolbar()" aria-expanded="${filtersOpen}">${icon("sliders-horizontal")} Filters</button><button onclick="toggleView()">${view=== "calendar"?icon("list")+" List view":icon("calendar-days")+" Calendar view"}</button></div><div class="chips">${[["upcoming","All upcoming"],["saved","Bookmarked"],["rsvp","RSVP’d"],["past","Past events"]].map(([value,label])=>`<button class="${mode===value?"active":""}" onclick="setMode('${value}')">${label}</button>`).join("")}</div><div class="filters" ${filtersOpen?"":"hidden"}>${filterSelect("Category / type","category",categoryValues)}${filterSelect("Location","location",[...new Set(events.map((e)=>e.location))])}${filterSelect("Club / organizer","club",[...new Set(events.map((e)=>e.club))])}${filterSelect("Major relevance","major",["Information Systems","Business","Humanities","Fine Arts"])}<label>From date<input type="date" value="${filters.from}" onchange="setFilter('from',this.value)"></label><label>Through date<input type="date" value="${filters.to}" onchange="setFilter('to',this.value)"></label><div>${[["food","Has food"],["free","Free events"],["spiritual","Spiritual"]].map(([keyName,label])=>`<label><input type="checkbox" ${filters[keyName]?"checked":""} onchange="setFilter('${keyName}',this.checked)"> ${label}</label>`).join("")}</div></div>`;
  icons();
}
function toggleView() { view=view=== "calendar"?"list":"calendar"; history.replaceState(null,"",view=== "calendar"?"/events?view=calendar":"/events"); $("pageTitle").textContent=view=== "calendar"?"Your campus calendar.":"What’s happening at BYU."; renderResults(); }

function bookmark(id) { if(!requireAccount())return; data.saved.includes(id)?data.saved=data.saved.filter((x)=>x!==id):data.saved.push(id); persist(); renderResults(); closeModal(); toast(data.saved.includes(id)?"Added to your saved events":"Removed from saved events"); }
function rsvp(id) { if(!requireAccount())return; data.rsvp.includes(id)?data.rsvp=data.rsvp.filter((x)=>x!==id):data.rsvp.push(id); persist(); renderResults(); openEvent(id); toast(data.rsvp.includes(id)?"Your RSVP has been saved":"RSVP canceled"); }

function card(event) { return `<article class="card">${poster(event)}<div class="card-body"><div><div class="row between"><span class="tag">${esc(event.category)}</span><span class="muted" style="font-size:12px">${event.price?"$"+Number(event.price).toFixed(0):"Free"}${event.food?" · Food provided":""}</span></div><h3>${esc(event.name)}</h3><div class="metadata"><span>${icon("clock")} ${pretty(event.date)} · ${time(event.start)}${event.end?"–"+time(event.end):""}</span><span>${icon("map-pin")} ${esc(event.location)}</span></div></div><div class="card-actions"><button onclick="openEvent('${event.id}')">${ended(event)?"View event":"View event"} ↗</button><button class="save ${data.saved.includes(event.id)?"active":""}" aria-pressed="${data.saved.includes(event.id)}" onclick="bookmark('${event.id}')">${data.saved.includes(event.id)?icon("bookmark-check")+" Saved":icon("bookmark")+" Save"}</button></div></div></article>`; }
function calendar(eventsToShow) {
  const year=month.getFullYear(), monthIndex=month.getMonth();
  const first=new Date(year,monthIndex,1).getDay(), days=new Date(year,monthIndex+1,0).getDate(), cells=[];
  for(let index=0;index<Math.ceil((first+days)/7)*7;index++){ const day=index-first+1; if(day<1||day>days){cells.push('<div class="day dim"></div>');continue;} const date=key(new Date(year,monthIndex,day)); const dayEvents=eventsToShow.filter((event)=>event.date===date); cells.push(`<div class="day"><button class="daynum ${date===key(today)?"today":""}" onclick="selectDay('${date}')">${day}</button>${dayEvents.map((event)=>`<button class="calevent" onclick="openEvent('${event.id}')">${time(event.start)}<br>${esc(event.name)}</button>`).join("")}</div>`); }
  return `<div class="row between section-head"><div class="row"><h2>${month.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</h2><button onclick="month=new Date(today.getFullYear(),today.getMonth(),1);selectedDay='';renderResults()">Today</button></div><div class="row"><button aria-label="Previous month" onclick="changeMonth(-1)">←</button><button aria-label="Next month" onclick="changeMonth(1)">→</button></div></div><div class="calendar"><div class="calhead">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d)=>"<div>"+d+"</div>").join("")}</div><div class="calgrid">${cells.join("")}</div></div><div id="dayList" class="day-list">${selectedDay?`<div class="row between section-head"><h2>${pretty(selectedDay,true)}</h2><button onclick="selectedDay='';renderResults()">Back to month</button></div><div class="list">${eventsToShow.filter((event)=>event.date===selectedDay).map(card).join("")||'<div class="empty">No events on this day match your filters.</div>'}</div>`:'<p class="muted">Select a date to see its schedule, or an event to see the details.</p>'}</div>`;
}
function changeMonth(offset) { month=new Date(month.getFullYear(),month.getMonth()+offset,1); selectedDay=""; renderResults(); }
function selectDay(date) { selectedDay=date; renderResults(); $("dayList")?.scrollIntoView({behavior:"smooth",block:"start"}); }
function renderResults() {
  if(filters.from&&filters.to&&filters.from>filters.to){$("results").innerHTML='<div class="empty" role="alert">The end date must be on or after the start date.</div>';$("resultCount").textContent="0 events";return;}
  const list=filteredEvents(); $("resultCount").textContent=`${list.length} event${list.length===1?"":"s"}`;
  $("results").innerHTML=view=== "calendar"?calendar(list):list.length?`<div class="list">${list.map(card).join("")}</div>`:'<div class="empty"><h3>No events match current filters</h3><p class="muted">Try a different date or clear your filters.</p><button onclick="clearFilters()">Clear filters</button></div>';
  icons();
}

function showModal(html) { $("modal").innerHTML=html; if(!$("modal").open)$("modal").showModal(); icons(); }
function closeModal() { if($("modal").open)$("modal").close(); }
function openEvent(id) { const event=events.find((item)=>item.id===id); if(!event)return; showModal(`<button class="close" aria-label="Close event details" onclick="closeModal()">✕</button>${poster(event,"detail-poster")}<div class="dialog-body"><span class="tag">${esc(event.category)}${ended(event)?" · Past event":""}</span><h2 style="margin-top:12px">${esc(event.name)}</h2><div class="detail-grid"><div><span class="muted">When</span><b>${pretty(event.date,true)}</b>${time(event.start)}${event.end?"–"+time(event.end):""}</div><div><span class="muted">Where</span><b>${esc(event.location)}</b>BYU · Provo, Utah</div><div><span class="muted">Admission</span><b>${event.price?"$"+Number(event.price).toFixed(0):"Free"}</b>${event.food?"Food provided":"Food not provided"}</div><div><span class="muted">Hosted by</span><b>${esc(event.club||"Campus organizer")}</b>${esc(event.major||"All majors")}</div></div><p>${esc(event.description)}</p><div class="row"><button class="${data.saved.includes(id)?"active":""}" onclick="bookmark('${id}')">${data.saved.includes(id)?icon("bookmark-check")+" Saved":icon("bookmark")+" Save event"}</button>${ended(event)?'<button onclick="closeModal()">Past event</button>':`<button class="primary" onclick="rsvp('${id}')">${data.rsvp.includes(id)?"✓ RSVP’d · Cancel":"RSVP to event"}</button>`}<a class="primary" style="display:inline-block;padding:12px;border-radius:8px;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location+" BYU Provo Utah")}">View location ↗</a></div></div>`); }

async function boot() {
  try {
    const config=await api("/config"); backendMode=config.mode;
    if(backendMode=== "supabase") { const [listing,session]=await Promise.all([api("/events"),api("/auth/session")]); events=listing.events.map((event)=>({...event,end:null,club:"Campus organizer",major:"All majors",poster:event.category.toUpperCase(),friends:[]})); data.user=session.user; $("footerMode").textContent=data.user?"Connected to Supabase · Your personal plans":"Connected to Supabase · Sign in to save plans"; if(data.user){const result=await api("/state"); data={...data,...result.state,user:data.user};} $("userButton").textContent=data.user?data.user.name+" ↗":"Sign in ↗"; $("sideUserButton").textContent=data.user?data.user.name+" ↗":"Sign in"; }
  } catch(error) { $("results").innerHTML=`<div class="empty"><h2>We couldn’t load events.</h2><p>${esc(error.message)}</p><button onclick="boot()">Try again</button></div>`; return; }
  $("pageTitle").textContent=view=== "calendar"?"Your campus calendar.":"What’s happening at BYU.";
  renderToolbar(); renderResults();
}
$("modal").addEventListener("click",(event)=>{ if(event.target===$("modal")) closeModal(); });
document.addEventListener("keydown",(event)=>{ if(event.key=== "Escape"&&!$("drawer").hidden)toggleMenu(); });
boot();
