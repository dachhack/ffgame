-- 0293: THE DEPTH CHART — who actually starts this week (v0.416.0).
--
-- Founder, correcting a projected lineup that had Sam Darnold starting:
-- "Lock is the QB2 but Darnold is hurt and out this week."
--
-- v0.415.0 took the injured man OFF the sheet, which was right and not
-- enough: with Darnold out the next name shown was Jalen Milroe, because the
-- sheet ranks by PROJECTION and Drew Lock has none. The projection set knows
-- players it can value; a backup quarterback it has never valued is invisible
-- to it however the list is sorted. Injury-awareness fixes who comes off.
-- Only a depth chart fixes who comes on.
--
-- WHY SLEEPER. Three sources were checked. ESPN's core API serves a real 2026
-- ranked depth chart and is the SEASON one — it still has Darnold at QB1, so
-- it answers about role, not about Sunday. StatHead's get_depth_charts has
-- exactly the right shape and its worker exceeds its resource limit on 2025
-- and 2026 (2024 answers fine), so it cannot be relied on today. Sleeper's
-- directory carries depth_chart_order, is re-ordered for availability week to
-- week — it already has Lock at 1 and Darnold at 2 — and the worker pulls that
-- directory daily ALREADY. sync.js has been reading the field since the
-- preseason pool builder; it simply never stored it.
--
-- Its known weakness is coverage: about 71% of active skill players carry an
-- order. That is why this is a PREFERENCE and not a replacement — a player
-- with no rank keeps his projection ordering, so the sheet degrades to
-- exactly what v0.415.0 did rather than to nothing.
--
-- Shaped like player_team_override (0142), deliberately: global data, worker
-- writes, any signed-in user reads, no RPC. The difference is that this table
-- is the WHOLE map rather than a drift — there is no baked depth chart to diff
-- against, and at a few hundred rows it does not need to be one.

create table if not exists player_depth (
  slug       text primary key,
  team       text,                 -- the NFL team the rank is ON
  pos        text,                 -- QB/RB/WR/TE/K — the chart's own position
  depth      int not null,         -- 1 = starter, as Sleeper numbers it
  updated_at timestamptz not null default now()
);
create index if not exists player_depth_team on player_depth(team, pos, depth);
alter table player_depth enable row level security;
drop policy if exists player_depth_read on player_depth;
create policy player_depth_read on player_depth
  for select using (auth.uid() is not null);
grant select on player_depth to authenticated;
