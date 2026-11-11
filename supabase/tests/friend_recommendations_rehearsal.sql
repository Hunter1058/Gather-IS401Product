-- GENERATED: run the ENTIRE file as Supabase postgres owner BEFORE the new migration.
-- Does not modify real User, Auth, friendship, request, interest, or RSVP records.
-- Creates a guarded test schema and new function temporarily; rolls everything back.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regclass('public."UserInterest"') is null
    or to_regprocedure('public.get_friend_directory(integer,uuid,text,text)') is null then
    raise exception 'Install the existing profile interests and friend directory setup first.';
  end if;
end;
$$;

create function public.get_friend_recommendations(
  p_limit integer default 25, p_after uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text,
  request_id text, mutual_friends bigint, shared_events bigint, is_private boolean,
  photo_url text, connection_degree integer, shared_interests bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public."User" u where u."UserID"=v_actor) then
    raise exception using errcode='42501', message='Sign in to see suggestions.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then
    raise exception using errcode='22023', message='Invalid recommendation page.';
  end if;
  return query
  with recursive visible_edges as (
    select f."UserAID" as a, f."UserBID" as b
    from public."Friends" f
    join public."User" ua on ua."UserID"=f."UserAID"
    join public."User" ub on ub."UserID"=f."UserBID"
    where (ua."UserID"=v_actor or not ua."IsPrivate")
      and (ub."UserID"=v_actor or not ub."IsPrivate")
  ), walk(id, depth) as (
    select v_actor, 0
    union
    select case when e.a=w.id then e.b else e.a end, w.depth+1
    from walk w join visible_edges e on e.a=w.id or e.b=w.id
    where w.depth < 3
  ), distances as (
    select w.id, min(w.depth) as degree from walk w where w.id<>v_actor group by w.id
  ), my_friends as (
    select case when e.a=v_actor then e.b else e.a end as id
    from visible_edges e where e.a=v_actor or e.b=v_actor
  ), overlap_events as (
    select theirs."UserID" as id, count(distinct theirs."EventID") as total
    from public."RSVP" mine join public."RSVP" theirs on theirs."EventID"=mine."EventID"
    where mine."UserID"=v_actor and mine."RSVPGoing" and theirs."RSVPGoing"
    group by theirs."UserID"
  ), overlap_interests as (
    select theirs."UserID" as id, count(distinct theirs."EventCatID") as total
    from public."UserInterest" mine join public."UserInterest" theirs on theirs."EventCatID"=mine."EventCatID"
    where mine."UserID"=v_actor group by theirs."UserID"
  ), mutual_counts as (
    select case when e.a=m.id then e.b else e.a end as id, count(distinct m.id) as total
    from my_friends m join visible_edges e on e.a=m.id or e.b=m.id
    group by case when e.a=m.id then e.b else e.a end
  ), profiles as (
    select u."UserID" as id,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''), nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80) as name,
      left(nullif(btrim(u."Username"),''),60) as handle,
      u."UserProfilePhoto" as photo,
      case when d.degree between 2 and 3 then d.degree end as degree,
      coalesce(m.total,0::bigint) as mutual,
      coalesce(e.total,0::bigint) as events,
      coalesce(i.total,0::bigint) as interests,
      not exists (select 1 from public."Friends" f
        where f."UserAID"=least(v_actor,u."UserID") and f."UserBID"=greatest(v_actor,u."UserID"))
      and not exists (select 1 from public."FriendRequest" r where r."Status"='pending'
        and least(r."RequesterUserID",r."RecipientUserID")=least(v_actor,u."UserID")
        and greatest(r."RequesterUserID",r."RecipientUserID")=greatest(v_actor,u."UserID")) as eligible
    from public."User" u join auth.users a on a.id=u."UserID"
    left join distances d on d.id=u."UserID"
    left join mutual_counts m on m.id=u."UserID"
    left join overlap_events e on e.id=u."UserID"
    left join overlap_interests i on i.id=u."UserID"
    where u."UserID"<>v_actor and not u."IsPrivate"
  ), ranked as (
    select p.*, row_number() over (order by p.degree asc nulls last,
      p.events desc, p.interests desc, p.mutual desc, p.id) as position
    from profiles p
  )
  select r.id,r.name,r.handle,'none'::text,null::text,r.mutual,r.events,false,
    r.photo,r.degree,r.interests
  from ranked r
  where r.eligible and (r.degree is not null or r.events>0 or r.interests>0)
    and (p_after is null or r.position > (select c.position from ranked c where c.id=p_after))
  order by r.position limit p_limit;
