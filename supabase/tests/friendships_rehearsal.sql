-- GENERATED REHEARSAL ONLY: run the whole file as Supabase project owner.
-- Applies the proposed migration and behavioral/permission checks in ONE
-- transaction, then ROLLBACKs table/function/policy changes. Existing Friends
-- identity values may advance (harmless gaps): sequences are not transactional.
-- Uses two existing real profiles. Does not change User or auth.users rows.
-- Never run the local-only friendships_bootstrap.sql in the shared database.
begin;
set local lock_timeout = '10s';

lock table public."Friends" in access exclusive mode;
do $$
begin
  if exists (select 1 from public."Friends") then
    raise exception 'Friends is no longer empty. Stop and review its records; nothing will be deleted.';
  end if;
  if to_regclass('public."FriendRequest"') is not null then
    raise exception 'FriendRequest already exists. This migration is not a rerun script.';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'Friends') <> 3
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'Friends' and column_name = 'FriendshipID') is distinct from 'int8'
     or (select is_identity from information_schema.columns where table_schema = 'public' and table_name = 'Friends' and column_name = 'FriendshipID') is distinct from 'YES'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'Friends' and column_name = 'UserID') is distinct from 'uuid'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'Friends' and column_name = 'FriendUserID') is distinct from 'uuid'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'User' and column_name = 'UserID') is distinct from 'uuid' then
    raise exception 'The inspected UUID Friends/User schema has changed. Review before applying.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'Friends')
     or exists (select 1 from pg_trigger where tgrelid = 'public."Friends"'::regclass and not tgisinternal)
     or exists (select 1 from pg_constraint where confrelid = 'public."Friends"'::regclass) then
    raise exception 'Friends now has policies, custom triggers or incoming foreign keys. Review those dependencies first.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'gather_lock_friend_pair', 'gather_guard_friend_request',
        'send_friend_request', 'respond_to_friend_request',
        'cancel_friend_request', 'remove_friend')) then
    raise exception 'A proposed friendship function name is already in use. Review instead of replacing it.';
  end if;
end;
$$;

-- Preserve the table and its generated FriendshipID primary key.
alter table public."Friends" rename column "UserID" to "UserAID";
alter table public."Friends" rename column "FriendUserID" to "UserBID";
alter table public."Friends" rename constraint "Friends_UserID_fkey" to "Friends_UserAID_fkey";
alter table public."Friends" rename constraint "Friends_FriendUserID_fkey" to "Friends_UserBID_fkey";
alter table public."Friends"
  alter column "UserAID" set not null,
  add column "FriendsSince" timestamptz not null default clock_timestamp(),
  add constraint gather_friends_ordered_pair check ("UserAID" < "UserBID"),
  add constraint gather_friends_unique_pair unique ("UserAID", "UserBID");
create index gather_friends_user_b_idx on public."Friends" ("UserBID");

create table public."FriendRequest" (
  "FriendRequestID" bigint generated always as identity primary key,
  "RequesterUserID" uuid not null references public."User"("UserID") on delete cascade,
  "RecipientUserID" uuid not null references public."User"("UserID") on delete cascade,
  "Status" text not null default 'pending',
  "RequestedAt" timestamptz not null default clock_timestamp(),
  "ResolvedAt" timestamptz,
  constraint gather_request_distinct_users check ("RequesterUserID" <> "RecipientUserID"),
  constraint gather_request_valid_status check ("Status" in ('pending', 'accepted', 'declined', 'cancelled')),
  constraint gather_request_resolution check (
    ("Status" = 'pending' and "ResolvedAt" is null)
    or ("Status" in ('accepted', 'declined', 'cancelled')
      and "ResolvedAt" is not null and "ResolvedAt" >= "RequestedAt")
  )
);
-- Opposite-direction pending requests are the same pair, but resolved attempts
-- are deliberately NOT unique: repeated requests must retain separate IDs.
create unique index gather_request_one_pending_pair
  on public."FriendRequest" (
    least("RequesterUserID", "RecipientUserID"),
    greatest("RequesterUserID", "RecipientUserID")
  ) where "Status" = 'pending';
create index gather_request_incoming_idx
  on public."FriendRequest" ("RecipientUserID", "Status", "RequestedAt" desc, "FriendRequestID" desc);
create index gather_request_outgoing_idx
  on public."FriendRequest" ("RequesterUserID", "Status", "RequestedAt" desc, "FriendRequestID" desc);

