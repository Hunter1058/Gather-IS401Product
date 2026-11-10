begin;

alter table public."User" add column "IsPrivate" boolean not null default true;
grant select ("IsPrivate"), update ("IsPrivate") on public."User" to authenticated;

create function public.save_profile_visibility_settings(
  first_name text, last_name text, category_ids bigint[], photo_url text, is_private boolean
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if is_private is null then raise invalid_parameter_value; end if;
  if photo_url is null then
    perform public.save_profile_settings(first_name, last_name, category_ids);
  else
    perform public.save_profile_settings_with_photo(first_name, last_name, category_ids, photo_url);
  end if;
  update public."User" set "IsPrivate" = is_private where "UserID" = auth.uid();
end;
$$;
revoke all on function public.save_profile_visibility_settings(text, text, bigint[], text, boolean) from public, anon;
grant execute on function public.save_profile_visibility_settings(text, text, bigint[], text, boolean) to authenticated;

create function public.search_friend_people(
  p_limit integer,
  p_after uuid,
  p_person_id uuid,
  p_query text
)
returns table (user_id uuid, display_name text, username text, relationship text, request_id text, is_private boolean, photo_url text)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in to browse people.';
  end if;
  if not exists (select 1 from public."User" u where u."UserID" = v_actor) then
    raise exception using errcode = '42501', message = 'Your account profile is not available.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 or (p_after is not null and p_person_id is not null) then
    raise exception using errcode = '22023', message = 'Invalid directory page.';
  end if;
  return query
    select u."UserID",
      case when u."IsPrivate" then
        coalesce('@' || left(nullif(btrim(u."Username"), ''), 60), 'Private profile')
      else left(coalesce(
        nullif(btrim(concat_ws(' ', u."UserFirstName", u."UserLastName")), ''),
        nullif(btrim(u."Username"), ''),
        nullif(btrim(a.raw_user_meta_data ->> 'name'), ''),
        'Member ' || left(u."UserID"::text, 8)
      ), 80) end,
      left(nullif(btrim(u."Username"), ''), 60),
      case when f."FriendshipID" is not null then 'friends'
        when r."RequesterUserID" = v_actor then 'outgoing_pending'
        when r."RecipientUserID" = v_actor then 'incoming_pending'
        else 'none' end,
      case when f."FriendshipID" is not null then null else r."FriendRequestID"::text end,
      u."IsPrivate", case when not u."IsPrivate" then u."UserProfilePhoto" end
    from public."User" u
    join auth.users a on a.id = u."UserID"
    left join public."Friends" f
      on f."UserAID" = least(v_actor, u."UserID") and f."UserBID" = greatest(v_actor, u."UserID")
    left join public."FriendRequest" r
      on r."Status" = 'pending'
      and least(r."RequesterUserID", r."RecipientUserID") = least(v_actor, u."UserID")
      and greatest(r."RequesterUserID", r."RecipientUserID") = greatest(v_actor, u."UserID")
    where u."UserID" <> v_actor
      and (p_after is null or u."UserID" > p_after)
      and (p_person_id is null or u."UserID" = p_person_id)
      and (coalesce(p_query, '') = '' or
        strpos(lower(coalesce(btrim(u."Username"), '')), lower(p_query)) > 0 or
        (not u."IsPrivate" and strpos(lower(concat_ws(' ', u."UserFirstName", u."UserLastName")), lower(p_query)) > 0))
    order by u."UserID"
    limit p_limit;
end;
$$;
revoke all on function public.search_friend_people(integer, uuid, uuid, text) from public, anon;
grant execute on function public.search_friend_people(integer, uuid, uuid, text) to authenticated;

-- Older deployments must also honor privacy during rollout.
create or replace function public.get_friend_people(
  p_limit integer default 25, p_after uuid default null, p_person_id uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text, request_id text)
language sql security invoker set search_path = ''
as $$
  select user_id, display_name, username, relationship, request_id
  from public.search_friend_people(p_limit, p_after, p_person_id, null);
$$;

notify pgrst, 'reload schema';
commit;
