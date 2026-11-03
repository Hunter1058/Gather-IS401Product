# RSVP and bookmarks: install and integration

## 1. Apply the database change

For the team's **existing Supabase project**, open **SQL Editor → New query**,
copy the entire contents of `supabase/migrations/20261102000000_event_plans.sql`,
and run it as the project owner. Apply this before starting the changed server.
Do not rerun `schema.sql` or `seed.sql` on an existing database.

For a **new empty project**, run `supabase/schema.sql`, then optionally
`supabase/seed.sql`. The current schema already includes the migration's setup.

The live database uses UUIDs for `User.UserID`, `Bookmark.UserID`, and
`RSVP.UserID`. The profile ID is the exact Supabase Auth account UUID. Signup and
backfill explicitly insert that UUID; there is no numeric profile ID, random
profile UUID, or additional AuthUserID column. The server resolves the profile
using the verified Auth ID, never a client-supplied owner.

Existing IDs and matching profiles/plans are preserved. If an existing profile
ID has no matching Auth account, the migration stops for ownership review rather
than assigning its records by email. Auth account deletion cascades through its
profile to its plans. The UUID types are validated before any table changes.

Categories use the existing many-to-many category and event-link tables. This
migration does not add a category column to Events. The server reads
`Event_Category_Linking_Table` → `EventCategory.EventCatagory` through their
foreign keys. Each API event includes a `categories` array and a compatible
single `category` value (first alphabetically, for color/icon styling). Labels
and filters use all categories; an unlinked event remains visible with a
`Campus event` fallback. Public read policies/grants cover both category tables;
category editing remains restricted to administrative access.

**Existing linking-table constraint:** the reported `Event_Category_pkey` is
only on `EventID`, so the live database currently permits one category per
event. The RSVP/bookmark migration intentionally preserves that constraint.
To enable multiple categories, the team should separately review changing the
primary key to `(EventID, EventCatID)`, including NULL link rows and any foreign
keys referencing the old key. This is not required to save bookmarks/RSVPs.
The API accepts both the current one-to-one embedding shape and the future
one-to-many shape; the fresh-install schema uses the composite primary key.

The migration enforces one bookmark and one RSVP per user/event. Canceling an
RSVP updates `RSVPGoing` to false; removing a bookmark deletes that pair only.
RLS and grants restrict both tables to the owner's records. Clients cannot
create/reassign profile identity, publish events, or read the legacy Password
column. No password values are stored by this feature.

If the migration stops, it rolls back its table/policy changes. It does not
silently remove old data or teammate policies. Use these read-only checks to
review the reported issue:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('User', 'Events', 'Bookmark', 'RSVP', 'EventCategory', 'Event_Category_Linking_Table');

select "UserID", "EventID", count(*)
from public."Bookmark" group by "UserID", "EventID" having count(*) > 1;
select "UserID", "EventID", count(*)
from public."RSVP" group by "UserID", "EventID" having count(*) > 1;

select * from public."Bookmark" where "UserID" is null or "EventID" is null;
select * from public."RSVP"
where "UserID" is null or "EventID" is null or "RSVPGoing" is null;
```

Resolve the reported data or policy conflict deliberately, then rerun the
migration. Run the whole migration as one transaction. Do not run selected fragments.

## 2. Run the app

Keep your existing `.env`. For a new checkout, copy `.env.example` to `.env` and
fill in the Supabase URL and publishable/anon key. Do not commit `.env` or use a
service-role key. With Node 22.15+ (or Node 24):

```sh
npm ci
npm start
```

Open `http://localhost:3000/events`, sign in using an actual Supabase account,
and test the buttons. In production, set `APP_ORIGIN` to the exact HTTPS origin
and `NODE_ENV=production` for secure session cookies.

Sessions retain the existing in-memory server design. Server restarts can
require sign-in again; the plans themselves stay in Supabase and reload after
sign-in. Multiple server instances would need shared session storage, which is
outside this change.

## 3. Verify with two accounts

1. Sign in as A. Bookmark one event and mark it Going. Both should stay selected
   after refresh. Clicking an action on a list card should not open a dialog.
2. Open an event's details; its controls should agree with the list. Check Saved
   from the navigation: it reads the same bookmark records.
3. Sign out, then sign in as B (or use a separate browser profile). A's plans
   must not appear. Save a different event as B.
4. Sign back in as A. Its original plans should remain. Cancel its RSVP and
   remove its bookmark. B's records must remain unchanged.
5. Verify the database directly as an administrator: canceled RSVPs have
   `RSVPGoing = false`; bookmarks are removed only for the intended pair.
6. Check the same operations against the Supabase API as signed-in A and B to
   verify actual database RLS isolation; mocked tests alone cannot prove RLS.
