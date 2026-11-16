-- Preserve chosen signup profile atomically; single-use server recovery tickets.
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
commit;
