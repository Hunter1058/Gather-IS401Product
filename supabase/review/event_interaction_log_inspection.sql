-- Read-only metadata for review BEFORE considering the Phase 1 migration.
select column_name, data_type, is_nullable, column_default, is_identity, identity_generation
from information_schema.columns
where table_schema='public' and table_name='EventInteractionLog'
order by ordinal_position;
select relrowsecurity, relforcerowsecurity
from pg_class where oid=to_regclass('public."EventInteractionLog"');
select * from pg_policies where schemaname='public' and tablename='EventInteractionLog';
select grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='EventInteractionLog';
select grantee, column_name, privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='EventInteractionLog';
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid=to_regclass('public."EventInteractionLog"');
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid=to_regclass('public."EventInteractionLog"') and not tgisinternal;
select pg_get_serial_sequence('public."EventInteractionLog"','InteractionID') as interaction_sequence;
