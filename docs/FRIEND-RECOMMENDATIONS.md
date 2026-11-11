# Suggested friends: personalized recommendation logic

This patch builds on the completed friend search feature (your b5030af commit),
including the corrected login browser-test selector. If that PR is still open,
branch from feature/friend-search. Use main only after it includes that feature.
No newer remote source was available for comparison; use git apply --check and
stop on conflicts rather than overwrite teammate work.

## Ranking and eligibility

The Suggested friends section uses the following strict priority order:

1. Shortest eligible friendship connection: second degree before third degree.
2. More events where both accounts currently have RSVPGoing=true.
3. More matching profile Event interests (UserInterest/EventCatID).
4. Mutual friend count, then UUID as stable tie breakers.

A second-degree connection means a friend of a friend; third degree has one more
accepted friendship edge. Paths are capped at three edges, not an unbounded graph
traversal. Duplicate paths do not duplicate candidates, and shortest distance wins.
The implementation only traverses public profiles, except the caller's own
profile can be private. Private intermediary relationships do not become a
recommendation signal. Only counts and degree are returned, not the identities
along a path, RSVP event IDs, or interest IDs/names of other accounts.

Suggestions exclude the caller, accepted friends, either direction of pending
request, private profiles, and profiles with no eligible connection/shared RSVP/
shared interest. They do not fall back to showing everyone. With no signals the
UI explains that users can add friends, select profile interests, or search.
Historical cancelled/declined/accepted requests do not by themselves block future
recommendation; current friendships and pending requests determine eligibility.
No new request cooldown or blocking system is introduced.

RSVP overlap includes any stored event with true going states for both accounts,
including past events, matching the prior overlap definition. False/cancelled
RSVPs and null event IDs do not count; event overlaps are distinct. Interest
matches use the existing profile-selected Event categories, not a new free-text
hobbies field. Missing interests simply contribute zero; onboarding is unchanged.

A connection candidate precedes an unconnected candidate even if the latter has
more shared RSVPs. Within the same degree, RSVP counts precede interest counts.
Without a connection, RSVP matches precede interest-only matches. Scores are
computed in SQL before paging, not from only the currently visible cards.

## UI and API

Empty Search Friends input calls get_friend_recommendations through the same
GET /api/friends/people?section=search API. Nonempty input continues using the
existing search function and its username/name/email ranking. Other tabs, target
lookups, profile visibility settings, and friendship write functions are unchanged.
No recommendations or relationship states are saved in localStorage.

The safe person DTO gains connectionDegree (2, 3 or null) and sharedInterests
(count). Existing queries without recommendation fields get null/zero defaults.
Cards preserve server order and display the available reasons. The Explore people
fallback is removed. Sending a request removes the candidate from blank suggestions;
Requests continues to show the confirmed outgoing state. After cancellation,
Refresh can recommend the same candidate again if a signal remains.

The frontend and backend still use verified account sessions and account-bound
responses. Recommendation reads use the verified user's client, not a service key.
No email, raw friendship graph, or another user's interest/RSVP list is exposed.
Existing RLS/table grants are unchanged. Private accounts remain discoverable
by username in typed search as previously agreed, without their names or photos.

## Apply locally

Start with a clean branch containing b5030af and its predecessors. If the search
PR is unmerged, branch from feature/friend-search; otherwise updated main works.

```sh
git status --short
git branch --show-current
git switch -c feature/friend-recommendations
git apply --check /absolute/path/gather-friend-recommendations.patch
git apply /absolute/path/gather-friend-recommendations.patch
npm test
npm run test:browser
npm run test:friends:browser
```

Expected Node suite: 66 tests passed. No package dependencies or .env changes.
Stop on patch conflicts. The old search migration is already installed: do not
rerun that migration, the original friendship foundation, or their rehearsals.

## Rehearse the new SQL

Copy the ENTIRE supabase/tests/friend_recommendations_rehearsal.sql file into a
new Supabase SQL Editor query and run as postgres/project owner BEFORE installing
the permanent recommendation migration.

