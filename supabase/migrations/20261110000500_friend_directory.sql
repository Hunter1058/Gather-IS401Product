-- Filter before pagination so each tab searches the entire directory.
-- Only aggregate overlap counts are exposed, never other people's RSVP lists
-- or the identities of their friends. Existing table RLS stays unchanged.
begin;
create function public.get_friend_directory(
  p_limit integer default 25, p_after uuid default null,
  p_section text default 'friends', p_search text default ''
)
returns table (user_id uuid, display_name text, username text, relationship text,
  request_id text, mutual_friends bigint, shared_events bigint, is_private boolean, photo_url text)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public."User" where "UserID" = v_actor) then
    raise exception using errcode = '42501', message = 'Sign in to browse people.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51
     or p_section is null or p_section not in ('friends', 'search', 'requests')
     or p_search is null or length(p_search) > 80 then
    raise exception using errcode = '22023', message = 'Invalid directory filter.';
  end if;
  return query
  with my_friends as (
    select case when "UserAID" = v_actor then "UserBID" else "UserAID" end as id
    from public."Friends" where "UserAID" = v_actor or "UserBID" = v_actor
  ), profiles as (
    select u."UserID" as id,
      u."IsPrivate" as private_profile,
      case when not u."IsPrivate" then u."UserProfilePhoto" end as photo,
      case when u."IsPrivate" then coalesce('@' || left(nullif(btrim(u."Username"), ''), 60), 'Private profile')
      else left(coalesce(nullif(btrim(concat_ws(' ', u."UserFirstName", u."UserLastName")), ''),
        nullif(btrim(u."Username"), ''), nullif(btrim(a.raw_user_meta_data ->> 'name'), ''),
        'Member ' || left(u."UserID"::text, 8)), 80) end as name,
      left(nullif(btrim(u."Username"), ''), 60) as handle,
      case when f."FriendshipID" is not null then 'friends'
        when r."RequesterUserID" = v_actor then 'outgoing_pending'
        when r."RecipientUserID" = v_actor then 'incoming_pending' else 'none' end as relation,
      case when f."FriendshipID" is null then r."FriendRequestID"::text end as rid
    from public."User" u join auth.users a on a.id = u."UserID"
    left join public."Friends" f on f."UserAID" = least(v_actor, u."UserID")
      and f."UserBID" = greatest(v_actor, u."UserID")
    left join public."FriendRequest" r on r."Status" = 'pending'
      and least(r."RequesterUserID", r."RecipientUserID") = least(v_actor, u."UserID")
      and greatest(r."RequesterUserID", r."RecipientUserID") = greatest(v_actor, u."UserID")
    where u."UserID" <> v_actor
  ), scored as (
    select p.*,
      case when p_section = 'search' and not p.private_profile then (select count(*) from my_friends m
        join public."Friends" f on f."UserAID" = least(p.id, m.id)
          and f."UserBID" = greatest(p.id, m.id)) else 0::bigint end as mutual,
      case when p_section = 'search' and not p.private_profile then (select count(*) from public."RSVP" mine
        join public."RSVP" theirs on theirs."EventID" = mine."EventID"
        where mine."UserID" = v_actor and theirs."UserID" = p.id
          and mine."RSVPGoing" and theirs."RSVPGoing") else 0::bigint end as shared
    from profiles p
  ), ranked as (
    select s.*, row_number() over (order by (s.mutual + s.shared) desc, s.id) as position
    from scored s
  )
  select r.id, r.name, r.handle, r.relation, r.rid, r.mutual, r.shared, r.private_profile, r.photo
  from ranked r
  where (case p_section when 'friends' then r.relation = 'friends'
      when 'requests' then r.relation in ('incoming_pending', 'outgoing_pending')
      else r.relation = 'none' end)
    and (p_search = '' or strpos(lower(r.name), lower(btrim(p_search))) > 0
      or strpos(lower(coalesce(r.handle, '')), lower(btrim(p_search))) > 0)
    and (p_after is null or r.position > (select cursor_row.position from ranked cursor_row where cursor_row.id = p_after))
  order by r.position limit p_limit;
end;
$$;
revoke all on function public.get_friend_directory(integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_friend_directory(integer, uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
