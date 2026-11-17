-- GENERATED: run this ENTIRE file in Supabase SQL Editor as project owner.
-- Requires the current UI directory migration to be installed already.
-- Temporarily replaces the directory and creates private matching helpers.
-- Tests real SQL and permissions, then restores functions via ROLLBACK.
-- Does not write any User, Auth, friendship, RSVP or request records.
-- Run BEFORE applying the permanent search migration, not after.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regprocedure('public.get_friend_directory(integer,uuid,text,text)') is null then
    raise exception 'Install the existing friend directory migration first.';
  end if;
end;
$$;

-- Private implementation helpers; only the directory owner can execute them.
create function public.gather_friend_name_distance(p_left text, p_right text)
returns integer language plpgsql immutable strict set search_path = ''
as $$
declare
  a text := lower(p_left); b text := lower(p_right);
  m integer := length(a); n integer := length(b);
  previous integer[]; current_row integer[]; i integer; j integer;
begin
  if m > 80 or n > 80 then return 81; end if;
  if m = 0 then return n; end if;
  if n = 0 then return m; end if;
  previous := array_fill(0, array[n + 1], array[0]);
  for j in 0..n loop previous[j] := j; end loop;
  for i in 1..m loop
    current_row := array_fill(0, array[n + 1], array[0]);
    current_row[0] := i;
    for j in 1..n loop
      current_row[j] := least(current_row[j-1] + 1, previous[j] + 1,
        previous[j-1] + case when substr(a,i,1) = substr(b,j,1) then 0 else 1 end);
    end loop;
    previous := current_row;
  end loop;
  return previous[n];
end;
$$;

-- All query words must match a word of the stored first/last name. Partial
-- words match literally; fuzzy words require 4+ letters and at most 1 edit
-- (4-7 letters) or 2 edits (8+). No fuzzy email or username comparison exists.
create function public.gather_friend_name_matches(p_query text, p_name text, p_fuzzy boolean)
returns boolean language plpgsql immutable strict set search_path = ''
as $$
declare q text; token text; found_word boolean; tolerance integer;
begin
  if btrim(p_query) = '' or length(p_query) > 80 or btrim(p_name) = '' then return false; end if;
  foreach q in array regexp_split_to_array(lower(btrim(p_query)), '[[:space:]]+') loop
    found_word := false;
    tolerance := case when length(q) >= 8 then 2 when length(q) >= 4 then 1 else 0 end;
    foreach token in array regexp_split_to_array(lower(btrim(p_name)), '[[:space:]]+') loop
      if strpos(token, q) > 0 or (p_fuzzy and tolerance > 0
        and abs(length(q) - length(token)) <= tolerance
        and public.gather_friend_name_distance(q, token) <= tolerance) then
        found_word := true; exit;
      end if;
    end loop;
    if not found_word then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.gather_friend_name_distance(text,text) from public, anon, authenticated;
revoke all on function public.gather_friend_name_matches(text,text,boolean) from public, anon, authenticated;

