-- READ ONLY: one JSON result to copy from Supabase SQL Editor.
-- This reads schema metadata only; it does not call either sharing RPC.
select jsonb_pretty(jsonb_build_object(
  'sharing_functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'signature', p.oid::regprocedure::text,
      'arguments', pg_get_function_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE')
    )) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('gather_share_event','gather_received_event_shares')
  ), '[]'::jsonb),
  'interaction_columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', column_name, 'type', data_type, 'nullable', is_nullable,
      'default', column_default, 'identity', is_identity
    ) order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='EventInteractionLog'
  ), '[]'::jsonb),
  'interaction_constraints', coalesce((
    select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)))
    from pg_constraint where conrelid=to_regclass('public."EventInteractionLog"')
  ), '[]'::jsonb),
  'interaction_policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name',policyname,'command',cmd,'roles',roles,'permissive',permissive,
      'using',qual,'with_check',with_check
    )) from pg_policies where schemaname='public' and tablename='EventInteractionLog'
  ), '[]'::jsonb),
  'interaction_table', (
    select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'forced_rls',relforcerowsecurity)
    from pg_class where oid=to_regclass('public."EventInteractionLog"')
  ),
  'interaction_triggers', coalesce((
    select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)))
    from pg_trigger where tgrelid=to_regclass('public."EventInteractionLog"') and not tgisinternal
  ), '[]'::jsonb),
  'interaction_table_grants', coalesce((
    select jsonb_agg(jsonb_build_object('role',grantee,'privilege',privilege_type))
    from information_schema.table_privileges where table_schema='public' and table_name='EventInteractionLog'
  ), '[]'::jsonb),
  'interaction_column_grants', coalesce((
    select jsonb_agg(jsonb_build_object('role',grantee,'column',column_name,'privilege',privilege_type))
    from information_schema.column_privileges where table_schema='public' and table_name='EventInteractionLog'
  ), '[]'::jsonb),
  'friendship_columns', coalesce((
    select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type) order by ordinal_position)
    from information_schema.columns where table_schema='public' and table_name='Friends'
  ), '[]'::jsonb),
  'friend_pair_lock', to_regprocedure('public.gather_lock_friend_pair(uuid,uuid)')::text
)) as sharing_diagnostics;
