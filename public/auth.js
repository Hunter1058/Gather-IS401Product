"use strict";

/* Standalone login and sign-up pages. Shared styles and server session APIs
 * follow the same structure as the standalone Events page. */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

let backendMode = "demo";
let data = { accounts: [], user: null };
try {
  const stored = JSON.parse(localStorage.getItem("gather-v1"));
  if (stored) data = { ...data, ...stored };
} catch {}
const signup = /\/signup(?:\/|\.html)?$/.test(location.pathname);
function go(page) {
  location.assign(({ home: "/", saved: "/#saved", login: "/login", signup: "/signup" })[page] || "/");
}
function toggleMenu() {
  const open = $("drawer").hidden;
  $("drawer").hidden = !open;
  $("menuButton").setAttribute("aria-expanded", String(open));
}
function toast(message) { $("toast").textContent = message; }
function persist() {
  try { localStorage.setItem("gather-v1", JSON.stringify(data)); }
  catch { throw Error("Browser storage is unavailable. Enable it to use demo accounts."); }
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
function demoAuth(signup = false) {
  if (data.user && !signup)
    return `<div class="auth"><span class="eyebrow">Welcome back</span><h2>${esc(data.user.name)}</h2><p class="muted">Your plans are saved in this browser.</p><button class="primary" onclick="go('saved')">View saved events</button><button onclick="signOut()">Sign out</button></div>`;
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Find your place</span><h2>${signup ? "Make yourself at home." : "Welcome back."}</h2><p class="muted">${signup ? "Create a demo profile to personalize your visit." : "Sign in to your demo profile."}</p><div class="notice">Prototype only. Use fictional details and a demo password. For a quick tour: <b>student / gather123</b>.</div>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="off"></label><label>Email<input name="email" type="email" required autocomplete="off"></label>' : ""}<label>Username<input name="username" required autocomplete="off"></label><label>Password<input name="password" type="password" minlength="6" required autocomplete="off"></label><div id="authError" class="error" role="alert"></div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "New here? Create an account"}</button><button type="button" onclick="go('home')">Continue as guest →</button></form>`;
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
function auth(signup = false) {
  if (backendMode === "demo") return demoAuth(signup);
  if (data.user && !signup)
    return `<div class="auth"><span class="eyebrow">Your account</span><h2>${esc(data.user.name)}</h2><p class="muted">${esc(data.user.email)}</p><button class="primary" onclick="go('saved')">View saved plans</button><button onclick="signOut()">Sign out</button></div>`;
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Your campus, connected</span><h2>${signup ? "Find your place." : "Welcome back."}</h2><p class="muted">${signup ? "Create your Gather account." : "Sign in to keep your plans together."}</p>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="name"></label>' : ""}<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="${signup ? "new-password" : "current-password"}"></label><div id="authError" class="error" role="alert"></div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "Create an account"}</button><button type="button" onclick="go('home')">Continue as guest</button></form>`;
}

async function authenticate(ev, signup) {
  ev.preventDefault();
  const button = ev.target.querySelector("[type=submit]");
  button.disabled = true;
  $("authError").textContent = "";
  try {
    if (backendMode === "demo") {
      await demoAuthenticate(ev, signup);
      return;
    }
    const fields = Object.fromEntries(new FormData(ev.target));
    const result = await api("/auth/" + (signup ? "signup" : "login"), {
      method: "POST", body: JSON.stringify(fields),
    });
    if (!result.user) {
      $("authError").textContent = result.message || "Check your email to confirm your account, then sign in.";
      return;
    }
    // The destination page restores the session and loads personal plans.
    go("home");
  } catch (error) {
    $("authError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
async function signOut() {
  try {
    if (backendMode === "supabase") await api("/auth/logout", { method: "POST", body: "{}" });
    else { data.user = null; persist(); }
    go("home");
  } catch { toast("Could not sign out. Please try again."); }
}
async function boot() {
  try {
    if (location.protocol !== "file:") {
      const config = await api("/config");
      backendMode = config.mode;
      if (backendMode === "supabase") data = { accounts: [], user: (await api("/auth/session")).user };
    }
    $("app").innerHTML = auth(signup);
    $("userButton").textContent = data.user ? data.user.name + " ↗" : "Sign in";
    $("sideUserButton").textContent = data.user ? "Account" : "Sign in";
    $("footerMode").textContent = backendMode === "demo" ? "Demo mode · Plans saved in this browser" : "Connected to Supabase";
    window.lucide?.createIcons();
  } catch {
    $("app").innerHTML = '<div class="empty"><h1>We couldn’t load your account.</h1><p>Check your connection and try again.</p><button onclick="boot()">Try again</button></div>';
  }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("drawer").hidden) toggleMenu();
});
boot();
