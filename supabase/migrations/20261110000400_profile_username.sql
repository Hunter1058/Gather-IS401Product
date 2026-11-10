begin;

create unique index gather_username_unique
  on public."User" (lower(btrim("Username")))
  where nullif(btrim("Username"), '') is not null;

grant update ("Username") on public."User" to authenticated;

create function public.save_profile_username_settings(
  first_name text, last_name text, category_ids bigint[], photo_url text,
  is_private boolean, username text
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if username is not null and username !~ '^[a-z0-9_]{3,30}$' then
    raise invalid_parameter_value;
  end if;
  perform public.save_profile_visibility_settings(first_name, last_name, category_ids, photo_url, is_private);
  update public."User" set "Username" = save_profile_username_settings.username
    where "UserID" = auth.uid();
end;
$$;

revoke all on function public.save_profile_username_settings(text, text, bigint[], text, boolean, text) from public, anon;
grant execute on function public.save_profile_username_settings(text, text, bigint[], text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;
