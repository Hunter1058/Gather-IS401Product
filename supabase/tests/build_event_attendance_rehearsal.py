"""Build a rollback-only migration/behavior rehearsal using synthetic accounts."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
migration = (root / 'supabase/migrations/20261117000000_event_friend_attendance.sql').read_text()
checks = (root / 'supabase/tests/event_attendance_checks.sql').read_text()
start = migration.index('create function public.gather_event_friend_attendance(')
end = migration.index('revoke all on function public.gather_event_friend_attendance(')
summary = migration[start:end]
start = migration.index('create or replace function public.gather_friends_going()')
end = migration.index('revoke all on function public.gather_friends_going()')
legacy = migration[start:end]
functions = summary + '\n' + legacy
for table in ['User', 'Friends', 'RSVP', 'Events']:
    functions = functions.replace(f'public."{table}"', f'gather_attendance_test."{table}"')
functions = functions.replace('auth.users', 'gather_attendance_test.auth_users')
functions = functions.replace('public.gather_event_friend_attendance(', 'gather_attendance_test.gather_event_friend_attendance(')
functions = functions.replace('public.gather_friends_going()', 'gather_attendance_test.gather_friends_going()')
assert checks.count('-- __CLONED_FUNCTIONS__') == 1
checks = checks.replace('-- __CLONED_FUNCTIONS__', functions)
header = '''-- GENERATED. Run this ENTIRE file as postgres in Supabase SQL Editor.
-- Run BEFORE the permanent event friend attendance migration. Ends in ROLLBACK.
-- Real functions are temporarily installed; all row writes use synthetic fixtures.
-- No real user, friendship, RSVP, event, profile, table policy or table grant is edited.
'''
body = migration[migration.index('begin;'):migration.rindex('commit;')]
(root / 'supabase/tests/event_attendance_rehearsal.sql').write_text(header + body + '\n' + checks + '\nrollback;\n')
print('Rebuilt event_attendance_rehearsal.sql')
