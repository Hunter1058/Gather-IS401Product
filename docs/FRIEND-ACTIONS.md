# Friend actions: first vertical slice

This change connects `/#friends` to real profiles and the already-installed
friendship action functions. It covers sending/cancelling requests and removing
an accepted friend, with authoritative status restoration after refresh.

The base is the last known working project: the November 9 main ZIP plus the
friendship database files and three corrected event tests (your commit 00ee770).
GitHub access was unavailable, so no newer remote changes were inspected. Apply
the patch with `git apply --check` to preserve any intervening teammate work.

## Scope and UX

| Database relationship to the signed-in user | Card control |
| --- | --- |
| No current friendship or pending request | Send request |
| Outgoing pending request | Cancel request |
| Accepted current friendship | Remove friend, with confirmation |
| Incoming pending request | Request received (disabled) |

Resolved/declined/cancelled request history does not pretend a friendship still
exists. A resend creates a new attempt through the existing database function.
Unfriending removes the current pair and keeps accepted request history.
Incoming acceptance/decline UI, separate Friends/Sent/Received views, search,
recommendation algorithms, activity feeds, and profile editing are later work.
There are no arbitrary name-based local friend toggles in connected mode.

People are fetched in bounded UUID-cursor pages (24 by default), with Load more
and explicit Refresh people. The list excludes the signed-in account. Display
names use profile first/last names, username, the signup Auth metadata `name`,
then a distinguishing Member/UUID-prefix fallback; no email fallback is used.
The only profile fields exposed are ID, display name and username. The directory
is available to signed-in users only. It does not open the User table's grants,
show other people's friendship graph, or expose email, Password or Auth tokens.

Controls disable per person while pending, suppress duplicate clicks, preserve
keyboard focus and update only after confirmed server state. Other people's
cards can be changed concurrently without replacing each other's state. Failed
or uncertain writes keep the last confirmed state and require Refresh status
before another action. This handles a successful write followed by a failed
status read without blindly creating another request. Account changes require
a full page reload; responses for a previous account are discarded.

The page's friend actions are independent of event listing/event preference
loads. Event outages do not block the people directory. Existing event/category/
Share behavior is preserved. Native `confirm()` is the small removal confirmation
for now; the controller accepts a boolean/Promise<boolean> callback so the UI
coworker can replace it with a modal.

## 1. Apply on a new branch from the foundation

Start in your existing clone with a clean working tree. Base this work on the
commit containing the foundation (00ee770), or current main if that PR has merged.
Do not switch to an older main lacking your foundation just to apply this patch.

```sh
git status --short
git switch -c feature/friend-actions
git apply --check /absolute/path/to/gather-friend-actions.patch
git apply /absolute/path/to/gather-friend-actions.patch
npm test
npm run test:browser
npm run test:friends:browser
```

Stop if the patch check reports conflicts; do not overwrite your coworker's
current UI work with files from the package. No dependency or .env change is
needed. The package adds one npm script, without changing package dependencies.
The new browser test uses the existing Playwright/Chromium installation.

## 2. Rehearse the new limited directory function

The friendship foundation is ALREADY applied. Do NOT rerun its migration or its
old rehearsal. This step is a separate, read-only directory-function addition.

Open this file from the updated Git project:

`supabase/tests/friend_people_rehearsal.sql`

Copy the ENTIRE file to a new Supabase SQL Editor query and run as project owner.
It temporarily creates the new function, uses two existing matching Auth/User
profiles to exercise none/outgoing/incoming/friends status, and rolls its changes
back. It never creates/changes User or Auth rows. Identity sequences can advance,
leaving harmless ID gaps. If the selected pair already has an active relationship,
the rehearsal stops for review instead of deleting it. Stop on any SQL error.

The generated script comes from the new migration plus
`supabase/tests/friend_people_checks.sql`. After editing those sources, rebuild:

```sh
python3 supabase/tests/build_friend_people_rehearsal.py
```

After successful rollback:

```sql
select to_regprocedure('public.get_friend_people(integer,uuid,uuid)') as directory_function;
```

Expected: NULL. Friends/FriendRequest tables and their pre-existing records must
remain as they were before rehearsal. The original foundation remains installed.

## 3. Install the directory function

After the rehearsal passes, run the ENTIRE contents of:

`supabase/migrations/20261109000000_friend_people.sql`

Run once as project owner in Supabase SQL Editor. It adds only the bounded,
authenticated `get_friend_people` read function and its execution privileges.
No existing action function, table data, User grants or RLS policies are changed.
It validates `auth.uid()` and actor profile existence, returns explicit safe
fields, and uses an empty search_path. A name conflict stops the transaction
rather than replacing another person's function. It notifies PostgREST to reload
its schema; allow a moment for the new RPC to become discoverable.

The function returns request IDs as SQL text to avoid JavaScript bigint rounding.
The existing action RPC results can contain numeric bigint IDs, but the backend
never uses those numeric IDs: it reads the confirmed text-ID relationship after
each action. The action RPCs still perform ownership checks and transactional
writes as previously tested in the foundation.

## 4. Verify against real Supabase accounts

Restart `npm start` and open `http://localhost:3000/#friends`.

1. Sign in as test account A. Real profiles should appear, and A must be excluded.
2. Send to B. The card must show Cancel request after success. Refresh the page:
   that state must remain. In Table Editor, verify one pending request A→B.
3. Cancel. The card returns to Send request. Refresh again: it remains sendable.
   The original request row stays in FriendRequest with Status=cancelled and
   ResolvedAt set. It is not deleted.
4. Send again. Verify a new request ID and the retained old cancelled row.
5. Sign in as B in another browser profile. A should show Request received,
   without a sender cancellation button. No automatic acceptance occurs.
