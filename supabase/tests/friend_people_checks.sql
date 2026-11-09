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
