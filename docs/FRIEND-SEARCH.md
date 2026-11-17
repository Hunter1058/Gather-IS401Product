# Friend search implementation and setup

This patch builds on the latest uploaded UI repository plus the already-merged
friend username display change. It preserves the existing two-line cards and
friendship action functions. No account, relationship, or request data is migrated.

## Search behavior

| Search input | Match behavior |
| --- | --- |
| `@campus_bla` | Literal case-insensitive username substring; also matches a literal email fragment if applicable. No typo correction. |
| `campus_bla` | Username matches first, then public name matches, then public email matches. |
| `Jonathan` or `Thompson` | Public first or last name, including partial words. |
| `Jon Thomp` or `Thompson Jonathan` | Every query word must match a name word, in either order. |
| `Jonathon` | Close spelling of Jonathan; approximate matching applies only to public names. |
| `student@byu` | Literal case-insensitive email substring only. No typo correction. |
| Empty query | Existing new-person suggestions ordered by shared RSVPs/mutual friends. |

For close name spellings: query words of 4–7 characters allow one insertion,
deletion, or substitution; words of 8+ allow two. Words of 1–3 characters must
match literally as substrings. Name token matching is bounded to queries of
80 characters. Overall search accepts up to 254 characters for email addresses.
Matching ignores capitalization and repeated whitespace. There is no phonetic,
nickname, or accent-normalization dictionary. Partial words must be contiguous.
Percent and underscore are literal characters, not SQL wildcards.

Username match tiers are exact, starts-with, then contains; name tiers are exact
full name, literal words, then close words; email substring matches come last.
Existing suggestion counts and UUID order break ties. Ranking is performed over
the directory before pagination; the UI preserves that order instead of grouping
search results by recommendation count. If relationships or profiles change
between pages, Refresh reruns the search from the first page.

A misspelled username/email receives no fuzzy match. An unprefixed query can
still match a person's public name independently. Leading `@` accepts username input and can also match a literal email-domain
fragment such as `@byu.edu`; it never triggers fuzzy name matching. A query
containing `@` elsewhere searches emails only.

## Privacy and data source

Per the selected privacy preference, private accounts are searchable by username
only. Their first/last names, emails, photos and recommendation details remain
hidden. Public accounts can be found by their stored `UserFirstName` and
`UserLastName`, username, or current Supabase Auth email. The legacy profile
`Email` column is not used, to avoid matching an out-of-date login address.
Email addresses never appear in result payloads, cards, search explanations,
request bodies for friendship writes, or request history.

All matching is inside the authenticated database directory function. Existing
RLS policies and profile-table permissions are unchanged; the matching helpers
are revoked from public/anon/authenticated execution and invoked by the protected
directory. The directory still derives the caller from auth.uid(), excludes that
caller, returns safe explicit columns, and accepts bounded page/query inputs.
Private/public visibility flags and username uniqueness/onboarding are unchanged.

A nonempty Search Friends query can also find existing friends and requests,
with their correct Remove/Cancel/Accept/Deny controls. Blank suggestions still
exclude those relationships. Action results remain in a typed search so that
the confirmed state is visible. This does not change the My Friends/Requests tab
filters or friendship write functions.

## Apply and test locally

Start on clean, current main containing the username display PR. Do not overwrite
teammate files with full-folder replacements.

```sh
git status --short
git switch -c feature/friend-search
git apply --check /absolute/path/gather-friend-search.patch
git apply /absolute/path/gather-friend-search.patch
npm test
npm run test:browser
npm run test:friends:browser
```

Stop and share errors if the patch check fails. Expected Node suite: 58 passed.
The patch adds no package dependencies or environment settings. Search continues
to use the existing submit button/Enter behavior. No special client SDK is added.

## Rehearse the SQL before installing it

The previously installed migrations, including get_friend_directory, must remain
installed. Do not rerun any older friendship/profile/directory migrations.

