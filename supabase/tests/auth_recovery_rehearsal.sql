-- GENERATED: run this ENTIRE file as the Supabase SQL Editor postgres owner.
-- Run BEFORE applying the auth recovery migration. All changes roll back.
-- No real account, profile, password, interest or existing policy is written.
-- The migration's functions/table are temporarily installed in this transaction;
-- behavior checks use isolated synthetic fixtures and copies of those functions.
begin;
set local lock_timeout='10s';
do $$ begin
 if to_regprocedure('public.handle_new_user()') is null or to_regclass('public."UserInterest"') is null
   or to_regclass('public.gather_username_unique') is null then
  raise exception 'Install existing signup/profile migrations first.';
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
   and tgfoid='public.handle_new_user()'::regprocedure and not tgisinternal and tgenabled in ('O','A')) then
  raise exception 'Expected signup trigger is missing. Stop and inspect Auth triggers.';
 end if;
 -- Do not silently overwrite another teammate's live-only trigger changes.
 if (select regexp_replace(lower(prosrc),'\s+','','g') from pg_proc
     where oid='public.handle_new_user()'::regprocedure) <>
    'begininsertintopublic."user"("userid","email")values(new.id,new.email)onconflict("userid")donothing;returnnew;end;' then
  raise exception 'Signup trigger differs from the repository baseline. Review its definition before replacing it.';
 end if;
