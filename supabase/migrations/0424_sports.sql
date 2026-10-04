-- 0424 — THE SPORT SPINE (v0.616.0): a league has a sport, and non-NFL games
-- are stored as per-player STAT LINES rather than plays.
--
-- Founder: "What would it take for us to do hockey, NBA, MLB, WNBA fantasy …
-- let's assume native leagues for all of these and no drip format."
--
-- Additive only. Every existing league reads 'nfl' and nothing that scores
-- the NFL touches the two new tables. See docs/multi-sport-plan.md.
--
-- Undo:
--   drop table if exists game_stat_line; drop table if exists sport_game;
--   alter table league drop column if exists sport;

-- ── league.sport ──────────────────────────────────────────────────────────────
-- The five the platform defines (packages/core/src/sports/). The check list
-- is the same as core's SPORT_IDS; scripts/check-sports.mjs pins the two.
alter table league add column if not exists sport text not null default 'nfl'
  check (sport in ('nfl', 'nba', 'wnba', 'nhl', 'mlb'));
create index if not exists league_sport on league(sport) where sport <> 'nfl';

comment on column league.sport is 'nfl | nba | wnba | nhl | mlb — which SportDef shapes the league (0424). NFL leagues score through live_play; the others through game_stat_line.';

-- ── sport_game: one row per real game, per sport and season ──────────────────
-- The slate for the daily sports. `season` is the starting year as text
-- ('2026' for NBA/NHL 2026-27), matching league.season. `game_id` is the
-- feed's own id (NHL 2026020002, MLB gamePk, NBA/WNBA 0022400012).
create table if not exists sport_game (
  sport       text not null check (sport in ('nba', 'wnba', 'nhl', 'mlb')),
  season      text not null,
  game_id     text not null,
  game_date   date not null,                 -- the league's local game date
  start_utc   timestamptz,
  status      text not null default 'pre' check (status in ('pre', 'live', 'final', 'postponed', 'cancelled')),
  away        text not null,                 -- feed tricode
  home        text not null,
  away_score  int,
  home_score  int,
  clock       text,                          -- "P3 19:59", "Middle 6", "Q4 02:11" — display only
  game_type   text,                          -- regular | preseason | playoffs | playin | allstar
  updated_at  timestamptz not null default now(),
  primary key (sport, season, game_id)
);
create index if not exists sport_game_date on sport_game(sport, game_date);
create index if not exists sport_game_live on sport_game(sport, status) where status = 'live';

-- ── game_stat_line: one player's cumulative line for one game ────────────────
-- `player_key` is `<sport>-<feed id>` (core sports/index.ts playerKey), the
-- same numeric-id rule college uses, so it never collides with an NFL slug.
-- `line` holds the sport's short stat ids (core sports/<sport>.ts) — raw
-- stats only; derived ones (PPP, QS, IP) are computed on read. Idempotent:
-- the worker upserts the whole line on every poll and the final wins.
create table if not exists game_stat_line (
  sport       text not null,
  season      text not null,
  game_id     text not null,
  player_key  text not null,
  ext_id      text not null,                 -- the feed's player id, bare
  full_name   text not null,
  team        text not null,                 -- feed tricode, this game
  pos         text,                          -- the feed's position code, this game
  played      boolean not null default false,
  line        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (sport, season, game_id, player_key),
  foreign key (sport, season, game_id) references sport_game(sport, season, game_id) on delete cascade
);
create index if not exists game_stat_line_player on game_stat_line(sport, season, player_key);
create index if not exists game_stat_line_game on game_stat_line(sport, season, game_id);

-- Public sports data, same posture as live_play / game_feed: any signed-in
-- user reads; only the service-role worker writes (no insert/update policy,
-- and the service role bypasses RLS).
alter table sport_game enable row level security;
alter table game_stat_line enable row level security;
drop policy if exists sport_game_read on sport_game;
create policy sport_game_read on sport_game for select using (auth.role() = 'authenticated');
drop policy if exists game_stat_line_read on game_stat_line;
create policy game_stat_line_read on game_stat_line for select using (auth.role() = 'authenticated');
grant select on sport_game, game_stat_line to authenticated;

-- ── a period's lines, for a set of players ───────────────────────────────────
-- What a board or a resolver asks: every line these players posted in games
-- dated inside [p_from, p_to], newest first. Derivation and scoring happen in
-- core (sports/score.ts) so the number is the same on every host.
create or replace function sport_lines_for(p_sport text, p_season text, p_keys text[], p_from date, p_to date)
returns table (player_key text, game_id text, game_date date, status text, team text, pos text, played boolean, line jsonb)
language sql stable security definer set search_path = public as $$
  select l.player_key, l.game_id, g.game_date, g.status, l.team, l.pos, l.played, l.line
  from game_stat_line l
  join sport_game g on g.sport = l.sport and g.season = l.season and g.game_id = l.game_id
  where l.sport = p_sport and l.season = p_season
    and l.player_key = any (p_keys)
    and g.game_date between p_from and p_to
  order by g.game_date desc, l.player_key
$$;
grant execute on function sport_lines_for(text, text, text[], date, date) to authenticated;
