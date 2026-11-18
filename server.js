/*
 * Gather Node.js server
 * ---------------------
 * Serves the static website, exposes the JSON API, validates Supabase
 * configuration, manages short-lived authenticated sessions, and proxies data
 * operations that require a signed-in user.
 */

import http from "node:http";
import { authObject, emailInput, passwordInput, signupProfile, providerFailure, authLimiter, authFailure } from "./lib/auth-input.js";
import { passwordRecovery } from "./lib/password-recovery.js";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { authSessions } from "./lib/auth-session.js";
import { isSameOrigin } from "./lib/request-origin.js";
import { people, userId, friendBody, sendRequest, cancelRequest, removeFriend, respondRequest, connections } from "./lib/friends.js";
import { shareEvent, receivedShares, eventId } from "./lib/event-sharing.js";
import { logEventView } from "./lib/event-interactions.js";
import { planInput, profileId, readPlans, writePlan } from "./lib/event-plans.js";

// Server and Supabase configuration. Supabase credentials must be provided together.
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_KEY;
const accountDeletionKey = process.env.SUPABASE_ACCOUNT_DELETION_KEY;
const configured = Boolean(supabaseUrl && publishableKey);
const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

if (Boolean(supabaseUrl) !== Boolean(publishableKey))
  throw Error("Set both SUPABASE_URL and SUPABASE_KEY, or neither for demo mode.");
if (publishableKey?.startsWith("sb_secret_"))
  throw Error("Use a publishable key, never a secret key.");
if (publishableKey?.startsWith("eyJ")) {
  try {
    const role = JSON.parse(Buffer.from(publishableKey.split(".")[1], "base64url").toString()).role;
    if (role === "service_role") throw Error("Use an anon/publishable key, never service_role.");
  } catch (e) {
    if (e.message.includes("service_role")) throw e;
  }
}

// Each browser login gets its own Supabase client; public reads use a public client.
const makeClient = () =>
  createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
const publicClient = configured ? makeClient() : null;

// Request-scoped clients restore verified sessions on any Vercel instance.
const sessionCookies = authSessions(makeClient, { secure: production });
const limitAuth = authLimiter();
const recovery = passwordRecovery({makeClient,sessionCookies,secure:production,port,limit:limitAuth});
// Production must never offer browser-only demo accounts after a misconfiguration.
if (production && !configured) throw Error("Configure Supabase before deploying Gather.");

const userView = (u) =>
  u ? {
        id: u.id,
        email: u.email,
        name: String(u.user_metadata?.name || u.email?.split("@")[0] || "Student").slice(0, 60),
      } : null;

// HTTP response and cookie helpers keep API behavior consistent.
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw Object.assign(Error("Invalid JSON."), { status: 400 });
  }
}

