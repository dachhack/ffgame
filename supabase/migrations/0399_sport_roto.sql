-- 0399 — ROTO (phase 4, v0.566.0): a sport league scored by season-long
-- category rankings rather than weekly results.
--
-- Rotisserie has no weekly winner: every locked slot-day all season sums
-- into one line per seat, each category ranks the league (best of N takes
-- N, ties split), and the standings are the sum. The worker computes it
-- (core sports/score.ts rotoStandings, the same code a board could run)
-- and writes `sport_roto`; boards read it. The weekly matchups still exist
-- and still score head-to-head — a roto league keeps its schedule for the
-- board's sake, but its table is this one.
--
-- Undo: drop function if exists sport_roto_standings(uuid), sport_league_lines_svc(uuid);
--       drop table if exists sport_roto;

create table if not exists sport_roto (
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  points      numeric not null default 0,           -- the sum of place points
  totals      jsonb not null default '{}'::jsonb,   -- the seat's summed line (derived per game first)
  cats        jsonb not null default '{}'::jsonb,   -- { cat: { value, points } }
  updated_at  timestamptz not null default now(),
  primary key (league_id, roster_id)
);
alter table sport_roto enable row level security;
drop policy if exists sport_roto_read on sport_roto;
create policy sport_roto_read on sport_roto for select using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());
grant select on sport_roto to authenticated;

-- Every locked slot-day with a line, league-wide (the worker only).
create or replace function sport_league_lines_svc(p_league_id uuid)
  returns table (roster_id int, week int, game_date date, player_slug text, line jsonb)
  language sql stable security definer set search_path = public as $$
  select (select lm.sleeper_roster_id from league_membership lm
           where lm.league_id = m.league_id and lm.app_user_id = k.app_user_id
           order by lm.sleeper_roster_id limit 1),
         m.week, k.game_date, k.player_slug, s.line
    from sport_slot_lock k
    join matchup m on m.id = k.matchup_id
    join league l on l.id = m.league_id
    join game_stat_line s on s.sport = l.sport and s.season = l.season and s.game_id = k.game_id and s.player_key = k.player_slug
   where m.league_id = p_league_id and not m.is_playoff
$$;
revoke execute on function sport_league_lines_svc(uuid) from public, anon, authenticated;
grant execute on function sport_league_lines_svc(uuid) to service_role;

create or replace function sport_roto_standings(p_league_id uuid)
  returns table (roster_id int, points numeric, totals jsonb, cats jsonb, updated_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select r.roster_id, r.points, r.totals, r.cats, r.updated_at
    from sport_roto r
   where r.league_id = p_league_id
     and (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
   order by r.points desc, r.roster_id
$$;
grant execute on function sport_roto_standings(uuid) to authenticated;
