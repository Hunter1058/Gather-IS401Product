-- LOCAL TEST FIXTURE ONLY, after friendships_bootstrap.sql and the migration.
-- Everything below rolls back; do not replace production Auth/profile records.
begin;
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
select gather_test.expect_error('select public.send_friend_request(''22222222-2222-4222-8222-222222222222'')', '42501', 'Anonymous request rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select gather_test.expect_error('select public.send_friend_request(''22222222-2222-4222-8222-222222222222'')', '42501', 'Missing Auth UUID rejected');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select gather_test.expect_error('select public.send_friend_request(''11111111-1111-4111-8111-111111111111'')', '22023', 'Self request rejected');
select gather_test.expect_error('select public.send_friend_request(null)', '22023', 'NULL recipient rejected');
select gather_test.expect_error('select public.send_friend_request(''44444444-4444-4444-8444-444444444444'')', '23503', 'Missing profile rejected');
select set_config('gather_test.request_1', (public.send_friend_request('22222222-2222-4222-8222-222222222222'))."FriendRequestID"::text, true);
select gather_test.assert_true((public.send_friend_request('22222222-2222-4222-8222-222222222222'))."FriendRequestID"::text = current_setting('gather_test.request_1'), 'Pending send retry returns the same attempt');
select gather_test.assert_true((select count(*) = 1 from public."FriendRequest"), 'Sender sees own request');
select gather_test.assert_true((select count(*) = 1 from public."User"), 'Existing own-profile RLS preserved');
select gather_test.expect_error('select "Password" from public."User"', '42501', 'Profile private-column restriction preserved');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, true)', '42501', 'Requester cannot accept own request');
select gather_test.expect_error('insert into public."Friends" ("UserAID","UserBID") values (''11111111-1111-4111-8111-111111111111'',''22222222-2222-4222-8222-222222222222'')', '42501', 'Direct friendship insert rejected');
select gather_test.expect_error('update public."FriendRequest" set "Status" = ''accepted''', '42501', 'Direct request update rejected');
select gather_test.expect_error('delete from public."FriendRequest"', '42501', 'Direct history deletion rejected');

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 0 from public."FriendRequest"), 'Unrelated user cannot read request history');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, true)', '42501', 'Unrelated user cannot accept');
select gather_test.expect_error('select public.cancel_friend_request(current_setting(''gather_test.request_1'')::bigint)', '42501', 'Unrelated user cannot cancel');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 1 from public."FriendRequest"), 'Recipient sees incoming request');
select gather_test.expect_error('select public.send_friend_request(''11111111-1111-4111-8111-111111111111'')', '22023', 'Opposite-direction send requires an explicit response');
select gather_test.expect_error('select public.cancel_friend_request(current_setting(''gather_test.request_1'')::bigint)', '42501', 'Recipient cannot cancel sender request');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_1'')::bigint, null)', '22023', 'NULL decision rejected');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_1')::bigint, false))."Status" = 'declined', 'Recipient decline persists');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_1')::bigint, false))."Status" = 'declined', 'Repeated decline is idempotent');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select set_config('gather_test.request_2', (public.send_friend_request('22222222-2222-4222-8222-222222222222'))."FriendRequestID"::text, true);
select gather_test.assert_true(current_setting('gather_test.request_1') <> current_setting('gather_test.request_2'), 'Resend creates a different history ID');
select gather_test.assert_true((select count(*) = 2 from public."FriendRequest"), 'Both attempts retained');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true))."Status" = 'accepted', 'Recipient acceptance persists');
select gather_test.assert_true((select count(*) = 1 from public."Friends"), 'Acceptance creates one friendship');
select gather_test.assert_true((select "UserAID" < "UserBID" from public."Friends"), 'Friendship UUID order canonical');
select gather_test.assert_true((select f."FriendsSince" = r."ResolvedAt" from public."Friends" f cross join public."FriendRequest" r where r."FriendRequestID" = current_setting('gather_test.request_2')::bigint), 'Acceptance timestamps agree');
select gather_test.assert_true((public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true))."Status" = 'accepted', 'Accept retry does not duplicate friendship');
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_2'')::bigint, false)', '22023', 'Accepted decision cannot become declined');
select gather_test.expect_error('select public.send_friend_request(''11111111-1111-4111-8111-111111111111'')', '22023', 'Existing friends cannot send another request');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 0 from public."Friends"), 'Unrelated user cannot read friendships');
select gather_test.assert_true(not public.remove_friend('11111111-1111-4111-8111-111111111111'), 'Unrelated unfriend cannot remove A-B');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select gather_test.assert_true((select count(*) = 1 from public."Friends"), 'Sender sees mutual friendship');
select gather_test.assert_true(public.remove_friend('22222222-2222-4222-8222-222222222222'), 'Either participant can unfriend');
select gather_test.assert_true(not public.remove_friend('22222222-2222-4222-8222-222222222222'), 'Unfriend retry is harmless');
select gather_test.assert_true((select count(*) = 2 from public."FriendRequest"), 'Unfriending preserves complete request history');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
select public.respond_to_friend_request(current_setting('gather_test.request_2')::bigint, true);
select gather_test.assert_true((select count(*) = 0 from public."Friends"), 'Stale accept retry after unfriend does not recreate friendship');
select set_config('gather_test.request_3', (public.send_friend_request('11111111-1111-4111-8111-111111111111'))."FriendRequestID"::text, true);
select gather_test.assert_true((public.cancel_friend_request(current_setting('gather_test.request_3')::bigint))."Status" = 'cancelled', 'Requester can cancel reverse-direction request');
select gather_test.assert_true((public.cancel_friend_request(current_setting('gather_test.request_3')::bigint))."Status" = 'cancelled', 'Cancel retry is idempotent');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select gather_test.expect_error('select public.respond_to_friend_request(current_setting(''gather_test.request_3'')::bigint, true)', '22023', 'Cancelled request cannot be accepted');
reset role;

select gather_test.expect_error('update public."FriendRequest" set "Status" = ''pending'', "ResolvedAt" = null where "FriendRequestID" = current_setting(''gather_test.request_1'')::bigint', '23514', 'Resolved history immutable even through direct SQL update');
select gather_test.expect_error('insert into public."Friends" ("UserAID","UserBID") values (''22222222-2222-4222-8222-222222222222'',''11111111-1111-4111-8111-111111111111'')', '23514', 'Reversed friendship order rejected');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values (''11111111-1111-4111-8111-111111111111'',''11111111-1111-4111-8111-111111111111'')', '23514', 'Self request constraint also protects direct SQL');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID","Status") values (''11111111-1111-4111-8111-111111111111'',''22222222-2222-4222-8222-222222222222'',''invalid'')', '23514', 'Invalid status rejected');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID","Status") values (''11111111-1111-4111-8111-111111111111'',''22222222-2222-4222-8222-222222222222'',''declined'')', '23514', 'Resolved request needs timestamp');
insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
select gather_test.expect_error('insert into public."FriendRequest" ("RequesterUserID","RecipientUserID") values (''22222222-2222-4222-8222-222222222222'',''11111111-1111-4111-8111-111111111111'')', '23505', 'Unique pending pair protects opposite-direction direct SQL');

delete from public."User" where "UserID" = '11111111-1111-4111-8111-111111111111';
select gather_test.assert_true((select count(*) = 0 from public."FriendRequest"), 'Profile deletion intentionally cascades history');
rollback;