-- Returns only the match tier; email/name inputs never appear in the RPC output.
create function public.gather_friend_search_rank(
  p_query text, p_handle text, p_name text, p_email text, p_private boolean
) returns integer language plpgsql immutable set search_path = ''
as $$
declare
  q text := lower(regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', ' ', 'g'));
  handle text := lower(coalesce(p_handle, ''));
  handle_only boolean := left(q, 1) = '@';
  email_only boolean := not handle_only and strpos(q, '@') > 0;
  handle_query text := case when handle_only then substr(q, 2) else q end;
  private_profile boolean := coalesce(p_private, true);
  full_name text := lower(btrim(coalesce(p_name, '')));
begin
  if length(q) > 254 then raise exception using errcode = '22023', message = 'Search is too long.'; end if;
  if q = '' then return 0; end if;
  if q = '@' then return null; end if;
  if not email_only and handle_query <> '' then
    if handle = handle_query then return 1; end if;
    if strpos(handle, handle_query) = 1 then return 2; end if;
    if strpos(handle, handle_query) > 0 then return 3; end if;
  end if;
  if not private_profile and not handle_only and not email_only then
    if full_name = q then return 4; end if;
    if public.gather_friend_name_matches(q, full_name, false) then return 5; end if;
    if public.gather_friend_name_matches(q, full_name, true) then return 6; end if;
  end if;
  if not private_profile and strpos(lower(coalesce(p_email, '')), q) > 0 then return 7; end if;
  return null;
end;
$$;
revoke all on function public.gather_friend_search_rank(text,text,text,text,boolean) from public, anon, authenticated;

create or replace function public.get_friend_directory(
  p_limit integer default 25, p_after uuid default null,
  p_section text default 'friends', p_search text default ''
)
returns table (user_id uuid, display_name text, username text, relationship text,
  request_id text, mutual_friends bigint, shared_events bigint, is_private boolean, photo_url text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_query text := lower(regexp_replace(btrim(p_search), '[[:space:]]+', ' ', 'g'));

begin
  if v_actor is null or not exists (select 1 from public."User" where "UserID" = v_actor) then
    raise exception using errcode = '42501', message = 'Sign in to browse people.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51
     or p_section is null or p_section not in ('friends', 'search', 'requests')
     or p_search is null or length(p_search) > 254 then
    raise exception using errcode = '22023', message = 'Invalid directory filter.';
  end if;
  return query
  with my_friends as (
    select case when "UserAID" = v_actor then "UserBID" else "UserAID" end as id
    from public."Friends" where "UserAID" = v_actor or "UserBID" = v_actor
  ), profiles as (
    select u."UserID" as id,
      u."IsPrivate" as private_profile,
      lower(btrim(concat_ws(' ', u."UserFirstName", u."UserLastName"))) as full_name,
      lower(coalesce(a.email, '')) as email_value,
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
  ), matched as (
    select p.*,
      public.gather_friend_search_rank(v_query, p.handle, p.full_name,
        p.email_value, p.private_profile) as match_rank
    from profiles p
  ), scored as (
    select p.*,
      case when p_section = 'search' and not p.private_profile then (select count(*) from my_friends m
        join public."Friends" f on f."UserAID" = least(p.id, m.id)
          and f."UserBID" = greatest(p.id, m.id)) else 0::bigint end as mutual,
      case when p_section = 'search' and not p.private_profile then (select count(*) from public."RSVP" mine
        join public."RSVP" theirs on theirs."EventID" = mine."EventID"
        where mine."UserID" = v_actor and theirs."UserID" = p.id
          and mine."RSVPGoing" and theirs."RSVPGoing") else 0::bigint end as shared
    from matched p
  ), ranked as (
    select s.*, row_number() over (order by s.match_rank, (s.mutual + s.shared) desc, s.id) as position
    from scored s
  )
  select r.id, r.name, r.handle, r.relation, r.rid, r.mutual, r.shared, r.private_profile, r.photo
  from ranked r
  where (case p_section when 'friends' then r.relation = 'friends'
      when 'requests' then r.relation in ('incoming_pending', 'outgoing_pending')
      else (v_query <> '' or r.relation = 'none') end)
    and r.match_rank is not null
    and (p_after is null or r.position > (select cursor_row.position from ranked cursor_row where cursor_row.id = p_after))
  order by r.position limit p_limit;
end;
$$;
revoke all on function public.get_friend_directory(integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_friend_directory(integer, uuid, text, text) to authenticated;
notify pgrst, 'reload schema';

-- Owner-only checks, intended inside the generated rehearsal transaction.
-- No profile, Auth, friendship, RSVP or request records are modified.
do $$
declare t record; actual integer;
begin
  for t in select * from (values
    ('', null::text, null::text, null::text, true, 0),
    ('JoN', 'jon', 'Other Person', 'other@example.test', false, 1),
    ('jon', 'jonny', 'Other Person', 'other@example.test', false, 2),
    ('jon', 'the_jonny', 'Other Person', 'other@example.test', false, 3),
    ('@jon', 'jonny', 'Other Person', 'other@example.test', true, 2),
    ('@jonnny', 'jonny', 'Jonnny Smith', 'jonnny@example.test', false, null),
    ('jonathan thompson', 'other', 'Jonathan Thompson', null, false, 4),
    ('Jonathan', 'other', 'Jonathan Thompson', null, false, 5),
    ('Thompson', 'other', 'Jonathan Thompson', null, false, 5),
    ('thomp jon', 'other', 'Jonathan Thompson', null, false, 5),
    ('  JON   THOMP  ', 'other', 'Jonathan Thompson', null, false, 5),
    ('Jonathon', 'other', 'Jonathan Thompson', null, false, 6),
    ('Smyth', 'other', 'Jane Smith', null, false, 6),
    ('Jan', 'other', 'Jane Smith', null, false, 5),
    ('Jne', 'other', 'Jane Smith', null, false, null),
    ('Alexandra', 'other', 'Jane Smith', null, false, null),
    ('jonathan', 'unrelated', 'Jonathan Thompson', null, true, null),
    ('THOMPSON', null, 'Jonathan Thompson', null, true, null),
    ('school@byu', 'other', 'Other Person', 'school@byu.edu', false, 7),
    ('SCHOOL@BYU.EDU', 'other', 'Other Person', 'school@byu.edu', false, 7),
    ('schol@byu.edu', 'other', 'Other Person', 'school@byu.edu', false, null),
    ('school@byu.edu', 'other', 'Other Person', 'school@byu.edu', true, null),
    ('byu.edu', 'other', 'Other Person', 'school@byu.edu', false, 7),
    ('@byu.edu', 'other', 'Other Person', 'school@byu.edu', false, 7),
    ('%', 'other', 'Other Person', 'school@byu.edu', false, null),
    ('@', 'other', 'Other Person', 'school@byu.edu', false, null),
    ('', null, null, null, null, 0)
  ) as cases(query, handle, name, email, private_profile, expected) loop
    actual := public.gather_friend_search_rank(t.query,t.handle,t.name,t.email,t.private_profile);
    if actual is distinct from t.expected then
      raise exception 'Search case failed: query %, expected %, got %', t.query,t.expected,actual;
    end if;
  end loop;
  if public.gather_friend_name_distance('kitten','sitting') <> 3 then raise exception 'Distance failed'; end if;
  if public.gather_friend_name_distance('', 'abc') <> 3 then raise exception 'Empty distance failed'; end if;
  if has_function_privilege('anon','public.get_friend_directory(integer,uuid,text,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_friend_directory(integer,uuid,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.gather_friend_search_rank(text,text,text,text,boolean)','EXECUTE') then
    raise exception 'Unexpected search execution permissions';
  end if;
end;
$$;

do $$
declare actor uuid; public_id uuid; public_email text; private_id uuid; private_email text; entry record;
begin
  select u."UserID" into actor from public."User" u join auth.users a on a.id=u."UserID" order by u."UserID" limit 1;
  if actor is null then raise exception 'A real matching User/Auth account is required for rehearsal'; end if;
  select u."UserID", a.email into public_id, public_email
    from public."User" u join auth.users a on a.id=u."UserID"
    where u."UserID"<>actor and not u."IsPrivate" and strpos(a.email,'@')>0 order by u."UserID" limit 1;
  select u."UserID", a.email into private_id, private_email
    from public."User" u join auth.users a on a.id=u."UserID"
    where u."UserID"<>actor and u."IsPrivate" and strpos(a.email,'@')>0 order by u."UserID" limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  perform * from public.get_friend_directory(2,null,'friends','');
  perform * from public.get_friend_directory(2,null,'requests','');
  for entry in select * from public.get_friend_directory(51,null,'search','') loop
    if entry.user_id=actor or to_jsonb(entry) ?| array['email','email_value','full_name'] then
      raise exception 'Directory leaked internal fields or included its caller';
    end if;
  end loop;
  if public_id is not null and not exists (
    select 1 from public.get_friend_directory(51,null,'search',public_email) where user_id=public_id
  ) then raise exception 'Public email lookup failed'; end if;
  if private_id is not null and exists (
    select 1 from public.get_friend_directory(51,null,'search',private_email) where user_id=private_id
  ) then raise exception 'Private profile was discoverable by email'; end if;
  begin
    perform * from public.get_friend_directory(1,null,'search',repeat('x',255));
    raise exception 'Oversized query was accepted';
  exception when invalid_parameter_value then null; end;
  reset role;
  -- Only booleans are reported, never the emails used for the checks.
  perform set_config('gather.search_public_probe', (public_id is not null)::text, true);
  perform set_config('gather.search_private_probe', (private_id is not null)::text, true);
end;
$$;

select 'PASS: friend search rehearsal completed; function changes will roll back.' as result,
  current_setting('gather.search_public_probe')::boolean as real_public_email_checked,
  current_setting('gather.search_private_probe')::boolean as real_private_email_checked;

rollback;