Open `supabase/tests/friend_search_rehearsal.sql`, copy the ENTIRE file, and run
as the Supabase project owner (postgres) in SQL Editor. It temporarily installs
the new matching helpers/directory, verifies matching cases and permissions,
checks the real directory with a real Auth/User profile, then ROLLS BACK. It does
not modify User, auth.users, Friends, FriendRequest, RSVP or Bookmark records.

Expected result: PASS with two probe flags. `real_public_email_checked` and
`real_private_email_checked` indicate whether suitable other profiles existed
for those live SQL checks. False means that probe was skipped, not that it passed;
verify that case with your public/private test accounts during UI checks below.
All deterministic matching cases execute regardless of these flags.

After successful rehearsal verify rollback:

```sql
select to_regprocedure(
  'public.gather_friend_search_rank(text,text,text,text,boolean)'
) as temporary_search_helper;
```

Expected NULL. The old directory remains installed and working. Stop on any SQL
error; do not try the permanent migration until the rehearsal succeeds.

Rebuild after changing the migration/check source:

```sh
python3 supabase/tests/build_friend_search_rehearsal.py
```

## Install the new SQL

Copy and run only the ENTIRE file
`supabase/migrations/20261111000000_friend_search.sql` in Supabase SQL Editor as
postgres. Expected: Success. No rows returned. This replaces get_friend_directory
without changing its signature/output and creates three private pure matching
helpers. No extension installation is needed. It requests PostgREST schema reload.
Do not rerun the rehearsal after applying this migration: the helpers already exist.

The migration is transactional. If an error occurs, the previous directory and
permissions remain in place. Matching helpers intentionally use CREATE, so a
second execution stops rather than silently replacing an existing implementation.

## Live checks

Restart the local server. Use a signed-in caller and a second test profile. You
can set that test profile's existing privacy setting through the current profile
UI; this feature does not change the setting itself.

1. For a public test profile, search part of its username and then its full handle.
   Leading @ should work; a misspelled @handle should not find that profile.
2. Search its first name, last name, partial first+last, then a close spelling
   (for example Jonathan -> Jonathon). Clearly unrelated names should not match.
3. Search a partial email such as `student@byu`, then the full current login email.
   An email typo should not match. The email must not be displayed on the card.
4. Make the target private using its existing profile setting. Username searches
   must still find it; name/email searches must not. The heading remains Private
   account and its username is below it. Refresh results after switching privacy.
5. Verify result order for multiple profiles: username before name before email.
   Load more should append results in the same order without duplicates.
6. Search an existing friend and a pending requester by username and verify the
   correct controls. Send/accept/cancel/remove and reload as previously tested.
7. Sign out: no directory results should be exposed. A failed request should show
   an error and Retry, not pretend the directory is empty.

If the website still performs the old matching after restart, confirm the NEW
migration was applied to the same Supabase project used by the running server.
Committing/merging a SQL file does not apply it to the shared database.

## Validation limits and handoff

58 Node tests passed in development, including real HTTP routing/account checks
with a fake database, controller actions, page rendering and search ordering.
The browser test was extended with partial email/username, fuzzy names and
private discovery checks; it must run on your Mac. The hosted environment blocks
Chromium execution. New SQL has not been executed against your Supabase project;
the rehearsal is required. Node fixture tests do not substitute for PostgreSQL
permission/algorithm verification. Live visibility checks remain necessary.

The query scans profiles to support flexible name matches and existing suggestion
ranking. No claim of production load testing is made; revisit query plans and
indexing if the directory grows substantially. Matching is defined by explicit
bounds, not an unbounded fuzzy search over emails or usernames.

UI coworker: keep `friendsSearch`, `searchFriends(event)`, `refreshPeople()` and
the data-friend action/focus hooks. Keep the search input maximum and help text
in sync, and preserve server ordering when a query is active. Profile visibility
and friendship state must come from the existing API, not client filtering.
