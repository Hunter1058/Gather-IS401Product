# Complete Gather OKR production setup

The application implementation is complete. Current validation: 173 Node tests passed, zero failures/skips; Events, Friends, Auth and Sharing browser suites all passed. No production SQL, deployment, or commit was performed.

Use the single repair below instead of the earlier Phase 2 placeholder migration. No diagnostic round trip or constraint-name editing is required for supported repository schemas. It matches the exact application calls in [lib/event-sharing.js](../lib/event-sharing.js):

- gather_share_event(p_event_id bigint, p_channel text, p_recipient uuid, p_request_id uuid) returns TABLE(interaction_id text).
- gather_received_event_shares(p_after bigint, p_limit integer) returns TABLE(interaction_id text, event_id text, event_name text, sender_name text, shared_at timestamptz).

## What the repair does

It checks the existing schema and trusted execution role, recognizes known legacy recipient CHECK definitions through PostgreSQL's parsed expressions, adds missing channel/request columns, classifies prior recipient-bearing shares as in_app, installs the channel constraint and indexes, preserves existing view policies, and supplies narrow view grants plus restrictive guards. It replaces only the two sharing RPC names (including old overloads), with DROP RESTRICT to protect dependent objects, installs the exact expected arguments/returns, grants authenticated-only execution, and notifies PostgREST to reload its schema cache.

No user, event, RSVP, friendship or interaction row is deleted; existing interaction IDs, timestamps, participants and types are retained. Existing score objects are not modified. Full-script reruns preserve existing records and deduplication keys.

The entire script is transactional. Unsupported types/CHECKs, unsafe read policies, unknown restrictive INSERT policies, inherited broad INSERT grants, incompatible request indexes or dependent database objects cause rollback. The exception identifies the mismatch. These are intentional safeguards, not placeholders. If the SQL Editor leaves an aborted transaction after an error, execute ROLLBACK before another attempt; do not run only the tail of the script.

## Running it

1. Open SQL Editor in the Supabase project used by the application server.
2. Choose the trusted project-owner role (normally postgres).
3. Paste and run the COMPLETE repair SQL below in one execution. Do not run the earlier placeholder migration as well.
4. Run the complete read-only verification query below. Every row must report passed=true.
5. Refresh Gather. If the local Node process predates the application changes, restart it using npm start. No new credentials are needed.

The script is prepared for manual execution, not already applied. Production application and deployment still require the user's authorization.

## End-to-end smoke test

Use two authorized test accounts A and B, and an unrelated account C:

1. Accept a friend request between A/B. Confirm one accepted friendship in Friends. This is the friends OKR source.
2. As A, RSVP to an event. Confirm RSVPGoing=true in RSVP. This is the RSVP OKR source.
3. Open that event's details once. Confirm a UserID=A view interaction. Bookmark/RSVP redraws and opening the share menu must add no view.
4. Copy its link once. Confirm exactly one UserID=A, InteractionType=share, ShareChannel=copy_link, RecipientUserID=NULL record.
5. On an actual supporting device, complete native sharing and confirm a native share row; cancellation adds none. Browser completion cannot prove external delivery.
6. Send to accepted friend B. Confirm one in_app share with A/B and a request UUID, even with repeated clicks while pending. C must not be an eligible recipient.
7. As B, visit Friends -> Shared with Me, verify sender/event/time and open details. This creates a B-owned view. C must not see B's shares.
8. Compare the four source measures: accepted Friends pair, active RSVP, view interactions, share interactions. Existing monthly/overall calculations should include both external and in_app shares because all retain InteractionType=share.

The repair deliberately does not invoke CalculateMonthlyOKRs()/CalculateOverallOKRs() or alter score rows/schedules. Their live definitions were not available locally. Source compatibility and unchanged score objects are tested; actual scheduled production aggregation remains a post-setup check.

## Validation scope and remaining intervention

Embedded PostgreSQL tests exercise actual SQL, RLS/grants and transactional rollback. Browser tests use real Node share/view endpoints backed by that isolated database. Auth/PostgREST and device/clipboard results are represented by fixtures; real Supabase Auth/cache behavior, real native-device completion and production multi-connection timing still need the smoke test above.

