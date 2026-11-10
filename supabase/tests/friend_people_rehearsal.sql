-- GENERATED REHEARSAL: run this ENTIRE file as Supabase owner.
-- Foundation migration must already be applied. Do NOT rerun that migration.
-- Temporarily creates the directory function and exercises two existing real
-- profiles, then rolls back function/grant/relationship changes. Never changes
-- User or auth.users rows. Existing identity sequences may advance (ID gaps).
begin;
do $$
begin
  if to_regprocedure('public.send_friend_request(uuid)') is null
     or to_regprocedure('public.cancel_friend_request(bigint)') is null
     or to_regprocedure('public.remove_friend(uuid)') is null
     or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'Friends' and column_name = 'UserAID') then
    raise exception 'Apply the friendship foundation before the friend directory migration.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_friend_people') then
    raise exception 'get_friend_people already exists; review it instead of replacing it.';
  end if;
end;
$$;

create function public.get_friend_people(
  p_limit integer default 25,
  p_after uuid default null,
  p_person_id uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text, request_id text)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in to browse people.';
  end if;
  if not exists (select 1 from public."User" u where u."UserID" = v_actor) then
    raise exception using errcode = '42501', message = 'Your account profile is not available.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 or (p_after is not null and p_person_id is not null) then
    raise exception using errcode = '22023', message = 'Invalid directory page.';
  end if;
  return query
    select u."UserID",
      left(coalesce(
        nullif(btrim(concat_ws(' ', u."UserFirstName", u."UserLastName")), ''),
        nullif(btrim(u."Username"), ''),
        nullif(btrim(a.raw_user_meta_data ->> 'name'), ''),
        'Member ' || left(u."UserID"::text, 8)
      ), 80),
      left(nullif(btrim(u."Username"), ''), 60),
      case when f."FriendshipID" is not null then 'friends'
        when r."RequesterUserID" = v_actor then 'outgoing_pending'
        when r."RecipientUserID" = v_actor then 'incoming_pending'
        else 'none' end,
      case when f."FriendshipID" is not null then null else r."FriendRequestID"::text end
    from public."User" u
    join auth.users a on a.id = u."UserID"
    left join public."Friends" f
      on f."UserAID" = least(v_actor, u."UserID") and f."UserBID" = greatest(v_actor, u."UserID")
    left join public."FriendRequest" r
      on r."Status" = 'pending'
      and least(r."RequesterUserID", r."RecipientUserID") = least(v_actor, u."UserID")
      and greatest(r."RequesterUserID", r."RecipientUserID") = greatest(v_actor, u."UserID")
    where u."UserID" <> v_actor
      and (p_after is null or u."UserID" > p_after)
      and (p_person_id is null or u."UserID" = p_person_id)
    order by u."UserID"
    limit p_limit;
