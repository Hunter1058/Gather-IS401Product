> Current setup: [Complete production setup](./OKR-PRODUCTION-SETUP.md) supersedes the earlier placeholder migration and diagnostic round trip. The consolidated repair has no placeholders and passes 173 Node tests plus all four browser suites. It has not been applied to production.

# Phase 2 sharing: implementation and review report

Implemented locally on November 17, 2026. No production SQL, production user-data writes, deployment, or commit was performed.

## Implemented behavior

- Share controls open a separate native dialog offering device sharing, Copy link, and authenticated Send to Gather Friend. Opening it does not redraw details or log views/shares.
- Successful navigator.share completion logs share/native with a NULL recipient. It confirms completion of the browser sharing process, not external delivery.
- Successful website clipboard writes log share/copy_link with a NULL recipient. Cancellations, failures, merely selecting a manual URL, and menu opening do not count. Non-cancellation native errors retain the clipboard fallback.
- Anonymous external sharing remains available without analytics or forced sign-in. Analytics failures produce console diagnostics without interrupting sharing or retrying automatically.
- Direct sharing offers accepted friends through the existing paginated directory, disables repeated sends immediately, and confirms only after success.
- Friends has a keyboard-accessible Shared with Me tab: sender, event, timestamp, refresh/pagination, and Open event details. Private senders use their usernames.
- One EventInteractionLog row serves as both delivery and analytics. Per-action UUIDs make retries idempotent, including an uncertain response after commit.
- Existing view logging, bookmarks, RSVPs, discovery, friend requests, and public shared URLs remain functional. Shared links can now fetch an event outside the first 500 listing results by its exact bigint ID.

## New API contracts

All sharing endpoints restore the existing session, verify Supabase Auth getUser(), require same-origin and matching X-Gather-Account, and use the caller's JWT client. No sender ID is accepted.

### POST /api/events/:eventId/share

External body: {"channel":"native","requestId":"UUID"} or {"channel":"copy_link","requestId":"UUID"}.

Direct body: {"channel":"in_app","recipientId":"FRIEND_UUID","requestId":"UUID"}.

No extra fields are accepted. Positive bigint IDs remain canonical decimal strings; UUIDs are validated. SQL verifies the event and Auth-linked profiles, derives the sender from auth.uid(), and requires an accepted friendship for direct sends. Identical sender/request UUIDs return the same interaction; different fields with the same UUID conflict.

Success is HTTP 200 with {accountId, interactionId}; the ID is text. Errors: 400 invalid input, 401 absent/invalid session, 403 origin or friendship restriction, 404 unavailable event/person, 405 wrong method, 409 account or request mismatch, and 503 sharing unavailable/migration missing. Database details are sanitized.

### GET /api/shared-events?limit=20&after=INTERACTION_ID

Returns {accountId, shares, nextCursor} for the verified recipient only. Share fields are id, eventId, eventName, senderName, createdAt. Limits are 1–50 and cursors remain exact bigint strings. Unknown/duplicate query fields are rejected. The database function accepts no recipient ID.

### GET /api/events?eventId=EVENT_ID

Adds an exact-ID filter to the existing public event listing for links outside its initial result page.

## Migration and security

The proposed migration adds ShareChannel (text) and ShareRequestID (UUID), plus request uniqueness and inbox indexes. It preserves every existing policy, including the Phase 1 view INSERT policy. A new restrictive INSERT policy permits direct client writes only for valid views; new shares must use the checked RPC.

The shape CHECK permits:
- view: NULL channel, recipient, and request ID.
- share/native or share/copy_link: NULL recipient.
- share/in_app: another user's UUID as recipient.

Historical shares retain IDs, timestamps, participants, and InteractionType and receive ShareChannel=in_app. Historical request IDs remain NULL. Review whether this classification matches actual historical use.

New restricted functions:
- gather_share_event(bigint,text,uuid,uuid): trusted-owner SECURITY DEFINER, empty search_path, explicit auth/validation, request transaction lock, accepted friendship check, and one atomic log/delivery insert. It reuses the existing friendship pair lock used by removal.
- gather_received_event_shares(bigint,integer): trusted-owner SECURITY DEFINER, empty search_path, explicit auth.uid() recipient filtering, bounded pagination, and privacy-aware sender labels.

