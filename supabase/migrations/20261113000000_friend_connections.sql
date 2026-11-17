-- Shared details only: never returns full friend, RSVP or interest lists.
begin;
create function public.get_friend_connections(
  p_person_id uuid, p_kind text, p_limit integer default 11, p_after text default null
)
returns table (item_id text,label text,username text,event_date date,event_location text)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid:=auth.uid(); private_profile boolean; cursor_uuid uuid; cursor_number bigint;
begin
  if actor is null or not exists(select 1 from public."User" u where u."UserID"=actor) then
    raise exception using errcode='42501',message='Sign in to see shared connections.';
  end if;
  if p_person_id is null or p_person_id=actor or p_kind is null or p_kind not in ('friends','events','interests')
    or p_limit is null or p_limit<1 or p_limit>51 then
    raise exception using errcode='22023',message='Invalid connection lookup.';
  end if;
  select u."IsPrivate" into private_profile from public."User" u join auth.users a on a.id=u."UserID" where u."UserID"=p_person_id;
  if not found then raise exception using errcode='23503',message='That person is unavailable.'; end if;
  if private_profile then return; end if;
  if p_after is not null then
    if p_kind='friends' then cursor_uuid:=p_after::uuid;
    else
      if p_after !~ '^[1-9][0-9]{0,18}$' then raise invalid_parameter_value; end if;
      cursor_number:=p_after::bigint;
    end if;
  end if;
  if p_kind='friends' then
    return query
    select u."UserID"::text,
      left(coalesce(nullif(btrim(concat_ws(' ',u."UserFirstName",u."UserLastName")),''),
        nullif(btrim(u."Username"),''),nullif(btrim(a.raw_user_meta_data->>'name'),''),
        'Member '||left(u."UserID"::text,8)),80),
      left(nullif(btrim(u."Username"),''),60),null::date,null::text
    from public."User" u join auth.users a on a.id=u."UserID"
    where not u."IsPrivate" and u."UserID" not in (actor,p_person_id)
      and (cursor_uuid is null or u."UserID">cursor_uuid)
      and exists(select 1 from public."Friends" f where f."UserAID"=least(actor,u."UserID") and f."UserBID"=greatest(actor,u."UserID"))
      and exists(select 1 from public."Friends" f where f."UserAID"=least(p_person_id,u."UserID") and f."UserBID"=greatest(p_person_id,u."UserID"))
    order by u."UserID" limit p_limit;
  elsif p_kind='events' then
    return query
    select e."EventID"::text,coalesce(nullif(btrim(e."EventName"),''),'Unnamed event'),null::text,e."EventDate",e."EventLocation"
    from public."Events" e
    where (cursor_number is null or e."EventID">cursor_number)
      and exists(select 1 from public."RSVP" r where r."UserID"=actor and r."EventID"=e."EventID" and r."RSVPGoing")
      and exists(select 1 from public."RSVP" r where r."UserID"=p_person_id and r."EventID"=e."EventID" and r."RSVPGoing")
    order by e."EventID" limit p_limit;
  else
    return query
    select c."EventCatID"::text,coalesce(nullif(btrim(c."EventCatagory"),''),'Unnamed interest'),null::text,null::date,null::text
    from public."EventCategory" c
    where (cursor_number is null or c."EventCatID">cursor_number)
      and exists(select 1 from public."UserInterest" i where i."UserID"=actor and i."EventCatID"=c."EventCatID")
      and exists(select 1 from public."UserInterest" i where i."UserID"=p_person_id and i."EventCatID"=c."EventCatID")
    order by c."EventCatID" limit p_limit;
  end if;
end;
$$;
revoke all on function public.get_friend_connections(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.get_friend_connections(uuid,text,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
