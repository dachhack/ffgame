-- 0113: practice weeks get DISTINCT pairings, and already-played weeks are
-- skipped.
--
-- Two things 0054's clone got wrong for a multi-week playtest:
--
--   1. It copied WEEK 1 into every preseason board week, so a playtester faced
--      the same opponent three (now four) times running. Fine for the one-night
--      live-fire it was built for; poor for a month of practice. Board week
--      100+i now clones regular-season week i — real, varied pairings that are
--      already in the DB from the season sync — falling back to Week 1 for any
--      week the league hasn't scheduled (a short season, or a sync that only
--      reached week 1).
--
--   2. It cloned every preseason week regardless of the calendar. Turning
--      practice on today seeds week 101 — the Hall of Fame game, played back on
--      Aug 6 — as a live-looking matchup that will never receive another snap.
--      Weeks whose last kickoff is more than ~4h past are now skipped, the same
--      "this week isn't over yet" allowance defaultOpenWeek and join_weekly use.
--
-- The clone now reports WHICH weeks it seeded, so the client seeds deep pools for
-- exactly those (rather than trying all four and reporting failures for weeks it
-- deliberately skipped).

-- Return type changes from int, so this one needs the drop.
drop function if exists _clone_preseason_weeks(uuid);
create function _clone_preseason_weeks(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wk int; src int; made int := 0; total int := 0;
  ids uuid[]; seeded int[] := '{}'; skipped int[] := '{}';
  seas text; last_kick timestamptz;
begin
  select season into seas from league where id = p_league_id;
  foreach wk in array preseason_board_weeks() loop
    -- Skip a week that's already over — nothing will ever feed it.
    select max(kickoff) into last_kick from nfl_slate where season = seas and week = wk;
    if last_kick is not null and last_kick + interval '4 hours' < now() then
      skipped := skipped || wk;
      continue;
    end if;

    -- Wipe any existing clone at this week (matchup children first).
    select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
    if ids is not null then
      delete from sealed_pick   where matchup_id = any(ids);
      delete from matchup_state where matchup_id = any(ids);
      delete from applied_state where matchup_id = any(ids);
      delete from matchup        where id = any(ids);
    end if;
    delete from sleeper_lineup where league_id = p_league_id and week = wk;

    -- Board week 100+i mirrors regular-season week i, so each practice week is a
    -- different opponent. Fall back to Week 1 when that week isn't scheduled.
    src := wk - 100;
    if not exists (select 1 from matchup where league_id = p_league_id and week = src) then
      src := 1;
    end if;

    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
      select league_id, wk, sleeper_matchup_id, home_roster_id, away_roster_id, 'scheduled', null
        from matchup where league_id = p_league_id and week = src;
    get diagnostics made = row_count;
    total := total + made;

    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
      select league_id, wk, roster_id, starters_json
        from sleeper_lineup where league_id = p_league_id and week = src;

    seeded := seeded || wk;
  end loop;
  return jsonb_build_object('weeks', to_jsonb(seeded), 'skipped', to_jsonb(skipped),
                            'matchups', total, 'per_week', made);
end $$;

-- 0110/0112's shared on/off body, carrying the clone's week list out to callers.
create or replace function _set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; r jsonb; wks int[] := preseason_board_weeks();
begin
  if p_on then
    if not exists (select 1 from matchup where league_id = p_league_id and week = 1) then
      return jsonb_build_object('ok', false, 'error', 'no Week-1 matchups to clone — sync the season first');
    end if;
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    r := _clone_preseason_weeks(p_league_id);
    if jsonb_array_length(r -> 'weeks') = 0 then
      -- Every preseason week is in the past: turning practice on would hand back
      -- nothing playable, so don't leave the league stamped as if it had.
      update league set preseason_at = null where id = p_league_id;
      return jsonb_build_object('ok', false, 'error', 'every preseason week has already been played');
    end if;
    return jsonb_build_object('ok', true, 'preseason_at', ts,
      'matchups', r -> 'per_week', 'weeks', r -> 'weeks', 'skipped', r -> 'skipped');
  end if;
  update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
  delete from sealed_pick   where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from applied_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup        where league_id = p_league_id and week = any(wks);
  delete from sleeper_lineup where league_id = p_league_id and week = any(wks);
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', 0, 'weeks', '[]'::jsonb);
end $$;

-- Internal only (0110's reasoning: SECURITY DEFINER + EXECUTE-to-PUBLIC by
-- default). The DROP above cleared the old ACL, so this re-revoke is load-bearing.
revoke all on function _set_preseason(uuid, boolean) from public;
revoke all on function _clone_preseason_weeks(uuid) from public;