PUBLIC and anon cannot execute the functions; authenticated receives EXECUTE. No raw log SELECT/UPDATE/DELETE grants or SELECT policies are added. RLS remains enabled. No service-role credential is introduced.

### Required metadata review

Only application Supabase URL/key configuration was available; no staging connection or database metadata connection was available. Live defaults, CHECK names, triggers, policies, grants, and inheritance have not been independently queried or modified.

The migration intentionally contains REVIEW_REQUIRED_RECIPIENT_CHECK_NAME. Replace ONLY the value in the legacy_constraint declaration with the exact inspected recipient/type CHECK name. Leave the later placeholder guard unchanged. Review the CHECK definition itself, not just its name.

Preflight stops for unexpected types/data, existing sharing columns, forced RLS, missing canonical friendship locking, or existing interaction SELECT/UPDATE/DELETE/ALL policies requiring review. It does not drop policies. Only the explicitly reviewed legacy recipient/type CHECK is replaced. Other existing constraints stay enforced.

Assumptions needing confirmation: nullable recipient, sequence/identity-generated InteractionID, correct current-time created_at default, compatible extra required columns, working view INSERT policy, ordered Friends.UserAID/UserBID pairs, trusted function owner, and compatible grants/triggers. The migration takes a table lock, backfills historical channels, and builds indexes transactionally.

## Validation

- npm test: 153 passed, 0 failed, 0 skipped.
- npm run test:browser: passed.
- npm run test:friends:browser: passed.
- npm run test:auth:browser: passed.
- npm run test:sharing:browser: passed.
- git diff --check: passed.

The dev-only PGlite dependency runs actual embedded PostgreSQL 18.6 in a new in-memory database, without any remote connection. Tests install fixture Auth/profiles/events/friendships and the exact existing friendship lock/removal functions, then execute the proposed migration with the fixture CHECK name configured. The standalone local/staging SQL rehearsal also executes and rolls back its test rows.

Coverage: native/copy success; cancellation/manual fallback; anonymous behavior; analytics failures; accepted friends only; forged fields/identity; invalid/missing sessions, event IDs and user IDs; origin/account consistency; exact IDs above JavaScript's safe range; recipient isolation; private labels; pagination; direct INSERT/raw-history denial; anonymous RPC denial; repeated clicks; failed sends; idempotent retry after lost response; and an after-insert failure rolling back delivery and analytics.

Chromium exercises both page implementations, 320/390/1280px dialog layouts, recipient inbox/details, nested Escape behavior, and preserved view counts. The new browser suite uses real Node share/view endpoints backed by isolated PostgreSQL.

PGlite is not a complete Supabase stack. Auth/PostgREST transport is represented by fixtures, and browser-native sharing/clipboard outcomes are simulated. Its single-client execution does not independently prove multi-connection lock timing. The SQL additionally has a unique request index and shares the existing friendship lock.

## OKR compatibility

All three sharing methods insert InteractionType=share. Isolated SQL verifies the existing predicate counts all channels and excludes views. No MonthlyOKRScores, OverallOKRScores, CalculateMonthlyOKRs(), or CalculateOverallOKRs() objects were changed. Their actual definitions/schedules were unavailable locally and were not run; compatibility relies on the user's confirmed share-count predicate and tested row shape.

## Features requiring the migration

External sharing itself works without the migration; its analytics fails quietly until the RPC/schema is installed. Direct delivery and Shared with Me require it and show recoverable errors until available. Existing Phase 1 views continue using the existing schema.

## Manual local/staging test steps

