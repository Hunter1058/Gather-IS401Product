# Friends and friend-request history: database foundation

This package adds the approved two-table model to the **existing** Supabase
project inspected November 6, 2026. It does not build the friends-page UI or
change login, event, RSVP, Bookmark, category, or profile-directory permissions.
No current repository snapshot is replaced: the patch adds new files only.

## Schema and normalization

`Friends` is preserved and renamed in place:

| Column | Meaning |
| --- | --- |
| FriendshipID | Existing bigint identity primary key |
| UserAID | UUID FK to User.UserID, NOT NULL |
| UserBID | UUID FK to User.UserID, NOT NULL |
| FriendsSince | timestamptz, database-generated acceptance time |

`UserAID < UserBID` and UNIQUE(UserAID, UserBID) guarantee one canonical mutual
friendship. An index on UserBID complements the unique index's leading UserAID.

`FriendRequest` stores every attempt separately:

| Column | Meaning |
| --- | --- |
| FriendRequestID | bigint generated-always identity primary key |
| RequesterUserID | UUID FK to User.UserID, NOT NULL |
| RecipientUserID | UUID FK to User.UserID, NOT NULL |
| Status | pending / accepted / declined / cancelled; default pending |
| RequestedAt | timestamptz, database-generated sent time |
| ResolvedAt | NULL until accepted, declined or cancelled |

Both participants must differ. A partial unique expression index permits only
one pending request for an unordered pair; it deliberately does not restrict
resolved attempts. Incoming/outgoing indexes support actor/status/time queries.
RequestedAt/participants/ID cannot be rewritten. A trigger prevents rewriting
resolved history; applications cannot directly delete history either.

Under the stated dependencies, both tables are in BCNF (and therefore 3NF):
Friends has candidate keys FriendshipID and its UUID pair; FriendRequest has
FriendRequestID as its key. Names, emails, passwords, friend counts and retry
counts are not copied into these tables. No separate duplicate history table
or status-description lookup is needed.

Every resend after a declined/cancelled request creates a NEW request ID. An
accepted attempt remains accepted after unfriending. Unfriending deletes only
the current Friends row. No cooldown is imposed by this foundation: request
history makes a future cooldown or blocking rule possible, but those rules
must be implemented in the database action, not just by disabling a UI button.

**Retention:** deleting a User profile intentionally cascades to its friendships
and request history. This follows the existing profile-deletion model and is
not an archive that survives account deletion. Change that policy before use
if retained/anonymized deleted-account history is a requirement. This design
records request history; it is not a separate audit of who later unfriended whom.

## Files

- `supabase/migrations/20261106000000_friendships.sql`: permanent migration.
- `supabase/tests/friendships_rehearsal.sql`: generated transactional rehearsal
  for the shared Supabase project; table changes are rolled back.
- `supabase/tests/friendships.sql`: tests for the LOCAL throwaway fixture.
- `supabase/tests/friendships_bootstrap.sql`: LOCAL ONLY mock Auth/roles setup.
- `supabase/tests/build_friendships_rehearsal.py`: rebuild the rehearsal from
  the migration and test sources after making changes.

**Never run friendships_bootstrap.sql in Supabase.** It is for an isolated
local PostgreSQL cluster only, not the real Auth schema.

## 1. Add the files to a new Git branch

In your normal clone, run `git status --short`. Preserve any existing changes
before switching branches. With a clean working tree:

```sh
git switch main
git pull --ff-only
git switch -c feature/friendships-database
git apply --check /absolute/path/to/gather-friendships-database.patch
git apply /absolute/path/to/gather-friendships-database.patch
```

The patch adds new files and does not overwrite current teammates' changes.
If any of these paths already exist, stop and reconcile them. Keep the current
`.env`; no new key, service-role secret or Vercel setting is needed.

## 2. Rehearse in Supabase before making permanent changes