end;
$$;
revoke all on function public.get_friend_people(integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_friend_people(integer, uuid, uuid) to authenticated;
comment on function public.get_friend_people(integer, uuid, uuid) is
  'Signed-in directory: IDs, display names, usernames, and relationship to caller only. No emails, passwords or other users'' relationship graph. Request IDs returned as text.';
notify pgrst, 'reload schema';

-- Test body for the generated friend_people_rehearsal.sql; run the generated
-- file, not this body alone. It never creates or changes User/Auth profiles.
do $$
declare v_ids uuid[];
begin
  if to_regnamespace('gather_friend_people_test') is not null then
    raise exception 'The test schema already exists. Stop and review before rehearsal.';
  end if;
  select array_agg(id order by id) into v_ids from (
    select u."UserID" id from public."User" u join auth.users a on a.id = u."UserID"
    order by u."UserID" limit 2
  ) ids;
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'Directory rehearsal needs two existing real profiles.';
  end if;
  if exists (select 1 from public."Friends" where "UserAID" = v_ids[1] and "UserBID" = v_ids[2])
    or exists (select 1 from public."FriendRequest" where "Status" = 'pending'
      and least("RequesterUserID", "RecipientUserID") = v_ids[1]
      and greatest("RequesterUserID", "RecipientUserID") = v_ids[2]) then
    raise exception 'The rehearsal pair already has an active relationship. Stop and review which test accounts to use; do not delete their records.';
  end if;
  perform set_config('gather_friend_people_test.a', v_ids[1]::text, true);
  perform set_config('gather_friend_people_test.b', v_ids[2]::text, true);
end;
$$;
create schema gather_friend_people_test;
create function gather_friend_people_test.check_true(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function gather_friend_people_test.rejects(stmt text, code text)
returns void language plpgsql security invoker as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = code then return; end if;
    raise exception 'Expected %, received % (%)', code, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error %, but statement succeeded', code;
end;
$$;
create function gather_friend_people_test.as_user(id uuid)
returns void language plpgsql security invoker as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(id::text, ''), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', id, 'role', 'authenticated')::text, true);
end;
$$;
grant usage on schema gather_friend_people_test to anon, authenticated;
grant execute on all functions in schema gather_friend_people_test to anon, authenticated;

select gather_friend_people_test.check_true(
  not has_function_privilege('anon', 'public.get_friend_people(integer,uuid,uuid)', 'EXECUTE'), 'No anonymous directory access');
set local role anon;
select gather_friend_people_test.rejects('select * from public.get_friend_people()', '42501');
reset role;
set local role authenticated;
select gather_friend_people_test.as_user(null);
select gather_friend_people_test.rejects('select * from public.get_friend_people()', '42501');
select gather_friend_people_test.as_user(current_setting('gather_friend_people_test.a')::uuid);
select gather_friend_people_test.check_true((select count(*) = 0 from public.get_friend_people(1, null, current_setting('gather_friend_people_test.a')::uuid)), 'Self excluded');
select gather_friend_people_test.check_true((select count(*) = 1 from public.get_friend_people(1, null, null)), 'Directory page bounded');
select gather_friend_people_test.check_true((select count(*) = 1 from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'Limited profile lookup available');
select gather_friend_people_test.check_true((select relationship = 'none' from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'No relationship initially');
select gather_friend_people_test.check_true((select not (to_jsonb(p) ?| array['Email','Password','email','password','raw_user_meta_data']) from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid) p), 'Private profile fields absent');
select gather_friend_people_test.rejects('select * from public.get_friend_people(0)', '22023');
select gather_friend_people_test.rejects('select * from public.get_friend_people(52)', '22023');
select gather_friend_people_test.rejects('select * from public.get_friend_people(1, current_setting(''gather_friend_people_test.a'')::uuid, current_setting(''gather_friend_people_test.b'')::uuid)', '22023');

select set_config('gather_friend_people_test.request_1',
  (public.send_friend_request(current_setting('gather_friend_people_test.b')::uuid))."FriendRequestID"::text, true);
select gather_friend_people_test.check_true((select relationship = 'outgoing_pending' and request_id = current_setting('gather_friend_people_test.request_1') from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'Outgoing request and exact text ID');
select gather_friend_people_test.check_true((select pg_typeof(request_id) = 'text'::regtype from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'Request IDs are SQL text');
select gather_friend_people_test.as_user(current_setting('gather_friend_people_test.b')::uuid);
select gather_friend_people_test.check_true((select relationship = 'incoming_pending' from public.get_friend_people(1, null, current_setting('gather_friend_people_test.a')::uuid)), 'Recipient sees incoming state');
select gather_friend_people_test.as_user(current_setting('gather_friend_people_test.a')::uuid);
select public.cancel_friend_request(current_setting('gather_friend_people_test.request_1')::bigint);
select gather_friend_people_test.check_true((select relationship = 'none' and request_id is null from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'Cancellation restores sendable state');
select set_config('gather_friend_people_test.request_2',
  (public.send_friend_request(current_setting('gather_friend_people_test.b')::uuid))."FriendRequestID"::text, true);
select gather_friend_people_test.as_user(current_setting('gather_friend_people_test.b')::uuid);
select public.respond_to_friend_request(current_setting('gather_friend_people_test.request_2')::bigint, true);
select gather_friend_people_test.check_true((select relationship = 'friends' and request_id is null from public.get_friend_people(1, null, current_setting('gather_friend_people_test.a')::uuid)), 'Accepted friendship, not historical request status');
select gather_friend_people_test.as_user(current_setting('gather_friend_people_test.a')::uuid);
select public.remove_friend(current_setting('gather_friend_people_test.b')::uuid);
select gather_friend_people_test.check_true((select relationship = 'none' from public.get_friend_people(1, null, current_setting('gather_friend_people_test.b')::uuid)), 'Unfriend restores sendable state');
select gather_friend_people_test.check_true((select "Status" = 'accepted' from public."FriendRequest" where "FriendRequestID" = current_setting('gather_friend_people_test.request_2')::bigint), 'Accepted history preserved after removal');
reset role;
select 'PASS: friend directory rehearsal completed; temporary changes will roll back.' as result;

rollback;