1. Inspect staging metadata using the read-only SQL below and the existing Phase 1 inspection. Review and configure the legacy CHECK declaration, then apply the approved draft to staging only.
2. Run the complete local/staging rehearsal below as owner. It needs an accepted pair, an unrelated third Auth-linked user and an event. It rolls back rows; sequence advances and nontransactional trigger effects are not rolled back. Review triggers first.
3. Start the app with separate staging credentials using the command below.
4. Sign in as A. Open details once, then Share. Confirm menu opening adds no view/share. Use Copy link and confirm one share/copy_link record owned by A with NULL recipient.
5. On an actual supporting device, complete native sharing and verify one share/native record. Cancel another operation and verify no new record. Native completion does not prove recipient delivery.
6. Block clipboard access. Confirm the selectable URL appears without a record. Re-enable it and use Copy link to log a confirmed copy. Anonymous external sharing should work without analytics.
7. Choose an accepted friend B and send. Repeated clicks while pending must produce one share/in_app row with A, B, request UUID and generated identity/timestamp. Pending/unrelated C must not appear as choices.
8. Sign in as B separately. Friends -> Shared with Me must show A, event name/time and working details. Opening details adds one B-owned view; bookmark/RSVP redraws add none. C must not see the delivery.
9. Simulate API failure. External sharing still succeeds without analytics popups. Direct sharing shows an error without new success confirmation. Restore service and retry within the same page: its uncertain request UUID must be reused.
10. Recheck filters, plans, friend requests, keyboard navigation, Escape and mobile layouts. Removing a friend blocks new sends; historical delivered shares remain visible.

Staging launch command (replace placeholders; do not overwrite production configuration):

    SUPABASE_URL="https://YOUR-STAGING.supabase.co" SUPABASE_KEY="YOUR-STAGING-PUBLISHABLE-KEY" APP_ORIGIN="http://localhost:3000" npm start

## Exact future activation steps

1. Review the complete metadata output and SQL; set the inspected CHECK name and reconcile any stopped preflight assumptions.
2. Apply the reviewed SQL in isolated staging, run the rehearsal, and complete manual checks with real staging Supabase Auth and actual device sharing.
3. Run npm ci, npm test, and all four browser scripts above. If needed, install the test browser with npx playwright install chromium.
4. After explicit production authorization, apply the approved staging-tested migration as the trusted project owner BEFORE deploying application code. Its PostgREST schema-cache reload notification is included. Do not reapply Phase 1.
5. After deployment authorization, use the existing hosting process and publishable credentials. No new runtime secrets are required.
6. With authorized production test accounts, smoke-test views, native/copy/in-app sharing, inbox and OKR refresh. No score-function change is currently needed.

## Decisions and remaining verification

- Direct shares are persistent history without push/email, chat, or read receipts. Unfriending blocks new deliveries, not prior inbox history.
- Deliberately reopening a menu after success permits another send. Pending duplicates and explicit uncertain retries retain their UUID within a page, including close/reopen. Full page reload discards this in-memory uncertain state.
- External analytics trusts browser-reported success; authenticated API callers can submit these analytics themselves. It cannot prove human intent or external delivery.
- External analytics does not retry automatically, so failures can lose counts.
- Live defaults, extra constraints, triggers, role inheritance, multi-connection timing, real device outcomes, and actual scheduled OKR execution remain staging/production gates.

## Complete changed-file list

- [package.json](../package.json)
- [package-lock.json](../package-lock.json)
- [server.js](../server.js)
- [lib/event-sharing.js](../lib/event-sharing.js)
- [public/event-sharing.js](../public/event-sharing.js)
- [public/app.js](../public/app.js)
- [public/events.js](../public/events.js)
- [public/styles.css](../public/styles.css)
- [tests/browser.mjs](../tests/browser.mjs)
- [tests/events-ui.test.js](../tests/events-ui.test.js)
- [tests/http.test.js](../tests/http.test.js)
- [tests/event-sharing-db.test.js](../tests/event-sharing-db.test.js)
- [tests/event-sharing-http.test.js](../tests/event-sharing-http.test.js)
- [tests/event-sharing-ui.test.js](../tests/event-sharing-ui.test.js)
- [tests/helpers/sharing-database.js](../tests/helpers/sharing-database.js)
- [tests/sharing-browser.mjs](../tests/sharing-browser.mjs)
- [supabase/migrations/20261119000000_event_sharing.sql](../supabase/migrations/20261119000000_event_sharing.sql)
- [supabase/review/event_sharing_inspection.sql](../supabase/review/event_sharing_inspection.sql)
- [supabase/review/event_sharing_diagnostics.sql](../supabase/review/event_sharing_diagnostics.sql)
- [supabase/tests/event_sharing_checks.sql](../supabase/tests/event_sharing_checks.sql)
- [docs/EVENT-SHARING-PHASE-2.md](../docs/EVENT-SHARING-PHASE-2.md)