The rehearsal requires two existing User profiles whose IDs match Auth users.
The previous login tests should already have supplied those accounts. It picks
the first two matching UUIDs and uses a synthetic unrelated subject to verify
RLS exclusion; no credentials, User fields or Auth records are modified.

Open your **Git project's** `supabase/tests/friendships_rehearsal.sql`, copy the
ENTIRE file into a new Supabase SQL Editor query, and run as project owner.
It creates the proposed tables/functions and exercises sending, declining,
resending, accepting, cancelling, unfriending, repeated actions, grants, RLS,
immutable history and constraints within one transaction, then ROLLBACKs.

This is not a read-only query: it performs temporary DDL and test writes. Its
changes to tables/functions/policies are rolled back. The existing Friends
identity sequence can advance, leaving harmless gaps in future IDs, because
PostgreSQL sequences are not transactional. Existing User/Auth rows are never
inserted, updated or deleted by this rehearsal.

If any check raises an error, STOP and share the exact message. Do not proceed
to the permanent migration or remove safeguards to force success. If the SQL
editor leaves a transaction aborted, run `ROLLBACK;` in the same connection.
A pre-existing `gather_test` schema also stops rehearsal instead of overwriting it.

After a successful rehearsal, verify the original shape remains:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'Friends'
order by ordinal_position;
select to_regclass('public."FriendRequest"') as request_table;
select count(*) as friends_count from public."Friends";
```

Expected: original FriendshipID/FriendUserID/UserID columns; request_table NULL;
friends_count zero. Do not run the permanent migration until rehearsal succeeds.

## 3. Apply the permanent migration

Open `supabase/migrations/20261106000000_friendships.sql` from the Git project,
copy the ENTIRE file into a new Supabase SQL Editor query and run once as owner.
It starts a transaction, locks Friends, checks the inspected baseline, preserves
its identity/table, changes the schema, grants access, and commits atomically.

The migration refuses a nonempty Friends table, an existing FriendRequest,
conflicting proposed function names, or new policies/triggers/incoming foreign
keys. These are review safeguards, not instructions to delete anything.
It intentionally does not use DROP TABLE or replace existing friend functions.
The migration uses a 10-second lock timeout so it fails rather than waiting
indefinitely if another transaction holds the old Friends table.

Do not rerun `schema.sql`, earlier migrations, or seed.sql on the existing
project. Do not run the rehearsal again after the permanent migration: it
expects the old empty baseline. For a future clean install using the repository's
old schema.sql baseline, apply this new migration after that baseline as well.
Running a SQL file manually does not automatically reconcile Supabase CLI
migration history; keep the team's existing manual workflow for this change.

## 4. Post-migration verification

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('Friends', 'FriendRequest')
order by table_name, ordinal_position;

select tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename in ('Friends', 'FriendRequest');

select count(*) as friends_count from public."Friends";
select count(*) as request_count from public."FriendRequest";
```

Expected: the new columns, two participant-only SELECT policies, and both counts
zero before real actions. Normal authenticated clients have SELECT, but no
INSERT/UPDATE/DELETE grants on these two tables. Anonymous users have neither
read grants nor action-function execution grants. Owners/service roles remain
privileged administrators; RLS does not make admin access disappear.

## 5. API contract for the upcoming friends page

Use the signed-in account's **request-scoped Supabase client** from the existing
Node backend, not the public anonymous client. Passing only the publishable key
without a user's session does not authenticate an action. Derive the actor from
`auth.uid()`; there is no requester/actor argument for a caller to impersonate.

```js
// existing verified account client, carrying the user's Supabase session
await client.rpc('send_friend_request', {
  p_recipient_user_id: otherUserId,
});
await client.rpc('respond_to_friend_request', {
  p_request_id: requestId, // positive bigint; preserve as a decimal string
  p_accept: true,         // false declines; null is rejected
});
await client.rpc('cancel_friend_request', { p_request_id: requestId });
await client.rpc('remove_friend', { p_other_user_id: otherUserId });
```

