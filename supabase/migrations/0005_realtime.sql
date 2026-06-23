-- 0005: enable Supabase Realtime on the live-board tables.
-- Clients subscribe to matchup_state (live scores) and matchup (status/lock) via
-- postgres_changes; Realtime still enforces RLS, so a user only receives changes
-- to rows they can SELECT (matchup participants). Idempotent.
do $$ begin
  alter publication supabase_realtime add table matchup_state;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table matchup;
exception when duplicate_object then null; end $$;
