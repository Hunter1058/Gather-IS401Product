-- GENERATED. Run this ENTIRE file as postgres in Supabase SQL Editor.
-- Run BEFORE the permanent event friend attendance migration. Ends in ROLLBACK.
-- Real functions are temporarily installed; all row writes use synthetic fixtures.
-- No real user, friendship, RSVP, event, profile, table policy or table grant is edited.
begin;
set local lock_timeout = '10s';
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserAID')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserBID')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='User' and column_name='IsPrivate') then
  raise exception 'Install the canonical friendships and profile visibility migrations first.';
 end if;
 if to_regprocedure('public.gather_event_friend_attendance(bigint,integer)') is not null then
  raise exception 'Event friend attendance is already installed. Stop instead of rerunning this migration.';
 end if;
end; $$;

create function public.gather_event_friend_attendance(
 p_after_event_id bigint default null, p_limit integer default 250
)
returns table(event_id text, friend_count text, friends jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from public."User" u where u."UserID"=actor) then
  raise exception using errcode='42501',message='Sign in to see friends attending events.';
 end if;
 if p_limit is null or p_limit<1 or p_limit>250 or (p_after_event_id is not null and p_after_event_id<1) then
  raise invalid_parameter_value;
 end if;
 return query
 with my_friends as (
  select f."UserBID" as id from public."Friends" f where f."UserAID"=actor
  union
  select f."UserAID" as id from public."Friends" f where f."UserBID"=actor
 ), attendance as (
  select distinct r."EventID" as eid,u."UserID" as uid,
   left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
    '@'||nullif(btrim(u."Username"),''),'Gather friend'),80) as label
  from my_friends f
  join public."User" u on u."UserID"=f.id and u."IsPrivate"=false
  join auth.users a on a.id=u."UserID"
  join public."RSVP" r on r."UserID"=u."UserID" and r."RSVPGoing"=true
  join public."Events" e on e."EventID"=r."EventID"
  where u."UserID"<>actor and (p_after_event_id is null or r."EventID">p_after_event_id)
 ), ranked as (
  select a.*,row_number() over(partition by a.eid order by a.label,a.uid) as position
  from attendance a
 )
 select r.eid::text,count(*)::text,
  jsonb_agg(jsonb_build_object('id',r.uid::text,'label',r.label) order by r.label,r.uid)
   filter(where r.position<=2)
 from ranked r group by r.eid order by r.eid limit p_limit;
end;
$$;
revoke all on function public.gather_event_friend_attendance(bigint,integer) from public,anon,authenticated;
grant execute on function public.gather_event_friend_attendance(bigint,integer) to authenticated;

-- Keep the existing event-ID-only contract for older deployments/clients.
-- The old migration used UserID/FriendUserID, which the new schema renamed.
create or replace function public.gather_friends_going()
returns table("EventID" text)
language sql stable security definer set search_path = ''
as $$
 select distinct r."EventID"::text
 from public."RSVP" r
 join public."Events" e on e."EventID"=r."EventID"
 join public."User" u on u."UserID"=r."UserID" and u."IsPrivate"=false
 join auth.users a on a.id=u."UserID"
 join public."Friends" f on
  (f."UserAID"=(select auth.uid()) and f."UserBID"=r."UserID") or
  (f."UserBID"=(select auth.uid()) and f."UserAID"=r."UserID")
 where (select auth.uid()) is not null and r."UserID"<>(select auth.uid()) and r."RSVPGoing"=true;
$$;
revoke all on function public.gather_friends_going() from public,anon,authenticated;
grant execute on function public.gather_friends_going() to authenticated;
notify pgrst,'reload schema';

-- Included by the generated rehearsal. Do not run this fragment alone.
do $$ begin
 if to_regnamespace('gather_attendance_test') is not null then raise exception 'Test schema exists. Stop for review.'; end if;
 if has_function_privilege('anon','public.gather_event_friend_attendance(bigint,integer)','EXECUTE')
  or has_function_privilege('anon','public.gather_friends_going()','EXECUTE')
  or not has_function_privilege('authenticated','public.gather_event_friend_attendance(bigint,integer)','EXECUTE') then
  raise exception 'Incorrect attendance RPC grants'; end if;
