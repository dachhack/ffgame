-- 0054: super-admin "preseason" toggle. Lets select leagues create + play real
-- 2026 NFL preseason matchups (on real PBP) before the regular season starts,
-- without disturbing the already-loaded 2026 regular-season schedule.
--
-- Preseason is namespaced as OFFSET board weeks 101/102/103 (= ESPN preseason
-- weeks 1/2/3 + 100) under the same season/league_id, so nothing collides with
-- the regular-season weeks 1-3 (nfl_slate/matchup are keyed by week) and the
-- league keeps its members/wallets/enrollment. The worker writes preseason slate,
-- plays, and scores at these offset weeks when it runs with seasonType=1.
--
-- Flipping the toggle on stamps preseason_at and CLONES the league's Week-1
-- pairings + lineups into weeks 101-103 (Sleeper has no preseason matchups, so we
-- seed them from the real Week-1 schedule). Off clears the stamp and the clones.

alter table league add column if not exists preseason_at timestamptz;

-- Clone a league's Week-1 matchups + starting lineups into the preseason offset
-- weeks (101-103). Idempotent: wipes any prior clone at those weeks first (children
-- of the matchups included). Mirrors server/src/sync.js cloneWeek in SQL so it can
-- run from the admin RPC without a Sleeper fetch.
create or replace function _clone_preseason_weeks(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare wk int; made int := 0; ids uuid[];
begin
  foreach wk in array array[101, 102, 103] loop
    -- Wipe any existing clone at this week (matchup children first).
    select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
    if ids is not null then
      delete from sealed_pick   where matchup_id = any(ids);
      delete from matchup_state where matchup_id = any(ids);
      delete from applied_state where matchup_id = any(ids);
      delete from matchup        where id = any(ids);
    end if;
    delete from sleeper_lineup where league_id = p_league_id and week = wk;

    -- Re-seed from Week 1. status scheduled, lock_at null (the worker backfills it
    -- from the preseason slate's first kickoff).
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
      select league_id, wk, sleeper_matchup_id, home_roster_id, away_roster_id, 'scheduled', null
        from matchup where league_id = p_league_id and week = 1;
    get diagnostics made = row_count;

    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
      select league_id, wk, roster_id, starters_json
        from sleeper_lineup where league_id = p_league_id and week = 1;
  end loop;
  return made; -- matchups seeded per week (weeks share the Week-1 pairing count)
end $$;

-- Super-admin only: flip preseason mode on (stamp + clone) or off (clear + wipe clones).
create or replace function admin_set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; n int := 0;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_on then
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    n := _clone_preseason_weeks(p_league_id);
  else
    update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
    -- Drop the preseason clones (children first) so the league is clean.
    delete from sealed_pick   where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from matchup_state where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from applied_state where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from matchup        where league_id = p_league_id and week in (101,102,103);
    delete from sleeper_lineup where league_id = p_league_id and week in (101,102,103);
  end if;
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', n);
end $$;
grant execute on function admin_set_preseason(uuid, boolean) to authenticated;

-- Surface preseason_at on the super-admin overview so the toggle reflects state.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'preseason_at', l.preseason_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_overview() to authenticated;
