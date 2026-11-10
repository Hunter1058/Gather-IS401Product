begin;

create table if not exists public."UserInterest" (
  "UserID" uuid not null references public."User" ("UserID") on delete cascade,
  "EventCatID" bigint not null references public."EventCategory" ("EventCatID") on delete cascade,
  primary key ("UserID", "EventCatID")
);
alter table public."UserInterest" enable row level security;
revoke all on public."UserInterest" from anon, authenticated;
grant select, insert, delete on public."UserInterest" to authenticated;
drop policy if exists "Users manage their own interests" on public."UserInterest";
create policy "Users manage their own interests" on public."UserInterest"
  for all to authenticated using ((select auth.uid()) = "UserID")
  with check ((select auth.uid()) = "UserID");

grant select ("UserFirstName", "UserLastName"),
  update ("UserFirstName", "UserLastName") on public."User" to authenticated;
drop policy if exists gather_user_update_names on public."User";
create policy gather_user_update_names on public."User" for update to authenticated
  using ((select auth.uid()) = "UserID") with check ((select auth.uid()) = "UserID");

create or replace function public.save_profile_settings(
  first_name text, last_name text, category_ids bigint[]
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise insufficient_privilege;
  end if;
  if first_name is null or char_length(btrim(first_name)) not between 1 and 60
    or last_name is null or char_length(btrim(last_name)) > 60
    or category_ids is null or cardinality(category_ids) > 100
    or array_position(category_ids, null) is not null then
    raise invalid_parameter_value;
  end if;

  -- Updating the owner row serializes concurrent saves for that account.
  update public."User"
    set "UserFirstName" = btrim(first_name), "UserLastName" = btrim(last_name)
    where "UserID" = owner_id;
  if not found then
    raise no_data_found;
  end if;

  delete from public."UserInterest"
    where "UserID" = owner_id and not ("EventCatID" = any(category_ids));
  insert into public."UserInterest" ("UserID", "EventCatID")
    select owner_id, category_id from unnest(category_ids) as ids(category_id)
    on conflict ("UserID", "EventCatID") do nothing;
end;
$$;

revoke all on function public.save_profile_settings(text, text, bigint[]) from public, anon;
grant execute on function public.save_profile_settings(text, text, bigint[]) to authenticated;

commit;
