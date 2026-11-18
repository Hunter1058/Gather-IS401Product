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
if (location.hash && /access_token=|refresh_token=|error_description=/.test(location.hash))
  history.replaceState(null,"",location.pathname+location.search);
const signup = /\/signup(?:\/|\.html)?$/.test(location.pathname);
function go(page) {
  location.assign(({ home: "/", saved: "/#saved", login: "/login", signup: "/signup" })[page] || "/");
}
function toggleMenu() {
  if (window.GatherMobileNav) { window.GatherMobileNav.toggle(); return; }
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
  let body;
  try { body=await res.json(); }
  catch { throw Object.assign(Error("Account service is temporarily unavailable. Please try again."),{status:503}); }
  if (!res.ok) throw Object.assign(Error(body.error || "Unable to complete that request."), { status: res.status });
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
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Your campus, connected</span><h2>${signup ? "Find your place." : "Welcome back."}</h2><p class="muted">${signup ? "Create your Gather account." : "Sign in to keep your plans together."}</p>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="name"></label>' : ""}<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="${signup ? 8 : 1}" required autocomplete="${signup ? "new-password" : "current-password"}"></label><div id="authError" class="error" role="alert"></div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "Create an account"}</button><button type="button" onclick="go('home')">Continue as guest</button>${signup ? "" : '<p><a href="/recover">Forgot your password or need account help?</a></p>'}</form>`;
}


async function authenticate(ev, signup) {
  ev.preventDefault();

  const button = ev.target.querySelector("[type=submit]");
  if (button.disabled) return;
  const message = $("authError");

  button.disabled = true;
  message.textContent = "";
  message.classList.remove("auth-success");
  message.classList.add("error");
  message.setAttribute("role", "alert");

  try {
    if (backendMode === "demo") {
      await demoAuthenticate(ev, signup);
      return;
    }

    const fields = Object.fromEntries(new FormData(ev.target));

    const result = await api("/auth/" + (signup ? "signup" : "login"), {
      method: "POST",
      body: JSON.stringify(fields),
    });

    if (!result.user) {
      message.classList.remove("error");
      message.classList.add("auth-success");
      message.setAttribute("role", "status");
      message.textContent =
        "You're almost there! 💚 Check your email to confirm your account, then sign in.";
      return;
    }

    data.user=result.user;
    try { await finishSignupPhoto(result.user); }
    catch { message.textContent="You are signed in. Open Profile settings to finish your photo or profile.";
      const link=document.createElement("a");link.href="/settings";link.textContent=" Open Profile settings";message.append(link);return; }
    go("home");

  } catch (error) {
    const status = error.status ?? error.statusCode;

    const isOutage =
      status === 0 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      /failed to fetch|networkerror|network error|fetch failed|timeout/i.test(
        error.message || ""
      );

    message.textContent = isOutage
      ? "Sorry, our system is temporarily down. Please try again in a few minutes."
      : error.message || "Something went wrong. Please try again.";

  } finally {
    button.disabled = false;
  }
}

async function finishSignupPhoto(user) {
  let pending;
  try { pending=JSON.parse(sessionStorage.getItem("gatherPendingSignup") || "null"); } catch { return; }
  if (!pending || typeof pending.email!=="string" || pending.email.trim().toLowerCase()!==user.email?.trim().toLowerCase()) return;
  const headers={"Content-Type":"application/json","X-Gather-Account":user.id};
  const current=await api("/settings",{headers});
  // Handle legacy drafts only for an incomplete profile; never overwrite a profile
  // already completed/edited in another browser with stale privacy choices.
  const legacy=pending.profile && !current.firstName && !current.username ? pending.profile : null;
  const photoUrl=pending.photoUrl || pending.profile?.photoUrl;
  if (legacy || photoUrl) await api("/settings",{method:"PUT",headers,body:JSON.stringify({
    firstName:legacy?.firstName || current.firstName,lastName:legacy?.lastName ?? current.lastName,
    username:legacy?.username ?? current.username ?? "",isPrivate:legacy?.isPrivate ?? current.isPrivate,
    categoryIds:legacy?.categoryIds ?? current.categoryIds,...(photoUrl?{photoUrl}:{})})});
  try { sessionStorage.removeItem("gatherPendingSignup"); } catch {}
}

