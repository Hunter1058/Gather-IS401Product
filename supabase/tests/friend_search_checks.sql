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
