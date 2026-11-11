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
  return `<form class="auth" onsubmit="authenticate(event,${signup})"><span class="eyebrow">Your campus, connected</span><h2>${signup ? "Find your place." : "Welcome back."}</h2><p class="muted">${signup ? "Create your Gather account." : "Sign in to keep your plans together."}</p>${signup ? '<label>Name<input name="name" required maxlength="60" autocomplete="name"></label>' : ""}<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="${signup ? "new-password" : "current-password"}"></label><div id="authError" class="error" role="alert"></div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button><button type="button" onclick="go('${signup ? "login" : "signup"}')">${signup ? "Already have an account? Sign in" : "Create an account"}</button><button type="button" onclick="go('home')">Continue as guest</button></form>`;
}


async function authenticate(ev, signup) {
  ev.preventDefault();

  const button = ev.target.querySelector("[type=submit]");
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

    // Successful login: return to the homepage.
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

async function signOut() {
  try {
    if (backendMode === "supabase") await api("/auth/logout", { method: "POST", body: "{}" });
    else { data.user = null; persist(); }
    go("home");
  } catch { toast("Could not sign out. Please try again."); }
}
const settingsPage = /^\/settings\/?$/.test(location.pathname);

function renderAccountHeader(name = data.user?.name) {
  const button = $("userButton");
  button.classList.toggle("profile-avatar", Boolean(data.user));
  if (!button.querySelector(".account-avatar-image")) button.textContent = data.user
    ? (name || "Account").trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase()
    : "Sign in";
  button.title = data.user ? name || "My account" : "Sign in";
  globalThis.accountMenu?.update(data.user, signOut);
  $("sideUserButton").textContent = data.user ? "Account" : "Sign in";
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

    function showSummary(message = "") {
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || data.user.name || "Your profile";
      const photo = profile.photoUrl?.trim();
      const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
      const interests = profile.categories.filter(category => profile.categoryIds.includes(category.id));
      renderAccountHeader(name);
      app.innerHTML = `<section class="auth">
        <h1>Profile settings</h1>
        <div class="avatar settings-photo" aria-hidden="true">
          <span>${esc(initials)}</span>
          ${photo && /^(https?:\/\/|data:image\/jpeg;base64,)/i.test(photo) ? `<img src="${esc(photo)}" alt="">` : ""}
        </div>
        <h2>${esc(name)}</h2>
        <p>Username: ${profile.username ? "@" + esc(profile.username.replace(/^@/, "")) : "Not set"}</p>
        <p class="muted">${esc(data.user.email || "")}</p>
        <p>Profile visibility: ${profile.isPrivate ? "Private" : "Public"}</p>
        <h3>Event interests</h3>
        <p>${interests.length ? interests.map(category => categoryLabel(category)).join(", ") : "No interests selected."}</p>
        <p id="settingsSaved" role="status" tabindex="-1">${esc(message)}</p>
        <button id="editSettings" class="primary" type="button">Edit profile</button>
        <button type="button" onclick="go('saved')">View saved plans</button>
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
      </section>`;
      const photoImage = app.querySelector(".settings-photo img");
      photoImage?.addEventListener("error", () => photoImage.remove());
      if (photoImage?.complete && !photoImage.naturalWidth) photoImage.remove();
      $("editSettings").addEventListener("click", () => {
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
      if (message) $("settingsSaved").focus();
    }

    function showForm() {
      const selected = new Set(profile.categoryIds);
      app.innerHTML = `<form class="auth" id="settingsForm">
        <h1>Profile settings</h1>
        <p class="muted">${esc(data.user.email || "")}</p>
        <label>First name<input name="firstName" autocomplete="given-name" maxlength="60" required value="${esc(profile.firstName)}"></label>
        <label>Last name<input name="lastName" autocomplete="family-name" maxlength="60" value="${esc(profile.lastName)}"></label>
        <label>Username<input name="username" autocomplete="username" maxlength="31" aria-describedby="usernameHint" value="${esc(profile.username || "")}"></label>
        <p class="muted" id="usernameHint">Use 3–30 letters, numbers, or underscores so people can find you in Friends.</p>
        <label>Profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="photoHint"></label>
        <p class="muted" id="photoHint">JPG, PNG, or WebP, up to 5 MB. Leave blank to keep your current photo.</p>
        <label>Profile visibility
          <select name="visibility" aria-describedby="visibilityHint">
            <option value="private" ${profile.isPrivate ? "selected" : ""}>Private</option>
            <option value="public" ${profile.isPrivate ? "" : "selected"}>Public</option>
          </select>
        </label>
        <p id="visibilityHint" class="muted">People can find you by username either way. Only Public shows your name and photo to other signed-in users.</p>
        <fieldset><legend>Event interests</legend>
          <p class="muted">Choose any categories you’re interested in.</p>
          <div class="settings-interests">${profile.categories.map(category =>
          `<label><input type="checkbox" name="categoryId" value="${esc(category.id)}" ${selected.has(category.id) ? "checked" : ""}> ${categoryLabel(category)}</label>`
          ).join("") || "<p>No categories available.</p>"}</div>
        </fieldset>
        <p id="settingsStatus" role="status"></p>
        <button class="primary" type="submit">Save settings</button>
        <button id="cancelSettings" type="button">Cancel</button>
      </form>`;
      $("cancelSettings").addEventListener("click", () => {
        showSummary();
        $("editSettings").focus();
      });
      $("settingsForm").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const submit = form.querySelector('[type="submit"]');
        const status = $("settingsStatus");
        submit.disabled = true;
        $("cancelSettings").disabled = true;
        status.textContent = "Saving…";
        try {
          const file = fields.get("photo");
          const photoUrl = file?.size ? await prepareProfilePhoto(file) : undefined;
          const saved = await api("/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({
              firstName: fields.get("firstName"),
              lastName: fields.get("lastName"),
              categoryIds: fields.getAll("categoryId"),
              photoUrl,
              username: fields.get("username"),
              isPrivate: fields.get("visibility") === "private",
            }),
          });
          profile = { ...profile, ...saved, photoUrl: photoUrl ?? profile.photoUrl, categoryIds: fields.getAll("categoryId") };
          showSummary("Settings saved.");
        } catch (error) {
          status.textContent = error.message;
        } finally {
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
        </form>
      `;

      $("signupStep1").addEventListener("submit", event => {
        event.preventDefault();

        const fields = new FormData(event.currentTarget);

        if (fields.get("password") !== fields.get("confirmPassword")) {
          $("signupError").textContent = "Passwords do not match.";
          return;
        }

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
      const selected = new Set(signupData.categoryIds);

      app.innerHTML = `
        <form class="auth" id="signupStep2">
          <span class="eyebrow">Step 2 of 2</span>
          <h1>Make Gather yours</h1>
          <p class="muted">Choose your interests to see relevant events first.</p>

          <label>Profile picture (optional)
            <input name="photo" type="file"
              accept="image/jpeg,image/png,image/webp">
          </label>
          <p class="muted">JPG, PNG, or WebP. Maximum 5 MB.</p>

          <label>Profile visibility
            <select name="visibility">
              <option value="private" ${signupData.visibility === "private" ? "selected" : ""}>Private</option>
              <option value="public" ${signupData.visibility === "public" ? "selected" : ""}>Public</option>
            </select>
          </label>

          <fieldset>
            <legend>What events interest you?</legend>
            <p class="muted">Select as many categories as you like.</p>

            <div class="settings-interests">
              ${categories.map(category => `
                <label>
                  <input type="checkbox" name="categoryId"
                    value="${esc(category.id)}"
                    ${selected.has(category.id) ? "checked" : ""}>
                    ${categoryLabel(category)}
                </label>
              `).join("")}
            </div>
          </fieldset>

          <p id="signupError" class="error" role="alert"></p>

          <button class="primary" type="submit">Create my account</button>
          <button id="signupBack" type="button">Back</button>
        </form>
      `;

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

        button.disabled = true;
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
              email: signupData.email,
              password: signupData.password
            })
          });

          // Never retain the password after the signup request.
          signupData.password = "";

          const profile = {
            firstName: signupData.firstName,
            lastName: signupData.lastName,
            username: signupData.username,
            photoUrl,
            isPrivate: signupData.visibility === "private",
            categoryIds: signupData.categoryIds
          };

          if (result.user) {
            await api("/settings", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "X-Gather-Account": result.user.id
              },
              body: JSON.stringify(profile)
            });

            location.replace("/");
          } else {
            // Email confirmation required. Save non-password profile
            // choices locally until the user confirms and signs in.
            sessionStorage.setItem(
              "gatherPendingSignup",
              JSON.stringify({ email: signupData.email, profile })
            );

            app.innerHTML = `
              <section class="auth">
                <h1>Check your email!</h1>
                <p>We've sent you a confirmation link.</p>
                <p class="muted">
                  After confirming your email, sign in to finish
                  setting up your profile.
                </p>
                <a href="/login">Go to sign in</a>
              </section>
            `;
          }
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
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
