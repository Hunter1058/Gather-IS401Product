-- For current manual production setup, use the consolidated repair instead:
-- ../repairs/20261120000000_complete_okr_sharing.sql (no placeholders; tested reruns).
-- This earlier draft is retained for historical migration/rehearsal coverage.
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
