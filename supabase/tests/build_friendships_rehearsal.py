"""Build a rollback rehearsal for the existing Supabase database (stdlib only)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / 'supabase/migrations/20261106000000_friendships.sql').read_text()
tests = (ROOT / 'supabase/tests/friendships.sql').read_text()
header = '''-- GENERATED REHEARSAL ONLY: run the whole file as Supabase project owner.
-- Applies the proposed migration and behavioral/permission checks in ONE
-- transaction, then ROLLBACKs table/function/policy changes. Existing Friends
-- identity values may advance (harmless gaps): sequences are not transactional.
-- Uses two existing real profiles. Does not change User or auth.users rows.
-- Never run the local-only friendships_bootstrap.sql in the shared database.
'''
setup = '''
-- Resolve identities only; never request or expose names, emails or passwords.
do $$
declare v_users uuid[]; v_other uuid;
begin
  if to_regnamespace('gather_test') is not null then
    raise exception 'A gather_test schema already exists; stop and review before rehearsal.';
  end if;
  select array_agg(id order by id) into v_users from (
    select u."UserID" as id from public."User" u
    join auth.users a on a.id = u."UserID" order by u."UserID" limit 2
  ) profiles;
  if coalesce(array_length(v_users, 1), 0) <> 2 then
    raise exception 'Rehearsal needs two existing profiles matching Auth accounts. Create/confirm two test accounts through the app first.';
  end if;
  loop
    v_other := gen_random_uuid();
    exit when not exists (select 1 from public."User" where "UserID" = v_other);
  end loop;
  perform set_config('gather_test.a', v_users[1]::text, true);
  perform set_config('gather_test.b', v_users[2]::text, true);
  perform set_config('gather_test.c', v_other::text, true);
end;
$$;
'''
body = tests[tests.index('create schema gather_test;'):tests.rindex('rollback;')]
# Only the isolated fixture may assert its particular User permissions or delete
# a profile. The live rehearsal preserves the team's existing profile setup.
body = '\n'.join(line for line in body.splitlines() if not any(part in line for part in (
    'Existing own-profile RLS preserved', 'Profile private-column restriction preserved',
    'delete from public."User"', 'Profile deletion intentionally cascades history',
))) + '\n'
for fixture, variable in (
    ('11111111-1111-4111-8111-111111111111', 'a'),
    ('22222222-2222-4222-8222-222222222222', 'b'),
    ('33333333-3333-4333-8333-333333333333', 'c'),
    ('44444444-4444-4444-8444-444444444444', 'c'),
):
    body = body.replace("''" + fixture + "''", "current_setting(''gather_test." + variable + "'')::uuid")
    body = body.replace("'" + fixture + "'", "current_setting('gather_test." + variable + "')::uuid")
# set_config expects text, whereas RPC UUID arguments/comparisons need UUIDs.
for variable in ('a', 'b', 'c'):
    body = body.replace(
        "'request.jwt.claim.sub', current_setting('gather_test." + variable + "')::uuid,",
        "'request.jwt.claim.sub', current_setting('gather_test." + variable + "'),",
    )
result = header + migration[migration.index('begin;'):migration.rindex('commit;')] + setup + body
result += "\nselect 'PASS: friendship rehearsal completed; changes will now roll back.' as result;\nrollback;\n"
(ROOT / 'supabase/tests/friendships_rehearsal.sql').write_text(result)
print('Rebuilt supabase/tests/friendships_rehearsal.sql')
