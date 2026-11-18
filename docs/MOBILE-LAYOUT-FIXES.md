# Mobile navigation and layout fixes

## Result

- The mobile drawer has an actual fixed backdrop. Its outside-click capture
  listener consumes the dismissal click before any event button/link handler can
  run. Background content is inert and body scrolling is locked while open.
- Close, Escape, outside click, drawer link navigation and resizing to a desktop
  header restore the page. Existing inert states and body overflow are preserved.
  Tab/Shift+Tab cycle inside the drawer; closing returns focus to its trigger.
- Discover uses a smaller featured-art region, reduced copy padding, and compact
  horizontal recommendation cards on both desktop and mobile. A featured event
  with no image gets a small icon column instead of a large empty art panel.
  Titles, event date/time, location, bookmark and View event remain available.
- Friends become full-width, content-sized rows at 720px and below. Identity and
  relationship text sit beside the avatar and actions wrap below the text. The
  forced square aspect ratio and auto spacing are removed on mobile; desktop
  tiles are unchanged. Action buttons retain a minimum 44px height.

## Files and integration

`public/mobile-nav.js` is loaded before page controllers in index, events, login,
signup and recover HTML. Each existing toggle delegates to it. Recovery retains
its isolated account/recovery code and uses the same drawer behavior.

`public/app.js` also closes the shared drawer on internal page navigation and
labels featured cards that have no photo for the compact icon layout.

`public/styles.css` supplies the backdrop, scrollable narrow-screen drawer and
scoped Discover/mobile Friends layout rules. Event list card styling, friend
privacy, suggestions, database persistence, sharing and authentication are not
otherwise changed. No database migration, API, dependency or environment changes
are required by this patch.

## Validation completed during development

- 141 runnable Node tests passed, including new drawer capture/focus/restoration
  checks and existing page/HTTP/state tests.
- The full npm test attempt could not run four existing files because
  `@electric-sql/pglite` is not installed in the execution environment:
  event-sharing-db.test.js, event-sharing-http.test.js,
  event-sharing-ui.test.js and okr-repair.test.js. Run the full suite after
  installing the repository's already-declared dependencies on your Mac.
- Changed JavaScript syntax and git whitespace checks passed.
- Browser tests were extended for real drawer interception, background inertness,
  outside click, Escape, close button, mobile friend row sizing and compact
  Discover cards. Browser execution and visual checks remain required locally;
  Chromium cannot start in this execution environment.
- The Discover fixture now has enough events to exercise recommendations outside
  the five featured slides. Its previous two-event fixture incorrectly expected
  two recommendations even though both events were featured.

## Local checks before committing

```sh
npm ci
npm test
npm run test:browser
npm run test:friends:browser
npm run test:auth:browser
npm run test:sharing:browser
npm run dev
```

If needed, install the browser using `npx playwright install chromium` after
`npm ci`. This patch does not change package.json or package-lock.json.

Check the running app at 320px, 390px, 720px, 768px and desktop widths, and on a
physical phone:

1. Open the drawer on Discover, Events, Friends and the account/recovery pages.
   Tap outside it over bookmark, share, RSVP, account and friend actions. Only
   the drawer should close: no modal, write, navigation or action should occur.
   A subsequent intentional tap after dismissal should work normally.
2. Verify Close menu, Escape, Tab/Shift+Tab, links, narrow/short-screen drawer
   scrolling and restoration of normal page scrolling after dismissal.
3. Discover: inspect featured events with/without images and recommendation
   cards. Check long names/locations, no events and a small event list where all
   events belong to the slideshow. The existing rule excluding all featured
   events from recommendations remains in place; it may leave no recommendation
   section when there are five or fewer upcoming events.
4. Friends: check suggestions, friends and requests with long names, photos,
   private/missing profiles, incoming Accept/Deny and failed-action messages.
   Check that text/actions fit without horizontal page scrolling and confirm
   add/cancel/accept/deny/remove and the profile photo viewer still work.

After validation, review the exact changed files, commit on a feature branch,
push, and open a pull request. No Supabase SQL needs to be run for these changes.