The rehearsal temporarily creates the production RPC. It also creates a guarded
schema gather_recommendation_test with synthetic profiles/graph/RSVP/interests.
The builder clones the exact production query with ONLY schema-qualified relation
names changed to the fixtures, then tests ordering, degree/shortest paths, cycles,
false RSVPs, overlaps, cursor pages, pending requests and private intermediaries.
It also exercises authenticated access against the real schema using an existing
profile. No real User, Auth, Friends, FriendRequest, UserInterest, RSVP or Bookmark
records are inserted, updated or deleted. All temporary schema/functions roll back.
An existing test schema causes an error and is never dropped or overwritten.

Expected result:
PASS: friend recommendation rehearsal completed; temporary functions and fixtures will roll back.

After successful rehearsal verify rollback:

```sql
select
  to_regprocedure('public.get_friend_recommendations(integer,uuid)') as recommendation_function,
  to_regnamespace('gather_recommendation_test') as temporary_test_schema;
```

Both should be NULL. Stop on errors rather than applying the permanent migration.
Rebuild if migration or checks are edited:

```sh
python3 supabase/tests/build_friend_recommendations_rehearsal.py
```

## Install

Copy and run ONLY the ENTIRE new file:
supabase/migrations/20261112000000_friend_recommendations.sql

Run in Supabase SQL Editor as postgres. Expected: Success. No rows returned.
This creates one read-only RPC and its authenticated execution permission.
No schema table changes, profile modifications, extension installation or existing
function replacement is required. It requests a PostgREST schema refresh.
If execution fails, its transaction rolls back. Do not rerun after success.
Do not rerun the rehearsal after installation; the RPC already exists.

## Live verification

Restart npm start and sign in. To exercise recommendations with real accounts,
use consenting team/test accounts and normal UI actions:

1. With no friends, shared true RSVPs or selected shared interests, verify no
   random users appear. Typed username searches must still find public/private
   accounts according to existing search rules.
2. Have A and B accepted friends and B/C accepted friends. As A, C should show
   Friend of a friend. Existing friend B and pending request recipients should
   not be suggested. Test with public B/C to permit the path.
3. Add a public D connected through C (A-B-C-D). A should see C ahead of D.
4. Give an unconnected public account shared going RSVPs with A. It should appear
   after connected candidates, and ahead of interest-only suggestions.
5. Select matching Event interests on A and an unconnected public account through
   existing profile settings. It should appear with a shared interest count.
6. Uncheck a going RSVP or change selected interests, then Refresh suggestions:
   the counts/order should update. With no other signals the candidate disappears.
7. Make a target or intermediary private using its existing privacy setting.
   Refresh: it must not be suggested or used as a connection path. Its username
   can still be found by typing it into Search Friends.
8. Send a request from a suggestion. Its card disappears and Requests shows the
   outgoing request. Cancel, then Refresh suggestions; it returns if still eligible.
9. Page through static results and check ordered/no duplicate candidates. Verify
   name/email search and request accept/deny/remove still work as before.

Refresh restarts pagination when graph, RSVP or profile settings change. Results
are computed live per request, not from a frozen database snapshot across pages;
a ranking change between pages can move candidates. No realtime subscription is
introduced. The SQL rehearsal provides deterministic ranking tests without
requiring many real accounts.

## Validation limits

All 66 Node tests passed in development. These cover HTTP routing/account checks,
API field mapping, recommendation precedence, exclusions, cycles, pagination,
search separation, empty states and action flows using fake database responses.
Browser scripts are updated but must run on your Mac because this hosted runtime
blocks browser execution. The actual SQL rehearsal and live Supabase flows still
need to be run by you. Node mocks are not a substitute for SQL/RLS verification.

No production performance test was run. Traversal is capped at three degrees and
uses UNION to discard duplicate (profile,depth) states. Query plans should be
reviewed as the directory grows; no unbounded graph scan or all-path enumeration
is used. Existing normalized Friends/RSVP/UserInterest tables are the data source,
so duplicated recommendation records cannot become stale in storage.

After validation, commit/push on the recommendation branch. If the search PR is
still open, initially target that branch; after it merges, target main. Mark the
new SQL migration as already applied once you apply it to shared Supabase, so
teammates do not execute it twice. Merging the SQL file alone does not install it.
