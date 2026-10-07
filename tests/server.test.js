import { test, after } from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_PUBLISHABLE_KEY;
const { server } = await import("../server.js");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
test("serves the app and identifies demo mode", async () => {
  let r = await fetch(base);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Gather/);
  assert.deepEqual(await (await fetch(base + "/api/config")).json(), {
    mode: "demo",
  });
});
test("server-only files are not public", async () => {
  for (const path of [
    "/.env",
    "/server.js",
    "/package.json",
    "/%2e%2e%2fserver.js",
  ]) {
    const r = await fetch(base + path);
    assert.ok([403, 404].includes(r.status));
  }
});
test("blocks cross-origin mutations and unavailable auth", async () => {
  assert.equal(
    (
      await fetch(base + "/api/state", {
        method: "PUT",
        headers: { Origin: "https://unrelated.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/auth/login", { method: "POST", body: "{}" }))
      .status,
    503,
  );
});
