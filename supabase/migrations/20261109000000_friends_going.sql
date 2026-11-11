begin;

-- Only return matching event IDs for the caller's outgoing friendship links.
-- Do not grant general access to other users' RSVP or profile records.
create or replace function public.gather_friends_going()
returns table ("EventID" text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r."EventID"::text
  from public."RSVP" r
  join public."Friends" f on f."FriendUserID" = r."UserID"
  where f."UserID" = (select auth.uid())
    and r."UserID" <> (select auth.uid())
    and r."RSVPGoing" = true
    and r."EventID" is not null;
$$;

revoke all on function public.gather_friends_going() from public, anon, authenticated;
grant execute on function public.gather_friends_going() to authenticated;
create index if not exists gather_friends_owner_friend
  on public."Friends" ("UserID", "FriendUserID");

commit;
