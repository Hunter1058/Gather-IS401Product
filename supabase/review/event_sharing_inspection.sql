-- READ ONLY. Review alongside the Phase 1 interaction inspection SQL.
-- NULL here means the exact required RPC signature is not installed.
select to_regprocedure('public.gather_share_event(bigint,text,uuid,uuid)') as share_rpc,
       to_regprocedure('public.gather_received_event_shares(bigint,integer)') as inbox_rpc;
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='EventInteractionLog'
  and column_name in ('ShareChannel','ShareRequestID');
select c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid='public."EventInteractionLog"'::regclass;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('EventInteractionLog','Friends','Events');
select table_name,column_name,data_type,is_nullable,column_default,is_identity
from information_schema.columns where table_schema='public' and table_name in ('EventInteractionLog','Friends','User','Events')
order by table_name,ordinal_position;
select grantee,table_name,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='EventInteractionLog';
select grantee,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='EventInteractionLog';
select p.oid::regprocedure,p.proowner::regrole,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('gather_lock_friend_pair','remove_friend');
select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public."EventInteractionLog"'::regclass and not tgisinternal;
select relowner::regrole,relrowsecurity,relforcerowsecurity from pg_class where oid='public."EventInteractionLog"'::regclass;
select roleid::regrole,member::regrole from pg_auth_members
where member in (select oid from pg_roles where rolname in ('anon','authenticated'));
select pg_get_serial_sequence('public."EventInteractionLog"','InteractionID') as interaction_sequence;