The first three return the request row (Supabase result shape: inspect `data`
from `.rpc`). `remove_friend` returns true when it removed a friendship and
false when none existed, including a retry. All calls can return errors and
the UI must wait for success before confirming saved state.

Reads use the same account client:

```js
await client.from('Friends').select('*'); // RLS filters to this account's pairs
await client.from('FriendRequest').select('*')
  .eq('RecipientUserID', accountId).eq('Status', 'pending');
await client.from('FriendRequest').select('*')
  .eq('RequesterUserID', accountId).eq('Status', 'pending');
```

Add pagination/time ordering when returning history. Row IDs are SQL bigint:
the future backend must preserve them accurately, just as with event IDs.
JavaScript libraries can parse large JSON integer values unsafely; if this app
ever reaches IDs above Number.MAX_SAFE_INTEGER, expose text IDs from a bounded
RPC/read adapter rather than coercing a rounded number back to a string.

Actions serialize by the unordered UUID pair using transaction advisory locks
under READ COMMITTED isolation. Non-default isolation is rejected explicitly.
Acceptance updates the request and inserts the friendship in one transaction.
A simultaneous reverse send cannot silently accept another person's request.
Send retries reuse an existing outgoing pending attempt. Repeated identical
responses/cancels return the stored attempt. A stale accept after unfriending
returns its historical accepted attempt without recreating the friendship.

The four action functions are SECURITY DEFINER with an empty search_path,
fully qualified application objects, explicit actor checks and restricted execute
grants. Direct writes are revoked. Internal lock/trigger functions are not
callable by authenticated clients as public RPCs. Never use a service-role key
in frontend code to work around RLS.

This package does not grant friends access to RSVP rows or open the User profile
table for search. Those policies/endpoints need their own limited design when
building the friends page. Mutual-friend recommendations must not expose the
entire private friendship graph. Existing demo friend buttons are not connected
to these functions until that page/backend work is implemented.

## 6. Commit and share the database foundation

After successful rehearsal, permanent migration, and metadata verification,
run your existing application tests as a regression check. These tests do not
replace the PostgreSQL rehearsal. Then stage only the new feature files:

```sh
git add supabase/migrations/20261106000000_friendships.sql supabase/tests/friendships.sql supabase/tests/friendships_bootstrap.sql supabase/tests/friendships_rehearsal.sql supabase/tests/build_friendships_rehearsal.py docs/FRIENDSHIPS-SETUP.md
git diff --cached --check
git --no-pager diff --cached --stat
git commit -m "Add friendship requests and persistent request history"
git push -u origin feature/friendships-database
```

Open a PR into main. State whether the shared Supabase migration has already
been applied so teammates do not execute it twice. Committing/pushing migration
files alone does not execute SQL or deploy the friends-page UI. No Vercel
settings change is required for the database foundation itself.

## Validation status

The SQL and permissions were reviewed against the supplied live inspection and
PostgreSQL/Supabase documentation. This environment could not install a local
PostgreSQL runtime/parser; no claim is made that the SQL integration suite has
already executed successfully. The generated Supabase rehearsal is the next
required execution check before the permanent migration. Concurrent behavior
also needs a multi-session PostgreSQL test before treating it as verified under
load; the pair locks and unique indexes are the intended safeguards.

Local-only fixture instructions (optional, for a disposable PostgreSQL cluster):

```sh
psql -v ON_ERROR_STOP=1 -d gather_friendships_test -f supabase/tests/friendships_bootstrap.sql
psql -v ON_ERROR_STOP=1 -d gather_friendships_test -f supabase/migrations/20261106000000_friendships.sql
psql -v ON_ERROR_STOP=1 -d gather_friendships_test -f supabase/tests/friendships.sql
```

References:
- https://www.postgresql.org/docs/17/explicit-locking.html
- https://www.postgresql.org/docs/17/indexes-partial.html
- https://supabase.com/docs/guides/database/functions
