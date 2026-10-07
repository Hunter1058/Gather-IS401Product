import { chromium } from "playwright";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_PUBLISHABLE_KEY;
const { server } = await import("../server.js");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? {
        executablePath: process.env.BROWSER_EXECUTABLE,
        args: [
          "--no-sandbox",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--no-zygote",
          "--single-process",
        ],
      }
    : {}),
});
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p.waitForSelector(".home-layout");
  await p.getByRole("button", { name: "Pause slideshow" }).click();
  await p.getByRole("button", { name: "Events", exact: true }).click();
  await p.getByLabel("Search events").fill("nonexistent");
  assert(
    await p.getByText("No upcoming events match current filters").isVisible(),
  );
  await p.getByRole("button", { name: "Clear filters", exact: true }).click();
  await p.getByRole("button", { name: /Filters/ }).click();
  await p.getByLabel("Has food").check();
  await p.getByLabel("Free events", { exact: true }).check();
  assert.equal(await p.locator("#results .card").count(), 3);
  await p.getByRole("button", { name: "Clear filters", exact: true }).click();
  await p
    .getByRole("button", { name: "View event ↗", exact: true })
    .first()
    .click();
  await p.getByRole("button", { name: "RSVP to event", exact: true }).click();
  assert(
    await p.getByRole("button", { name: "✓ RSVP’d · Cancel" }).isVisible(),
  );
  const downloadPromise = p.waitForEvent("download");
  await p.getByLabel("Event reminder").selectOption("60");
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /reminder\.ics$/);
  await p.getByRole("button", { name: "Close event details" }).click();
  await p.getByRole("button", { name: "Saved", exact: true }).first().click();
  await p
    .getByRole("button", { name: "Past saved events", exact: true })
    .click();
  await p.getByRole("button", { name: "View & reflect ↗" }).click();
  await p.getByRole("button", { name: "Rate this event" }).click();
  await p.getByLabel("How satisfied were you?").selectOption("5");
  await p
    .getByLabel("Was the event as advertised?")
    .selectOption("Yes, completely");
  await p
    .getByLabel("Would you attend another event from this organizer?")
    .selectOption("Yes");
  await p.getByRole("button", { name: "Save reflection" }).click();
  assert(await p.getByRole("button", { name: "Edit reflection" }).isVisible());
  await p.getByRole("button", { name: "Close event details" }).click();
  await p.reload();
  assert(
    await p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("gather-v1")).surveys.past.rating ===
        "5",
    ),
  );
  await p.getByRole("button", { name: "Calendar", exact: true }).click();
  await p.getByRole("button", { name: "Next month" }).click();
  await p.getByRole("button", { name: "Previous month" }).click();
  await p.locator(".daynum").first().click();
  assert(await p.getByRole("button", { name: "Back to month" }).isVisible());
  await p.getByRole("button", { name: "Back to month" }).click();
  await p.getByRole("button", { name: "Sign in ↗" }).click();
  await p.getByLabel("Username", { exact: true }).fill("student");
  await p.getByLabel("Password", { exact: true }).fill("gather123");
  await p
    .locator("form.auth")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await p.waitForSelector(".home-layout");
  for (const width of [1440, 768, 390, 320]) {
    await p.setViewportSize({ width, height: 900 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "home overflow " + width,
    );
    await p.evaluate(() => go("calendar"));
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "calendar overflow " + width,
    );
    await p.evaluate(() => go("home"));
  }
  await p.setViewportSize({ width: 1440, height: 1080 });
  await p.screenshot({
    path: process.env.SCREENSHOT_DIR
      ? process.env.SCREENSHOT_DIR + "/gather-desktop.png"
      : "test-results-desktop.png",
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: process.env.SCREENSHOT_DIR
      ? process.env.SCREENSHOT_DIR + "/gather-mobile.png"
      : "test-results-mobile.png",
  });
  await p.evaluate(() => go("list"));
  await p
    .getByRole("button", { name: "View event ↗", exact: true })
    .first()
    .click();
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await p.screenshot({
    path: process.env.SCREENSHOT_DIR
      ? process.env.SCREENSHOT_DIR + "/gather-detail-mobile.png"
      : "test-results-detail.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: demo browsing, compound filters, RSVP, calendar download, past survey persistence, calendar navigation, login, four responsive widths, modal layout; no browser errors.",
  );
} finally {
  await browser.close();
  server.close();
}