## Complete read-only inspection SQL

```sql
-- READ ONLY. Review alongside the Phase 1 interaction inspection SQL.
-- NULL here means the exact required RPC signature is not installed.
select to_regprocedure('public.gather_share_event(bigint,text,uuid,uuid)') as share_rpc,
       to_regprocedure('public.gather_received_event_shares(bigint,integer)') as inbox_rpc;
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='EventInteractionLog'
  and column_name in ('ShareChannel','ShareRequestID');
select c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid='public."EventInteractionLog"'::regclass;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('EventInteractionLog','Friends','Events');
select table_name,column_name,data_type,is_nullable,column_default,is_identity
from information_schema.columns where table_schema='public' and table_name in ('EventInteractionLog','Friends','User','Events')
order by table_name,ordinal_position;
select grantee,table_name,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='EventInteractionLog';
select grantee,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='EventInteractionLog';
select p.oid::regprocedure,p.proowner::regrole,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('gather_lock_friend_pair','remove_friend');
select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public."EventInteractionLog"'::regclass and not tgisinternal;
select relowner::regrole,relrowsecurity,relforcerowsecurity from pg_class where oid='public."EventInteractionLog"'::regclass;
select roleid::regrole,member::regrole from pg_auth_members
where member in (select oid from pg_roles where rolname in ('anon','authenticated'));
select pg_get_serial_sequence('public."EventInteractionLog"','InteractionID') as interaction_sequence;
```

## Complete proposed migration (unapplied to production)