6. To test accepted-state removal before the acceptance UI exists, deliberately
   accept that test request through the existing database function as B. The
   project owner can use the SQL below with B's actual Auth UUID and the current
   pending request ID. This is an admin TEST ONLY impersonation of B, not code
   to put in the app or a way to set the user's JWT from frontend input.

```sql
begin;
select set_config('request.jwt.claim.sub', 'REPLACE_WITH_B_UUID', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'REPLACE_WITH_B_UUID', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.respond_to_friend_request('REPLACE_WITH_REQUEST_ID'::bigint, true);
commit;
```

7. Refresh A's people list. B should show Friends / Remove friend. Dismiss the
   confirmation once: no write. Confirm removal: the Friends row disappears,
   the card becomes sendable, and the accepted request remains in history.
8. Refresh both accounts to confirm consistent state. Use a third account, if
   available, to verify that it cannot cancel A's request or alter A–B's pair.
9. Test a failed save (e.g. browser offline after loading), then restore network
   and use Refresh status. No false success toast or duplicate request should
   appear. Verify no profiles or request information are loaded when signed out.

The existing HTTP origin guard is intentionally unchanged. If a live mutation
returns "Request origin is not allowed", correct APP_ORIGIN for that deployment
and redeploy, as discussed previously. On localhost it must be absent or match
`http://localhost:3000`; production's configured origin must be the actual HTTPS
site origin. This feature does not disable that guard. Supabase Auth Site URL
is a separate email-link setting and does not configure the Node origin guard.

## API contract

All routes use the existing verified HttpOnly cookie session and request-scoped
Supabase client. Every mutation requires `X-Gather-Account` matching that session.
The header is a stale-tab consistency check, never an identity credential.

| Method/path | Input | Result |
| --- | --- | --- |
| GET /api/friends/people | Optional after UUID, limit 1–50, or personId UUID | accountId, people[], nextCursor |
| POST /api/friends/requests | Only `{ "recipientId": "UUID" }` | accountId, confirmed person |
| DELETE /api/friends/requests/:requestId | Empty JSON `{}` or no body | accountId, confirmed person |
| DELETE /api/friends/:otherUserId | Empty JSON `{}` or no body | accountId, confirmed person |

A person is `{ id, name, username, relationship, requestId }`. Relationship is
none/outgoing_pending/incoming_pending/friends. requestId is a decimal string
only for pending requests, otherwise null. IDs and request bodies are validated.
Extra ownership fields are rejected. Incoming requests cannot be cancelled by
the recipient; SQL enforces the original requester. The backend never writes
Friends/FriendRequest directly and never uses service-role credentials.

401 means sign in; ACCOUNT_CHANGED (409) means reload the page; other 409 errors
mean refresh the affected status; 403 means the operation is not yours; 404 means
the profile is unavailable; 503 means unavailable/unconfigured service. API code
FRIENDS_SETUP_REQUIRED identifies missing database setup for administrators;
the public message remains a friendly unavailable notice, not SQL instructions.

## UI coworker handoff

The controller is `public/friend-actions.js`; the layout is localized to
`friendsPage()` and `friendCard()` in `public/app.js`. The script is loaded before
app.js by index.html. Keep these function/data hooks when redesigning:

- `friendAction(person.id)`: derives the permitted operation from confirmed state.
- `refreshFriend(person.id)`: recover an uncertain card from the server.
- `refreshPeople()` / `loadMorePeople()`: reload/paginate the directory.
- `data-person-id`: person-card identity.
- `data-friend-user-id` / `data-friend-control`: control identity/focus restoration.
- `data-friend-status`: confirmed relationship state; used by browser checks.
- `data-friend-heading` and friendsRefresh/friendsMore IDs: focus fallbacks.

Keep pending/error/disabled and incoming states visible. Keep type=button,
meaningful aria-labels and aria-busy. Escape all profile strings; they are user
input. Keep the controller's authoritative state and explicit operations when
changing button appearance. Removal confirmation must resolve to boolean true
before a write. Do not use the old local friend-name array to infer relationships.

## Commit/push after validation

Stage the actual files listed by `git status` for this feature, review the staged
diff, and commit with a message such as "Connect friend request and unfriend actions".
Push `feature/friend-actions` and open a PR. If the foundation PR is still open,
base this PR on feature/friendships-database until the foundation has merged;
otherwise target main. Tell reviewers whether the new directory SQL has already
been applied. Merging code does not automatically execute manual SQL migrations.
No changes have been pushed, merged or applied to Supabase by this package.

## Validation limits

42 native tests pass, including the existing event/share tests plus the real
HTTP handlers, controller and real shell rendering. Supabase/database calls are
fixtures in those tests. The new browser suite covers actual DOM behavior but
could not launch here because Chromium is unavailable; run it locally. The SQL
rehearsal and real-account acceptance steps above still need execution in your
Supabase project. No claim is made that production or the new SQL has already
been verified. The original foundation SQL was not changed or rerun.

### Friends tabs and suggestions

Apply [the friend directory migration](../supabase/migrations/20261110000500_friend_directory.sql) after the existing friendship and people migrations. It adds `get_friend_directory`; the Friends page requires this function for its three tabs. Restart the Node server after updating the application.

My Friends lists accepted friendships. Search Friends searches names and usernames and ranks available people by the sum of shared going RSVPs and mutual friends, showing the reason on each suggestion. Existing friends and pending requests are excluded. Requests separates incoming requests (Accept / Deny) from sent requests (Cancel). Filtering and ranking happen before pagination. Recommendations return aggregate counts, keeping other users’ event lists and friend identities out of the response; existing table permissions remain intact.

Validation: `npm test` and `npm run test:friends:browser` cover directory filtering, recommendations, requests, account checks, keyboard tabs, search, and mobile layout.
