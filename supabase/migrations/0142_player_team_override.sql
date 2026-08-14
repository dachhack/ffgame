-- 0142: PLAYER TEAM OVERRIDES — the live layer over the baked player→team map.
--
-- The client's knowledge of "which NFL team does this player play for" is
-- BAKED (playerBio.ts, regenerated from Sleeper's directory). Rosters churn —
-- trades, cuts, signings, and hardest of all cut-down day — and a bake goes
-- stale the moment it lands. The worker already refreshes its own directory
-- copy daily; this table is where it publishes the DIFF: only players whose
-- current team differs from the bake. Clients load the whole table (small by
-- construction — dozens to a few hundred rows between bakes) into a module
-- cache, and teamFor(slug) answers override-first, bake-second.
--
-- team NULL means "free agent / no team" where the bake still lists one — a
-- real override, distinct from a row's absence (absence = the bake is right).
-- Re-running the bake shrinks this table back toward empty on the worker's
-- next sweep.
--
-- Global data, not league data: any signed-in user reads it; ONLY the worker
-- (service role) writes. No RPCs — a plain table read is the whole client
-- contract, and the worker bypasses RLS by role.

create table if not exists player_team_override (
  slug       text primary key,
  team       text,                                  -- null = free agent
  updated_at timestamptz not null default now()
);
alter table player_team_override enable row level security;
drop policy if exists player_team_override_read on player_team_override;
create policy player_team_override_read on player_team_override
  for select using (auth.uid() is not null);
grant select on player_team_override to authenticated;
