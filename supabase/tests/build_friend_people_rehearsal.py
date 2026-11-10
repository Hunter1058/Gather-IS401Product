"""Generate the rollback directory rehearsal; Python standard library only."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
migration = (root / 'supabase/migrations/20261109000000_friend_people.sql').read_text()
checks = (root / 'supabase/tests/friend_people_checks.sql').read_text()
header = '''-- GENERATED REHEARSAL: run this ENTIRE file as Supabase owner.
-- Foundation migration must already be applied. Do NOT rerun that migration.
-- Temporarily creates the directory function and exercises two existing real
-- profiles, then rolls back function/grant/relationship changes. Never changes
-- User or auth.users rows. Existing identity sequences may advance (ID gaps).
'''
result = header + migration[migration.index('begin;'):migration.rindex('commit;')] + '\n' + checks + '\nrollback;\n'
(root / 'supabase/tests/friend_people_rehearsal.sql').write_text(result)
print('Rebuilt friend_people_rehearsal.sql')
