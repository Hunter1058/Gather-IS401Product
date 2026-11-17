# Suggestion undo and shared connection details

Apply this FOLLOW-UP to the current recommendation feature, before committing
that feature if it is still uncommitted. Its baseline includes the recommendation
patch already applied and validated. Do not apply to older main without it.
No GitHub changes or production database writes have been made by this package.

## UX changes

Sending a request keeps the suggestion card visible and changes its action to
Cancel request. Cancelling changes it back to Add friend. Confirmed state and
request history still save immediately to Supabase; only card visibility is kept
for the current visit. Refreshing on the same suggestions tab restores each kept
card's current server state instead of dropping it. Leaving Friends, changing
Friends tabs/search, reloading the browser, or changing accounts resets that
visit. Returning uses normal server recommendation eligibility again.

A failed/uncertain save still requires Refresh status. Buttons stay disabled
while pending, and duplicate clicks are suppressed. The Requests and My Friends
tabs continue to remove cards that no longer belong to those lists.

Click a person's name or the non-button part of a friend card to open a native
dialog. The name is a real keyboard-accessible button; friendship action buttons
perform only their action and do not open the dialog. The dialog shows:

- Mutual accepted friends whose profiles are public, with name and username.
- Events both the caller and target currently have RSVPGoing=true for, with
  names, dates, locations, and links to the normal event page.
- Matching Event interests selected in profile settings.

Only direct mutual friends are named. Third-degree suggestions can have no direct
mutual friend and no shared items; this view does not expose complete connection
paths. Only intersections are returned, never the target's full lists. This
extends the previous count-only presentation to shared item details as requested.

Private targets show their username/private label and a privacy message; their
shared details remain hidden. Private mutual profiles are excluded as well.
There is no email disclosure or profile privacy setting change. Displayed text
is escaped and all IDs/cursors are validated. Bigint event/category IDs remain
strings so links and pagination do not lose precision.

Each section loads 10 items initially, with Load more. Requests are account-bound;
closing/navigating away ignores late results. Close/Escape returns focus to the
profile button when it still exists. Failed initial reads show Retry, not fake
empty results. A target becoming private during pagination hides the details.
Data is re-read on opening; no long-lived profile-detail cache is introduced.

## Apply locally

On your existing feature/friend-recommendations branch (with the first patch
already applied), check this follow-up without discarding/stashing that work:

```sh
git apply --check /absolute/path/gather-friend-connections.patch
git apply /absolute/path/gather-friend-connections.patch
git diff --check
npm test
npm run test:browser
npm run test:friends:browser
```

Expected Node suite: 75 passed. Stop on patch errors; do not overwrite newer UI
files. No npm dependency or environment setting changes are required.

## New SQL rehearsal

The recommendation migration is already installed. Do NOT rerun it or earlier
migrations/rehearsals.

Copy the ENTIRE supabase/tests/friend_connections_rehearsal.sql into Supabase
SQL Editor and run as postgres/project owner. This temporarily creates the new
read RPC and a guarded gather_connections_test schema with synthetic fixtures.
The builder clones the production SQL into that schema by changing only its
qualified relation names, tests shared intersections/false RSVPs/text IDs/
pagination/private targets/private mutuals/grants, and tests real schema reads.
It never changes real User, Auth, friendship, request, RSVP or interest records.
The final ROLLBACK removes the new function and all test fixtures.

Expected PASS: shared connections rehearsal completed; temporary function and fixtures will roll back.

Verify rollback in a new query:

```sql
select
  to_regprocedure('public.get_friend_connections(uuid,text,integer,text)') as connections_function,
  to_regnamespace('gather_connections_test') as temporary_test_schema;
```

Both must be NULL before installing. Stop on any rehearsal error.
Rebuild the generated file if sources are changed:

```sh
python3 supabase/tests/build_friend_connections_rehearsal.py
```

## Permanent installation

After rehearsal and rollback verification, copy and run ONLY the ENTIRE file:
supabase/migrations/20261113000000_friend_connections.sql

Run as postgres. Expected Success. No rows returned. It creates one read-only
function and its authenticated execution permission; no new real tables, changed
RLS policies, or existing data writes. Do not rerun after success, and do not run
the rehearsal after the new function is permanently installed.

The RPC derives the actor from auth.uid(), requires that actor's User profile,
validates target/kind/page bounds, gates on target privacy, and uses static SQL
with empty search_path. It is SECURITY DEFINER because normal profile/RSVP/
interest RLS intentionally prevents reading the other account directly. Only the
specified shared subset is exposed. Existing write and profile functions remain
unchanged. The Node backend uses the verified account client, never a service key.

## API

GET /api/friends/people/:uuid/connections?kind=friends|events|interests
Optional limit 1–50 and after cursor (UUID for friends; positive bigint text for
other sections). Uses the existing verified session and X-Gather-Account check.
Returns accountId, safe person DTO, kind, items, nextCursor. Each item contains
id, name, optional username, optional date/location. No raw profile rows, email,
password, auth metadata, or unrelated relationship/activity lists are returned.
A missing target is 404; malformed query 400; signed out 401; account mismatch
409; missing SQL setup/unavailable reads 503. Private target is a successful
private-safe response with empty items, not an error.

## Live checks

Restart npm start. Open blank Search Friends suggestions:

1. Add a suggested person: card stays, action becomes Cancel request. Cancel it:
   card stays, action becomes Add friend. Refresh on the same tab: correct state
   remains. Send again and leave for My Friends then return: it is excluded from
   suggestions while pending, and appears under Requests.
2. Open a profile by name, keyboard Enter/Space, or card background. No request
   should be sent. Click Add/Cancel: no details dialog should open.
3. With public test accounts that share an accepted friend, Going event and Event
   interest, confirm the dialog lists exactly those items. Public mutual profiles
   should have smaller usernames. Event links should open the correct event.
4. Verify false/cancelled RSVPs and non-shared interests are absent. If no items
   are shared, see an honest empty state. Paging must append without duplicates.
5. Test private target and private mutual profiles: target details hidden, private
   mutual not listed. Leave your coworker's visibility rules/settings intact.
6. Close/Escape while loading: late responses must not reopen the dialog. Test a
   network failure and Retry, then test normal event dialogs and friend actions.

## Validation limits and Git

75 Node tests passed locally (HTTP/account checks, service validation/privacy,
card retention/refresh, escaping, close-during-load, pagination and failure UX).
Browser tests were updated but must run on your Mac; browser execution is blocked
in this hosted runtime. The new SQL rehearsal/live Supabase checks also need to
run on your side. Node mocks are not real SQL/RLS verification.

After all checks pass, commit this follow-up together with the pending original
recommendation changes, or separately if that feature was already committed.
Include both new migration files in the eventual PR, identifying them as already
applied to shared Supabase once installed. No need to repeat prior migrations.
