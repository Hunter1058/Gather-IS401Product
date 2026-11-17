"""Build isolated SQL fixture and live read-only checks in a rollback transaction."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
migration=(root/'supabase/migrations/20261112000000_friend_recommendations.sql').read_text()
checks=(root/'supabase/tests/friend_recommendations_checks.sql').read_text()
function=migration[migration.index('create function public.get_friend_recommendations('):migration.index('revoke all on function')]
fixture=function.replace('public.get_friend_recommendations(', 'gather_recommendation_test.get_friend_recommendations(')
for table in ['User','Friends','FriendRequest','RSVP','UserInterest']:
    fixture=fixture.replace(f'public."{table}"',f'gather_recommendation_test."{table}"')
fixture=fixture.replace('auth.users','gather_recommendation_test.auth_users')
marker='-- __FIXTURE_FUNCTION__\n'
assert checks.count(marker)==1
checks=checks.replace(marker,fixture)
header='''-- GENERATED: run the ENTIRE file as Supabase postgres owner BEFORE the new migration.
-- Does not modify real User, Auth, friendship, request, interest, or RSVP records.
-- Creates a guarded test schema and new function temporarily; rolls everything back.
'''
guard='''do $$ begin
  if to_regnamespace('gather_recommendation_test') is not null then
    raise exception 'Test schema already exists. Stop for review.';
  end if;
end; $$;
create schema gather_recommendation_test;
'''
(root/'supabase/tests/friend_recommendations_rehearsal.sql').write_text(header+
    migration[migration.index('begin;'):migration.rindex('commit;')]+ '\n'+guard+checks+'\nrollback;\n')
print('Rebuilt friend_recommendations_rehearsal.sql')
