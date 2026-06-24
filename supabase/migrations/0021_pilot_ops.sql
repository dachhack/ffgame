-- 0021: pilot operations RPCs — pick readiness, system health, manual pick
-- override/clear. All admin-gated (readiness/override also allow league commish).
-- No new tables; reads existing sealed_pick / sleeper_lineup / live_play / matchup.

-- Per-side readiness snapshot used by admin_pick_readiness (one matchup → two sides).
create or replace function admin_pick_side(p_matchup uuid, p_league uuid, p_roster int, p_week int)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roster_id', p_roster,
    'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1),
    'app_user_id', (select app_user_id from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1),
    'enrolled', coalesce((select enrolled from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1), false),
    'email', (select u.email from league_membership mm join app_user u on u.id = mm.app_user_id where mm.league_id = p_league and mm.sleeper_roster_id = p_roster limit 1),
    'sleeper', (select u.sleeper_username from league_membership mm join app_user u on u.id = mm.app_user_id where mm.league_id = p_league and mm.sleeper_roster_id = p_roster limit 1),
    'lineup_size', coalesce((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = p_league and week = p_week and roster_id = p_roster), 0),
    'picks_set', coalesce((select count(*) from sealed_pick sp where sp.matchup_id = p_matchup and sp.player_slug is not null
        and sp.app_user_id = (select app_user_id from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1)), 0)
  );
$$;

-- Who has / hasn't set a lineup for a league's week — chase the stragglers before lock.
create or replace function admin_pick_readiness(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r order by (r->>'home_roster_id')::int), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'matchup_id', m.id, 'week', m.week, 'status', m.status, 'lock_at', m.lock_at,
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home', admin_pick_side(m.id, m.league_id, m.home_roster_id, m.week),
      'away', admin_pick_side(m.id, m.league_id, m.away_roster_id, m.week)
    ) r
    from matchup m where m.league_id = p_league_id and m.week = p_week
  ) t;
  return result;
end $$;

-- Worker / data health: ingest + resolve freshness, status mix, sim vs real plays.
create or replace function admin_health()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select jsonb_build_object(
    'now', now(),
    'leagues', (select count(*) from league),
    'enrolled', (select count(*) from league_membership where enrolled),
    'matchups_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status::text, count(*) n from matchup group by status) s),
    'live_matchups', (select count(*) from matchup where status = 'live'),
    'live_play_count', (select count(*) from live_play),
    'sim_play_count', (select count(*) from live_play where game_id = 'SIM'),
    'last_play_ingest', (select max(ingested_at) from live_play),
    'last_state_update', (select max(updated_at) from matchup_state)
  ) into result;
  return result;
end $$;

-- Manual override: replace a manager's sealed picks for a matchup (commish rescue).
-- Rows: [{game_window, roster_slot, player_slug, metric_id}]. If the matchup is
-- already locked/live/final, the inserted picks land locked + revealed (so the
-- resolver uses them), mirroring admin_set_matchup.
create or replace function admin_set_picks(p_matchup_id uuid, p_app_user_id uuid, p_rows jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not (is_admin() or is_matchup_commish(p_matchup_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_app_user_id is null then return jsonb_build_object('ok', false, 'error', 'manager not enrolled (no app_user)'); end if;
  select status::text into st from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  delete from sealed_pick where matchup_id = p_matchup_id and app_user_id = p_app_user_id;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked, revealed_at)
  select p_matchup_id, p_app_user_id, e->>'game_window', e->>'roster_slot', e->>'player_slug', e->>'metric_id',
    (st in ('locked', 'live', 'final')), case when st in ('locked', 'live', 'final') then now() else null end
  from jsonb_array_elements(p_rows) e;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_rows));
end $$;

create or replace function admin_clear_picks(p_matchup_id uuid, p_app_user_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_matchup_commish(p_matchup_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from sealed_pick where matchup_id = p_matchup_id and app_user_id = p_app_user_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_pick_side(uuid, uuid, int, int) to authenticated;
grant execute on function admin_pick_readiness(uuid, int) to authenticated;
grant execute on function admin_health() to authenticated;
grant execute on function admin_set_picks(uuid, uuid, jsonb) to authenticated;
grant execute on function admin_clear_picks(uuid, uuid) to authenticated;