-- Transaction-level lock: every action for an unordered pair uses the same
-- key, including attempts in opposite directions. A hash collision only causes
-- unrelated pairs to wait; it cannot authorize or mix their records.
create function public.gather_lock_friend_pair(p_a uuid, p_b uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  -- Fresh statement snapshots after waiting are essential to cross-table checks.
  -- Supabase RPCs normally use READ COMMITTED. Reject stale-snapshot contexts.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25001', message = 'Friendship actions require READ COMMITTED transaction isolation.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0));
end;
$$;

-- Resolved history is immutable, and participants/time/ID cannot be rewritten.
-- Deleting an actual User still cascades as the explicit retention policy.
create function public.gather_guard_friend_request()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new."FriendRequestID" is distinct from old."FriendRequestID"
     or new."RequesterUserID" is distinct from old."RequesterUserID"
     or new."RecipientUserID" is distinct from old."RecipientUserID"
     or new."RequestedAt" is distinct from old."RequestedAt" then
    raise exception using errcode = '23514', message = 'Request identity, participants and sent time are immutable.';
  end if;
  if old."Status" <> 'pending' and new is distinct from old then
    raise exception using errcode = '23514', message = 'A resolved request cannot be rewritten. Send a new request instead.';
  end if;
  return new;
end;
$$;
create trigger gather_friend_request_immutable
before update on public."FriendRequest"
for each row execute function public.gather_guard_friend_request();

create function public.send_friend_request(p_recipient_user_id uuid)
returns public."FriendRequest"
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_request public."FriendRequest";
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Sign in to send a friend request.'; end if;
  if p_recipient_user_id is null or p_recipient_user_id = v_actor then
    raise exception using errcode = '22023', message = 'Choose another user.';
  end if;
  v_a := least(v_actor, p_recipient_user_id);
  v_b := greatest(v_actor, p_recipient_user_id);
  perform public.gather_lock_friend_pair(v_a, v_b);
  if not exists (select 1 from public."User" where "UserID" = v_actor)
     or not exists (select 1 from public."User" where "UserID" = p_recipient_user_id) then
    raise exception using errcode = '23503', message = 'A user profile is not available.';
  end if;
  if exists (select 1 from public."Friends" where "UserAID" = v_a and "UserBID" = v_b) then
    raise exception using errcode = '22023', message = 'You are already friends.';
  end if;
  select * into v_request from public."FriendRequest"
    where "Status" = 'pending'
      and least("RequesterUserID", "RecipientUserID") = v_a
      and greatest("RequesterUserID", "RecipientUserID") = v_b;
  if found then
    if v_request."RequesterUserID" = v_actor then return v_request; end if;
    raise exception using errcode = '22023', message = 'An incoming request already exists. Accept or decline it first.';
  end if;
  insert into public."FriendRequest" ("RequesterUserID", "RecipientUserID")
    values (v_actor, p_recipient_user_id) returning * into v_request;
  return v_request;
end;
$$;

create function public.respond_to_friend_request(p_request_id bigint, p_accept boolean)
returns public."FriendRequest"
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request public."FriendRequest";
  v_status text;
  v_when timestamptz;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Sign in to respond to a friend request.'; end if;
  if p_request_id is null or p_accept is null then raise exception using errcode = '22023', message = 'A request and boolean decision are required.'; end if;
  select * into v_request from public."FriendRequest"
    where "FriendRequestID" = p_request_id and "RecipientUserID" = v_actor;
  if not found then raise exception using errcode = '42501', message = 'That request is not available to you.'; end if;
  perform public.gather_lock_friend_pair(v_request."RequesterUserID", v_request."RecipientUserID");
  select * into v_request from public."FriendRequest"
    where "FriendRequestID" = p_request_id and "RecipientUserID" = v_actor for update;
  if not found then raise exception using errcode = '42501', message = 'That request is not available to you.'; end if;
  v_status := case when p_accept then 'accepted' else 'declined' end;
  if v_request."Status" = v_status then return v_request; end if;
  if v_request."Status" <> 'pending' then
    raise exception using errcode = '22023', message = 'This request has already been resolved.';
  end if;
  v_when := greatest(clock_timestamp(), v_request."RequestedAt");
  if p_accept then
    insert into public."Friends" ("UserAID", "UserBID", "FriendsSince")
      values (least(v_request."RequesterUserID", v_actor), greatest(v_request."RequesterUserID", v_actor), v_when);
  end if;
  update public."FriendRequest" set "Status" = v_status, "ResolvedAt" = v_when
    where "FriendRequestID" = p_request_id returning * into v_request;
  return v_request;
end;
$$;