7. Check narrow/mobile and keyboard layouts. The bookmark is in the top corner;
   Going uses a soft secondary treatment. No new Share button is included.

## API contract

Requests use the existing HttpOnly session cookie. Set `X-Gather-Account` to the
Auth account ID currently shown in the page to reject writes from stale tabs
that are displaying a different account. This is a consistency check, not an
identity credential: the server always uses the verified session.

- `GET /api/state`: `{ accountId, state: { saved: [eventId], rsvp: [eventId], ... } }`.
  RSVP state includes only `RSVPGoing = true`. Failed reads return an error;
  they are never converted into empty plans.
- `PUT /api/events/:eventId/bookmark`: body `{ "bookmarked": true }` or false;
  response `{ eventId, bookmarked }`.
- `PUT /api/events/:eventId/rsvp`: body `{ "going": true }` or false;
  response `{ eventId, going }`.
- IDs are positive decimal strings. Bodies accept exactly the named boolean.
  A supplied `UserID`, extra keys, or string booleans are rejected.
- Repeating a desired state is idempotent. Different events are independent;
  no request erases or rewrites the user's entire plan collection.
- `PUT /api/state` now returns 405. Old tabs must reload rather than submit a
  stale full list. The included legacy home/Saved page has been updated too.

The existing home shell's other prototype preferences have no database tables.
They now explicitly report that they last for the current visit rather than
sending them through a destructive bookmark/RSVP write. Their database features
have not been implemented by this task.

## Share-button handoff

`card(event)` in `public/events.js` renders an empty
`<div class="event-share-slot" data-event-share-slot="EVENT_ID"></div>`.
Your coworker can put their button there and give it `class="primary"` to make
it the dominant action. No placeholder button, Share handler, or Share API was
added. The existing legacy Share behavior was left in place.

Cards re-render after filtering and plan changes. Insert the Share markup into
the card renderer rather than injecting it once, and attach a delegated click
handler to the stable `#results` parent. Both cards and slots carry the event ID.
Bookmark and Going remain soft secondary actions even when selected. Labels,
`aria-pressed`, disabled/pending states, and focus restoration support keyboards
and assistive technology. Real-browser layout verification is still required.

## Future bookmarks/friends pages

`GET /api/state` already supplies bookmarks and current Going events for the
signed-in account. A bookmarks page can join the bookmark EventID values with
the event listing. The home shell's Saved page already does this.

The database stores durable RSVP rows suitable for a future friends feature.
Friend access is **not** granted yet. Define accepted friendship visibility and
add a carefully scoped read policy/endpoint later; never make every RSVP public.
Filter friend plans by `RSVPGoing = true`. Review grants/RLS on the existing
Friends table as part of that future feature.

## Tests and limitations

```sh
npm test
npx playwright install chromium
npm run test:browser
```

`npm test` exercises the plan service, HTTP authentication/validation/UUID ownership
mapping, same-origin checks, and page/controller behavior using test doubles.
The HTTP test uses Node's module hooks and requires Node 22.15+; older Node
versions skip that one test. No real Supabase account or credentials are used.

The browser suite uses mocked APIs to check actual DOM behavior, reload, errors,
pending state, focus, Saved integration, stale accounts, mobile sizes, and guest
redirect. Run it locally after installing its browser. It was prepared but could
not run in the delivery environment: browser download and npm package downloads
were blocked. The migration and real RLS policies also need verification in your
Supabase project; they were not applied to a live database here.

## Commit to the real GitHub repository

The ZIP snapshot did not include Git history, and the GitHub connection was
unavailable. The delivery includes a patch based on exactly that snapshot and
an updated source folder. It has **not** been pushed to GitHub.

Prefer applying the patch in your normal clone so your coworker's unrelated
changes are preserved. Commit or stash your current work first, then:

```sh
git pull --ff-only
git switch -c feature/event-rsvp-bookmarks
git apply --check /path/to/gather-event-plans.patch
git apply /path/to/gather-event-plans.patch
```

If the check reports a conflict, stop and reconcile the changed files; do not
replace your coworker's work with the full ZIP. After applying SQL and testing:

```sh
git add server.js lib/event-plans.js public/app.js public/events.js public/events.html public/index.html public/event-plans.js public/styles.css supabase/schema.sql supabase/seed.sql supabase/migrations/20261102000000_event_plans.sql tests/event-plans.test.js tests/events-ui.test.js tests/http.test.js tests/saved-page.test.js tests/helpers/database.js tests/browser.mjs docs/EVENT-PLANS-SETUP.md README.md .env.example .gitignore
git commit -m "Add account-specific event bookmarks and RSVPs"
git push -u origin feature/event-rsvp-bookmarks
```

Open a pull request into the team's main branch and review the Share integration
with its owner. The local packaging commit uses a neutral local-only identity;
the commands above use your configured Git identity in the actual repository.