```sql
-- REVIEW REQUIRED. Do not run against production before reviewing inspection results.
-- Edit ONLY the legacy constraint name below to the exact inspected CHECK name.
-- Preserves all existing policies, especially the Phase 1 view INSERT policy.
begin;
set local lock_timeout = '10s';
lock table public."EventInteractionLog" in access exclusive mode;
do $$
declare legacy_constraint text := 'REVIEW_REQUIRED_RECIPIENT_CHECK_NAME'; expected record;
begin
  if not exists(select 1 from pg_class where oid=to_regclass('public."EventInteractionLog"') and relrowsecurity and not relforcerowsecurity) then
    raise exception 'Expected existing interaction table with RLS enabled, not forced; review RPC ownership first.';
  end if;
  for expected in select * from (values ('InteractionID','bigint'),('UserID','uuid'),('EventID','bigint'),
    ('InteractionType','text'),('RecipientUserID','uuid'),('created_at','timestamp with time zone')) x(name,kind) loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
      and column_name=expected.name and data_type=expected.kind) then raise exception 'Unexpected column: %',expected.name; end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name in ('ShareChannel','ShareRequestID')) then raise exception 'Sharing columns already exist. Stop rather than rerun.'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='RecipientUserID' and is_nullable='YES')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='created_at' and column_default is not null)
    or pg_get_serial_sequence('public."EventInteractionLog"','InteractionID') is null then
    raise exception 'Review nullable recipient, generated identity and timestamp defaults first.';
  end if;
  if to_regprocedure('public.gather_lock_friend_pair(uuid,uuid)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserAID')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserBID') then
    raise exception 'Canonical accepted friendship schema and pair lock are required.';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog' and cmd='INSERT') then
    raise exception 'Expected the existing Phase 1 view insert policy.';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog' and cmd<>'INSERT') then
    raise exception 'Existing read/update/delete/all interaction policies need privacy review before this migration.';
  end if;
  if legacy_constraint='REVIEW_REQUIRED_RECIPIENT_CHECK_NAME' or not exists(
    select 1 from pg_constraint where conrelid='public."EventInteractionLog"'::regclass
    and conname=legacy_constraint and contype='c'
    and pg_get_constraintdef(oid) like '%RecipientUserID%' and pg_get_constraintdef(oid) like '%InteractionType%'
  ) then raise exception 'Inspect and explicitly name the legacy recipient/type CHECK before proceeding.'; end if;
  if exists(select 1 from public."EventInteractionLog" where "UserID" is null or "EventID" is null or created_at is null
    or "InteractionType" is null or "InteractionType" not in ('view','share')
    or ("InteractionType"='view' and "RecipientUserID" is not null)
    or ("InteractionType"='share' and "RecipientUserID" is null)) then
    raise exception 'Unexpected legacy rows. Review without changing or deleting them.';
  end if;
  execute format('alter table public."EventInteractionLog" drop constraint %I',legacy_constraint);
end; $$;

alter table public."EventInteractionLog" add column "ShareChannel" text, add column "ShareRequestID" uuid;
-- Existing shares had known recipients, so preserve them as in-app history.
update public."EventInteractionLog" set "ShareChannel"='in_app' where "InteractionType"='share';
alter table public."EventInteractionLog" add constraint gather_interaction_channel_shape check (
  "InteractionType" is not null and (
    ("InteractionType"='view' and "RecipientUserID" is null and "ShareChannel" is null and "ShareRequestID" is null)
    or ("InteractionType"='share' and "ShareChannel" is not null and (
      ("ShareChannel" in ('native','copy_link') and "RecipientUserID" is null)
      or ("ShareChannel"='in_app' and "RecipientUserID" is not null and "RecipientUserID"<>"UserID")
    ))
  )
);
create unique index gather_share_request_unique on public."EventInteractionLog" ("UserID","ShareRequestID")
  where "ShareRequestID" is not null;
create index gather_share_inbox_idx on public."EventInteractionLog" ("RecipientUserID","InteractionID" desc)
  where "InteractionType"='share' and "ShareChannel"='in_app';

-- Keep Phase 1 INSERT grants/policy unchanged. New columns have no client grants.
-- Even another permissive policy cannot authorize a direct share INSERT:
-- all share inserts must go through the checked RPC below.
create policy gather_interaction_direct_views_only on public."EventInteractionLog" as restrictive
  for insert to authenticated with check (
    "UserID"=(select auth.uid()) and "InteractionType"='view' and "RecipientUserID" is null
    and "ShareChannel" is null and "ShareRequestID" is null
  );

create function public.gather_share_event(p_event_id bigint,p_channel text,p_recipient uuid,p_request_id uuid)
returns table(interaction_id text)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid := auth.uid(); previous public."EventInteractionLog"; inserted_id bigint;
begin
  if actor is null then raise exception using errcode='42501',message='Sign in to share.'; end if;
  if p_event_id is null or p_event_id<1 or p_request_id is null or p_channel is null
    or p_channel not in ('native','copy_link','in_app')
    or (p_channel='in_app' and (p_recipient is null or p_recipient=actor))
    or (p_channel<>'in_app' and p_recipient is not null) then
    raise exception using errcode='22023',message='Invalid share fields.';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='25001',message='Sharing requires READ COMMITTED isolation.';
  end if;
  -- Serialize identical requests; callers retry with the same UUID after ambiguity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('share:'||actor::text||':'||p_request_id::text,0));
  select * into previous from public."EventInteractionLog" where "UserID"=actor and "ShareRequestID"=p_request_id;
  if found then
    if previous."EventID" is distinct from p_event_id or previous."ShareChannel" is distinct from p_channel
      or previous."RecipientUserID" is distinct from p_recipient or previous."InteractionType"<>'share' then
      raise exception using errcode='23505',message='Request ID already used with different fields.';
    end if;
    return query select previous."InteractionID"::text; return;
  end if;
  perform 1 from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=actor;
  if not found then raise exception using errcode='23503',message='Sender unavailable.'; end if;
  perform 1 from public."Events" e where e."EventID"=p_event_id for key share;
  if not found then raise exception using errcode='23503',message='Event unavailable.'; end if;
  if p_channel='in_app' then
    perform public.gather_lock_friend_pair(actor,p_recipient);
    perform 1 from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=p_recipient;
    if not found then raise exception using errcode='23503',message='Recipient unavailable.'; end if;
    if not exists(select 1 from public."Friends" f where f."UserAID"=least(actor,p_recipient) and f."UserBID"=greatest(actor,p_recipient)) then
      raise exception using errcode='42501',message='An accepted friendship is required.';
    end if;
  end if;
  -- One row is both delivery and analytics. A failed transaction creates neither.
  insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID","ShareChannel","ShareRequestID")
    values(actor,p_event_id,'share',p_recipient,p_channel,p_request_id) returning "InteractionID" into inserted_id;
  return query select inserted_id::text;
end; $$;

create function public.gather_received_event_shares(p_after bigint default null,p_limit integer default 21)
returns table(interaction_id text,event_id text,event_name text,sender_name text,shared_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='Sign in to read shared events.'; end if;
  if p_limit is null or p_limit<1 or p_limit>51 or (p_after is not null and p_after<1) then
    raise exception using errcode='22023',message='Invalid inbox page.';
  end if;
  return query select l."InteractionID"::text,l."EventID"::text,
    left(coalesce(e."EventName",'Event unavailable'),200),
    left(case when u."IsPrivate" is distinct from false then coalesce('@'||nullif(u."Username",''),'Gather member')
      else coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),'Gather member') end,80),l.created_at
  from public."EventInteractionLog" l
  left join public."User" u on u."UserID"=l."UserID"
  left join public."Events" e on e."EventID"=l."EventID"
  where l."RecipientUserID"=actor and l."InteractionType"='share' and l."ShareChannel"='in_app'
    and l."EventID" is not null and (p_after is null or l."InteractionID"<p_after)
  order by l."InteractionID" desc limit p_limit;
end; $$;

revoke all on function public.gather_share_event(bigint,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.gather_received_event_shares(bigint,integer) from public, anon, authenticated;
grant execute on function public.gather_share_event(bigint,text,uuid,uuid) to authenticated;
grant execute on function public.gather_received_event_shares(bigint,integer) to authenticated;
-- Owner-created SECURITY DEFINER functions require a trusted owner able to access
-- the named tables; execute only this reviewed migration as the project owner.
-- No EventInteractionLog SELECT/UPDATE/DELETE grants or SELECT policies are added.
notify pgrst, 'reload schema';
commit;
```

