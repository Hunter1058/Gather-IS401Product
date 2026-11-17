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
-- __FIXTURE_FUNCTION__
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
