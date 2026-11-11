"""Temporary RPC, isolated fixtures, real reads, then rollback; no real data writes."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
migration=(root/'supabase/migrations/20261113000000_friend_connections.sql').read_text()
checks=(root/'supabase/tests/friend_connections_checks.sql').read_text()
function=migration[migration.index('create function public.get_friend_connections('):migration.index('revoke all on function')]
fixture=function.replace('public.get_friend_connections(', 'gather_connections_test.get_friend_connections(')
for table in ['User','Friends','RSVP','UserInterest','Events','EventCategory']:
    fixture=fixture.replace(f'public."{table}"',f'gather_connections_test."{table}"')
fixture=fixture.replace('auth.users','gather_connections_test.auth_users')
assert checks.count('-- __FIXTURE_FUNCTION__')==1
checks=checks.replace('-- __FIXTURE_FUNCTION__',fixture)
guard='''do $$ begin
 if to_regnamespace('gather_connections_test') is not null then raise exception 'Test schema already exists. Stop for review.'; end if;
end; $$;
create schema gather_connections_test;
'''
header='''-- GENERATED: run the ENTIRE file as Supabase postgres owner BEFORE the new migration.
-- Only synthetic tables are written; real account/relationship/event/interest data is not modified.
'''
(root/'supabase/tests/friend_connections_rehearsal.sql').write_text(header+
 migration[migration.index('begin;'):migration.rindex('commit;')]+'\n'+guard+checks+'\nrollback;\n')
print('Rebuilt friend_connections_rehearsal.sql')
