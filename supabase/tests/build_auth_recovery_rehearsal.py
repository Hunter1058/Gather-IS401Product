"""Build an owner-run transaction that tests synthetic accounts and then rolls back."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
migration = (root / 'supabase/migrations/20261114000000_auth_recovery_signup.sql').read_text()
checks = (root / 'supabase/tests/auth_recovery_checks.sql').read_text()
trigger = migration[migration.index('create or replace function public.handle_new_user()'):migration.index('revoke all on function public.handle_new_user()')]
rpc = migration[migration.index('create function public.gather_recovery_ticket('):migration.index('revoke all on function public.gather_recovery_ticket(')]
for name in ['User', 'UserInterest', 'GatherRecoveryTicket']:
    trigger = trigger.replace(f'public."{name}"', f'gather_auth_test."{name}"')
    rpc = rpc.replace(f'public."{name}"', f'gather_auth_test."{name}"')
trigger = trigger.replace('public.handle_new_user()', 'gather_auth_test.handle_new_user()')
rpc = rpc.replace('public.gather_recovery_ticket(', 'gather_auth_test.gather_recovery_ticket(')
assert checks.count('-- __CLONED_FUNCTIONS__') == 1
checks = checks.replace('-- __CLONED_FUNCTIONS__', trigger + '\n' + rpc)
header = '''-- GENERATED: run this ENTIRE file as the Supabase SQL Editor postgres owner.
-- Run BEFORE applying the auth recovery migration. All changes roll back.
-- No real account, profile, password, interest or existing policy is written.
-- The migration's functions/table are temporarily installed in this transaction;
-- behavior checks use isolated synthetic fixtures and copies of those functions.
'''
body = migration[migration.index('begin;'):migration.rindex('commit;')]
(root / 'supabase/tests/auth_recovery_rehearsal.sql').write_text(header + body + '\n' + checks + '\nrollback;\n')
print('Rebuilt auth_recovery_rehearsal.sql')