create function public.cancel_friend_request(p_request_id bigint)
returns public."FriendRequest"
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request public."FriendRequest";
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Sign in to cancel a friend request.'; end if;
  select * into v_request from public."FriendRequest"
    where "FriendRequestID" = p_request_id and "RequesterUserID" = v_actor;
  if not found then raise exception using errcode = '42501', message = 'That request is not available to you.'; end if;
  perform public.gather_lock_friend_pair(v_request."RequesterUserID", v_request."RecipientUserID");
  select * into v_request from public."FriendRequest"
    where "FriendRequestID" = p_request_id and "RequesterUserID" = v_actor for update;
  if not found then raise exception using errcode = '42501', message = 'That request is not available to you.'; end if;
  if v_request."Status" = 'cancelled' then return v_request; end if;
  if v_request."Status" <> 'pending' then
    raise exception using errcode = '22023', message = 'This request has already been resolved.';
  end if;
  update public."FriendRequest"
    set "Status" = 'cancelled', "ResolvedAt" = greatest(clock_timestamp(), "RequestedAt")
    where "FriendRequestID" = p_request_id returning * into v_request;
  return v_request;
end;
$$;

create function public.remove_friend(p_other_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_removed bigint;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Sign in to remove a friend.'; end if;
  if p_other_user_id is null or p_other_user_id = v_actor then
    raise exception using errcode = '22023', message = 'Choose another user.';
  end if;
  perform public.gather_lock_friend_pair(v_actor, p_other_user_id);
  delete from public."Friends"
    where "UserAID" = least(v_actor, p_other_user_id)
      and "UserBID" = greatest(v_actor, p_other_user_id);
  get diagnostics v_removed = row_count;
  -- Returns false on a retry after removal. No historical requests are changed.
  return v_removed > 0;
end;
$$;

-- All writes go through the functions above. RLS exposes only the participant's
-- own friendships/requests; no public directory, RSVP or Bookmark policy changes.
alter table public."Friends" enable row level security;
alter table public."FriendRequest" enable row level security;
revoke all on public."Friends", public."FriendRequest" from public, anon, authenticated;
grant select on public."Friends", public."FriendRequest" to authenticated;
create policy gather_friends_read on public."Friends"
  for select to authenticated
  using ((select auth.uid()) = "UserAID" or (select auth.uid()) = "UserBID");
create policy gather_requests_read on public."FriendRequest"
  for select to authenticated
  using ((select auth.uid()) = "RequesterUserID" or (select auth.uid()) = "RecipientUserID");
do $$
declare v_seq text;
begin
  foreach v_seq in array array[
    pg_get_serial_sequence('public."Friends"', 'FriendshipID'),
    pg_get_serial_sequence('public."FriendRequest"', 'FriendRequestID')
  ] loop
    if v_seq is not null then execute format('revoke all on sequence %s from public, anon, authenticated', v_seq); end if;
  end loop;
end;
$$;
revoke all on function public.gather_lock_friend_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gather_guard_friend_request() from public, anon, authenticated;
revoke all on function public.send_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_friend_request(bigint, boolean) from public, anon, authenticated;
revoke all on function public.cancel_friend_request(bigint) from public, anon, authenticated;
revoke all on function public.remove_friend(uuid) from public, anon, authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_to_friend_request(bigint, boolean) to authenticated;
grant execute on function public.cancel_friend_request(bigint) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

comment on table public."Friends" is 'Current mutual friendships only; ordered UUID pair, one row per pair.';
comment on table public."FriendRequest" is 'One immutable attempt per ID; pending may resolve once. Unfriending never deletes this history. Profile deletion cascades.';
notify pgrst, 'reload schema';

-- Resolve identities only; never request or expose names, emails or passwords.
do $$
declare v_users uuid[]; v_other uuid;
begin
  if to_regnamespace('gather_test') is not null then
    raise exception 'A gather_test schema already exists; stop and review before rehearsal.';
  end if;
  select array_agg(id order by id) into v_users from (
    select u."UserID" as id from public."User" u
    join auth.users a on a.id = u."UserID" order by u."UserID" limit 2
  ) profiles;
  if coalesce(array_length(v_users, 1), 0) <> 2 then
    raise exception 'Rehearsal needs two existing profiles matching Auth accounts. Create/confirm two test accounts through the app first.';
  end if;
  loop
    v_other := gen_random_uuid();
    exit when not exists (select 1 from public."User" where "UserID" = v_other);
  end loop;
  perform set_config('gather_test.a', v_users[1]::text, true);
  perform set_config('gather_test.b', v_users[2]::text, true);
  perform set_config('gather_test.c', v_other::text, true);
end;
$$;
create schema gather_test;
create function gather_test.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function gather_test.expect_error(stmt text, expected_code text, label text)
returns void language plpgsql security invoker as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = expected_code then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: %, expected %, got % (%)', label, expected_code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: %, expected an error', label;
end;
$$;
grant usage on schema gather_test to anon, authenticated;
grant execute on all functions in schema gather_test to anon, authenticated;

select gather_test.assert_true((select relrowsecurity from pg_class where oid = 'public."Friends"'::regclass), 'Friends RLS enabled');
select gather_test.assert_true((select relrowsecurity from pg_class where oid = 'public."FriendRequest"'::regclass), 'Requests RLS enabled');
select gather_test.assert_true(not has_table_privilege('authenticated', 'public."FriendRequest"', 'UPDATE'), 'No direct request UPDATE grant');
select gather_test.assert_true(not has_table_privilege('authenticated', 'public."Friends"', 'INSERT'), 'No direct friendship INSERT grant');
select gather_test.assert_true(not has_function_privilege('anon', 'public.send_friend_request(uuid)', 'EXECUTE'), 'Anonymous RPC execution revoked');
select gather_test.assert_true(not has_function_privilege('authenticated', 'public.gather_lock_friend_pair(uuid,uuid)', 'EXECUTE'), 'Lock helper is not a public RPC');
select gather_test.assert_true(not has_sequence_privilege('authenticated', pg_get_serial_sequence('public."FriendRequest"','FriendRequestID'), 'USAGE'), 'No direct identity sequence usage');

set local role anon;
select gather_test.expect_error('select * from public."Friends"', '42501', 'Anonymous table read rejected');
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.b'')::uuid)', '42501', 'Anonymous request rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.b'')::uuid)', '42501', 'Missing Auth UUID rejected');
select set_config('request.jwt.claim.sub', current_setting('gather_test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.a')::uuid, 'role', 'authenticated')::text, true);
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.a'')::uuid)', '22023', 'Self request rejected');
select gather_test.expect_error('select public.send_friend_request(null)', '22023', 'NULL recipient rejected');
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.c'')::uuid)', '23503', 'Missing profile rejected');
select set_config('gather_test.request_1', (public.send_friend_request(current_setting('gather_test.b')::uuid))."FriendRequestID"::text, true);
select gather_test.assert_true((public.send_friend_request(current_setting('gather_test.b')::uuid))."FriendRequestID"::text = current_setting('gather_test.request_1'), 'Pending send retry returns the same attempt');
select gather_test.assert_true((select count(*) = 1 from public."FriendRequest"), 'Sender sees own request');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, true)', '42501', 'Requester cannot accept own request');
select gather_test.expect_error('insert into public."Friends" ("UserAID","UserBID") values (current_setting(''gather_test.a'')::uuid,current_setting(''gather_test.b'')::uuid)', '42501', 'Direct friendship insert rejected');
select gather_test.expect_error('update public."FriendRequest" set "Status" = ''accepted''', '42501', 'Direct request update rejected');
select gather_test.expect_error('delete from public."FriendRequest"', '42501', 'Direct history deletion rejected');