The required manual action is executing the reviewed SQL on the affected project, followed by verification. No database password or secret key is requested. If a specific precondition fails, its error is the only schema-specific intervention needed; the script commits nothing from the failed attempt.

Production repair files:

- [Complete repair](../supabase/repairs/20261120000000_complete_okr_sharing.sql)
- [Read-only verification](../supabase/review/complete_okr_sharing_verification.sql)
- [Repair regression tests](../tests/okr-repair.test.js)

## Complete repair SQL

```sql
-- Gather OKR sharing repair. Run this ENTIRE script as the Supabase project owner.
-- No placeholders. No user/event/RSVP/friend rows are changed or deleted.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Known CHECK shapes, parsed by PostgreSQL itself for safe comparison.
create temporary table gather_okr_check_shapes (
  "UserID" uuid, "InteractionType" text, "RecipientUserID" uuid,
  "ShareChannel" text, "ShareRequestID" uuid,
  constraint legacy_full check (
    ("InteractionType"='view' and "RecipientUserID" is null)
    or ("InteractionType"='share' and "RecipientUserID" is not null)),
  constraint legacy_reversed check (
    ("InteractionType"='share' and "RecipientUserID" is not null)
    or ("InteractionType"='view' and "RecipientUserID" is null)),
  constraint legacy_share_required check ("InteractionType"<>'share' or "RecipientUserID" is not null),
  constraint legacy_view_or_recipient check ("InteractionType"='view' or "RecipientUserID" is not null),
  constraint legacy_equivalence check (("InteractionType"='share')=("RecipientUserID" is not null)),
  constraint legacy_case check (case when "InteractionType"='share' then "RecipientUserID" is not null else "RecipientUserID" is null end),
  constraint legacy_nonshare_null check (
    ("InteractionType"='share' and "RecipientUserID" is not null)
    or ("InteractionType"<>'share' and "RecipientUserID" is null)),
  constraint legacy_distinct_recipient check (
    ("InteractionType"='view' and "RecipientUserID" is null)
    or ("InteractionType"='share' and "RecipientUserID" is not null and "RecipientUserID"<>"UserID")),
  constraint channel_shape check (
    "InteractionType" is not null and (
      ("InteractionType"='view' and "RecipientUserID" is null and "ShareChannel" is null and "ShareRequestID" is null)
      or ("InteractionType"='share' and "ShareChannel" is not null and (
        ("ShareChannel" in ('native','copy_link') and "RecipientUserID" is null)
        or ("ShareChannel"='in_app' and "RecipientUserID" is not null and "RecipientUserID"<>"UserID")
      ))
    ))
) on commit drop;

do $$
declare spec record; c record; expr text; seq text;
begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Run as the trusted project owner (postgres), not anon/authenticated.';
  end if;
  for spec in select * from (values
    ('EventInteractionLog','InteractionID','bigint'),('EventInteractionLog','UserID','uuid'),
    ('EventInteractionLog','EventID','bigint'),('EventInteractionLog','InteractionType','text'),
    ('EventInteractionLog','RecipientUserID','uuid'),('EventInteractionLog','created_at','timestamp with time zone'),
    ('Events','EventID','bigint'),('Events','EventName','text'),
    ('User','UserID','uuid'),('User','Username','text'),('User','IsPrivate','boolean'),
    ('User','UserFirstName','text'),('User','UserLastName','text'),
    ('Friends','UserAID','uuid'),('Friends','UserBID','uuid')
  ) required(tbl,col,kind) loop
    if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name=spec.tbl and column_name=spec.col and data_type=spec.kind) then
      raise exception 'Schema mismatch: public.%.% must be %. No changes committed.',spec.tbl,spec.col,spec.kind;
    end if;
  end loop;
  if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null
    or to_regprocedure('public.gather_lock_friend_pair(uuid,uuid)') is null then
    raise exception 'Supabase Auth and canonical friendship pair-lock function are required.';
  end if;
  if not exists(select 1 from pg_class where oid='public."EventInteractionLog"'::regclass and relrowsecurity) then
    raise exception 'EventInteractionLog must already have RLS enabled.';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog'
    and cmd in ('SELECT','UPDATE','DELETE','ALL')) then
    raise exception 'Existing EventInteractionLog read/update/delete/ALL policies need privacy review. Nothing committed.';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog'
    and cmd='INSERT' and permissive='RESTRICTIVE' and policyname not in (
      'gather_interaction_direct_views_only','gather_okr_repair_direct_views','gather_okr_repair_no_anon')) then
    raise exception 'An unrecognized restrictive INSERT policy requires review to preserve working views.';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='RecipientUserID' and is_nullable<>'YES') then
    raise exception 'RecipientUserID must be nullable for views/external shares.';
  end if;
  seq:=pg_get_serial_sequence('public."EventInteractionLog"','InteractionID');
  if seq is null or not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='EventInteractionLog' and column_name='InteractionID' and (is_identity='YES' or column_default is not null)) then
    raise exception 'InteractionID needs its existing identity/sequence default.';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='created_at' and column_default is not null) then
    raise exception 'created_at needs its existing timestamp default.';
  end if;
  for spec in select * from (values ('ShareChannel','text'),('ShareRequestID','uuid')) extra(col,kind) loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
      and column_name=spec.col and (data_type<>spec.kind or column_default is not null or is_generated<>'NEVER' or is_nullable<>'YES')) then
      raise exception 'Existing % must be nullable %, without a default or generated expression.',spec.col,spec.kind;
    end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name not in ('InteractionID','UserID','EventID','InteractionType','RecipientUserID','created_at','ShareChannel','ShareRequestID')
    and is_nullable='NO' and column_default is null and is_identity='NO' and is_generated='NEVER') then
    raise exception 'Additional required interaction columns lack defaults.';
  end if;
  if not has_schema_privilege('authenticated','public','USAGE')
    or not has_column_privilege('authenticated','public."Events"','EventID','SELECT') then
    raise exception 'Existing authenticated schema/event-read grants are missing; restore the working event browsing permissions first.';
  end if;
  -- Refuse unknown coupling CHECKs rather than guessing their names or meaning.
  for c in select * from pg_constraint where conrelid='public."EventInteractionLog"'::regclass and contype='c' loop
    expr:=pg_get_expr(c.conbin,c.conrelid);
    if expr like '%"RecipientUserID"%' and expr like '%"InteractionType"%'
      or expr like '%"ShareChannel"%' or expr like '%"ShareRequestID"%' then
      if not exists(select 1 from pg_constraint probe
        where probe.conrelid='pg_temp.gather_okr_check_shapes'::regclass
        and regexp_replace(pg_get_expr(probe.conbin,probe.conrelid),'[[:space:]]','','g')=
            regexp_replace(expr,'[[:space:]]','','g')) then
        raise exception 'Unsupported interaction CHECK %: %. Nothing committed.',c.conname,expr;
      end if;
    end if;
  end loop;
end; $$;

lock table public."EventInteractionLog" in access exclusive mode;
alter table public."EventInteractionLog" add column if not exists "ShareChannel" text;
alter table public."EventInteractionLog" add column if not exists "ShareRequestID" uuid;

do $$
declare c record; expr text;
begin
  for c in select * from pg_constraint where conrelid='public."EventInteractionLog"'::regclass and contype='c' loop
    expr:=pg_get_expr(c.conbin,c.conrelid);
    if exists(select 1 from pg_constraint probe where probe.conrelid='pg_temp.gather_okr_check_shapes'::regclass
      and regexp_replace(pg_get_expr(probe.conbin,probe.conrelid),'[[:space:]]','','g')=regexp_replace(expr,'[[:space:]]','','g')) then
      execute format('alter table public."EventInteractionLog" drop constraint %I',c.conname);
    end if;
  end loop;
end; $$;
-- Historical shares previously required a known recipient. Preserve that history.
update public."EventInteractionLog" set "ShareChannel"='in_app'
where "InteractionType"='share' and "ShareChannel" is null and "RecipientUserID" is not null;

alter table public."EventInteractionLog" add constraint gather_interaction_channel_shape check (
  "InteractionType" is not null and (
    ("InteractionType"='view' and "RecipientUserID" is null and "ShareChannel" is null and "ShareRequestID" is null)
    or ("InteractionType"='share' and "ShareChannel" is not null and (
      ("ShareChannel" in ('native','copy_link') and "RecipientUserID" is null)
      or ("ShareChannel"='in_app' and "RecipientUserID" is not null and "RecipientUserID"<>"UserID")
    ))
  )
);
create unique index if not exists gather_share_request_unique
  on public."EventInteractionLog" ("UserID","ShareRequestID") where "ShareRequestID" is not null;
create index if not exists gather_share_inbox_idx on public."EventInteractionLog" ("RecipientUserID","InteractionID" desc)
  where "InteractionType"='share' and "ShareChannel"='in_app';
do $$ begin
  if not exists(select 1 from pg_index i
    where i.indexrelid=to_regclass('public.gather_share_request_unique')
      and i.indrelid='public."EventInteractionLog"'::regclass and i.indisunique and i.indisvalid
      and i.indnkeyatts=2 and i.indnatts=2 and i.indexprs is null
      and i.indkey::text=(select string_agg(attnum::text,' ' order by array_position(array['UserID','ShareRequestID'],attname::text))
        from pg_attribute where attrelid=i.indrelid and attname in ('UserID','ShareRequestID'))
      and regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[[:space:]()]','','g')='"ShareRequestID"ISNOTNULL') then
    raise exception 'gather_share_request_unique exists with an incompatible definition. Nothing committed.';
  end if;
end; $$;

-- Preserve existing view policies. Supply a narrowly scoped permissive policy
-- and restrictive guards; even a broad INSERT policy cannot authorize shares.
drop policy if exists gather_okr_repair_views on public."EventInteractionLog";
create policy gather_okr_repair_views on public."EventInteractionLog" for insert to authenticated
  with check ("UserID"=(select auth.uid()) and "InteractionType"='view' and "RecipientUserID" is null
    and exists(select 1 from public."Events" e where e."EventID"="EventInteractionLog"."EventID"));
drop policy if exists gather_okr_repair_direct_views on public."EventInteractionLog";
create policy gather_okr_repair_direct_views on public."EventInteractionLog" as restrictive for insert to authenticated
  with check ("UserID"=(select auth.uid()) and "InteractionType"='view' and "RecipientUserID" is null and "ShareChannel" is null and "ShareRequestID" is null
    and exists(select 1 from public."Events" e where e."EventID"="EventInteractionLog"."EventID"));
drop policy if exists gather_okr_repair_no_anon on public."EventInteractionLog";
create policy gather_okr_repair_no_anon on public."EventInteractionLog" as restrictive for insert to anon with check (false);

do $$
declare c record; seq text;
begin
  revoke insert on public."EventInteractionLog" from public,anon,authenticated;
  for c in select column_name from information_schema.columns where table_schema='public' and table_name='EventInteractionLog' loop
    execute format('revoke insert (%I) on public."EventInteractionLog" from public,anon,authenticated',c.column_name);
  end loop;
  grant insert ("UserID","EventID","InteractionType","RecipientUserID") on public."EventInteractionLog" to authenticated;
  seq:=pg_get_serial_sequence('public."EventInteractionLog"','InteractionID');
  execute format('grant usage on sequence %s to authenticated',seq);
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name in ('InteractionID','created_at','ShareChannel','ShareRequestID')
    and has_column_privilege('authenticated','public."EventInteractionLog"',column_name,'INSERT')) then
    raise exception 'Inherited INSERT grants expose generated/sharing fields. Reconcile role grants first.';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and has_column_privilege('anon','public."EventInteractionLog"',column_name,'INSERT')) then
    raise exception 'Inherited anonymous INSERT grants must be removed first.';
  end if;
  -- Remove only this feature's RPCs, including conflicting overloads/argument
  -- names. RESTRICT (never CASCADE) aborts if a DB object depends on one.
  for c in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('gather_share_event','gather_received_event_shares') loop
    execute format('drop function %s restrict',c.signature);
  end loop;
end; $$;

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
  perform 1 from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=actor for key share of u;
  if not found then raise exception using errcode='23503',message='Sender unavailable.'; end if;
  perform 1 from public."Events" e where e."EventID"=p_event_id for key share;
  if not found then raise exception using errcode='23503',message='Event unavailable.'; end if;
  if p_channel='in_app' then
    perform public.gather_lock_friend_pair(actor,p_recipient);
    perform 1 from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=p_recipient for key share of u;
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

do $$ begin
  if has_function_privilege('anon','public.gather_share_event(bigint,text,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.gather_received_event_shares(bigint,integer)','EXECUTE') then
    raise exception 'Inherited/default function grants expose sharing RPCs to anon. Nothing committed.';
  end if;
end; $$;

notify pgrst, 'reload schema';
commit;
```