## Complete local/staging SQL rehearsal

```sql
-- LOCAL/STAGING ONLY, after applying the reviewed sharing migration.
-- Run as project owner. Requires an accepted pair and an unrelated third user.
-- Rolls back rows; consumed sequence values and nontransactional trigger side
-- effects are not rolled back. Inspect triggers first. Never run on production.
begin;
set local lock_timeout='10s';
do $$
declare sender uuid; recipient uuid; outsider uuid; event_id bigint;
begin
  select f."UserAID",f."UserBID" into sender,recipient from public."Friends" f
    join auth.users a on a.id=f."UserAID" join auth.users b on b.id=f."UserBID" limit 1;
  select u."UserID" into outsider from public."User" u join auth.users a on a.id=u."UserID"
    where u."UserID" not in (sender,recipient) and not exists(select 1 from public."Friends" f
      where f."UserAID"=least(sender,u."UserID") and f."UserBID"=greatest(sender,u."UserID")) limit 1;
  select "EventID" into event_id from public."Events" where "EventID">0 order by "EventID" desc limit 1;
  if sender is null or recipient is null or outsider is null or event_id is null then
    raise exception 'Provide an accepted pair, an unrelated third Auth-linked profile and an event in local/staging.';
  end if;
  perform set_config('gather.share_sender',sender::text,true);
  perform set_config('gather.share_recipient',recipient::text,true);
  perform set_config('gather.share_outsider',outsider::text,true);
  perform set_config('gather.share_event',event_id::text,true);
  perform set_config('gather.share_native_key',gen_random_uuid()::text,true);
  perform set_config('gather.share_copy_key',gen_random_uuid()::text,true);
  perform set_config('gather.share_direct_key',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claim.sub',sender::text,true);
end; $$;
set local role authenticated;
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'native',null,current_setting('gather.share_native_key')::uuid);
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'copy_link',null,current_setting('gather.share_copy_key')::uuid);
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_recipient')::uuid,current_setting('gather.share_direct_key')::uuid);
-- Retry the same delivery: returns the same ID and must not insert another row.
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_recipient')::uuid,current_setting('gather.share_direct_key')::uuid);
do $$ begin
  begin
    perform public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_outsider')::uuid,gen_random_uuid());
    raise exception 'Nonfriend send unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
      values(current_setting('gather.share_sender')::uuid,current_setting('gather.share_event')::bigint,'share',current_setting('gather.share_recipient')::uuid);
    raise exception 'Direct share INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
      values(current_setting('gather.share_recipient')::uuid,current_setting('gather.share_event')::bigint,'view',null);
    raise exception 'Forged viewer unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$
declare delivery text;
begin
  if (select count(*) from public."EventInteractionLog" where "UserID"=current_setting('gather.share_sender')::uuid
    and "ShareRequestID" in (current_setting('gather.share_native_key')::uuid,current_setting('gather.share_copy_key')::uuid,current_setting('gather.share_direct_key')::uuid)
    and "InteractionType"='share')<>3 then raise exception 'Expected exactly three OKR-compatible share records'; end if;
  if (select count(*) from public."EventInteractionLog" where "UserID"=current_setting('gather.share_sender')::uuid
    and "ShareRequestID" in (current_setting('gather.share_native_key')::uuid,current_setting('gather.share_copy_key')::uuid)
    and "RecipientUserID" is null and "ShareChannel" in ('native','copy_link'))<>2 then raise exception 'External share shape mismatch'; end if;
  select "InteractionID"::text into delivery from public."EventInteractionLog"
    where "UserID"=current_setting('gather.share_sender')::uuid and "ShareRequestID"=current_setting('gather.share_direct_key')::uuid;
  perform set_config('gather.share_delivery',delivery,true);
  perform set_config('request.jwt.claim.sub',current_setting('gather.share_recipient'),true);
end; $$;
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.gather_received_event_shares(null,51) where interaction_id=current_setting('gather.share_delivery')) then
    raise exception 'Recipient cannot see the delivered share'; end if;
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('gather.share_outsider'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.gather_received_event_shares(null,51) where interaction_id=current_setting('gather.share_delivery')) then
    raise exception 'Outsider can read someone else''s share'; end if;
  begin
    if exists(select 1 from public."EventInteractionLog") then raise exception 'Raw interaction history is readable'; end if;
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin
    perform public.gather_share_event(current_setting('gather.share_event')::bigint,'native',null,gen_random_uuid());
    raise exception 'Anonymous share unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gather_received_event_shares(null,21);
    raise exception 'Anonymous inbox read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
```