select set_config('request.jwt.claim.sub', current_setting('gather_test.c'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.c')::uuid, 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 0 from public."FriendRequest"), 'Unrelated user cannot read request history');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, true)', '42501', 'Unrelated user cannot accept');
select gather_test.expect_error('select public.cancel_friend_request(current_setting(''gather_test.request_1'')::bigint)', '42501', 'Unrelated user cannot cancel');
select set_config('request.jwt.claim.sub', current_setting('gather_test.b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.b')::uuid, 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 1 from public."FriendRequest"), 'Recipient sees incoming request');
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.a'')::uuid)', '22023', 'Opposite-direction send requires an explicit response');
select gather_test.expect_error('select public.cancel_friend_request(current_setting(''gather_test.request_1'')::bigint)', '42501', 'Recipient cannot cancel sender request');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, null)', '22023', 'NULL decision rejected');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_1')::bigint, false))."Status" = 'declined', 'Recipient decline persists');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_1')::bigint, false))."Status" = 'declined', 'Repeated decline is idempotent');

select set_config('request.jwt.claim.sub', current_setting('gather_test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.a')::uuid, 'role', 'authenticated')::text, true);
select set_config('gather_test.request_2', (public.send_friend_request(current_setting('gather_test.b')::uuid))."FriendRequestID"::text, true);
select gather_test.assert_true(current_setting('gather_test.request_1') <> current_setting('gather_test.request_2'), 'Resend creates a different history ID');
select gather_test.assert_true((select count(*) = 2 from public."FriendRequest"), 'Both attempts retained');
select set_config('request.jwt.claim.sub', current_setting('gather_test.b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.b')::uuid, 'role', 'authenticated')::text, true);
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true))."Status" = 'accepted', 'Recipient acceptance persists');
select gather_test.assert_true((select count(*) = 1 from public."Friends"), 'Acceptance creates one friendship');
select gather_test.assert_true((select "UserAID" < "UserBID" from public."Friends"), 'Friendship UUID order canonical');
select gather_test.assert_true((select f."FriendsSince" = r."ResolvedAt" from public."Friends" f cross join public."FriendRequest" r where r."FriendRequestID" = current_setting('gather_test.request_2')::bigint), 'Acceptance timestamps agree');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true))."Status" = 'accepted', 'Accept retry does not duplicate friendship');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_2'')::bigint, false)', '22023', 'Accepted decision cannot become declined');
select gather_test.expect_error('select public.send_friend_request(current_setting(''gather_test.a'')::uuid)', '22023', 'Existing friends cannot send another request');
select set_config('request.jwt.claim.sub', current_setting('gather_test.c'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.c')::uuid, 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 0 from public."Friends"), 'Unrelated user cannot read friendships');
select gather_test.assert_true(not public.remove_friend(current_setting('gather_test.a')::uuid), 'Unrelated unfriend cannot remove A-B');
select set_config('request.jwt.claim.sub', current_setting('gather_test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.a')::uuid, 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 1 from public."Friends"), 'Sender sees mutual friendship');
select gather_test.assert_true(public.remove_friend(current_setting('gather_test.b')::uuid), 'Either participant can unfriend');
select gather_test.assert_true(not public.remove_friend(current_setting('gather_test.b')::uuid), 'Unfriend retry is harmless');
select gather_test.assert_true((select count(*) = 2 from public."FriendRequest"), 'Unfriending preserves complete request history');
select set_config('request.jwt.claim.sub', current_setting('gather_test.b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.b')::uuid, 'role', 'authenticated')::text, true);
select public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true);
select gather_test.assert_true((select count(*) = 0 from public."Friends"), 'Stale accept retry after unfriend does not recreate friendship');
select set_config('gather_test.request_3', (public.send_friend_request(current_setting('gather_test.a')::uuid))."FriendRequestID"::text, true);
select gather_test.assert_true((public.cancel_friend_request(current_setting('gather_test.request_3')::bigint))."Status" = 'cancelled', 'Requester can cancel reverse-direction request');
select gather_test.assert_true((public.cancel_friend_request(current_setting('gather_test.request_3')::bigint))."Status" = 'cancelled', 'Cancel retry is idempotent');
select set_config('request.jwt.claim.sub', current_setting('gather_test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('gather_test.a')::uuid, 'role', 'authenticated')::text, true);
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_3'')::bigint, true)', '22023', 'Cancelled request cannot be accepted');
reset role;

