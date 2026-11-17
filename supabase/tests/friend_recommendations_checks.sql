-- Synthetic fixture tables exist only inside the rollback rehearsal schema.
create table gather_recommendation_test."User" (
  "UserID" uuid primary key, "UserFirstName" text, "UserLastName" text,
  "Username" text, "UserProfilePhoto" text, "IsPrivate" boolean not null default false);
create table gather_recommendation_test.auth_users (id uuid primary key, raw_user_meta_data jsonb);
create table gather_recommendation_test."Friends" ("UserAID" uuid,"UserBID" uuid,primary key("UserAID","UserBID"));
create table gather_recommendation_test."FriendRequest" ("RequesterUserID" uuid,"RecipientUserID" uuid,"Status" text);
create table gather_recommendation_test."RSVP" ("UserID" uuid,"EventID" bigint,"RSVPGoing" boolean);
create table gather_recommendation_test."UserInterest" ("UserID" uuid,"EventCatID" bigint);

insert into gather_recommendation_test."User" ("UserID","UserFirstName","Username")
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Person '||n,'person_'||n
from generate_series(1,10) n;
insert into gather_recommendation_test.auth_users select "UserID", '{}'::jsonb from gather_recommendation_test."User";
insert into gather_recommendation_test."Friends" values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000007');
insert into gather_recommendation_test."RSVP" values
  ('00000000-0000-4000-8000-000000000001',1,true),
  ('00000000-0000-4000-8000-000000000005',1,true),
  ('00000000-0000-4000-8000-000000000009',1,false);
insert into gather_recommendation_test."UserInterest" values
  ('00000000-0000-4000-8000-000000000001',1),
  ('00000000-0000-4000-8000-000000000001',2),
  ('00000000-0000-4000-8000-000000000006',1),
  ('00000000-0000-4000-8000-000000000006',2);

-- __FIXTURE_FUNCTION__ is replaced by the builder with the exact production
-- function definition, changing only schema-qualified table/function names.
-- __FIXTURE_FUNCTION__

do $$
declare ids uuid[]; expected uuid[]:=array[
  '00000000-0000-4000-8000-000000000003'::uuid,
  '00000000-0000-4000-8000-000000000004'::uuid,
  '00000000-0000-4000-8000-000000000005'::uuid,
  '00000000-0000-4000-8000-000000000006'::uuid];
  page record; cursor_id uuid; gathered uuid[]:=array[]::uuid[]; passes integer:=0;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  select array_agg(user_id) into ids from gather_recommendation_test.get_friend_recommendations(51,null);
  if ids is distinct from expected then raise exception 'Recommendation order/eligibility failed: %',ids; end if;
  if (select connection_degree from gather_recommendation_test.get_friend_recommendations(51,null) where user_id=expected[1]) <> 2
     or (select connection_degree from gather_recommendation_test.get_friend_recommendations(51,null) where user_id=expected[2]) <> 3
     or (select shared_interests from gather_recommendation_test.get_friend_recommendations(51,null) where user_id=expected[4]) <> 2 then
    raise exception 'Recommendation reasons failed';
  end if;
  loop
    select * into page from gather_recommendation_test.get_friend_recommendations(1,cursor_id);
    exit when not found;
    gathered:=array_append(gathered,page.user_id); cursor_id:=page.user_id; passes:=passes+1;
    if passes>10 then raise exception 'Pagination did not terminate'; end if;
  end loop;
  if gathered is distinct from expected then raise exception 'Pagination order failed'; end if;
  -- Shared RSVPs break ties before shared interests at the same connection degree.
  insert into gather_recommendation_test."Friends" values
    ('00000000-0000-4000-8000-000000000002',expected[3]),
    ('00000000-0000-4000-8000-000000000002',expected[4]);
  select array_agg(user_id) into ids from gather_recommendation_test.get_friend_recommendations(51,null);
  if ids is distinct from array[expected[3],expected[4],expected[1],expected[2]] then
    raise exception 'Within-degree RSVP/interest priorities failed: %',ids;
  end if;
  delete from gather_recommendation_test."Friends" where "UserBID" in (expected[3],expected[4]);
  -- Add a cycle and a shortcut: shortest degree must win and rows stay unique.
  insert into gather_recommendation_test."Friends" values
    ('00000000-0000-4000-8000-000000000002',expected[2]);
  if (select connection_degree from gather_recommendation_test.get_friend_recommendations(51,null) where user_id=expected[2]) <> 2 then
    raise exception 'Shortest path failed';
  end if;
  -- A private intermediary is not used for recommendations.
  update gather_recommendation_test."User" set "IsPrivate"=true
    where "UserID"='00000000-0000-4000-8000-000000000002';
  select array_agg(user_id) into ids from gather_recommendation_test.get_friend_recommendations(51,null);
  if ids is distinct from expected[3:4] then raise exception 'Private path exclusion failed: %',ids; end if;
  insert into gather_recommendation_test."FriendRequest" values
    ('00000000-0000-4000-8000-000000000001',expected[3],'pending'),
    (expected[4],'00000000-0000-4000-8000-000000000001','pending');
  if exists(select 1 from gather_recommendation_test.get_friend_recommendations(51,null)) then
    raise exception 'Pending requests or zero-signal people were suggested';
  end if;
  if has_function_privilege('anon','public.get_friend_recommendations(integer,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_friend_recommendations(integer,uuid)','EXECUTE') then
    raise exception 'Unexpected recommendation grants';
  end if;
end;
$$;

-- Verify authenticated execution against the real schema, using an existing
-- account. No real table records are written by this rehearsal.
do $$
declare actor uuid; entry record;
begin
  select u."UserID" into actor from public."User" u join auth.users a on a.id=u."UserID" order by u."UserID" limit 1;
  if actor is null then raise exception 'A real matching User/Auth profile is required'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  for entry in select * from public.get_friend_recommendations(51,null) loop
    if entry.user_id=actor or entry.is_private or entry.relationship<>'none'
      or (entry.connection_degree is null and entry.shared_events=0 and entry.shared_interests=0)
      or to_jsonb(entry) ?| array['email','friend_ids','interest_ids','event_ids'] then
      raise exception 'Live recommendation eligibility/output failed';
    end if;
  end loop;
  begin
    perform * from public.get_friend_recommendations(52,null);
    raise exception 'Oversized recommendation page was accepted';
  exception when invalid_parameter_value then null; end;
  reset role;
end;
$$;
select 'PASS: friend recommendation rehearsal completed; temporary functions and fixtures will roll back.' as result;