// Main HTTP server: static files, API routes, authentication, and state storage.
export const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(req.method) && !isSameOrigin(req))
        return json(res, 403, { error: "Request origin is not allowed." });
      
      const route = url.pathname.slice(4);

      // Configuration and health endpoints.
      if (route === "/config" && req.method === "GET") return json(res, 200, { mode: configured ? "supabase" : "demo" });
      if (route === "/health" && req.method === "GET") return json(res, 200, { ok: true });
      if (!configured) return json(res, 503, { error: "Supabase is not configured." });

      // Public event listing: reads rows directly from the Supabase Events table.
      if (route === "/events" && req.method === "GET") {
        const eventQuery = publicClient
          .from("Events")
          .select("EventID::text, EventName, EventLocation, EventDate, EventTime, EventDescription, EventImage, CampusLocation, categoryLinks:Event_Category_Linking_Table(IsPrimary, category:EventCategory(EventCatagory, EventStockImage))")
          .limit(500);
        if (url.searchParams.has("eventId")) eventQuery.eq("EventID", eventId(url.searchParams.get("eventId")));
        const { data, error } = await eventQuery;
        
        if (error) throw error;

        const { data: categoryRows, error: categoryError } = await publicClient
          .from("EventCategory")
          .select("EventCatagory")
          .order("EventCatagory");

        if (categoryError) throw categoryError;

        
        // Map relational data back to the JSON structure the frontend expects
        return json(res, 200, {
          categories: categoryRows.map(row => row.EventCatagory),
          events: data.map((r) => {
            // PostgREST can return an object while EventID alone is the link PK,
            // or an array after the team enables multiple categories per event.
            const links = Array.isArray(r.categoryLinks) ? r.categoryLinks
              : r.categoryLinks ? [r.categoryLinks] : [];
            const categories = [...new Set(links.map(link => link.category?.EventCatagory)
              .filter(value => typeof value === "string" && value.trim())
              .map(value => value.trim()))].sort();
            const primaryLink = links.find(link => link.IsPrimary) || links[0];
            const primaryCategory = primaryLink?.category?.EventCatagory
              || categories[0]
              || "Campus event";

            const stockImagePath = primaryLink?.category?.EventStockImage;

            const stockImageUrl = stockImagePath
              ? publicClient.storage
                  .from("Stock_Images")
                  .getPublicUrl(stockImagePath).data.publicUrl
              : null;
            return {
              id: String(r.EventID),
              name: r.EventName || "Campus event",
              category: primaryCategory,
              categories,
              location: r.EventLocation,
              campusLocation: r.CampusLocation,
              date: r.EventDate,
              start: r.EventTime,
              description: r.EventDescription,
              imageUrl: r.EventImage || stockImageUrl || null,
              imageType: r.EventImage ? "flyer" : "stock",
              end: null,
              club: null,
              major: null,
              poster: categories.join(" · ") || "Campus event",
              friends: [],
              price: null,
              food: null
            };
          }),
        });
      }
      // Public event categories for the signup interests form.
if (route === "/categories" && req.method === "GET") {
  const client = makeClient();

  const { data: categories, error } = await client
    .from("EventCategory")
    .select("id:EventCatID::text, EventCatagory")
    .order("EventCatagory");

  if (error) throw error;

  return json(res, 200, { categories });
}

  // Check username availability before personalization.
if (route === "/auth/username-available" && req.method === "POST") {
  const b = await body(req);
  const username = typeof b.username === "string"
    ? b.username.trim().replace(/^@/, "").toLowerCase()
    : "";

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return json(res, 400, {
      error: "Username must be 3–30 letters, numbers, or underscores."
    });
  }

  const { data: available, error } = await publicClient.rpc(
    "is_username_available",
    { requested_username: username }
  );

  if (error) {
    return json(res, 503, {
      error: "Unable to check username availability."
    });
  }

  return json(res, 200, { available });
}

      // Login and account creation through Supabase Auth.
      if (["/auth/login", "/auth/signup"].includes(route) && req.method === "POST") {

const signingUp = route === "/auth/signup";

const input = authObject(
  await body(req),
  signingUp
    ? ["email", "password", "name", "profile", "username"]
    : ["email", "password"]
);

const email = emailInput(input.email);
const password = passwordInput(input.password, signingUp);

if (
  input.name !== undefined &&
  (typeof input.name !== "string" || input.name.trim().length > 121)
) {
  throw authFailure("Enter a valid name.");
}

const profile = signingUp ? signupProfile(input.profile) : undefined;

limitAuth(req, signingUp ? "signup" : "login", email);

const client = makeClient();

// Check username availability before signup.
if (signingUp) {
  const username = typeof profile?.username === "string"
  ? profile.username.trim().replace(/^@/, "").toLowerCase()
  : "";

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return json(res, 400, {
      error: "Username must be 3–30 letters, numbers, or underscores."
    });
  }

  const { data: available, error: checkError } =
    await client.rpc("is_username_available", {
      requested_username: username
    });

  if (checkError) {
    return json(res, 503, {
      error: "Unable to check username availability. Try again."
    });
  }

  if (!available) {
    return json(res, 409, {
      error: "That username is already taken. Please choose another."
    });
  }
}

const result = signingUp
  ? await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: input.name?.trim(),
          ...(profile ? { gather_signup_profile: profile } : {})
        }
      }
    })
  : await client.auth.signInWithPassword({ email, password });

providerFailure(result.error, !signingUp);