select gather_test.expect_error('update public."FriendRequest" set "Status" = ''pending'', "ResolvedAt" = null where "FriendRequestID" = current_setting(''gather_test.request_1'')::bigint', '23514', 'Resolved history immutable even through direct SQL update');
select gather_test.expect_error('insert into public."Friends" ("UserAID","UserBID") values (current_setting(''gather_test.b'')::uuid,current_setting(''gather_test.a'')::uuid)', '23514', 'Reversed friendship order rejected');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values (current_setting(''gather_test.a'')::uuid,current_setting(''gather_test.a'')::uuid)', '23514', 'Self request constraint also protects direct SQL');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID","Status") values (current_setting(''gather_test.a'')::uuid,current_setting(''gather_test.b'')::uuid,''invalid'')', '23514', 'Invalid status rejected');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID","Status") values (current_setting(''gather_test.a'')::uuid,current_setting(''gather_test.b'')::uuid,''declined'')', '23514', 'Resolved request needs timestamp');
insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values (current_setting('gather_test.a')::uuid,current_setting('gather_test.b')::uuid);
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values (current_setting(''gather_test.b'')::uuid,current_setting(''gather_test.a'')::uuid)', '23505', 'Unique pending pair protects opposite-direction direct SQL');


select 'PASS: friendship rehearsal completed; changes will now roll back.' as result;
rollback;
