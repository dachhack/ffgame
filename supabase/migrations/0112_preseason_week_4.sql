-- 0112: the 2026 preseason has FOUR ESPN weeks, not three.
--
-- 0056/0100 loaded board weeks 101-103 and everything downstream hardcoded that
-- range — the clone's `array[101,102,103]`, the off-switch's `week in (…)`, the
-- pool seeder's `p_week > 103` guard, and PRESEASON_WEEKS = 3 on the client.
-- But ESPN's 2026 preseason runs:
--
--     week 1 →  1 game   (Hall of Fame, Aug 6)
--     week 2 → 16 games  (Aug 13-16)
--     week 3 → 16 games  (Aug 20-24)
--     week 4 → 16 games  (Aug 27-29)   ← never loaded
--
-- 49 games; weeks 2-4 are 48 = 32 teams × 3 games ÷ 2, i.e. every team's third
-- and final preseason outing lived at a board week nothing knew about. The
-- worker needed no change (it already computes `espnWeek + 100`, so ESPN week 4
-- lands on 104 by itself) — it simply had no slate, no pairings and no pool
-- there.
--
-- Derived board for the new week: 7 windows, 8 slots, 16 games — the same slot
-- count as the regular season, and the closest of the four to its shape.
--
-- The range is no longer written down four times. `preseason_week_count()` is
-- the single SQL source (mirroring PRESEASON_WEEKS in src/data/nflSlate.ts, the
-- same mirror convention base_slot_count() has with TOTAL_SLOTS — bump together).

create or replace function preseason_week_count() returns int language sql immutable as $$ select 4 $$;
grant execute on function preseason_week_count() to authenticated;

-- The preseason BOARD weeks, derived: 101 … 100 + count.
create or replace function preseason_board_weeks() returns int[] language sql stable as $$
  select array(select generate_series(101, 100 + preseason_week_count()));
$$;
grant execute on function preseason_board_weeks() to authenticated;

-- 0054's clone, re-derived off the helper instead of a literal array.
create or replace function _clone_preseason_weeks(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare wk int; made int := 0; ids uuid[];
begin
  foreach wk in array preseason_board_weeks() loop
    select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
    if ids is not null then
      delete from sealed_pick   where matchup_id = any(ids);
      delete from matchup_state where matchup_id = any(ids);
      delete from applied_state where matchup_id = any(ids);
      delete from matchup        where id = any(ids);
    end if;
    delete from sleeper_lineup where league_id = p_league_id and week = wk;

    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
      select league_id, wk, sleeper_matchup_id, home_roster_id, away_roster_id, 'scheduled', null
        from matchup where league_id = p_league_id and week = 1;
    get diagnostics made = row_count;

    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
      select league_id, wk, roster_id, starters_json
        from sleeper_lineup where league_id = p_league_id and week = 1;
  end loop;
  return made;
end $$;

-- 0110's shared on/off body, with the off-branch reading the same helper.
create or replace function _set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; n int := 0; wks int[] := preseason_board_weeks();
begin
  if p_on then
    if not exists (select 1 from matchup where league_id = p_league_id and week = 1) then
      return jsonb_build_object('ok', false, 'error', 'no Week-1 matchups to clone — sync the season first');
    end if;
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    n := _clone_preseason_weeks(p_league_id);
  else
    update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
    delete from sealed_pick   where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
    delete from matchup_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
    delete from applied_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
    delete from matchup        where league_id = p_league_id and week = any(wks);
    delete from sleeper_lineup where league_id = p_league_id and week = any(wks);
  end if;
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', n);
end $$;

-- Both stay internal (0110's reasoning: SECURITY DEFINER + EXECUTE-to-PUBLIC by
-- default). CREATE OR REPLACE preserves the revoked ACL; re-asserted here so a
-- future rewrite that forgets can't quietly re-expose them.
revoke all on function _set_preseason(uuid, boolean) from public;
revoke all on function _clone_preseason_weeks(uuid) from public;

-- 0110's pool seeder, guard widened off the helper.
create or replace function seed_preseason_pool(p_league_id uuid, p_week int, p_pool jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not (p_week = any(preseason_board_weeks())) then
    return jsonb_build_object('ok', false, 'error',
      format('preseason board weeks only (101-%s)', 100 + preseason_week_count()));
  end if;
  if jsonb_typeof(p_pool) is distinct from 'array' or jsonb_array_length(p_pool) = 0 then
    return jsonb_build_object('ok', false, 'error', 'pool must be a non-empty array');
  end if;
  if jsonb_array_length(p_pool) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large');
  end if;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, p_week, m.sleeper_roster_id, p_pool
      from league_membership m where m.league_id = p_league_id
  on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'league has no seats'); end if;
  return jsonb_build_object('ok', true, 'seats', n, 'pool', jsonb_array_length(p_pool));
end $$;
grant execute on function seed_preseason_pool(uuid, int, jsonb) to authenticated;

-- The week-104 slate. Window ids come from the SHARED derivation
-- (windowIdsFromKickoffs via slateFromGames) run over ESPN's scoreboard for
-- seasontype=1 week=4 — the same generation path 0100 used, and the same ids the
-- worker will write on its first tick there. Schema-qualified for the migrate
-- workflow's search_path-less connection (see 0100). Idempotent.
delete from public.nfl_slate where season = '2026' and week = 104;
insert into public.nfl_slate (season, week, home, away, win, kickoff) values
  ('2026', 104, 'BUF', 'PIT', 'tnf',  '2026-08-27T23:00Z'),
  ('2026', 104, 'CLE', 'NE',  'tnf',  '2026-08-28T00:00Z'),
  ('2026', 104, 'LV',  'SF',  'tnf',  '2026-08-28T00:00Z'),
  ('2026', 104, 'LAC', 'LA',  'tnf2', '2026-08-28T02:00Z'),
  ('2026', 104, 'BAL', 'WAS', 'fri',  '2026-08-28T22:00Z'),
  ('2026', 104, 'MIA', 'ATL', 'fri',  '2026-08-28T23:00Z'),
  ('2026', 104, 'CAR', 'HOU', 'fri',  '2026-08-28T23:00Z'),
  ('2026', 104, 'NYJ', 'NYG', 'fri2', '2026-08-28T23:30Z'),
  ('2026', 104, 'JAX', 'TB',  'fri2', '2026-08-28T23:30Z'),
  ('2026', 104, 'DAL', 'NO',  'fri2', '2026-08-29T00:00Z'),
  ('2026', 104, 'GB',  'ARI', 'fri2', '2026-08-29T00:00Z'),
  ('2026', 104, 'KC',  'SEA', 'fri2', '2026-08-29T00:00Z'),
  ('2026', 104, 'PHI', 'CIN', 'fri2', '2026-08-29T00:00Z'),
  ('2026', 104, 'DEN', 'MIN', 'fri3', '2026-08-29T01:00Z'),
  ('2026', 104, 'IND', 'DET', 'sat',  '2026-08-29T17:00Z'),
  ('2026', 104, 'TEN', 'CHI', 'sat2', '2026-08-29T22:00Z')
on conflict (season, week, home) do update set away = excluded.away, win = excluded.win, kickoff = excluded.kickoff;