end;
$$;
revoke all on function public.get_friend_recommendations(integer,uuid) from public,anon,authenticated;
grant execute on function public.get_friend_recommendations(integer,uuid) to authenticated;
notify pgrst, 'reload schema';

do $$ begin
  if to_regnamespace('gather_recommendation_test') is not null then
    raise exception 'Test schema already exists. Stop for review.';
  end if;
end; $$;
create schema gather_recommendation_test;
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
create function gather_recommendation_test.get_friend_recommendations(
  p_limit integer default 25, p_after uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text,
  request_id text, mutual_friends bigint, shared_events bigint, is_private boolean,
  photo_url text, connection_degree integer, shared_interests bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from gather_recommendation_test."User" u where u."UserID"=v_actor) then
    raise exception using errcode='42501', message='Sign in to see suggestions.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then
    raise exception using errcode='22023', message='Invalid recommendation page.';
  end if;
  return query
  with recursive visible_edges as (
    select f."UserAID" as a, f."UserBID" as b
    from gather_recommendation_test."Friends" f
    join gather_recommendation_test."User" ua on ua."UserID"=f."UserAID"
    join gather_recommendation_test."User" ub on ub."UserID"=f."UserBID"
    where (ua."UserID"=v_actor or not ua."IsPrivate")
      and (ub."UserID"=v_actor or not ub."IsPrivate")
  ), walk(id, depth) as (
    select v_actor, 0
    union
    select case when e.a=w.id then e.b else e.a end, w.depth+1
    from walk w join visible_edges e on e.a=w.id or e.b=w.id
    where w.depth < 3
  ), distances as (
    select w.id, min(w.depth) as degree from walk w where w.id<>v_actor group by w.id
  ), my_friends as (
    select case when e.a=v_actor then e.b else e.a end as id
    from visible_edges e where e.a=v_actor or e.b=v_actor
  ), overlap_events as (
    select theirs."UserID" as id, count(distinct theirs."EventID") as total
    from gather_recommendation_test."RSVP" mine join gather_recommendation_test."RSVP" theirs on theirs."EventID"=mine."EventID"
    where mine."UserID"=v_actor and mine."RSVPGoing" and theirs."RSVPGoing"
    group by theirs."UserID"
  ), overlap_interests as (
    select theirs."UserID" as id, count(distinct theirs."EventCatID") as total
    from gather_recommendation_test."UserInterest" mine join gather_recommendation_test."UserInterest" theirs on theirs."EventCatID"=mine."EventCatID"
    where mine."UserID"=v_actor group by theirs."UserID"
  ), mutual_counts as (
    select case when e.a=m.id then e.b else e.a end as id, count(distinct m.id) as total
    from my_friends m join visible_edges e on e.a=m.id or e.b=m.id
    group by case when e.a=m.id then e.b else e.a end
  ), profiles as (
    select u."UserID" as id,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''), nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80) as name,
      left(nullif(btrim(u."Username"),''),60) as handle,
      u."UserProfilePhoto" as photo,
      case when d.degree between 2 and 3 then d.degree end as degree,
      coalesce(m.total,0::bigint) as mutual,
      coalesce(e.total,0::bigint) as events,
      coalesce(i.total,0::bigint) as interests,
      not exists (select 1 from gather_recommendation_test."Friends" f
        where f."UserAID"=least(v_actor,u."UserID") and f."UserBID"=greatest(v_actor,u."UserID"))
      and not exists (select 1 from gather_recommendation_test."FriendRequest" r where r."Status"='pending'
        and least(r."RequesterUserID",r."RecipientUserID")=least(v_actor,u."UserID")
        and greatest(r."RequesterUserID",r."RecipientUserID")=greatest(v_actor,u."UserID")) as eligible
    from gather_recommendation_test."User" u join gather_recommendation_test.auth_users a on a.id=u."UserID"
    left join distances d on d.id=u."UserID"
    left join mutual_counts m on m.id=u."UserID"
    left join overlap_events e on e.id=u."UserID"
    left join overlap_interests i on i.id=u."UserID"
    where u."UserID"<>v_actor and not u."IsPrivate"
  ), ranked as (
    select p.*, row_number() over (order by p.degree asc nulls last,
      p.events desc, p.interests desc, p.mutual desc, p.id) as position
    from profiles p
  )
  select r.id,r.name,r.handle,'none'::text,null::text,r.mutual,r.events,false,
    r.photo,r.degree,r.interests
  from ranked r
  where r.eligible and (r.degree is not null or r.events>0 or r.interests>0)
    and (p_after is null or r.position > (select c.position from ranked c where c.id=p_after))
  order by r.position limit p_limit;
end;
$$;

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

rollback;
