# Friends going on event cards

Based on the supplied main ZIP at commit
`e18551e03e917b3af65e977475983a31e171131d`.

## Result

Signed-in people see a compact friend-attendance summary below an event's date
and location. It shows the total count and up to two profile labels, followed by
`+N more` when needed. The same component is used on Events, Discover, Saved,
calendar day cards and event details. It adds no extra card buttons. Past events
use “friends RSVP’d” rather than implying the event is still upcoming.

You do not need to RSVP yourself to see your friends' RSVPs. A successful empty
result adds no badge. Guests get no attendance data, and an attendance-read
failure shows a notice while their personal bookmarks and RSVPs remain usable.
The existing Friends going filter uses the same snapshot as the card summaries.

The preview intentionally shows at most two people. This step does not add a
full attendee-directory dialog or real-time subscriptions. Reload to refresh
after a friend changes RSVP, accepts/removes a friendship or changes privacy.
An explicit expired/changed-account API response clears attendance immediately;
normal account changes are reflected on the next authenticated page load.

## Privacy and data rules

- Only **current accepted friendships** in `Friends` qualify, in either direction
  of the canonical `UserAID`/`UserBID` pair.
- Only `RSVPGoing = true` qualifies. Self, strangers, friend-of-friend links,
  pending/declined/cancelled requests, cancelled RSVPs, orphan events and deleted
  Auth accounts are excluded. Request history alone never establishes friendship.
- **Private profiles are excluded from both counts and names**, consistent with
  the existing shared-connections/recommendations attendance rules. Missing
  visibility also fails closed. This does not modify anyone's privacy setting,
  the profile directory, or any table policy. Use a Public test profile to verify
  initial attendance display; do not turn other people's profiles public in SQL.
- Public profile first/last names are used, falling back to `@username`, then
  `Gather friend`. Names are bounded to 80 characters and escaped in HTML.
  Emails, passwords, Auth metadata and profile photos are not returned.
- Bigint event IDs and counts remain strings. A single friend counts once per
  event even if legacy RSVP duplicates exist. Previews contain at most two IDs
  and labels per event.

## Backend and compatibility

`readPlans` still serves the existing authenticated `/api/state` route. It adds
`friendAttendance`, keyed by event ID, and preserves `friendsGoing` and
`friendsGoingError` for existing filters. Owner identity comes from the verified
session and database `auth.uid()`, not from a browser-supplied user ID.

The new `gather_event_friend_attendance(bigint,integer)` RPC is callable only by
authenticated users. It uses `SECURITY DEFINER` with an empty search path and
explicit caller friendship/privacy checks; it grants no general access to other
people's RSVP or profile rows. No existing table data, RLS or grants are changed.

The server reads event batches of up to 250, following the last exact bigint ID
until an empty page. It does not infer the end from a short page, which could be
caused by a lower PostgREST row cap. More than 40 nonempty RPC pages yields an
explicit attendance failure, never a successful partial snapshot. Pagination is
a reloadable snapshot; live edits during multiple page reads are not a single
cross-request transaction. No per-card database request is made.

The ZIP's older `20261109000000_friends_going.sql` still referred to
`Friends.UserID/FriendUserID`. Those columns were renamed by the canonical
friendship migration. The new forward migration replaces that old helper using
`UserAID/UserBID`, retaining its event-ID-only return type. Do not rerun the old
friends-going migration against the current schema. A fresh-project setup must
account for that historical migration ordering issue; this handoff targets the
existing project with canonical friendships already installed.

## 1. Apply code safely

In your existing repository, check:

```bash
git status --short
git branch --show-current
```

With a clean main branch, update it and create a new branch:

```bash
git pull --ff-only origin main
git switch -c feature/event-friend-attendance
```

Check and apply the downloaded `gather-event-friend-attendance.patch`, using its
actual Downloads path:

```bash
git apply --check '/path/to/gather-event-friend-attendance.patch'
git apply '/path/to/gather-event-friend-attendance.patch'
git diff --check
npm test
npm run test:browser
```

Stop if the patch check reports conflicts; do not force it over other changes.
No new dependencies, environment variables or email settings are needed. Preserve
your existing `.env`. The account-recovery and username-availability code from
your coworker's main ZIP is not modified by this patch.

Before the migration is installed, the real app may show an attendance-load
notice. That is an explicit setup failure, not proof that no friends are going.
The automated browser fixture uses mocked APIs, so it can run before SQL setup.

## 2. Rehearse SQL, then verify rollback

Run the **entire** file below in Supabase SQL Editor as `postgres`:

