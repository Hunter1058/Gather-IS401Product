-- Forward correction for the current canonical friendship schema.
-- No existing data or table RLS/grants are changed.
begin;
set local lock_timeout = '10s';
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserAID')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='Friends' and column_name='UserBID')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='User' and column_name='IsPrivate') then
  raise exception 'Install the canonical friendships and profile visibility migrations first.';
 end if;
 if to_regprocedure('public.gather_event_friend_attendance(bigint,integer)') is not null then
  raise exception 'Event friend attendance is already installed. Stop instead of rerunning this migration.';
 end if;
end; $$;

create function public.gather_event_friend_attendance(
 p_after_event_id bigint default null, p_limit integer default 250
)
returns table(event_id text, friend_count text, friends jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from public."User" u where u."UserID"=actor) then
  raise exception using errcode='42501',message='Sign in to see friends attending events.';
 end if;
 if p_limit is null or p_limit<1 or p_limit>250 or (p_after_event_id is not null and p_after_event_id<1) then
  raise invalid_parameter_value;
 end if;
 return query
 with my_friends as (
  select f."UserBID" as id from public."Friends" f where f."UserAID"=actor
  union
  select f."UserAID" as id from public."Friends" f where f."UserBID"=actor
 ), attendance as (
  select distinct r."EventID" as eid,u."UserID" as uid,
   left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
    '@'||nullif(btrim(u."Username"),''),'Gather friend'),80) as label
  from my_friends f
  join public."User" u on u."UserID"=f.id and u."IsPrivate"=false
  join auth.users a on a.id=u."UserID"
  join public."RSVP" r on r."UserID"=u."UserID" and r."RSVPGoing"=true
  join public."Events" e on e."EventID"=r."EventID"
  where u."UserID"<>actor and (p_after_event_id is null or r."EventID">p_after_event_id)
 ), ranked as (
  select a.*,row_number() over(partition by a.eid order by a.label,a.uid) as position
  from attendance a
 )
 select r.eid::text,count(*)::text,
  jsonb_agg(jsonb_build_object('id',r.uid::text,'label',r.label) order by r.label,r.uid)
   filter(where r.position<=2)
 from ranked r group by r.eid order by r.eid limit p_limit;
end;
$$;
revoke all on function public.gather_event_friend_attendance(bigint,integer) from public,anon,authenticated;
grant execute on function public.gather_event_friend_attendance(bigint,integer) to authenticated;

-- Keep the existing event-ID-only contract for older deployments/clients.
-- The old migration used UserID/FriendUserID, which the new schema renamed.
create or replace function public.gather_friends_going()
returns table("EventID" text)
language sql stable security definer set search_path = ''
as $$
 select distinct r."EventID"::text
 from public."RSVP" r
 join public."Events" e on e."EventID"=r."EventID"
 join public."User" u on u."UserID"=r."UserID" and u."IsPrivate"=false
 join auth.users a on a.id=u."UserID"
 join public."Friends" f on
  (f."UserAID"=(select auth.uid()) and f."UserBID"=r."UserID") or
  (f."UserBID"=(select auth.uid()) and f."UserAID"=r."UserID")
 where (select auth.uid()) is not null and r."UserID"<>(select auth.uid()) and r."RSVPGoing"=true;
$$;
revoke all on function public.gather_friends_going() from public,anon,authenticated;
grant execute on function public.gather_friends_going() to authenticated;
notify pgrst,'reload schema';
commit;
