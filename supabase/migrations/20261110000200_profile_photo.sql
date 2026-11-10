begin;

grant update ("UserProfilePhoto") on public."User" to authenticated;

create or replace function public.save_profile_settings_with_photo(
  first_name text, last_name text, category_ids bigint[], photo_url text
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if photo_url is null or char_length(photo_url) > 55000
    or photo_url !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]+={0,2}$' then
    raise invalid_parameter_value;
  end if;
  perform public.save_profile_settings(first_name, last_name, category_ids);
  update public."User" set "UserProfilePhoto" = photo_url
    where "UserID" = auth.uid();
end;
$$;

revoke all on function public.save_profile_settings_with_photo(text, text, bigint[], text) from public, anon;
grant execute on function public.save_profile_settings_with_photo(text, text, bigint[], text) to authenticated;

commit;
