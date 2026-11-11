-- GENERATED: run the ENTIRE file as Supabase postgres owner BEFORE the new migration.
-- Only synthetic tables are written; real account/relationship/event/interest data is not modified.
begin;
create function public.get_friend_connections(
  p_person_id uuid, p_kind text, p_limit integer default 11, p_after text default null
)
returns table (item_id text,label text,username text,event_date date,event_location text)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid:=auth.uid(); private_profile boolean; cursor_uuid uuid; cursor_number bigint;
begin
  if actor is null or not exists(select 1 from public."User" u where u."UserID"=actor) then
    raise exception using errcode='42501',message='Sign in to see shared connections.';
  end if;
  if p_person_id is null or p_person_id=actor or p_kind is null or p_kind not in ('friends','events','interests')
    or p_limit is null or p_limit<1 or p_limit>51 then
    raise exception using errcode='22023',message='Invalid connection lookup.';
  end if;
  select u."IsPrivate" into private_profile from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=p_person_id;
  if not found then raise exception using errcode='23503',message='That person is unavailable.'; end if;
  if private_profile then return; end if;
  if p_after is not null then
    if p_kind='friends' then cursor_uuid:=p_after::uuid;
    else
      if p_after !~ '^[1-9][0-9]{0,18}$' then raise invalid_parameter_value; end if;
      cursor_number:=p_after::bigint;
    end if;
  end if;
  if p_kind='friends' then
    return query
    select u."UserID"::text,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''),nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80),
      left(nullif(btrim(u."Username"),''),60),null::date,null::text
    from public."User" u join auth.users a on a.id=u."UserID"
    where not u."IsPrivate" and u."UserID" not in (actor,p_person_id)
      and (cursor_uuid is null or u."UserID">cursor_uuid)
      and exists(select 1 from public."Friends" f where f."UserAID"=least(actor,u."UserID") and f."UserBID"=greatest(actor,u."UserID"))
      and exists(select 1 from public."Friends" f where f."UserAID"=least(p_person_id,u."UserID") and f."UserBID"=greatest(p_person_id,u."UserID"))
    order by u."UserID" limit p_limit;
  elsif p_kind='events' then
    return query
    select e."EventID"::text,coalesce(nullif(btrim(e."EventName"),''),'Unnamed event'),null::text,e."EventDate",e."EventLocation"
    from public."Events" e
    where (cursor_number is null or e."EventID">cursor_number)
      and exists(select 1 from public."RSVP" r where r."UserID"=actor and r."EventID"=e."EventID" and r."RSVPGoing")
      and exists(select 1 from public."RSVP" r where r."UserID"=p_person_id and r."EventID"=e."EventID" and r."RSVPGoing")
    order by e."EventID" limit p_limit;
  else
    return query
    select c."EventCatID"::text,coalesce(nullif(btrim(c."EventCatagory"),''),'Unnamed interest'),null::text,null::date,null::text
    from public."EventCategory" c
    where (cursor_number is null or c."EventCatID">cursor_number)
      and exists(select 1 from public."UserInterest" i where i."UserID"=actor and i."EventCatID"=c."EventCatID")
      and exists(select 1 from public."UserInterest" i where i."UserID"=p_person_id and i."EventCatID"=c."EventCatID")
    order by c."EventCatID" limit p_limit;
  end if;