async function signOut() {
  try {
    if (backendMode === "supabase") await api("/auth/logout", { method: "POST", body: "{}" });
    else { data.user = null; persist(); }
    go("home");
  } catch { toast("Could not sign out. Please try again."); }
}
const settingsPage = /^\/settings\/?$/.test(location.pathname);

function renderAccountHeader(name = data.user?.name, photoUrl = data.user?.photoUrl) {
  const button = $("userButton");
  button.classList.toggle("profile-avatar", Boolean(data.user));
  if (!button.querySelector(".account-avatar-image")) button.textContent = data.user
    ? (name || "Account").trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase()
    : "Sign in";
  button.title = data.user ? name || "My account" : "Sign in";
  globalThis.accountMenu?.update(data.user, signOut, photoUrl);
}

async function prepareProfilePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw Error("Choose a JPG, PNG, or WebP image under 5 MB.");

  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const side = Math.min(image.width, image.height);
    canvas.getContext("2d").drawImage(image, (image.width - side) / 2, (image.height - side) / 2,
      side, side, 0, 0, 256, 256);
    const photo = canvas.toDataURL("image/jpeg", 0.7);
    if (photo.length > 55000) throw Error("Try a smaller photo.");
    return photo;
  } finally {
    image.close();
  }
}

async function loadSettings() {
  const app = $("app");
  const headers = { "Content-Type": "application/json", "X-Gather-Account": data.user.id };
  app.innerHTML = '<p class="auth" role="status">Loading profile settings…</p>';
  try {
    let profile = await api("/settings", { headers });
    showSummary();

    function showSummary(message = "", editing = false) {
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || data.user.name || "Your profile";
      const photo = profile.photoUrl?.trim();
      const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
      const interests = profile.categories.filter(category => profile.categoryIds.some(id => String(id) === String(category.id)));
      renderAccountHeader(name, profile.photoUrl);
      app.innerHTML = `<section class="profile-settings" aria-labelledby="profileSettingsTitle">
        <h1 id="profileSettingsTitle">Profile settings</h1>
        <div class="auth settings-panel">
          ${editing ? '<form id="settingsForm"></form>' : ""}
          <section class="settings-section" aria-labelledby="settingsProfileTitle">
            <h2 id="settingsProfileTitle">Profile</h2>
            <div class="settings-profile-row">
              <div class="settings-photo-wrap"><div class="avatar settings-photo" aria-hidden="true">
                <span>${esc(initials)}</span>
                ${photo && /^(https?:\/\/|data:image\/jpeg;base64,)/i.test(photo) ? `<img src="${esc(photo)}" alt="">` : ""}
              </div>
              ${editing ? `<button class="settings-photo-edit" type="button" aria-label="Change profile photo" title="Change profile photo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></svg></button><input form="settingsForm" id="settingsPhotoInput" name="photo" type="file" accept="image/jpeg,image/png,image/webp" hidden>` : ""}</div>
              <div class="settings-identity">
                ${editing ? `<div class="settings-name-fields"><label>First name<input form="settingsForm" name="firstName" autocomplete="given-name" maxlength="60" required value="${esc(profile.firstName || "")}"></label><label>Last name<input form="settingsForm" name="lastName" autocomplete="family-name" maxlength="60" value="${esc(profile.lastName || "")}"></label></div><label>Username<input form="settingsForm" name="username" autocomplete="username" maxlength="30" pattern="[A-Za-z0-9_]{3,30}" aria-describedby="usernameHint" value="${esc(profile.username || "")}"></label><p id="usernameHint" class="muted">Use 3–30 letters, numbers, or underscores.</p>` : `<strong>${esc(name)}</strong>
                <p>${profile.username ? "@" + esc(profile.username.replace(/^@/, "")) : "Username not set"}</p>`}
                <p class="muted">${esc(data.user.email || "")}</p>
              </div>
              ${editing ? `<div class="settings-edit-actions"><button form="settingsForm" class="primary" type="submit">Save changes</button><button id="cancelSettings" type="button">Cancel</button></div>` : '<button id="editSettings" class="primary" type="button">Edit profile</button>'}
            </div>
            ${editing ? '<p class="muted settings-photo-hint">Use the pencil to choose a JPG, PNG, or WebP photo up to 5 MB. Photos are cropped to a square.</p><p id="settingsStatus" role="status"></p>' : ""}
          </section>
          <section class="settings-section" aria-labelledby="settingsPrivacyTitle">
            <h2 id="settingsPrivacyTitle">Privacy</h2>
            <div class="settings-visibility">
              <strong>Profile visibility</strong>
              ${editing ? `<select form="settingsForm" name="visibility" aria-label="Profile visibility"><option value="private" ${profile.isPrivate ? "selected" : ""}>Private</option><option value="public" ${profile.isPrivate ? "" : "selected"}>Public</option></select>` : `<span class="settings-chip">${profile.isPrivate ? "Private" : "Public"}</span>`}
            </div>
            <p class="muted">${profile.isPrivate
              ? "People can find you by username. Your name and photo are hidden in search."
              : "Other signed-in users can see your name and photo."}</p>
          </section>
          <section class="settings-section" aria-labelledby="settingsInterestsTitle">
            <h2 id="settingsInterestsTitle">Event interests</h2>
            <p class="muted">These shape your recommendations on Discover.</p>
            ${editing ? `<div class="settings-interest-options">${profile.categories.map(category => `<label class="settings-interest-option"><input form="settingsForm" type="checkbox" name="categoryId" value="${esc(category.id)}" ${profile.categoryIds.some(id => String(id) === String(category.id)) ? "checked" : ""}><span>${esc(category.EventCatagory || "Unnamed category")}</span></label>`).join("") || '<p class="muted">No categories available.</p>'}</div>` : interests.length ? `<ul class="settings-chips">${interests.map(category =>
              `<li class="settings-chip">${esc(category.EventCatagory || "Unnamed category")}</li>`
            ).join("")}</ul>` : '<p class="muted">No interests selected.</p>'}
          </section>
          <section class="settings-section" aria-labelledby="settingsAccountTitle">
            <h2 id="settingsAccountTitle">Account</h2>
            <div class="settings-account-actions">
              <button type="button" onclick="signOut()">Sign out</button>
              <details class="delete-account">
                <summary>Delete account</summary>
                <p>This permanently deletes your profile, saved plans, and friendships.</p>
                <form id="deleteAccountForm">
                  <label>Current password<input name="password" type="password" autocomplete="current-password" maxlength="4096" required></label>
                  <label>Type DELETE to confirm<input name="confirmation" autocomplete="off" required pattern="DELETE"></label>
                  <button type="submit">Permanently delete my account</button>
                  <p id="deleteAccountStatus" role="status"></p>
                </form>
              </details>
            </div>
          </section>
        </div>
      </section>`;
      const photoImage = app.querySelector(".settings-photo img");
      photoImage?.addEventListener("error", () => photoImage.remove());
      if (photoImage?.complete && !photoImage.naturalWidth) photoImage.remove();
      $("editSettings")?.addEventListener("click", () => {
        showForm();
        $("settingsForm").elements.firstName.focus();
      });
      $("deleteAccountForm").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const submit = form.querySelector('[type="submit"]');
        const status = $("deleteAccountStatus");
        submit.disabled = true;
        status.textContent = "Deleting your account…";
        try {
          await api("/auth/account", {
            method: "DELETE", headers,
            body: JSON.stringify({
              password: fields.get("password"),
              confirmation: fields.get("confirmation"),
            }),
          });
          location.replace("/");
        } catch (error) {
          status.textContent = error.message;
          submit.disabled = false;
        }
      });
      if (message) {
        const notice = document.createElement("div");
        notice.className = "settings-save-notice";
        notice.setAttribute("role", "status");
        document.body.append(notice);
        notice.textContent = message;
        setTimeout(() => notice.remove(), 4000);
        $("editSettings").focus();
      }
    }

    function showForm() {
      showSummary("", true);
      let previewPhoto;
      let photoPending = false;
      const photoInput = $("settingsPhotoInput");
      app.querySelector(".settings-photo-edit").addEventListener("click", () => photoInput.click());
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if (!file) return;
        photoPending = true;
        const save = app.querySelector('[form="settingsForm"][type="submit"]');
        save.disabled = true;
        $("settingsStatus").textContent = "Preparing photo…";
        try {
          const prepared = await prepareProfilePhoto(file);
          if (!photoInput.isConnected) return;
          previewPhoto = prepared;
          const avatar = app.querySelector(".settings-photo");
          let image = avatar.querySelector("img");
          if (!image) { image = document.createElement("img"); image.alt = ""; avatar.append(image); }
          image.src = prepared;
          $("settingsStatus").textContent = "Photo ready. Save changes to apply it.";
        } catch (error) {
          if (photoInput.isConnected) $("settingsStatus").textContent = error.message;
          photoInput.value = "";
        } finally {
          photoPending = false;
          save.disabled = false;
        }
      });
      $("cancelSettings").addEventListener("click", () => {
        showSummary();
        $("editSettings").focus();
      });
      $("settingsForm").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const submit = app.querySelector('[form="settingsForm"][type="submit"]');
        if (submit.disabled || photoPending) return;
        const status = $("settingsStatus");
        submit.disabled = true;
        $("cancelSettings").disabled = true;
        const controls = Array.from(form.elements).filter(control => control !== submit && control !== $("cancelSettings"));
        controls.forEach(control => control.disabled = true);
        app.querySelector(".settings-photo-edit").disabled = true;
        status.textContent = "Saving…";
        try {
          const file = fields.get("photo");
          const photoUrl = previewPhoto ?? (file?.size ? await prepareProfilePhoto(file) : undefined);
          const saved = await api("/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({
              firstName: fields.get("firstName"),
              lastName: fields.get("lastName"),
              categoryIds: profile.categories.filter(category => fields.getAll("categoryId").includes(String(category.id))).map(category => category.id),
              photoUrl,
              username: fields.get("username"),
              isPrivate: fields.get("visibility") === "private",
            }),
          });
          profile = { ...profile, ...saved, photoUrl: photoUrl ?? profile.photoUrl, categoryIds: profile.categories.filter(category => fields.getAll("categoryId").includes(String(category.id))).map(category => category.id) };
          showSummary("Profile updated.");
        } catch (error) {
          status.textContent = error.message;
        } finally {
          controls.forEach(control => control.disabled = false);
          app.querySelector(".settings-photo-edit")?.removeAttribute("disabled");
          submit.disabled = false;
          if ($("cancelSettings")) $("cancelSettings").disabled = false;
        }
      });
    }
  } catch (error) {
    app.innerHTML = '<div class="auth"><h1>Profile settings</h1><p role="alert"></p><button type="button" onclick="boot()">Try again</button></div>';
    app.querySelector('[role="alert"]').textContent = error.message;
  }
}

const categoryEmojis = {
  "Academic": "📚",
  "Arts": "🎨",
  "Career & Networking": "💼",
  "Culture": "🌎",
  "Dance": "💃",
  "Fitness": "💪",
  "Food": "🍕",
  "Games": "🎮",
  "Music": "🎵",
  "Outdoors": "🏕️",
  "Service & Volunteering": "🤝",
  "Social": "🎉",
  "Spiritual & Religious": "✨",
  "Sports": "⚽",
  "Technology": "💻"
};

function categoryLabel(category) {
  const name = category.EventCatagory || "Unnamed category";
  return `${categoryEmojis[name] || "📅"} ${esc(name)}`;
}

async function loadSignup() {
  const app = $("app");

  app.innerHTML = '<div class="auth">Loading signup form…</div>';

  try {
    const { categories } = await api("/categories");

    const signupData = {
      firstName: "",
      lastName: "",
      username: "",
      email: "",
      password: "",
      photo: null,
      visibility: "private",
      categoryIds: []
    };

    // STEP 1: Account details
    function showStep1() {
      app.innerHTML = `
        <form class="auth" id="signupStep1">
          <span class="eyebrow">Step 1 of 2</span>
          <h1>Create your account</h1>
          <p class="muted">Join Gather and discover what's happening on campus.</p>

          <label>First name
            <input name="firstName" required maxlength="60"
              autocomplete="given-name" value="${esc(signupData.firstName)}">
          </label>

          <label>Last name
            <input name="lastName" maxlength="60"
              autocomplete="family-name" value="${esc(signupData.lastName)}">
          </label>

          <label>Username
            <input name="username" required minlength="3" maxlength="30"
              pattern="[A-Za-z0-9_]{3,30}"
              autocomplete="username" value="${esc(signupData.username)}">
          </label>
          <p class="muted">3–30 letters, numbers, or underscores.</p>

          <label>Email
            <input name="email" type="email" required
              autocomplete="email" value="${esc(signupData.email)}">
          </label>

          <label>Password
            <input name="password" type="password" required minlength="8"
              autocomplete="new-password">
          </label>

          <label>Confirm password
            <input name="confirmPassword" type="password" required minlength="8"
              autocomplete="new-password">
          </label>

          <p id="signupError" class="error" role="alert"></p>

          <button class="primary" type="submit">Next: Personalize</button>
          <button type="button" onclick="go('login')">
            Already have an account? Sign in
          </button>
          <button type="button" onclick="go('home')">
          Continue as guest
          </button>
        </form>
      `;

      $("signupStep1").addEventListener("submit", event => {
        event.preventDefault();

        const fields = new FormData(event.currentTarget);

        if (fields.get("password") !== fields.get("confirmPassword")) {
          $("signupError").textContent = "Passwords do not match.";
          return;
        }

        if(!fields.get("firstName").trim()) { $("signupError").textContent="Enter your first name.";return; }
        signupData.firstName = fields.get("firstName").trim();
        signupData.lastName = fields.get("lastName").trim();
        signupData.username = fields.get("username").trim().toLowerCase();
        signupData.email = fields.get("email").trim();
        signupData.password = fields.get("password");

        showStep2();
      });
    }

    // STEP 2: Profile personalization
    function showStep2() {
      const selected = new Set(signupData.categoryIds.map(String));
      const initials = [signupData.firstName, signupData.lastName].filter(Boolean).map(part => Array.from(part)[0]).join("").toUpperCase();
      let preparingPhoto = false;
      app.innerHTML = `<section class="profile-settings signup-personalise" aria-labelledby="personaliseTitle">
        <div class="signup-personalise-intro"><p>Step 2 of 2</p><h1 id="personaliseTitle">Make it yours.</h1>
        <p class="muted">Add a photo and choose what you’d like to discover.</p></div>
        <form class="auth settings-panel" id="signupStep2">
          <section class="settings-section" aria-labelledby="signupPhotoTitle">
            <h2 id="signupPhotoTitle">Profile photo</h2>
            <div class="settings-profile-row">
              <div class="settings-photo-wrap"><div class="avatar settings-photo"><span>${esc(initials)}</span>${signupData.photoPreview ? `<img src="${esc(signupData.photoPreview)}" alt="Profile photo preview">` : ""}</div>
                <button class="settings-photo-edit" id="signupPhotoEdit" type="button" aria-label="Upload profile photo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></svg></button>
                <input id="signupPhotoInput" name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="signupPhotoHint" hidden>
              </div>
              <div><strong>Upload a profile photo</strong><p id="signupPhotoHint" class="muted">Optional · JPG, PNG, or WebP, up to 5 MB. Photos are cropped to a square.</p><p id="signupPhotoStatus" role="status"></p></div>
            </div>
          </section>
          <section class="settings-section" aria-labelledby="signupPrivacyTitle">
            <h2 id="signupPrivacyTitle">Privacy</h2>
            <div class="settings-visibility"><label for="signupVisibility">Profile visibility</label>
              <select id="signupVisibility" name="visibility" aria-describedby="signupVisibilityHint"><option value="private" ${signupData.visibility === "private" ? "selected" : ""}>Private</option><option value="public" ${signupData.visibility === "public" ? "selected" : ""}>Public</option></select>
            </div>
            <p class="muted" id="signupVisibilityHint">People can find you by username. When private, your name and photo stay hidden in search.</p>
          </section>
          <section class="settings-section" aria-labelledby="signupInterestsTitle">
            <h2 id="signupInterestsTitle">Event interests</h2><p class="muted">Choose interests to personalise your recommendations.</p>
            <div class="settings-interest-options">${categories.map(category => `<label class="settings-interest-option"><input type="checkbox" name="categoryId" value="${esc(category.id)}" ${selected.has(String(category.id)) ? "checked" : ""}><span>${esc(category.EventCatagory || "Unnamed category")}</span></label>`).join("") || '<p class="muted">No categories available.</p>'}</div>
          </section>
          <section class="settings-section signup-personalise-footer">
            <p id="signupError" class="error" role="alert"></p>
            <div class="signup-personalise-actions"><button id="signupBack" type="button">Back</button><p class="muted">You can change these choices later in Settings.</p><button class="primary" type="submit">Create account</button></div>
          </section>
        </form>
      </section>`;
      $("signupPhotoEdit").addEventListener("click", () => $("signupPhotoInput").click());
      $("signupPhotoInput").addEventListener("change", async event => {
        const file = event.currentTarget.files[0];
        if (!file) return;
        preparingPhoto = true;
        const submit = $("signupStep2").querySelector('[type="submit"]');
        submit.disabled = true;
        $("signupBack").disabled = true;
        $("signupPhotoEdit").disabled = true;
        $("signupPhotoStatus").textContent = "Preparing photo…";
        try {
          const preview = await prepareProfilePhoto(file);
          signupData.photo = file;
          signupData.photoPreview = preview;
          const avatar = app.querySelector(".settings-photo");
          let image = avatar.querySelector("img");
          if (!image) { image = document.createElement("img"); image.alt = "Profile photo preview"; avatar.append(image); }
          image.src = preview;
          $("signupPhotoStatus").textContent = "Photo ready.";
        } catch (error) { event.target.value = ""; $("signupPhotoStatus").textContent = error.message; }
        finally { preparingPhoto = false; submit.disabled = false; $("signupBack").disabled = false; $("signupPhotoEdit").disabled = false; }
      });

      $("signupBack").addEventListener("click", () => {
        const fields = new FormData($("signupStep2"));
        signupData.visibility = fields.get("visibility");
        signupData.categoryIds = fields.getAll("categoryId");
        signupData.photo = fields.get("photo")?.size
          ? fields.get("photo")
          : signupData.photo;
        showStep1();
      });

      $("signupStep2").addEventListener("submit", async event => {
        event.preventDefault();

        const form = event.currentTarget;
        const fields = new FormData(form);
        const button = form.querySelector('[type="submit"]');
        const status = $("signupError");

        if (button.disabled || preparingPhoto) return;
        button.disabled = true;
        $("signupBack").disabled = true;
        status.textContent = "Creating your account…";

        try {
          signupData.visibility = fields.get("visibility");
          signupData.categoryIds = fields.getAll("categoryId");

          const file = fields.get("photo");
          if (file?.size) signupData.photo = file;

          const photoUrl = signupData.photo
            ? await prepareProfilePhoto(signupData.photo)
            : undefined;

          const result = await api("/auth/signup", {
  method: "POST",
  body: JSON.stringify({
    name: `${signupData.firstName} ${signupData.lastName}`.trim(),
    username: signupData.username,
    email: signupData.email,
    password: signupData.password,
    profile: {
      firstName: signupData.firstName,
      lastName: signupData.lastName,
      username: signupData.username,
      isPrivate: signupData.visibility === "private",
      categoryIds: signupData.categoryIds
    }
  })
});

          // Clear the in-memory password once the account creation request succeeds.
          signupData.password = "";

          let photoPending=false;
          if (photoUrl) {
            try { sessionStorage.setItem("gatherPendingSignup",JSON.stringify({email:signupData.email,photoUrl}));photoPending=true; }
            catch { /* Identity/profile fields already persisted; photo can be chosen again in settings. */ }
          }
          if (result.user) {
            try { if(photoPending) await finishSignupPhoto(result.user); }
            catch { app.innerHTML='<section class="auth"><h1>Account created</h1><p>Finish your photo in Profile settings.</p><a href="/settings">Open Profile settings</a></section>';return; }
            location.replace("/");
          } else {
            app.innerHTML='<section class="auth"><h1>Check your email</h1><p>If this address is eligible, confirm it using the email, then sign in. Your profile choices are saved with a new account.</p>'
              +(photoUrl&&!photoPending?'<p>You can add your photo in Profile settings after signing in.</p>':'')
              +'<p><a href="/login">Go to sign in</a> · <a href="/recover">Email didn’t arrive?</a></p></section>';
          }
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
          if ($("signupBack")) $("signupBack").disabled = false;
        }
      });
    }

    showStep1();

  } catch (error) {
    app.innerHTML = `<section class="auth">
      <h1>Unable to load signup</h1>
      <p role="alert">${esc(error.message)}</p>
      <button onclick="boot()">Try again</button>
    </section>`;
  }
}

async function boot() {
  try {
    if (location.protocol !== "file:") {
      const config = await api("/config");
      backendMode = config.mode;
      if (backendMode === "supabase") data = { accounts: [], user: (await api("/auth/session")).user };
    }
    renderAccountHeader();
    if (settingsPage) document.title = "Profile settings | Gather";
    if (settingsPage && data.user && backendMode === "supabase") {
  await loadSettings();
} else if (signup && backendMode === "supabase") {
  await loadSignup();
} else {
  $("app").innerHTML = auth(signup);
}
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