## Copy-link diagnostics follow-up

SHARING_UNAVAILABLE was a generic wrapper and did not identify the underlying Supabase error. Missing RPC/table/column/schema-cache errors now return SHARING_SETUP_REQUIRED. Other errors retain their existing status mapping. The server logs only the sanitized Supabase error code; database messages, row details, credentials and tokens are not logged. Browser analytics warnings include the safe application code without interrupting copying or retrying.

The read-only inspection now starts by checking both exact RPC signatures. A NULL result means that signature is absent. If the share RPC is absent, external share logging requires the reviewed Phase 2 migration; copying itself still works. If it exists, inspect the server's provider code for the actual failure. No remote schema inspection, migration, production-data write or deployment was performed for this follow-up. Restart a server launched with npm start to load the new diagnostics; it does not watch files.

## Live setup repair: confirmed unresolved gate

The reported PGRST202 means the current PostgREST cache cannot resolve the requested sharing function and named arguments. Both external logging and direct delivery use gather_share_event. Changing application error text does not install or expose that database function.

The single-result read-only event_sharing_diagnostics.sql reports function argument names and execution privileges, all log columns/constraints/policies/grants/triggers, and accepted-friendship schema metadata. Its output is required to safely distinguish an uninstalled migration, partial installation, signature mismatch, or cache problem on the affected project. No production SQL connection was available, so the live repair remains pending that output and any required production authorization.

An additional isolated regression verifies that missing functions prevent both share channels from inserting, then configures and applies the migration to the fixture and confirms exactly one copy-link record, one direct delivery/analytics record, recipient visibility, and preserved views. This verifies the proposed repair in isolation, not its deployment to the affected project.
