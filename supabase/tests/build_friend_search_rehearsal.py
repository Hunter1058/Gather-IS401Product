"""Build the read-only data rehearsal; existing directory must be installed."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
migration = (root / 'supabase/migrations/20261111000000_friend_search.sql').read_text()
checks = (root / 'supabase/tests/friend_search_checks.sql').read_text()
header = '''-- GENERATED: run this ENTIRE file in Supabase SQL Editor as project owner.
-- Requires the current UI directory migration to be installed already.
-- Temporarily replaces the directory and creates private matching helpers.
-- Tests real SQL and permissions, then restores functions via ROLLBACK.
-- Does not write any User, Auth, friendship, RSVP or request records.
-- Run BEFORE applying the permanent search migration, not after.
'''
(root / 'supabase/tests/friend_search_rehearsal.sql').write_text(
    header + migration[migration.index('begin;'):migration.rindex('commit;')]
    + '\n' + checks + '\nrollback;\n')
print('Rebuilt friend_search_rehearsal.sql')
