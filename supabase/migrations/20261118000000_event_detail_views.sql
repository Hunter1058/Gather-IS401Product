-- REVIEW ONLY: do not apply to production until metadata and SQL are approved.
-- Existing table only; no score tables/functions or interaction defaults changed.
begin;
set local lock_timeout = '10s';
do $$
declare column_spec record; sequence_name text;
begin
  if not exists(select 1 from pg_class where oid=to_regclass('public."EventInteractionLog"') and relrowsecurity) then
    raise exception 'Expected existing EventInteractionLog with RLS enabled. Inspect its schema first.';
  end if;
  -- Existing permissive policies combine with OR. Stop rather than silently
  -- widening access or replacing policies used by another application.
  if exists(select 1 from pg_policies where schemaname='public' and tablename='EventInteractionLog') then
    raise exception 'Existing interaction policies require review and reconciliation before applying this migration.';
  end if;
  for column_spec in select * from (values
    ('InteractionID','bigint'), ('UserID','uuid'), ('EventID','bigint'),
    ('InteractionType','text'), ('RecipientUserID','uuid'), ('created_at','timestamp with time zone')
  ) as expected(name, kind) loop
    if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='EventInteractionLog' and column_name=column_spec.name and data_type=column_spec.kind) then
      raise exception 'Unexpected EventInteractionLog column: %. Inspect schema before proceeding.', column_spec.name;
    end if;
  end loop;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='RecipientUserID' and is_nullable='YES')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='EventInteractionLog'
    and column_name='created_at' and column_default is not null) then
    raise exception 'Expected nullable recipient and server timestamp default. Review defaults first.';
  end if;
  sequence_name := pg_get_serial_sequence('public."EventInteractionLog"','InteractionID');
  if sequence_name is null or not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='EventInteractionLog' and column_name='InteractionID'
    and (is_identity='YES' or column_default is not null)) then
    raise exception 'Expected sequence-generated InteractionID. Review identity configuration first.';
  end if;
  -- Revoke table AND column insert grants so generated IDs/timestamps cannot be supplied.
  revoke insert on public."EventInteractionLog" from public, anon, authenticated;
  for column_spec in select column_name from information_schema.columns
    where table_schema='public' and table_name='EventInteractionLog' loop
    execute format('revoke insert (%I) on public."EventInteractionLog" from public, anon, authenticated',column_spec.column_name);
  end loop;
  execute format('grant usage on sequence %s to authenticated',sequence_name);
end; $$;

grant insert ("UserID", "EventID", "InteractionType", "RecipientUserID")
  on public."EventInteractionLog" to authenticated;
create policy gather_event_view_insert on public."EventInteractionLog"
  for insert to authenticated with check (
    "UserID" = (select auth.uid()) and "InteractionType" = 'view'
    and "RecipientUserID" is null
    and exists(select 1 from public."Events" e where e."EventID" = "EventInteractionLog"."EventID")
  );
-- No SELECT/UPDATE/DELETE policy or grants added. Insert uses return=minimal.
commit;
