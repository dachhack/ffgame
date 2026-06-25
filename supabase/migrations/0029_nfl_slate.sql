-- 0029: live NFL slate (current-season schedule) for slate-gating + the K/DST
-- bye check. The baked src/data/nflSlate.ts is 2025 (demo + baked-2025 force-
-- resolve); for LIVE play the worker derives the real schedule from the ESPN
-- scoreboard (buildSlate → windowFromKickoff) and writes it here so the client
-- can load it too (both call setRuntimeSlate). Public schedule info — readable by
-- anyone; only the service-role worker writes (bypasses RLS).

create table if not exists nfl_slate (
  season     text not null,
  week       int  not null,
  home       text not null,
  away       text not null,
  win        text not null,          -- tnf | early | late | snf | mnf
  kickoff    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (season, week, home)
);

alter table nfl_slate enable row level security;
create policy nfl_slate_read on nfl_slate for select using (true);
grant select on nfl_slate to anon, authenticated;
