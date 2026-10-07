-- Run once in the Supabase SQL editor, then seed.sql.
-- Event publishing is intentionally admin-only: the app has no event-creation UI.
create table if not exists public.events (
  id text primary key check (id ~ '^[a-z0-9-]{1,80}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);
create index if not exists events_starts_at_idx on public.events(starts_at);
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.events enable row level security;
alter table public.user_state enable row level security;
revoke all on public.events from anon, authenticated;
revoke all on public.user_state from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select, insert, update, delete on public.user_state to authenticated;
drop policy if exists "Anyone can browse events" on public.events;
create policy "Anyone can browse events" on public.events for select to anon, authenticated using (true);
drop policy if exists "Read own plans" on public.user_state;
create policy "Read own plans" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Insert own plans" on public.user_state;
create policy "Insert own plans" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own plans" on public.user_state;
create policy "Update own plans" on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own plans" on public.user_state;
create policy "Delete own plans" on public.user_state for delete to authenticated using ((select auth.uid()) = user_id);
