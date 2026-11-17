-- Read-only, personalized suggestions. Does not change search or friendships.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regclass('public."UserInterest"') is null
    or to_regprocedure('public.get_friend_directory(integer,uuid,text,text)') is null then
    raise exception 'Install the existing profile interests and friend directory setup first.';
  end if;
end;
$$;

create function public.get_friend_recommendations(
  p_limit integer default 25, p_after uuid default null
)
returns table (user_id uuid, display_name text, username text, relationship text,
  request_id text, mutual_friends bigint, shared_events bigint, is_private boolean,
  photo_url text, connection_degree integer, shared_interests bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public."User" u where u."UserID"=v_actor) then
    raise exception using errcode='42501', message='Sign in to see suggestions.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then
    raise exception using errcode='22023', message='Invalid recommendation page.';
  end if;
  return query
  with recursive visible_edges as (
    select f."UserAID" as a, f."UserBID" as b
    from public."Friends" f
    join public."User" ua on ua."UserID"=f."UserAID"
    join public."User" ub on ub."UserID"=f."UserBID"
    where (ua."UserID"=v_actor or not ua."IsPrivate")
      and (ub."UserID"=v_actor or not ub."IsPrivate")
  ), walk(id, depth) as (
    select v_actor, 0
    union
    select case when e.a=w.id then e.b else e.a end, w.depth+1
    from walk w join visible_edges e on e.a=w.id or e.b=w.id
    where w.depth < 3
  ), distances as (
    select w.id, min(w.depth) as degree from walk w where w.id<>v_actor group by w.id
  ), my_friends as (
    select case when e.a=v_actor then e.b else e.a end as id
    from visible_edges e where e.a=v_actor or e.b=v_actor
  ), overlap_events as (
    select theirs."UserID" as id, count(distinct theirs."EventID") as total
    from public."RSVP" mine join public."RSVP" theirs on theirs."EventID"=mine."EventID"
    where mine."UserID"=v_actor and mine."RSVPGoing" and theirs."RSVPGoing"
    group by theirs."UserID"
  ), overlap_interests as (
    select theirs."UserID" as id, count(distinct theirs."EventCatID") as total
    from public."UserInterest" mine join public."UserInterest" theirs on theirs."EventCatID"=mine."EventCatID"
    where mine."UserID"=v_actor group by theirs."UserID"
  ), mutual_counts as (
    select case when e.a=m.id then e.b else e.a end as id, count(distinct m.id) as total
    from my_friends m join visible_edges e on e.a=m.id or e.b=m.id
    group by case when e.a=m.id then e.b else e.a end
  ), profiles as (
    select u."UserID" as id,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''), nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80) as name,
      left(nullif(btrim(u."Username"),''),60) as handle,
      u."UserProfilePhoto" as photo,
      case when d.degree between 2 and 3 then d.degree end as degree,
      coalesce(m.total,0::bigint) as mutual,
      coalesce(e.total,0::bigint) as events,
      coalesce(i.total,0::bigint) as interests,
      not exists (select 1 from public."Friends" f
        where f."UserAID"=least(v_actor,u."UserID") and f."UserBID"=greatest(v_actor,u."UserID"))
      and not exists (select 1 from public."FriendRequest" r where r."Status"='pending'
        and least(r."RequesterUserID",r."RecipientUserID")=least(v_actor,u."UserID")
        and greatest(r."RequesterUserID",r."RecipientUserID")=greatest(v_actor,u."UserID")) as eligible
    from public."User" u join auth.users a on a.id=u."UserID"
    left join distances d on d.id=u."UserID"
    left join mutual_counts m on m.id=u."UserID"
    left join overlap_events e on e.id=u."UserID"
    left join overlap_interests i on i.id=u."UserID"
    where u."UserID"<>v_actor and not u."IsPrivate"
  ), ranked as (
    select p.*, row_number() over (order by p.degree asc nulls last,
      p.events desc, p.interests desc, p.mutual desc, p.id) as position
    from profiles p
  )
  select r.id,r.name,r.handle,'none'::text,null::text,r.mutual,r.events,false,
    r.photo,r.degree,r.interests
  from ranked r
  where r.eligible and (r.degree is not null or r.events>0 or r.interests>0)
    and (p_after is null or r.position > (select c.position from ranked c where c.id=p_after))
  order by r.position limit p_limit;
end;
$$;
revoke all on function public.get_friend_recommendations(integer,uuid) from public,anon,authenticated;
grant execute on function public.get_friend_recommendations(integer,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
