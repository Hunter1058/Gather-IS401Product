import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";


const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_KEY;
const configured = Boolean(supabaseUrl && publishableKey);
const production = process.env.NODE_ENV === "production";
if (Boolean(supabaseUrl) !== Boolean(publishableKey))
  throw Error(
    "Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither for demo mode.",
  );
if (publishableKey?.startsWith("sb_secret_"))
  throw Error("Use a publishable key, never a secret key.");
if (publishableKey?.startsWith("eyJ")) {
  try {
    const role = JSON.parse(
      Buffer.from(publishableKey.split(".")[1], "base64url").toString(),
    ).role;
    if (role === "service_role")
      throw Error("Use an anon/publishable key, never service_role.");
  } catch (e) {
    if (e.message.includes("service_role")) throw e;
  }
}
const makeClient = () =>
  createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const publicClient = configured ? makeClient() : null;
// Session tokens remain server-side. Restarting Node signs users out; use a shared
// session store before deploying multiple processes/instances.
const sessions = new Map(),
  attempts = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions)
    if (now - s.seen > SESSION_TTL) sessions.delete(id);
  for (const [id, s] of attempts)
    if (now - s.since > 15 * 60 * 1000) attempts.delete(id);
}, 60000).unref();
const userView = (u) =>
  u
    ? {
        id: u.id,
        email: u.email,
        name: String(
          u.user_metadata?.name || u.email?.split("@")[0] || "Student",
        ).slice(0, 60),
      }
    : null;
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function cookie(id, maxAge = 604800) {
  return `gather_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
}
function sid(req) {
  return /(?:^|;\s*)gather_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || "",
  )?.[1];
}
async function signedIn(req) {
  let id = sid(req),
    session = sessions.get(id);
  if (!session || Date.now() - session.seen > SESSION_TTL) return null;
  const { data: sd, error: se } = await session.client.auth.getSession();
  if (se || !sd.session) {
    sessions.delete(id);
    return null;
  }
  const { data, error } = await session.client.auth.getUser();
  if (error || !data.user) {
    sessions.delete(id);
    return null;
  }
  session.seen = Date.now();
  return { ...session, user: data.user };
}
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536)
      throw Object.assign(Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw Object.assign(Error("Invalid JSON."), { status: 400 });
  }
}
function validState(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const arrays = ["saved", "rsvp", "attended", "friends", "interests"];
  if (
    !arrays.every(
      (k) =>
        Array.isArray(s[k]) &&
        s[k].length <= 500 &&
        s[k].every((v) => typeof v === "string" && v.length <= 100),
    )
  )
    return false;
  for (const k of ["reminders", "surveys"])
    if (
      !s[k] ||
      typeof s[k] !== "object" ||
      Array.isArray(s[k]) ||
      Object.keys(s[k]).length > 500
    )
      return false;
  if (
    !Object.entries(s.reminders).every(
      ([k, v]) => /^[a-z0-9-]{1,80}$/.test(k) && ["60", "1440"].includes(v),
    )
  )
    return false;
  return Object.entries(s.surveys).every(
    ([k, v]) =>
      /^[a-z0-9-]{1,80}$/.test(k) &&
      v &&
      ["1", "2", "3", "4", "5"].includes(String(v.rating)) &&
      [
        "Yes, completely",
        "Mostly yes",
        "Neutral",
        "Mostly no",
        "No, not at all",
      ].includes(v.accuracy) &&
      ["Yes", "No"].includes(v.again) &&
      typeof v.feedback === "string" &&
      v.feedback.length <= 2000,
  );
}
function validEvent(row) {
  const e = row.payload;
  if (
    !e ||
    !/^[a-z0-9-]{1,80}$/.test(row.id) ||
    ![
      "Social",
      "Arts",
      "Career",
      "Service",
      "Sports",
      "Culture",
      "Spiritual",
    ].includes(e.category)
  )
    return false;
  return (
    [
      "name",
      "category",
      "location",
      "date",
      "start",
      "end",
      "club",
      "major",
      "description",
      "poster",
    ].every((k) => typeof e[k] === "string") &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    /^\d{2}:\d{2}$/.test(e.start) &&
    /^\d{2}:\d{2}$/.test(e.end) &&
    typeof e.price === "number" &&
    e.price >= 0 &&
    typeof e.food === "boolean" &&
    Array.isArray(e.friends) &&
    e.friends.every((f) => typeof f === "string")
  );
}
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] !== "cross-site";
  return origin === (process.env.APP_ORIGIN || `http://${req.headers.host}`);
}
export const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(req.method) && !isSameOrigin(req))
        return json(res, 403, { error: "Request origin is not allowed." });
      const route = url.pathname.slice(4);
      if (route === "/config" && req.method === "GET")
        return json(res, 200, { mode: configured ? "supabase" : "demo" });
      if (route === "/health" && req.method === "GET")
        return json(res, 200, { ok: true });
      if (!configured)
        return json(res, 503, {
          error:
            "Supabase is not configured. The frontend is running in demo mode.",
        });
      if (route === "/events" && req.method === "GET") {
        const { data, error } = await publicClient
          .from("events")
          .select("id,payload,ends_at")
          .order("starts_at", { ascending: true })
          .limit(500);
        if (error) throw error;
        return json(res, 200, {
          events: data
            .filter(validEvent)
            .map((r) => ({ ...r.payload, id: r.id, ends_at: r.ends_at })),
        });
      }
      if (
        ["/auth/login", "/auth/signup"].includes(route) &&
        req.method === "POST"
      ) {
        const ip = req.socket.remoteAddress;
        const a = attempts.get(ip) || { count: 0, since: Date.now() };
        if (Date.now() - a.since > 15 * 60 * 1000) {
          a.count = 0;
          a.since = Date.now();
        }
        a.count++;
        attempts.set(ip, a);
        if (a.count > 20)
          return json(res, 429, {
            error: "Too many attempts. Please try again in 15 minutes.",
          });
        const b = await body(req);
        if (
          typeof b.email !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
          b.email.length > 254 ||
          typeof b.password !== "string" ||
          b.password.length < 8 ||
          b.password.length > 128
        )
          return json(res, 400, {
            error: "Enter a valid email and a password of 8–128 characters.",
          });
        if (
          route === "/auth/signup" &&
          (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60)
        )
          return json(res, 400, {
            error: "Enter your name (up to 60 characters).",
          });
        const client = makeClient();
        const credentials = { email: b.email, password: b.password };
        const result =
          route === "/auth/signup"
            ? await client.auth.signUp({
                ...credentials,
                options: { data: { name: b.name.trim() } },
              })
            : await client.auth.signInWithPassword(credentials);
        if (result.error)
          return json(res, 400, {
            error:
              route === "/auth/login"
                ? "Email or password is incorrect."
                : result.error.message,
          });
        if (!result.data.session)
          return json(res, 200, {
            user: null,
            message: "Check your email to confirm your account, then sign in.",
          });
        const old = sid(req);
        if (old) sessions.delete(old);
        const id = randomBytes(32).toString("hex");
        sessions.set(id, { client, seen: Date.now() });
        res.setHeader("Set-Cookie", cookie(id));
        return json(res, 200, { user: userView(result.data.user) });
      }
      if (route === "/auth/logout" && req.method === "POST") {
        const id = sid(req),
          session = sessions.get(id);
        if (session) await session.client.auth.signOut({ scope: "local" });
        sessions.delete(id);
        res.setHeader("Set-Cookie", cookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (route === "/auth/session" && req.method === "GET") {
        const session = await signedIn(req);
        return json(res, 200, { user: userView(session?.user) });
      }
      if (route === "/state") {
        const session = await signedIn(req);
        if (!session) return json(res, 401, { error: "Please sign in again." });
        if (req.method === "GET") {
          const { data, error } = await session.client
            .from("user_state")
            .select("state")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (error) throw error;
          return json(res, 200, { state: data?.state || {} });
        }
        if (req.method === "PUT") {
          const input = await body(req);
          if (!validState(input))
            return json(res, 400, {
              error: "Your saved plan contains invalid values.",
            });
          const state = Object.fromEntries(
            [
              "saved",
              "rsvp",
              "attended",
              "friends",
              "interests",
              "reminders",
              "surveys",
            ].map((k) => [k, input[k]]),
          );
          const { error } = await session.client
            .from("user_state")
            .upsert(
              {
                user_id: session.user.id,
                state,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            );
          if (error) throw error;
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: "Endpoint not found." });
    }
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Method not allowed." });
    const path = resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(root + "/"))
      return json(res, 403, { error: "Forbidden" });
    try {
      const content = await readFile(path);
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[extname(path)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      return json(res, 404, { error: "Page not found." });
    }
  } catch (e) {
    console.error("Request failed:", e.code || e.name || "Error");
    return json(res, e.status || 500, {
      error: e.status
        ? e.message
        : "The request could not be completed. Please try again.",
    });
  }
});
if (process.env.NODE_ENV !== "test")
  server.listen(port, () =>
    console.log(
      `Gather: http://localhost:${port} (${configured ? "Supabase" : "demo"} mode)`,
    ),
  );
  