if (!result.data?.session) {
  if (!signingUp) {
    throw authFailure(
      "Account service is temporarily unavailable. Please try again.",
      503
    );
  }

  return json(res, 200, {
    user: null,
    message: "If this address is eligible, check your email to confirm it, then sign in."
  });
}

if (!result.data.user) {
  throw authFailure(
    "Account service is temporarily unavailable. Please try again.",
    503
  );
}

sessionCookies.save(res, result.data.session);

return json(res, 200, {
  user: userView(result.data.user)
});

      }

      if (["/auth/forgot-password","/auth/resend-confirmation"].includes(route) || route.startsWith("/auth/recovery/"))
        return await recovery.handle(route,req,res,body,json);

      // Sign-out invalidates the server session and clears the browser cookie.
      if (route === "/auth/logout" && req.method === "POST") {
        const session = await sessionCookies.restore(req, res);
        if (session) {
          const { error } = await session.client.auth.signOut({ scope: "local" });
          if (error) throw Object.assign(Error("Unable to sign out. Try again."), { status: 503 });
        }
        sessionCookies.clear(res);
        recovery.clear(res);
        return json(res, 200, { ok: true });
      }

      if (route === "/auth/account" && req.method === "DELETE") {
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to delete your account." });
        if (req.headers["x-gather-account"] !== session.user.id)
          return json(res, 409, { error: "Your account changed. Reload before continuing." });
        if (!accountDeletionKey)
          return json(res, 503, { error: "Account deletion is unavailable right now." });

        const input = await body(req);
        limitAuth(req,"delete-verification",session.user.id);
        if (!input || typeof input.password !== "string" || !input.password ||
            input.password.length > 4096 || input.confirmation !== "DELETE")
          return json(res, 400, { error: "Enter your password and type DELETE to confirm." });

        const verifier = makeClient();
        const verified = await verifier.auth.signInWithPassword({
          email: session.user.email, password: input.password,
        });
        if (verified.error || verified.data.user?.id !== session.user.id)
          return json(res, 403, { error: "Could not verify your password. Your account was not deleted." });
        await verifier.auth.signOut({ scope: "local" });

        // The Auth foreign key cascades from the account to its Gather profile.
        const admin = createClient(supabaseUrl, accountDeletionKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { error } = await admin.auth.admin.deleteUser(session.user.id, false);
        if (error) return json(res, 503, { error: "Could not delete your account. Please try again." });
        sessionCookies.clear(res);
        recovery.clear(res);
        return json(res, 200, { ok: true });
      }

      // Restore an account from the browser session on page refresh.
      if (route === "/auth/session" && req.method === "GET") {
        const session = await sessionCookies.restore(req, res);
        const user = userView(session?.user);
        if (user) {
          const profile = await session.client.from("User")
            .select("UserProfilePhoto").eq("UserID", user.id).maybeSingle();
          if (!profile.error && profile.data?.UserProfilePhoto)
            user.photoUrl = profile.data.UserProfilePhoto;
        }
        return json(res, 200, { user });
      }

      if (route === "/settings" && ["GET", "PUT"].includes(req.method)) {
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to manage your settings." });
        const accountId = session.user.id;
        if (req.headers["x-gather-account"] !== accountId)
          return json(res, 409, { error: "Your account changed. Reload before continuing." });

        if (req.method === "PUT") {
          const { firstName, lastName, categoryIds, photoUrl, isPrivate, username } = (await body(req)) ?? {};
          if (typeof isPrivate !== "boolean" || typeof firstName !== "string" || !firstName.trim() || firstName.trim().length > 60 ||
              typeof lastName !== "string" || lastName.trim().length > 60 ||
              !Array.isArray(categoryIds) || categoryIds.length > 100 ||
              categoryIds.some(id => typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) ||
                BigInt(id) > 9223372036854775807n))
            return json(res, 400, { error: "Enter a first name and choose valid categories." });
          if (photoUrl !== undefined && (typeof photoUrl !== "string" || photoUrl.length > 55000 ||
              !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(photoUrl)))
            return json(res, 400, { error: "Choose a valid profile photo." });
          const handle = typeof username === "string" ? username.trim().replace(/^@/, "").toLowerCase() : null;
          if (handle === null || (handle && !/^[a-z0-9_]{3,30}$/.test(handle)))
            return json(res, 400, { error: "Use 3–30 letters, numbers, or underscores for your username." });
          const { error } = await session.client.rpc(
            "save_profile_username_settings", {
            first_name: firstName.trim(), last_name: lastName.trim(), category_ids: categoryIds,
            photo_url: photoUrl ?? null, is_private: isPrivate, username: handle || null,
          });
          if (error?.code === "23505")
            return json(res, 409, { error: "That username is already taken." });
          if (error?.code === "23503")
            return json(res, 400, { error: "A category is no longer available. Reload and try again." });
          if (error) throw error;
          return json(res, 200, { firstName: firstName.trim(), lastName: lastName.trim(), isPrivate, username: handle || null });
        }

        const [profile, categories, interests] = await Promise.all([
          session.client.from("User").select("UserFirstName, UserLastName, Username, UserProfilePhoto, IsPrivate").eq("UserID", accountId).single(),
          session.client.from("EventCategory").select("id:EventCatID::text, EventCatagory").order("EventCatagory"),
          session.client.from("UserInterest").select("id:EventCatID::text").eq("UserID", accountId),
        ]);
        for (const result of [profile, categories, interests]) if (result.error) throw result.error;
        return json(res, 200, {
          firstName: profile.data.UserFirstName ?? "",
          lastName: profile.data.UserLastName ?? "",
          username: profile.data.Username,
          isPrivate: profile.data.IsPrivate,
          photoUrl: profile.data.UserProfilePhoto,
          categories: categories.data,
          categoryIds: interests.data.map(({ id }) => id),
        });
      }

      const shareRoute = /^\/events\/([^/]+)\/share$/.exec(route);
      if (shareRoute || route === "/shared-events") {
        if (!isSameOrigin(req)) return json(res, 403, { error: "Request origin is not allowed." });
        const method = shareRoute ? "POST" : "GET";
        if (req.method !== method) {
          res.setHeader("Allow", method);
          return json(res, 405, { error: `Use ${method} for this operation.` });
        }
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to share with Gather." });
        if (req.headers["x-gather-account"] !== session.user.id)
          return json(res, 409, { error: "Your account changed. Reload before continuing.", code: "ACCOUNT_CHANGED" });
        if (shareRoute)
          return json(res, 200, { accountId: session.user.id, ...await shareEvent(session.client, shareRoute[1], await body(req)) });
        return json(res, 200, { accountId: session.user.id, ...await receivedShares(session.client, url.searchParams) });
      }

      // Friend actions use the verified per-request account client. The header
      // protects against acting from a tab showing a different signed-in user.
      if (route.startsWith("/friends/")) {
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to manage friendships." });
        const expected = req.headers["x-gather-account"];
        if ((expected && expected !== session.user.id) || (req.method !== "GET" && expected !== session.user.id))
          return json(res, 409, { error: "Your account changed. Reload the page before changing friendships.", code: "ACCOUNT_CHANGED" });
        const shared = /^\/friends\/people\/([^/]+)\/connections$/.exec(route);
        if (shared && req.method === "GET")
          return json(res, 200, { accountId: session.user.id, ...await connections(session.client, session.user.id, shared[1], url.searchParams) });
        if (route === "/friends/people" && req.method === "GET")
          return json(res, 200, { accountId: session.user.id, ...await people(session.client, url.searchParams) });
        if (route === "/friends/requests" && req.method === "POST") {
          const recipient = friendBody(await body(req), true);
          return json(res, 200, { accountId: session.user.id, person: await sendRequest(session.client, session.user.id, recipient) });
        }
        const response = /^\/friends\/requests\/([^/]+)\/(accept|deny)$/.exec(route);
        if (response && req.method === "POST") {
          friendBody(await body(req));
          return json(res, 200, { accountId: session.user.id, person: await respondRequest(session.client, session.user.id, response[1], response[2] === "accept") });
        }
        const cancellation = /^\/friends\/requests\/([^/]+)$/.exec(route);
        if (cancellation && req.method === "DELETE") {
          friendBody(await body(req));
          return json(res, 200, { accountId: session.user.id, person: await cancelRequest(session.client, session.user.id, cancellation[1]) });
        }
        const removal = /^\/friends\/([^/]+)$/.exec(route);
        if (removal && req.method === "DELETE") {
          friendBody(await body(req));
          return json(res, 200, { accountId: session.user.id, person: await removeFriend(session.client, session.user.id, userId(removal[1])) });
        }
        return json(res, 405, { error: "Unsupported friendship operation." });
      }

      // Read-only aggregate for the existing Saved/home pages.
      if (route === "/state") {
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Please sign in again." });
        if (req.method !== "GET") {
          res.setHeader("Allow", "GET");
          return json(res, 405, { error: "Bulk plan writes are no longer supported. Reload Gather and use the event buttons." });
        }
        const owner = await profileId(session.client, session.user.id);
        return json(res, 200, { accountId: session.user.id, state: await readPlans(session.client, owner) });
      }

      // Analytics uses the same verified user JWT and origin protection as plan writes.
      const viewRoute = /^\/events\/([^/]+)\/view$/.exec(route);
      if (viewRoute) {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return json(res, 405, { error: "Use POST to log an event view." });
        }
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to log an event view." });
        if (req.headers["x-gather-account"] !== session.user.id)
          return json(res, 409, { error: "Your account changed. Reload before continuing.", code: "ACCOUNT_CHANGED" });
        await logEventView(session.client, session.user.id, viewRoute[1], await body(req));
        return json(res, 201, { logged: true });
      }

      // Idempotent per-event writes cannot erase plans for unrelated events.
      const planRoute = /^\/events\/([^/]+)\/(bookmark|rsvp)$/.exec(route);
      if (planRoute) {
        if (req.method !== "PUT") {
          res.setHeader("Allow", "PUT");
          return json(res, 405, { error: "Use PUT to update this event." });
        }
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to save your plans." });
        if (req.headers["x-gather-account"] && req.headers["x-gather-account"] !== session.user.id)
          return json(res, 409, { error: "Your account changed in another tab. Reload before saving." });
        const [, eventId, kind] = planRoute;
        const field = kind === "bookmark" ? "bookmarked" : "going";
        const value = planInput(eventId, await body(req), field);
        const owner = await profileId(session.client, session.user.id);
        return json(res, 200, await writePlan(session.client, owner, eventId, kind, value));
      }
      return json(res, 404, { error: "Endpoint not found." });
    }

    // Non-API requests serve files from the public directory.
    // Dedicated page routes follow the same static HTML mapping.
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "Method not allowed." });
    const pageRoute = /^\/(events|login|signup|settings|recover)\/?$/.exec(url.pathname);
    if (pageRoute) url.pathname = `/${pageRoute[1] === "settings" ? "login" : pageRoute[1]}.html`;
    let decodedPath;
    try { decodedPath=decodeURIComponent(url.pathname); }
    catch { throw authFailure("Invalid page path."); }
    const path = resolve(root, "." + (decodedPath === "/" ? "/index.html" : decodedPath));
    if (!path.startsWith(root + "/")) return json(res, 403, { error: "Forbidden" });
    const recoveryPage=path === resolve(root,"recover.html");
    if (recoveryPage) {
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Referrer-Policy","no-referrer");
      res.setHeader("X-Frame-Options","DENY");
      res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }

    try {
      const content = await readFile(path);
      const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" }[extname(path)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": recoveryPage ? "no-store" : "no-cache" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      return json(res, 404, { error: "Page not found." });
    }
  } catch (e) {
    console.error("Request failed:", e.code || e.name || "Error", ...(e.databaseCode ? ["Supabase code:", e.databaseCode] : []));
    return json(res, e.status || 500, { error: e.status ? e.message : "The request could not be completed.", ...(e.status && e.code ? { code: e.code } : {}) });
  }
});

export default function handler(req, res) {
  return server.listeners("request")[0](req, res);
}

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  server.listen(port, () =>
    console.log(`Gather: http://localhost:${port} (${configured ? "Supabase" : "demo"} mode)`)
  );
}
