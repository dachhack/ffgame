-- 0270: LUDICROUS SPEED — the rehearsal defaults to a ~20-second week.
--
-- Founder: "I want the feed to take like 20 sec. How fast would that be?"
-- The feed spans one full broadcast (~11,500 game-seconds; every game plays
-- simultaneously against its own kickoff), so ~20s of wall clock is ~600×.
-- Two walls stood in the way: the client wrapper silently sent p_speed 20
-- (fixed in core this same version), and this function CAPPED speed at 200
-- (~1 minute). Default 100 → 600, cap 200 → 2000.
--
-- Worth knowing, not fixing: the worker sweeps sims every 25s
-- (playsPollMs), so at 600× a week completes within one or two ticks — the
-- board goes scheduled → FINAL in a jump or two rather than animating. That
-- is exactly what a testing loop wants; a spectacle run can still pass a
-- lower explicit speed (the CLI and playLive's 300× are untouched).
--
-- BODY COPIED FROM 0266, THE LIVE DEFINITION — the two speed literals and
-- this header are the only changes.
create or replace function admin_sim_start(p_league_id uuid, p_week int default null,
                                           p_src int default null, p_speed numeric default 600)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tl timestamptz; wk int; n int; ids uuid[];
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select test_live_at into tl from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no league'); end if;
  if tl is null then
    return jsonb_build_object('ok', false, 'error', 'sandbox only — flip LIVE TEST on this league first');
  end if;

  wk := p_week;
  if wk is null then
    select min(week) into wk from matchup
      where league_id = p_league_id
        and (status <> 'final' or home_final is null or away_final is null);
    if wk is null then return jsonb_build_object('ok', false, 'error', 'nothing left to sim — every scheduled week is final'); end if;
  end if;

  select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
  if ids is null then return jsonb_build_object('ok', false, 'error', 'no matchups in week ' || wk); end if;
  if exists (select 1 from matchup where league_id = p_league_id and week = wk and home_final is not null) then
    return jsonb_build_object('ok', false, 'error', 'week ' || wk || ' already has finals — reset it first, or pick another week');
  end if;
  if exists (select 1 from sim_run where league_id = p_league_id and status = 'running') then
    return jsonb_build_object('ok', false, 'error', 'a sim is already running in this league — reset it first');
  end if;
  -- One sim per WEEK across all leagues: the SIM feed rows are week-scoped.
  if exists (select 1 from sim_run where week = wk and status = 'running') then
    return jsonb_build_object('ok', false, 'error', 'another league is simming week ' || wk || ' right now');
  end if;

  -- THE ROSTER REFRESH (0252). native_materialize skips any week that has
  -- ever gone non-scheduled, so a re-simmed week's pool froze at whatever
  -- predated the first run — and picks written off that stale pool would be
  -- locked below as lineups. Rewrite the week's pool from the CURRENT
  -- rosters, then drop the picks naming players their seat no longer holds
  -- (emptied spots — player_slug null — are decisions, and stay).
  if is_native_league(p_league_id) then
    perform native_materialize_week(p_league_id, wk);
    delete from sealed_pick sp
    using matchup m, league_membership lm
    where sp.matchup_id = m.id and m.id = any(ids)
      and lm.league_id = p_league_id and lm.app_user_id = sp.app_user_id
      and sp.player_slug is not null
      and not exists (select 1 from native_roster nr
                      where nr.league_id = p_league_id
                        and nr.roster_id = lm.sleeper_roster_id
                        and nr.slug = sp.player_slug);
  end if;

  -- The CLI's pre-flight, verbatim: fresh SIM feed, board state cleared,
  -- picks locked (revealed), the week live.
  delete from live_play where week = wk and game_id = 'SIM';
  delete from game_feed where week = wk and game_id like 'SIM:%';
  delete from matchup_state where matchup_id = any(ids);
  update sealed_pick set locked = true, revealed_at = now() where matchup_id = any(ids) and not locked;
  update matchup set status = 'live' where id = any(ids);
  get diagnostics n = row_count;

  delete from sim_run where league_id = p_league_id; -- a finished ('done') row makes way
  insert into sim_run (league_id, week, src_week, speed)
    values (p_league_id, wk, coalesce(p_src, wk), greatest(1, least(2000, coalesce(p_speed, 600))));
  return jsonb_build_object('ok', true, 'week', wk, 'src', coalesce(p_src, wk), 'matchups', n);
end $$;
grant execute on function admin_sim_start(uuid, int, int, numeric) to authenticated;