## Complete verification query

```sql
-- READ ONLY. Every required check must return true after the repair.
with rpc as (
  select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('gather_share_event','gather_received_event_shares')
), checks as (
  select 'share RPC: exact input names/types and output' as check_name,
    exists(select 1 from rpc where oid=to_regprocedure('public.gather_share_event(bigint,text,uuid,uuid)')
      and proargnames[1:4]=array['p_event_id','p_channel','p_recipient','p_request_id']
      and pg_get_function_result(oid)='TABLE(interaction_id text)') as passed
  union all select 'inbox RPC: exact input names/types and output',
    exists(select 1 from rpc where oid=to_regprocedure('public.gather_received_event_shares(bigint,integer)')
      and proargnames[1:2]=array['p_after','p_limit']
      and pg_get_function_result(oid)='TABLE(interaction_id text, event_id text, event_name text, sender_name text, shared_at timestamp with time zone)')
  union all select 'no conflicting overloads',(select count(*)=2 from rpc)
  union all select 'trusted-owner definer RPCs, empty search_path',
    (select count(*)=2 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
      and (r.rolsuper or r.rolbypassrls)) from rpc p join pg_roles r on r.oid=p.proowner)
  union all select 'authenticated execution only',
    (select count(*)=2 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE')
      and not has_function_privilege('anon',oid,'EXECUTE')) from rpc)
  union all select 'interaction RLS enabled',
    exists(select 1 from pg_class where oid=to_regclass('public."EventInteractionLog"') and relrowsecurity)
  union all select 'view and restrictive insert policies present',
    (select count(*)=3 from pg_policies where schemaname='public' and tablename='EventInteractionLog'
      and policyname in ('gather_okr_repair_views','gather_okr_repair_direct_views','gather_okr_repair_no_anon') and cmd='INSERT')
  union all select 'no raw history read/update/delete policies',
    not exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog' and cmd in ('SELECT','UPDATE','DELETE','ALL'))
  union all select 'authenticated view insert columns granted',
    (select bool_and(has_column_privilege('authenticated','public."EventInteractionLog"',col,'INSERT'))
      from unnest(array['UserID','EventID','InteractionType','RecipientUserID']) col)
  union all select 'generated and share-only columns cannot be supplied directly',
    (select bool_and(not has_column_privilege('authenticated','public."EventInteractionLog"',col,'INSERT'))
      from unnest(array['InteractionID','created_at','ShareChannel','ShareRequestID']) col)
  union all select 'anonymous cannot insert interactions',
    not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
      and has_column_privilege('anon','public."EventInteractionLog"',column_name,'INSERT'))
  union all select 'identity sequence usable by authenticated',
    coalesce(has_sequence_privilege('authenticated',pg_get_serial_sequence('public."EventInteractionLog"','InteractionID'),'USAGE'),false)
  union all select 'validated channel constraint present',
    exists(select 1 from pg_constraint where conrelid=to_regclass('public."EventInteractionLog"')
      and conname='gather_interaction_channel_shape' and convalidated)
  union all select 'valid unique request index present',
    exists(select 1 from pg_index where indexrelid=to_regclass('public.gather_share_request_unique')
      and indrelid=to_regclass('public."EventInteractionLog"') and indisunique and indisvalid)
)
select check_name,coalesce(passed,false) as passed from checks order by check_name;
```
