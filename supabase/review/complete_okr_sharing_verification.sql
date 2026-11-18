-- READ ONLY. Every required check must return true after the repair.
with rpc as (
  select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('gather_share_event','gather_received_event_shares')
), checks as (
  select 'share RPC: exact input names/types and output' as check_name,
    exists(select 1 from rpc where oid=to_regprocedure('public.gather_share_event(bigint,text,uuid,uuid)')
      and proargnames[1:4]=array['p_event_id','p_channel','p_recipient','p_request_id']
      and pg_get_function_result(oid)='TABLE(interaction_id text)') as passed
  union all select 'inbox RPC: exact input names/types and output',
    exists(select 1 from rpc where oid=to_regprocedure('public.gather_received_event_shares(bigint,integer)')
      and proargnames[1:2]=array['p_after','p_limit']
      and pg_get_function_result(oid)='TABLE(interaction_id text, event_id text, event_name text, sender_name text, shared_at timestamp with time zone)')
  union all select 'no conflicting overloads',(select count(*)=2 from rpc)
  union all select 'trusted-owner definer RPCs, empty search_path',
    (select count(*)=2 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
      and (r.rolsuper or r.rolbypassrls)) from rpc p join pg_roles r on r.oid=p.proowner)
  union all select 'authenticated execution only',
    (select count(*)=2 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE')
      and not has_function_privilege('anon',oid,'EXECUTE')) from rpc)
  union all select 'interaction RLS enabled',
    exists(select 1 from pg_class where oid=to_regclass('public."EventInteractionLog"') and relrowsecurity)
  union all select 'view and restrictive insert policies present',
    (select count(*)=3 from pg_policies where schemaname='public' and tablename='EventInteractionLog'
      and policyname in ('gather_okr_repair_views','gather_okr_repair_direct_views','gather_okr_repair_no_anon') and cmd='INSERT')
  union all select 'no raw history read/update/delete policies',
    not exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog' and cmd in ('SELECT','UPDATE','DELETE','ALL'))
  union all select 'authenticated view insert columns granted',
    (select bool_and(has_column_privilege('authenticated','public."EventInteractionLog"',col,'INSERT'))
      from unnest(array['UserID','EventID','InteractionType','RecipientUserID']) col)
  union all select 'generated and share-only columns cannot be supplied directly',
    (select bool_and(not has_column_privilege('authenticated','public."EventInteractionLog"',col,'INSERT'))
      from unnest(array['InteractionID','created_at','ShareChannel','ShareRequestID']) col)
  union all select 'anonymous cannot insert interactions',
    not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
      and has_column_privilege('anon','public."EventInteractionLog"',column_name,'INSERT'))
  union all select 'identity sequence usable by authenticated',
    coalesce(has_sequence_privilege('authenticated',pg_get_serial_sequence('public."EventInteractionLog"','InteractionID'),'USAGE'),false)
  union all select 'validated channel constraint present',
    exists(select 1 from pg_constraint where conrelid=to_regclass('public."EventInteractionLog"')
      and conname='gather_interaction_channel_shape' and convalidated)
  union all select 'valid unique request index present',
    exists(select 1 from pg_index where indexrelid=to_regclass('public.gather_share_request_unique')
      and indrelid=to_regclass('public."EventInteractionLog"') and indisunique and indisvalid)
)
select check_name,coalesce(passed,false) as passed from checks order by check_name;