`supabase/tests/event_attendance_rehearsal.sql`

It temporarily installs the proposed functions in one transaction, tests copied
functions with isolated synthetic accounts and ends with `ROLLBACK`. All fixture
tables have RLS enabled. It does not edit real users, events, friendships, RSVPs,
privacy preferences or existing table grants/policies. Function replacement can
briefly take locks; run at a quiet moment. Never run only a selected fragment.

Expected final result:

```text
PASS: event friend attendance rehearsal completed; all temporary changes will roll back.
```

Then run this separate read-only query:

```sql
select
 to_regprocedure('public.gather_event_friend_attendance(bigint,integer)') as attendance_function,
 to_regnamespace('gather_attendance_test') as temporary_test_schema;
```

Both must be null before the real migration. If a query fails, share the error
and stop. If the editor leaves a failed transaction open, run `rollback;`.

## 3. Apply the permanent migration once

After the rehearsal passes, run the entire file:

`supabase/migrations/20261117000000_event_friend_attendance.sql`

Expected: `Success. No rows returned`. Then verify:

```sql
select
 to_regprocedure('public.gather_event_friend_attendance(bigint,integer)') as attendance_function,
 has_function_privilege('anon','public.gather_event_friend_attendance(bigint,integer)','EXECUTE') as anonymous_execute,
 has_function_privilege('authenticated','public.gather_event_friend_attendance(bigint,integer)','EXECUTE') as authenticated_execute,
 (select proconfig from pg_proc where oid='public.gather_event_friend_attendance(bigint,integer)'::regprocedure) as function_settings;
```

Expected: function present, anonymous_execute false, authenticated_execute true,
and an empty search_path in function_settings. The migration stops if its new
function already exists rather than silently replacing an unknown installation.

For an authenticated smoke test, sign in through the app. Running the RPC in SQL
Editor without a real actor is not a valid user test; an absent actor must fail.

## 4. Live checks with two test accounts

Use two accounts/mailboxes you control. Avoid changing real users' relationships
or privacy just to test this feature.

1. Set test account B's profile to Public. Have A and B accept a friendship using
   the existing friend-request UI. In separate browser profiles/private windows,
   keep A and B signed in independently.
2. B marks Going on a real event. Reload A's Events page. Expect `1 friend going`
   with B's public name or username on the correct card, even when A has not RSVPed.
3. Open event details, Saved (after bookmarking) and a calendar day schedule;
   verify the summary remains consistent and Share/Going/bookmark still work.
4. Cancel B's RSVP. Reload A. The badge disappears; the public event remains.
5. Restore B's RSVP, then remove the friendship. Reload A. The badge disappears.
   A pending request by itself must not restore it. Accept again to restore it.
6. With friendship and RSVP active, make B Private through B's settings. Reload
   A. Neither B's name nor B's contribution to the count may appear. Restore
   Public only if that is the intended setting for this test account.
7. Add another Public test friend going to the same event. Expect the correct
   plural count. With three or more, expect only two preview labels and `+N more`.
8. Check Friends going filtering, guests, account switching, an account-service
   failure, and narrow mobile layouts. Guests must get no friend names/counts.
9. Check a past saved event: its summary should say `friends RSVP’d`, describing
   current RSVP records, not proof that those people attended historically.

The app updates on reload. This change does not subscribe to live database
changes while a page stays open. Old screenshots are not evidence of current
friendship/privacy state; always reload after making test changes.

## Validation and review

118 Node/unit/HTTP/VM tests passed in the development environment. Coverage
includes per-account API responses, bounded escaped previews, page caps and
bigint cursors, partial-read failures, guest/unready states, details, Saved and
clearing stale summaries on authentication/account-change errors.

The updated `test:browser` suite checks badge text, filtering, reload updates,
failure notices, account isolation and existing event controls using mock APIs.
Browser execution/visual checks and PostgreSQL rehearsal execution remain for
your Mac/Supabase project; they have not been represented as passed here.

The SQL rehearsal checks both friendship directions, current accepted links,
pending exclusion, RSVP cancellation, unfriend, privacy/null privacy, orphan
data, duplicate rows, paging, preview bounds, bigint precision and RPC grants.

After live checks pass, inspect `git status --short`, stage only files listed in
the package's CHANGED-FILES.txt, review the staged diff and commit/push this
feature branch. Keep `.env` untracked. Record that this migration was applied to
the shared project so reviewers do not run it again there. Committing a migration
does not execute it in Supabase; applying it in SQL Editor does not commit Git.
