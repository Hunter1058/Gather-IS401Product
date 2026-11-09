-- Add a limited authenticated directory; DO NOT rerun the foundation migration.
begin;
do $$
begin
  if to_regprocedure('public.send_friend_request(uuid)') is null
     or to_regprocedure('public.cancel_friend_request(bigint)') is null
     or to_regprocedure('public.remove_friend(uuid)') is null
     or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'Friends' and column_name = 'UserAID') then
    raise exception 'Apply the friendship foundation before the friend directory migration.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_friend_people') then
    raise exception 'get_friend_people already exists; review it instead of replacing it.';
  end if;
end;
$$;

create function public.get_friend_people(
  p_limit integer default 25,
  p_after uuid default null,
  p_person_id uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text, request_id text)
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
      left(coalesce(
        nullif(btrim(concat_ws(' ', u."UserFirstName", u."UserLastName")), ''),
        nullif(btrim(u."Username"), ''),
        nullif(btrim(a.raw_user_meta_data ->> 'name'), ''),
        'Member ' || left(u."UserID"::text, 8)
      ), 80),
      left(nullif(btrim(u."Username"), ''), 60),
      case when f."FriendshipID" is not null then 'friends'
        when r."RequesterUserID" = v_actor then 'outgoing_pending'
        when r."RecipientUserID" = v_actor then 'incoming_pending'
        else 'none' end,
      case when f."FriendshipID" is not null then null else r."FriendRequestID"::text end
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
    order by u."UserID"
    limit p_limit;
end;
$$;
revoke all on function public.get_friend_people(integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_friend_people(integer, uuid, uuid) to authenticated;
comment on function public.get_friend_people(integer, uuid, uuid) is
  'Signed-in directory: IDs, display names, usernames, and relationship to caller only. No emails, passwords or other users'' relationship graph. Request IDs returned as text.';
notify pgrst, 'reload schema';
commit;
