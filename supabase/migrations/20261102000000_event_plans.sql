-- UUID-user migration matching the live schema reported November 3, 2026.
-- Run the ENTIRE file in Supabase SQL Editor as the project owner.
-- No tables or event records are dropped. Ambiguous existing data/policies abort
-- the transaction for review instead of silently deleting or broadening access.
begin;

-- Existing permissive policies would combine with ours using OR. Refuse to
-- silently leave unknown policies in place or remove a teammate's policies.
do $$
begin
  if (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'User' and column_name = 'UserID') is distinct from 'uuid'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'Bookmark' and column_name = 'UserID') is distinct from 'uuid'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'RSVP' and column_name = 'UserID') is distinct from 'uuid'
     or (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'Events' and column_name = 'EventID') is distinct from 'int8' then
    raise exception 'Schema mismatch: expected UUID user IDs and bigint event IDs. No ID conversions will be attempted.';
  end if;
  if exists (select 1 from public."User" u where not exists (select 1 from auth.users a where a.id = u."UserID")) then
    raise exception 'Some existing UserIDs do not match an Auth account. Review profile ownership before applying this migration; existing records will not be reassigned.';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('User', 'Bookmark', 'RSVP', 'Events', 'EventCategory', 'Event_Category_Linking_Table')
      and policyname not in ('gather_user_read', 'gather_events_read', 'gather_categories_read', 'gather_event_categories_read',
        'gather_bookmark_read', 'gather_bookmark_insert', 'gather_bookmark_update', 'gather_bookmark_delete',
        'gather_rsvp_read', 'gather_rsvp_insert', 'gather_rsvp_update', 'gather_rsvp_delete')
  ) then
    raise exception 'Existing policies require review. Inspect pg_policies for User, Bookmark, RSVP, Events and both category tables before applying this migration.';
  end if;
  if exists (select 1 from public."Bookmark" where "UserID" is null or "EventID" is null)
     or exists (select 1 from public."RSVP" where "UserID" is null or "EventID" is null or "RSVPGoing" is null) then
    raise exception 'Existing plans contain NULL owners, events or RSVPGoing. Review and repair those rows before applying this migration.';
  end if;
  if exists (select 1 from public."Bookmark" group by "UserID", "EventID" having count(*) > 1)
     or exists (select 1 from public."RSVP" group by "UserID", "EventID" having count(*) > 1) then
    raise exception 'Duplicate user/event pairs require review in Bookmark or RSVP. Preserve the intended records before applying this migration.';
  end if;
end;
$$;

-- Preserve existing UUIDs; the profile primary key is the Auth account ID.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public."User"'::regclass and conname = 'User_UserID_auth_fkey') then
    alter table public."User" add constraint "User_UserID_auth_fkey"
      foreign key ("UserID") references auth.users(id) on delete cascade;
  end if;
end;
$$;

-- Signup creates a profile with the exact Auth UUID, never a random UUID or
-- an email-derived identity. Existing matching profiles are preserved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public."User" ("UserID", "Email") values (new.id, new.email)
  on conflict ("UserID") do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill accounts using explicit Auth IDs; preserve existing profile data.
insert into public."User" ("UserID", "Email")
select id, email from auth.users
on conflict ("UserID") do nothing;

alter table public."Bookmark" alter column "UserID" set not null, alter column "EventID" set not null;
alter table public."RSVP" alter column "UserID" set not null, alter column "EventID" set not null,
  alter column "RSVPGoing" set default false, alter column "RSVPGoing" set not null;
-- SET NULL conflicts with non-null owners/events; dependent bookmarks should
-- disappear when their user or event is deleted, like the existing RSVP FKs.
alter table public."Bookmark" drop constraint "Bookmark_UserID_fkey",
  add constraint "Bookmark_UserID_fkey" foreign key ("UserID") references public."User"("UserID") on update cascade on delete cascade;
alter table public."Bookmark" drop constraint "Bookmark_EventID_fkey",
  add constraint "Bookmark_EventID_fkey" foreign key ("EventID") references public."Events"("EventID") on update cascade on delete cascade;
create unique index if not exists gather_bookmark_user_event_unique on public."Bookmark" ("UserID", "EventID");
create unique index if not exists gather_rsvp_user_event_unique on public."RSVP" ("UserID", "EventID");

alter table public."User" enable row level security;
alter table public."Bookmark" enable row level security;
alter table public."RSVP" enable row level security;
alter table public."Events" enable row level security;
alter table public."EventCategory" enable row level security;
alter table public."Event_Category_Linking_Table" enable row level security;

-- Grants and RLS both apply. Clients cannot create/reassign auth profiles,
-- publish events, or read the legacy Password column.
revoke all on public."User", public."Bookmark", public."RSVP", public."Events", public."EventCategory", public."Event_Category_Linking_Table" from public, anon, authenticated;
grant select ("UserID") on public."User" to authenticated;
grant select on public."Events", public."EventCategory", public."Event_Category_Linking_Table" to anon, authenticated;
-- Category names and event/category links are public event metadata.
drop policy if exists gather_categories_read on public."EventCategory";
create policy gather_categories_read on public."EventCategory" for select to anon, authenticated using (true);
drop policy if exists gather_event_categories_read on public."Event_Category_Linking_Table";
create policy gather_event_categories_read on public."Event_Category_Linking_Table" for select to anon, authenticated using (true);
grant select, delete on public."Bookmark", public."RSVP" to authenticated;
grant insert ("UserID", "EventID"), update ("UserID", "EventID") on public."Bookmark" to authenticated;
grant insert ("UserID", "EventID", "RSVPGoing"), update ("UserID", "EventID", "RSVPGoing") on public."RSVP" to authenticated;
do $$
declare sequence_name text; table_name text; column_name text;
begin
  for table_name, column_name in values ('Bookmark', 'BookmarkID'), ('RSVP', 'RSVPid') loop
    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), column_name);
    if sequence_name is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', sequence_name);
      execute format('grant usage on sequence %s to authenticated', sequence_name);
    end if;
  end loop;
end;
$$;

drop policy if exists gather_user_read on public."User";
create policy gather_user_read on public."User" for select to authenticated
  using ("UserID" = (select auth.uid()));
drop policy if exists gather_events_read on public."Events";
create policy gather_events_read on public."Events" for select to anon, authenticated using (true);

-- Explicit operations make future friend-read policies a separate decision.
-- Bookmarks remain private. RSVP friend visibility is NOT enabled by this work.
do $$
declare table_name text; prefix text; ownership text;
begin
  for table_name, prefix in values ('Bookmark', 'gather_bookmark'), ('RSVP', 'gather_rsvp') loop
    ownership := '"UserID" = (select auth.uid())';
    execute format('drop policy if exists %I on public.%I', prefix || '_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', prefix || '_read', table_name, ownership);
    execute format('drop policy if exists %I on public.%I', prefix || '_insert', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', prefix || '_insert', table_name, ownership);
    execute format('drop policy if exists %I on public.%I', prefix || '_update', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', prefix || '_update', table_name, ownership, ownership);
    execute format('drop policy if exists %I on public.%I', prefix || '_delete', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', prefix || '_delete', table_name, ownership);
  end loop;
end;
$$;
commit;