end; $$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare p jsonb:=new.raw_user_meta_data->'gather_signup_profile'; v_id text;
begin
 if p is null or p='null'::jsonb then
  insert into public."User"("UserID","Email","IsPrivate") values(new.id,new.email,true) on conflict("UserID") do nothing;
  return new;
 end if;
 if jsonb_typeof(p)<>'object' or jsonb_typeof(p->'firstName') is distinct from 'string'
  or length(btrim(p->>'firstName')) not between 1 and 60
  or jsonb_typeof(p->'lastName') is distinct from 'string' or length(btrim(p->>'lastName'))>60
  or jsonb_typeof(p->'username') is distinct from 'string' or (p->>'username') !~ '^[a-z0-9_]{3,30}$'
  or jsonb_typeof(p->'isPrivate') is distinct from 'boolean'
  or jsonb_typeof(p->'categoryIds') is distinct from 'array' then
  raise exception using errcode='22023',message='Invalid signup profile';
 end if;
 if jsonb_array_length(p->'categoryIds')>100 or octet_length(p::text)>1600
  or exists(select 1 from jsonb_array_elements(p->'categoryIds') as items(value) where jsonb_typeof(items.value) is distinct from 'string')
 then raise invalid_parameter_value; end if;
 for v_id in select jsonb_array_elements_text(p->'categoryIds') loop
  if v_id is null or v_id !~ '^[1-9][0-9]{0,18}$' or v_id::numeric>9223372036854775807 then raise invalid_parameter_value; end if;
 end loop;
 insert into public."User"("UserID","Email","UserFirstName","UserLastName","Username","IsPrivate")
 values(new.id,new.email,btrim(p->>'firstName'),btrim(p->>'lastName'),p->>'username',(p->>'isPrivate')::boolean);
 insert into public."UserInterest"("UserID","EventCatID")
 select new.id,(value#>>'{}')::bigint from jsonb_array_elements(p->'categoryIds') on conflict do nothing;
 return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create table public."GatherRecoveryTicket" (
 "UserID" uuid primary key references auth.users(id) on delete cascade,
 "TicketHash" text not null check("TicketHash" ~ '^[a-f0-9]{64}$'),
 "ExpiresAt" timestamptz not null,"ConsumedAt" timestamptz
);
alter table public."GatherRecoveryTicket" enable row level security;
revoke all on public."GatherRecoveryTicket" from public,anon,authenticated;
-- No table policies or direct grants: only this narrowly-scoped owner RPC.
create function public.gather_recovery_ticket(p_hash text,p_action text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); changed integer;
begin
 if actor is null then raise insufficient_privilege; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_action is null
   or p_action not in ('issue','check','consume','release') then raise invalid_parameter_value; end if;
 if p_action='issue' then
  insert into public."GatherRecoveryTicket"("UserID","TicketHash","ExpiresAt") values(actor,p_hash,clock_timestamp()+interval '15 minutes')
  on conflict("UserID") do update set "TicketHash"=excluded."TicketHash","ExpiresAt"=excluded."ExpiresAt","ConsumedAt"=null;
  return true;
 elsif p_action='check' then
  return exists(select 1 from public."GatherRecoveryTicket" t where t."UserID"=actor and t."TicketHash"=p_hash
   and t."ExpiresAt">clock_timestamp() and t."ConsumedAt" is null);
 elsif p_action='consume' then
  update public."GatherRecoveryTicket" set "ConsumedAt"=clock_timestamp()
   where "UserID"=actor and "TicketHash"=p_hash and "ExpiresAt">clock_timestamp() and "ConsumedAt" is null;
 else
  update public."GatherRecoveryTicket" set "ConsumedAt"=null
   where "UserID"=actor and "TicketHash"=p_hash and "ExpiresAt">clock_timestamp() and "ConsumedAt" is not null;
 end if;
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;
revoke all on function public.gather_recovery_ticket(text,text) from public,anon,authenticated;
grant execute on function public.gather_recovery_ticket(text,text) to authenticated;
notify pgrst,'reload schema';

-- Synthetic checks included by build_auth_recovery_rehearsal.py. Do not run alone.
do $$ begin
 if to_regnamespace('gather_auth_test') is not null then raise exception 'Test schema exists. Stop for review.'; end if;
 if not (select relrowsecurity from pg_class where oid='public."GatherRecoveryTicket"'::regclass) then
  raise exception 'Recovery table must have RLS'; end if;
 if has_table_privilege('authenticated','public."GatherRecoveryTicket"','SELECT')
  or has_table_privilege('authenticated','public."GatherRecoveryTicket"','INSERT')
  or has_table_privilege('anon','public."GatherRecoveryTicket"','SELECT') then
  raise exception 'Recovery table must not have direct API grants'; end if;
 if has_function_privilege('anon','public.gather_recovery_ticket(text,text)','EXECUTE')
  or not has_function_privilege('authenticated','public.gather_recovery_ticket(text,text)','EXECUTE') then
  raise exception 'Incorrect recovery function grants'; end if;
end; $$;
create schema gather_auth_test;
create table gather_auth_test.auth_users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create table gather_auth_test."User"(
 "UserID" uuid primary key references gather_auth_test.auth_users(id),"Email" text,
 "UserFirstName" text,"UserLastName" text,"Username" text,"IsPrivate" boolean not null default false
);
create unique index on gather_auth_test."User"(lower(btrim("Username"))) where nullif(btrim("Username"),'') is not null;
create table gather_auth_test."EventCategory"("EventCatID" bigint primary key);
create table gather_auth_test."UserInterest"(
 "UserID" uuid references gather_auth_test."User"("UserID"),
 "EventCatID" bigint references gather_auth_test."EventCategory"("EventCatID"),primary key("UserID","EventCatID")
);
create table gather_auth_test."GatherRecoveryTicket"(
 "UserID" uuid primary key references gather_auth_test.auth_users(id),"TicketHash" text not null,
 "ExpiresAt" timestamptz not null,"ConsumedAt" timestamptz
);
alter table gather_auth_test.auth_users enable row level security;
alter table gather_auth_test."User" enable row level security;
alter table gather_auth_test."EventCategory" enable row level security;
alter table gather_auth_test."UserInterest" enable row level security;
alter table gather_auth_test."GatherRecoveryTicket" enable row level security;
create or replace function gather_auth_test.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare p jsonb:=new.raw_user_meta_data->'gather_signup_profile'; v_id text;
begin
 if p is null or p='null'::jsonb then
  insert into gather_auth_test."User"("UserID","Email","IsPrivate") values(new.id,new.email,true) on conflict("UserID") do nothing;
  return new;
 end if;
 if jsonb_typeof(p)<>'object' or jsonb_typeof(p->'firstName') is distinct from 'string'
  or length(btrim(p->>'firstName')) not between 1 and 60
  or jsonb_typeof(p->'lastName') is distinct from 'string' or length(btrim(p->>'lastName'))>60
  or jsonb_typeof(p->'username') is distinct from 'string' or (p->>'username') !~ '^[a-z0-9_]{3,30}$'
  or jsonb_typeof(p->'isPrivate') is distinct from 'boolean'
  or jsonb_typeof(p->'categoryIds') is distinct from 'array' then
  raise exception using errcode='22023',message='Invalid signup profile';
 end if;
 if jsonb_array_length(p->'categoryIds')>100 or octet_length(p::text)>1600
  or exists(select 1 from jsonb_array_elements(p->'categoryIds') as items(value) where jsonb_typeof(items.value) is distinct from 'string')
 then raise invalid_parameter_value; end if;
 for v_id in select jsonb_array_elements_text(p->'categoryIds') loop
  if v_id is null or v_id !~ '^[1-9][0-9]{0,18}$' or v_id::numeric>9223372036854775807 then raise invalid_parameter_value; end if;
 end loop;
 insert into gather_auth_test."User"("UserID","Email","UserFirstName","UserLastName","Username","IsPrivate")
 values(new.id,new.email,btrim(p->>'firstName'),btrim(p->>'lastName'),p->>'username',(p->>'isPrivate')::boolean);
 insert into gather_auth_test."UserInterest"("UserID","EventCatID")
 select new.id,(value#>>'{}')::bigint from jsonb_array_elements(p->'categoryIds') on conflict do nothing;
 return new;
end;
$$;

create function gather_auth_test.gather_recovery_ticket(p_hash text,p_action text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); changed integer;
begin
 if actor is null then raise insufficient_privilege; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_action is null
   or p_action not in ('issue','check','consume','release') then raise invalid_parameter_value; end if;
 if p_action='issue' then
  insert into gather_auth_test."GatherRecoveryTicket"("UserID","TicketHash","ExpiresAt") values(actor,p_hash,clock_timestamp()+interval '15 minutes')
  on conflict("UserID") do update set "TicketHash"=excluded."TicketHash","ExpiresAt"=excluded."ExpiresAt","ConsumedAt"=null;
  return true;
 elsif p_action='check' then
  return exists(select 1 from gather_auth_test."GatherRecoveryTicket" t where t."UserID"=actor and t."TicketHash"=p_hash
   and t."ExpiresAt">clock_timestamp() and t."ConsumedAt" is null);
 elsif p_action='consume' then
  update gather_auth_test."GatherRecoveryTicket" set "ConsumedAt"=clock_timestamp()
   where "UserID"=actor and "TicketHash"=p_hash and "ExpiresAt">clock_timestamp() and "ConsumedAt" is null;
 else
  update gather_auth_test."GatherRecoveryTicket" set "ConsumedAt"=null
   where "UserID"=actor and "TicketHash"=p_hash and "ExpiresAt">clock_timestamp() and "ConsumedAt" is not null;
 end if;
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;

create trigger new_test_user after insert on gather_auth_test.auth_users
 for each row execute function gather_auth_test.handle_new_user();
insert into gather_auth_test."EventCategory" values (1),(9007199254740993);
insert into gather_auth_test.auth_users values
 ('11111111-1111-4111-8111-111111111111','synthetic-a@example.invalid',
 '{"gather_signup_profile":{"firstName":" Alex ","lastName":" Smith ","username":"alex_test","isPrivate":true,"categoryIds":["1","9007199254740993","1"]}}'),
 ('22222222-2222-4222-8222-222222222222','synthetic-b@example.invalid',
 '{"gather_signup_profile":{"firstName":"Blair","lastName":"","username":"blair_test","isPrivate":false,"categoryIds":[]}}'),
 ('33333333-3333-4333-8333-333333333333','legacy@example.invalid','{}');
do $$ begin
 if not exists(select 1 from gather_auth_test."User" where "Username"='alex_test' and "UserFirstName"='Alex' and "IsPrivate")
  or not exists(select 1 from gather_auth_test."User" where "Username"='blair_test' and not "IsPrivate")
  or not exists(select 1 from gather_auth_test."User" where "Email"='legacy@example.invalid' and "IsPrivate")
  or (select count(*) from gather_auth_test."UserInterest")<>2 then
  raise exception 'Atomic profile choices/legacy privacy/interests failed'; end if;
 begin
  insert into gather_auth_test.auth_users values('44444444-4444-4444-8444-444444444444','duplicate@example.invalid',
   '{"gather_signup_profile":{"firstName":"Duplicate","lastName":"","username":"alex_test","isPrivate":true,"categoryIds":[]}}');
  raise exception 'Duplicate username unexpectedly accepted';
 exception when unique_violation then null; end;
 if exists(select 1 from gather_auth_test.auth_users where email='duplicate@example.invalid') then raise exception 'Duplicate left an orphan Auth account'; end if;
 begin
  insert into gather_auth_test.auth_users values('44444444-4444-4444-8444-444444444444','invalid@example.invalid',
   '{"gather_signup_profile":{"firstName":"Invalid","lastName":"","username":"invalid_test","isPrivate":true,"categoryIds":["999"]}}');
  raise exception 'Unknown interest unexpectedly accepted';
 exception when foreign_key_violation then null; end;
 if exists(select 1 from gather_auth_test."User" where "Username"='invalid_test') then raise exception 'Invalid interest left a partial profile'; end if;
 begin
  insert into gather_auth_test.auth_users values('44444444-4444-4444-8444-444444444444','invalid-type@example.invalid',
   '{"gather_signup_profile":{"firstName":"Invalid","lastName":"","username":"invalid_test","isPrivate":"false","categoryIds":[]}}');
  raise exception 'Invalid privacy type unexpectedly accepted';
 exception when invalid_parameter_value then null; end;
end; $$;
revoke all on all tables in schema gather_auth_test from public,anon,authenticated;
revoke all on function gather_auth_test.gather_recovery_ticket(text,text) from public,anon;
grant usage on schema gather_auth_test to authenticated;
grant execute on function gather_auth_test.gather_recovery_ticket(text,text) to authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 begin
  perform 1 from public."GatherRecoveryTicket";
  raise exception 'Direct recovery table read unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 if not gather_auth_test.gather_recovery_ticket(repeat('a',64),'issue')
  or not gather_auth_test.gather_recovery_ticket(repeat('a',64),'check')
  or not gather_auth_test.gather_recovery_ticket(repeat('a',64),'consume') then raise exception 'Ticket creation/consume failed'; end if;
 if gather_auth_test.gather_recovery_ticket(repeat('a',64),'consume')
  or gather_auth_test.gather_recovery_ticket(repeat('a',64),'check') then raise exception 'Consumed ticket replay allowed'; end if;
 if not gather_auth_test.gather_recovery_ticket(repeat('a',64),'release') then raise exception 'Explicit-rejection retry failed'; end if;
 perform gather_auth_test.gather_recovery_ticket(repeat('b',64),'issue');
 if gather_auth_test.gather_recovery_ticket(repeat('a',64),'check') then raise exception 'Superseded ticket accepted'; end if;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if gather_auth_test.gather_recovery_ticket(repeat('b',64),'check')
  or gather_auth_test.gather_recovery_ticket(repeat('b',64),'consume') then raise exception 'Other account accessed the ticket'; end if;
end; $$;
reset role;
update gather_auth_test."GatherRecoveryTicket" set "ExpiresAt"=clock_timestamp()-interval '1 second';
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if gather_auth_test.gather_recovery_ticket(repeat('b',64),'check') then raise exception 'Expired ticket accepted'; end if;
end; $$;
reset role;
select 'PASS: auth recovery/signup rehearsal completed; all temporary changes will roll back.' as result;

rollback;