end;
$$;
revoke all on function public.get_friend_connections(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.get_friend_connections(uuid,text,integer,text) to authenticated;
notify pgrst,'reload schema';

do $$ begin
 if to_regnamespace('gather_connections_test') is not null then raise exception 'Test schema already exists. Stop for review.'; end if;
end; $$;
create schema gather_connections_test;
create table gather_connections_test."User" ("UserID" uuid primary key,"UserFirstName" text,"UserLastName" text,"Username" text,"IsPrivate" boolean not null default false);
create table gather_connections_test.auth_users (id uuid primary key,raw_user_meta_data jsonb);
create table gather_connections_test."Friends" ("UserAID" uuid,"UserBID" uuid);
create table gather_connections_test."RSVP" ("UserID" uuid,"EventID" bigint,"RSVPGoing" boolean);
create table gather_connections_test."UserInterest" ("UserID" uuid,"EventCatID" bigint);
create table gather_connections_test."Events" ("EventID" bigint primary key,"EventName" text,"EventDate" date,"EventLocation" text);
create table gather_connections_test."EventCategory" ("EventCatID" bigint primary key,"EventCatagory" text);
insert into gather_connections_test."User" ("UserID","UserFirstName","Username")
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Person '||n,'person_'||n from generate_series(1,4)n;
insert into gather_connections_test.auth_users select "UserID",'{}'::jsonb from gather_connections_test."User";
insert into gather_connections_test."Friends" values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
insert into gather_connections_test."Events" values (1,'Shared concert','2026-11-15','Music Building'),
  (9007199254740993,'Shared games','2026-11-16','Campus'),(2,'Cancelled event',null,null),(4,'Target only',null,null);
insert into gather_connections_test."RSVP" values
  ('00000000-0000-4000-8000-000000000001',1,true),
  ('00000000-0000-4000-8000-000000000003',1,true),
  ('00000000-0000-4000-8000-000000000001',9007199254740993,true),
  ('00000000-0000-4000-8000-000000000003',9007199254740993,true),
  ('00000000-0000-4000-8000-000000000001',2,true),
  ('00000000-0000-4000-8000-000000000003',2,false),
  ('00000000-0000-4000-8000-000000000003',4,true);
insert into gather_connections_test."EventCategory" values (1,'Arts'),(2,'Sports');
insert into gather_connections_test."UserInterest" values
  ('00000000-0000-4000-8000-000000000001',1),
  ('00000000-0000-4000-8000-000000000003',1),
  ('00000000-0000-4000-8000-000000000003',2);
create function gather_connections_test.get_friend_connections(
  p_person_id uuid, p_kind text, p_limit integer default 11, p_after text default null
)
returns table (item_id text,label text,username text,event_date date,event_location text)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid:=auth.uid(); private_profile boolean; cursor_uuid uuid; cursor_number bigint;
begin
  if actor is null or not exists(select 1 from gather_connections_test."User" u where u."UserID"=actor) then
    raise exception using errcode='42501',message='Sign in to see shared connections.';
  end if;
  if p_person_id is null or p_person_id=actor or p_kind is null or p_kind not in ('friends','events','interests')
    or p_limit is null or p_limit<1 or p_limit>51 then
    raise exception using errcode='22023',message='Invalid connection lookup.';
  end if;
  select u."IsPrivate" into private_profile from gather_connections_test."User" u join gather_connections_test.auth_users a on a.id=u."UserID" where u."UserID"=p_person_id;
  if not found then raise exception using errcode='23503',message='That person is unavailable.'; end if;
  if private_profile then return; end if;
  if p_after is not null then
    if p_kind='friends' then cursor_uuid:=p_after::uuid;
    else
      if p_after !~ '^[1-9][0-9]{0,18}$' then raise invalid_parameter_value; end if;
      cursor_number:=p_after::bigint;
    end if;
  end if;
  if p_kind='friends' then
    return query
    select u."UserID"::text,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''),nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80),
      left(nullif(btrim(u."Username"),''),60),null::date,null::text
    from gather_connections_test."User" u join gather_connections_test.auth_users a on a.id=u."UserID"
    where not u."IsPrivate" and u."UserID" not in (actor,p_person_id)
      and (cursor_uuid is null or u."UserID">cursor_uuid)
      and exists(select 1 from gather_connections_test."Friends" f where f."UserAID"=least(actor,u."UserID") and f."UserBID"=greatest(actor,u."UserID"))
      and exists(select 1 from gather_connections_test."Friends" f where f."UserAID"=least(p_person_id,u."UserID") and f."UserBID"=greatest(p_person_id,u."UserID"))
    order by u."UserID" limit p_limit;
  elsif p_kind='events' then
    return query
    select e."EventID"::text,coalesce(nullif(btrim(e."EventName"),''),'Unnamed event'),null::text,e."EventDate",e."EventLocation"
    from gather_connections_test."Events" e
    where (cursor_number is null or e."EventID">cursor_number)
      and exists(select 1 from gather_connections_test."RSVP" r where r."UserID"=actor and r."EventID"=e."EventID" and r."RSVPGoing")
      and exists(select 1 from gather_connections_test."RSVP" r where r."UserID"=p_person_id and r."EventID"=e."EventID" and r."RSVPGoing")
    order by e."EventID" limit p_limit;
  else
    return query
    select c."EventCatID"::text,coalesce(nullif(btrim(c."EventCatagory"),''),'Unnamed interest'),null::text,null::date,null::text
    from gather_connections_test."EventCategory" c
    where (cursor_number is null or c."EventCatID">cursor_number)
      and exists(select 1 from gather_connections_test."UserInterest" i where i."UserID"=actor and i."EventCatID"=c."EventCatID")
      and exists(select 1 from gather_connections_test."UserInterest" i where i."UserID"=p_person_id and i."EventCatID"=c."EventCatID")
    order by c."EventCatID" limit p_limit;
  end if;