end; $$;
create schema gather_attendance_test;
create table gather_attendance_test.auth_users(id uuid primary key);
create table gather_attendance_test."User"(
 "UserID" uuid primary key,"UserFirstName" text,"UserLastName" text,"Username" text,"IsPrivate" boolean
);
create table gather_attendance_test."Friends"(
 "UserAID" uuid not null,"UserBID" uuid not null,primary key("UserAID","UserBID"),check("UserAID"<"UserBID")
);
-- Deliberately allow legacy duplicate/orphan RSVP fixtures to check fail-closed joins.
create table gather_attendance_test."RSVP"("UserID" uuid,"EventID" bigint,"RSVPGoing" boolean);
create table gather_attendance_test."Events"("EventID" bigint primary key);
create table gather_attendance_test."FriendRequest"("RequesterUserID" uuid,"RecipientUserID" uuid,"Status" text);
alter table gather_attendance_test.auth_users enable row level security;
alter table gather_attendance_test."User" enable row level security;
alter table gather_attendance_test."Friends" enable row level security;
alter table gather_attendance_test."RSVP" enable row level security;
alter table gather_attendance_test."Events" enable row level security;
alter table gather_attendance_test."FriendRequest" enable row level security;
create function gather_attendance_test.gather_event_friend_attendance(
 p_after_event_id bigint default null, p_limit integer default 250
)
returns table(event_id text, friend_count text, friends jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from gather_attendance_test."User" u where u."UserID"=actor) then
  raise exception using errcode='42501',message='Sign in to see friends attending events.';
 end if;
 if p_limit is null or p_limit<1 or p_limit>250 or (p_after_event_id is not null and p_after_event_id<1) then
  raise invalid_parameter_value;
 end if;
 return query
 with my_friends as (
  select f."UserBID" as id from gather_attendance_test."Friends" f where f."UserAID"=actor
  union
  select f."UserAID" as id from gather_attendance_test."Friends" f where f."UserBID"=actor
 ), attendance as (
  select distinct r."EventID" as eid,u."UserID" as uid,
   left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
    '@'||nullif(btrim(u."Username"),''),'Gather friend'),80) as label
  from my_friends f
  join gather_attendance_test."User" u on u."UserID"=f.id and u."IsPrivate"=false
  join gather_attendance_test.auth_users a on a.id=u."UserID"
  join gather_attendance_test."RSVP" r on r."UserID"=u."UserID" and r."RSVPGoing"=true
  join gather_attendance_test."Events" e on e."EventID"=r."EventID"
  where u."UserID"<>actor and (p_after_event_id is null or r."EventID">p_after_event_id)
 ), ranked as (
  select a.*,row_number() over(partition by a.eid order by a.label,a.uid) as position
  from attendance a
 )
 select r.eid::text,count(*)::text,
  jsonb_agg(jsonb_build_object('id',r.uid::text,'label',r.label) order by r.label,r.uid)
   filter(where r.position<=2)
 from ranked r group by r.eid order by r.eid limit p_limit;
end;
$$;

create or replace function gather_attendance_test.gather_friends_going()
returns table("EventID" text)
language sql stable security definer set search_path = ''
as $$
 select distinct r."EventID"::text
 from gather_attendance_test."RSVP" r
 join gather_attendance_test."Events" e on e."EventID"=r."EventID"
 join gather_attendance_test."User" u on u."UserID"=r."UserID" and u."IsPrivate"=false
 join gather_attendance_test.auth_users a on a.id=u."UserID"
 join gather_attendance_test."Friends" f on
  (f."UserAID"=(select auth.uid()) and f."UserBID"=r."UserID") or
  (f."UserBID"=(select auth.uid()) and f."UserAID"=r."UserID")
 where (select auth.uid()) is not null and r."UserID"<>(select auth.uid()) and r."RSVPGoing"=true;
$$;

insert into gather_attendance_test."User" values
 ('11111111-1111-4111-8111-111111111111','Alex','Owner','alex',false),
 ('22222222-2222-4222-8222-222222222222','Blair <friend>','','blair',false),
 ('33333333-3333-4333-8333-333333333333',null,null,'casey',false),
 ('44444444-4444-4444-8444-444444444444','Private name','','private_user',true),
 ('55555555-5555-4555-8555-555555555555','Friend of a friend','','outsider',false),
 ('66666666-6666-4666-8666-666666666666','Pending person','','pending',false),
 ('77777777-7777-4777-8777-777777777777','Missing visibility','','unknown_visibility',null),
 ('88888888-8888-4888-8888-888888888888','Orphan profile','','orphan',false);
insert into gather_attendance_test.auth_users
 select "UserID" from gather_attendance_test."User" where "Username"<>'orphan';
insert into gather_attendance_test."Events" values(1),(2),(9223372036854775807);
insert into gather_attendance_test."Friends" values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'),
 ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444'),
 ('11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-777777777777'),
 ('11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888'),
 ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');
insert into gather_attendance_test."FriendRequest" values
 ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','pending');
