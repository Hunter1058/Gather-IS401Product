-- The existing owner-only User SELECT policy limits these fields to their owner.
grant select ("Username", "UserProfilePhoto") on public."User" to authenticated;