end;
$$;

do $$
declare target uuid:='00000000-0000-4000-8000-000000000003'; ids text[]; kind text;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  select array_agg(item_id) into ids from gather_connections_test.get_friend_connections(target,'friends',51,null);
  if ids is distinct from array['00000000-0000-4000-8000-000000000002'] then raise exception 'Mutual public friend intersection failed'; end if;
  select array_agg(item_id) into ids from gather_connections_test.get_friend_connections(target,'events',51,null);
  if ids is distinct from array['1','9007199254740993'] then raise exception 'Shared going events/ID precision failed'; end if;
  if (select item_id from gather_connections_test.get_friend_connections(target,'events',1,'1'))<>'9007199254740993' then raise exception 'Event pagination failed'; end if;
  select array_agg(item_id) into ids from gather_connections_test.get_friend_connections(target,'interests',51,null);
  if ids is distinct from array['1'] then raise exception 'Shared interest intersection failed'; end if;
  update gather_connections_test."User" set "IsPrivate"=true where "UserID"='00000000-0000-4000-8000-000000000002';
  if exists(select 1 from gather_connections_test.get_friend_connections(target,'friends',51,null)) then raise exception 'Private mutual friend leaked'; end if;
  update gather_connections_test."User" set "IsPrivate"=true where "UserID"=target;
  foreach kind in array array['friends','events','interests'] loop
    if exists(select 1 from gather_connections_test.get_friend_connections(target,kind,51,null)) then raise exception 'Private target details leaked'; end if;
  end loop;
  if has_function_privilege('anon','public.get_friend_connections(uuid,text,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_friend_connections(uuid,text,integer,text)','EXECUTE') then
    raise exception 'Unexpected shared detail execution grants';
  end if;
end;
$$;
-- Real schema compilation/read check. Does not mutate real records.
do $$
declare actor uuid; target uuid; kind text;
begin
  select u."UserID" into actor from public."User" u join auth.users a on a.id=u."UserID" order by u."UserID" limit 1;
  select u."UserID" into target from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"<>actor order by u."UserID" limit 1;
  if actor is null or target is null then raise exception 'Two matching real User/Auth profiles are required'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  foreach kind in array array['friends','events','interests'] loop
    perform * from public.get_friend_connections(target,kind,2,null);
  end loop;
  reset role;
end;
$$;
select 'PASS: shared connections rehearsal completed; temporary function and fixtures will roll back.' as result;

rollback;