insert into gather_attendance_test."RSVP"
 select "UserID",1,true from gather_attendance_test."User";
insert into gather_attendance_test."RSVP" values
 ('22222222-2222-4222-8222-222222222222',1,true),
 ('22222222-2222-4222-8222-222222222222',2,false),
 ('33333333-3333-4333-8333-333333333333',9223372036854775807,true),
 ('22222222-2222-4222-8222-222222222222',999,true);
revoke all on all tables in schema gather_attendance_test from public,anon,authenticated;
revoke all on function gather_attendance_test.gather_event_friend_attendance(bigint,integer) from public,anon;
revoke all on function gather_attendance_test.gather_friends_going() from public,anon;
grant usage on schema gather_attendance_test to authenticated;
grant execute on function gather_attendance_test.gather_event_friend_attendance(bigint,integer) to authenticated;
grant execute on function gather_attendance_test.gather_friends_going() to authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$ declare rows_found integer; r record; begin
 select count(*) into rows_found from gather_attendance_test.gather_event_friend_attendance();
 if rows_found<>2 then raise exception 'Unexpected event count: cancelled/orphan events or hidden people leaked'; end if;
 select * into strict r from gather_attendance_test.gather_event_friend_attendance(null,1);
 if r.event_id<>'1' or r.friend_count<>'2' or jsonb_array_length(r.friends)<>2
  or not r.friends @> '[{"id":"22222222-2222-4222-8222-222222222222","label":"Blair <friend>"}]'
  or not r.friends @> '[{"id":"33333333-3333-4333-8333-333333333333","label":"@casey"}]' then
  raise exception 'Incorrect accepted/public distinct attendance or profile labels'; end if;
 select * into strict r from gather_attendance_test.gather_event_friend_attendance(1,1);
 if r.event_id<>'9223372036854775807' or r.friend_count<>'1' then raise exception 'Bigint cursor lost precision'; end if;
 if exists(select 1 from gather_attendance_test.gather_event_friend_attendance(9223372036854775807,1)) then
  raise exception 'Final page repeated'; end if;
 if (select array_agg("EventID" order by "EventID") from gather_attendance_test.gather_friends_going())
  is distinct from array['1','9223372036854775807']::text[] then raise exception 'Legacy filter contract differs'; end if;
 begin
  perform * from gather_attendance_test.gather_event_friend_attendance(null,251);
  raise exception 'Oversized page accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform * from gather_attendance_test.gather_event_friend_attendance(0,1);
  raise exception 'Invalid cursor accepted';
 exception when invalid_parameter_value then null; end;
end; $$;
reset role;
-- The same canonical pair must work for the opposite user, without a directed duplicate.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r record; begin
 select * into strict r from gather_attendance_test.gather_event_friend_attendance();
 if r.event_id<>'1' or r.friend_count<>'2'
  or not r.friends @> '[{"id":"11111111-1111-4111-8111-111111111111"}]' then
  raise exception 'Reverse friendship direction failed'; end if;
end; $$;
reset role;
-- Accept a pending request by adding the canonical friendship, solely in fixtures.
insert into gather_attendance_test."Friends" values
 ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r record; begin
 select * into strict r from gather_attendance_test.gather_event_friend_attendance(null,1);
 if r.friend_count<>'3' or jsonb_array_length(r.friends)<>2 then raise exception 'Count or bounded preview failed after acceptance'; end if;
end; $$;
reset role;
update gather_attendance_test."RSVP" set "RSVPGoing"=false where "UserID"='22222222-2222-4222-8222-222222222222';
delete from gather_attendance_test."Friends" where "UserAID"='11111111-1111-4111-8111-111111111111'
 and "UserBID"='33333333-3333-4333-8333-333333333333';
set local role authenticated;
do $$ declare r record; begin
 select * into strict r from gather_attendance_test.gather_event_friend_attendance();
 if r.event_id<>'1' or r.friend_count<>'1'
  or not r.friends @> '[{"id":"66666666-6666-4666-8666-666666666666"}]' then
  raise exception 'RSVP cancellation or friendship removal did not remove attendance'; end if;
end; $$;
reset role;
update gather_attendance_test."User" set "IsPrivate"=true where "Username"='pending';
set local role authenticated;
do $$ begin
 if exists(select 1 from gather_attendance_test.gather_event_friend_attendance()) then
  raise exception 'Private attendance was still exposed'; end if;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 begin
  perform * from gather_attendance_test.gather_event_friend_attendance();
  raise exception 'Missing profile accepted';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select 'PASS: event friend attendance rehearsal completed; all temporary changes will roll back.' as result;

rollback;
