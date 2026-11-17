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
-- __CLONED_FUNCTIONS__
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
