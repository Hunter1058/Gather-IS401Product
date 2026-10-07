import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
const users = {
  one: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "one@example.com",
    user_metadata: { name: "One" },
  },
  two: {
    id: "22222222-2222-4222-8222-222222222222",
    email: "two@example.com",
    user_metadata: { name: "Two" },
  },
};
const states = new Map();
const token = (n) =>
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ) +
  "." +
  Buffer.from(
    JSON.stringify({
      sub: users[n].id,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url") +
  ".mock";
const stub = http.createServer(async (req, res) => {
  let chunks = [];
  for await (const c of req) chunks.push(c);
  let b = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  const reply = (x, s = 200) => {
    res.statusCode = s;
    res.end(JSON.stringify(x));
  };
  let n = Object.keys(users).find(
    (n) => req.headers.authorization === "Bearer " + token(n),
  );
  if (url.pathname === "/auth/v1/token") {
    let n = b.email?.split("@")[0];
    if (!users[n] || b.password !== "password123")
      return reply({ error: "invalid_grant", msg: "Invalid credentials" }, 400);
    return reply({
      access_token: token(n),
      refresh_token: "refresh-" + n,
      expires_in: 3600,
      token_type: "bearer",
      user: users[n],
    });
  }
  if (url.pathname === "/auth/v1/user")
    return n ? reply(users[n]) : reply({ msg: "Unauthorized" }, 401);
  if (url.pathname === "/auth/v1/logout") return reply({});
  if (url.pathname === "/rest/v1/events") return reply([]);
  if (url.pathname === "/rest/v1/user_state") {
    if (!n) return reply({ message: "Unauthorized" }, 401);
    if (req.method === "GET") {
      assert.equal(url.searchParams.get("user_id"), "eq." + users[n].id);
      return reply(states.has(n) ? [{ state: states.get(n) }] : []);
    }
    if (req.method === "POST") {
      assert.equal(b.user_id, users[n].id);
      states.set(n, b.state);
      return reply(null);
    }
  }
  reply({ message: "Unknown mock endpoint" }, 404);
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = `http://127.0.0.1:${stub.address().port}`;
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
const { server } = await import("../server.js");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  stub.close();
});
const request = (path, method = "GET", b, c) =>
  fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(c ? { Cookie: c } : {}),
    },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
let firstCookie, secondCookie;
test("unauthenticated state cannot be read or written", async () => {
  assert.equal((await request("/state")).status, 401);
  assert.equal((await request("/state", "PUT", {})).status, 401);
});
test("login uses an opaque HttpOnly cookie, not browser tokens", async () => {
  let bad = await request("/auth/login", "POST", {
    email: "one@example.com",
    password: "badbadbad",
  });
  assert.equal(bad.status, 400);
  let r = await request("/auth/login", "POST", {
    email: "one@example.com",
    password: "password123",
  });
  assert.equal(r.status, 200);
  firstCookie = r.headers.get("set-cookie");
  assert.match(firstCookie, /HttpOnly/);
  assert.match(firstCookie, /SameSite=Lax/);
  assert.match(firstCookie, /gather_session=[a-f0-9]{64}/);
  assert.equal((await r.json()).user.id, users.one.id);
  assert.equal(
    (await (await request("/auth/session", "GET", null, firstCookie)).json())
      .user.id,
    users.one.id,
  );
});
test("saved state is scoped to the verified user, with separate account state", async () => {
  const state = {
    saved: ["fall-social"],
    rsvp: [],
    attended: [],
    friends: [],
    interests: ["Arts"],
    reminders: {},
    surveys: {},
  };
  assert.equal(
    (await request("/state", "PUT", state, firstCookie)).status,
    200,
  );
  assert.deepEqual(
    (await (await request("/state", "GET", null, firstCookie)).json()).state,
    state,
  );
  let r = await request("/auth/login", "POST", {
    email: "two@example.com",
    password: "password123",
  });
  secondCookie = r.headers.get("set-cookie");
  assert.deepEqual(
    (await (await request("/state", "GET", null, secondCookie)).json()).state,
    {},
  );
  assert.equal(
    (
      await request(
        "/state",
        "PUT",
        { ...state, saved: "invalid" },
        firstCookie,
      )
    ).status,
    400,
  );
});
test("logout invalidates the server session", async () => {
  assert.equal(
    (await request("/auth/logout", "POST", {}, firstCookie)).status,
    200,
  );
  assert.equal((await request("/state", "GET", null, firstCookie)).status, 401);
});
