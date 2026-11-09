/*
 * Gather Node.js server
 * ---------------------
 * Serves the static website, exposes the JSON API, validates Supabase
 * configuration, manages short-lived authenticated sessions, and proxies data
 * operations that require a signed-in user.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { authSessions } from "./lib/auth-session.js";
import { isSameOrigin } from "./lib/request-origin.js";
import { people, userId, friendBody, sendRequest, cancelRequest, removeFriend } from "./lib/friends.js";
import { planInput, profileId, readPlans, writePlan } from "./lib/event-plans.js";

// Server and Supabase configuration. Supabase credentials must be provided together.
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_KEY;
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
// Best-effort per-worker throttle; production-wide abuse limits belong at the
// platform/Supabase layer rather than relying on this process-local counter.
const attempts = new Map();
setInterval(() => {
  for (const [id, attempt] of attempts)
    if (Date.now() - attempt.since > 15 * 60 * 1000) attempts.delete(id);
}, 60000).unref();

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
        const { data, error } = await publicClient
          .from("Events")
          .select("EventID, EventName, EventLocation, EventDate, EventTime, EventDescription, EventImage, CampusLocation, categoryLinks:Event_Category_Linking_Table(category:EventCategory(EventCatagory))")          .order("EventDate", { ascending: true })
          .limit(500);
        
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
            return {
              id: String(r.EventID),
              name: r.EventName || "Campus event",
              category: categories[0] || "Campus event",
              categories,
              location: r.EventLocation,
              campusLocation: r.CampusLocation,
              date: r.EventDate,
              start: r.EventTime,
              description: r.EventDescription,
              imageUrl: r.EventImage || null, 
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

      // Login and account creation through Supabase Auth.
      if (["/auth/login", "/auth/signup"].includes(route) && req.method === "POST") {
        const ip = req.socket.remoteAddress;
        const a = attempts.get(ip) || { count: 0, since: Date.now() };
        if (Date.now() - a.since > 15 * 60 * 1000) { a.count = 0; a.since = Date.now(); }
        a.count++;
        attempts.set(ip, a);
        if (a.count > 20) return json(res, 429, { error: "Too many attempts." });

        const b = await body(req);
        if (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || typeof b.password !== "string" || b.password.length < 8)
          return json(res, 400, { error: "Enter a valid email and password." });

        const client = makeClient();
        const credentials = { email: b.email, password: b.password };
        const result = route === "/auth/signup"
            ? await client.auth.signUp({ ...credentials, options: { data: { name: b.name?.trim() } } })
            : await client.auth.signInWithPassword(credentials);

        if (result.error) return json(res, 400, { error: result.error.message });
        if (!result.data.session) return json(res, 200, { user: null, message: "Check your email." });

        sessionCookies.save(res, result.data.session);
        return json(res, 200, { user: userView(result.data.user) });
      }

      // Sign-out invalidates the server session and clears the browser cookie.
      if (route === "/auth/logout" && req.method === "POST") {
        const session = await sessionCookies.restore(req, res);
        if (session) {
          const { error } = await session.client.auth.signOut({ scope: "local" });
          if (error) throw Object.assign(Error("Unable to sign out. Try again."), { status: 503 });
        }
        sessionCookies.clear(res);
        return json(res, 200, { ok: true });
      }

      // Restore an account from the browser session on page refresh.
      if (route === "/auth/session" && req.method === "GET") {
        const session = await sessionCookies.restore(req, res);
        return json(res, 200, { user: userView(session?.user) });
      }

      // Friend actions use the verified per-request account client. The header
      // protects against acting from a tab showing a different signed-in user.
      if (route.startsWith("/friends/")) {
        const session = await sessionCookies.restore(req, res);
        if (!session) return json(res, 401, { error: "Sign in to manage friendships." });
        const expected = req.headers["x-gather-account"];
        if ((expected && expected !== session.user.id) || (req.method !== "GET" && expected !== session.user.id))
          return json(res, 409, { error: "Your account changed. Reload the page before changing friendships.", code: "ACCOUNT_CHANGED" });
        if (route === "/friends/people" && req.method === "GET")
          return json(res, 200, { accountId: session.user.id, ...await people(session.client, url.searchParams) });
        if (route === "/friends/requests" && req.method === "POST") {
          const recipient = friendBody(await body(req), true);
          return json(res, 200, { accountId: session.user.id, person: await sendRequest(session.client, session.user.id, recipient) });
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
    const pageRoute = /^\/(events|login|signup)\/?$/.exec(url.pathname);
    if (pageRoute) url.pathname = `/${pageRoute[1]}.html`;
    const path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root + "/")) return json(res, 403, { error: "Forbidden" });

    try {
      const content = await readFile(path);
      const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" }[extname(path)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      return json(res, 404, { error: "Page not found." });
    }
  } catch (e) {
    console.error("Request failed:", e.code || e.name || "Error");
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
