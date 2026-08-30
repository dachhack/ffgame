-- 0266: THE REHEARSAL READS AS A PERCENT, AND RUNS AT 100× (v0.376.4).
--
-- Founder: "for the rehearsal, let's have the feed show at % rather than
-- time. We can go 100x rather than 20x." The strip said "feed at 203:32 ·
-- 20×" — honest, but a feed-clock minute count means nothing unless you know
-- how long the feed is. Only the WORKER knows that (simsweep builds the feed
-- and holds its `maxAt`), so:
--
--   • sim_run grows `feed_len` — the feed's final `at`, stamped by the sweep
--     on every cursor write (a run started before the worker redeploys shows
--     the clock fallback until the next tick stamps it; nothing breaks).
--   • sim_run_state computes `pct` server-side, same place the clock is
--     computed, capped at 100 (the wall clock can run past the last play).
--     Null feed_len ⇒ null pct ⇒ the strip falls back to the old clock.
--   • admin_sim_start's default speed becomes 100× — a full week in ~2 min
--     of wall clock. THE BODY IS COPIED FROM 0252, THE LIVE DEFINITION, with
--     only the two 20s changed; the explicit-speed path (the CLI, playLive's
--     300×) is untouched, and the 1–200 cap already admits 100.

alter table sim_run add column if not exists feed_len numeric;

comment on column sim_run.feed_len is
  'The feed''s final release time (game-feed seconds) — stamped by the worker''s sweep, which is the only thing that knows it. Null until the first sweep tick of a run. Lets sim_run_state answer in percent.';

-- sim_run_state v2 (0251 + feed_len/pct).
create or replace function sim_run_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r sim_run%rowtype; clk numeric;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into r from sim_run where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', true, 'run', null); end if;
  clk := case when r.status = 'running'
    then round((extract(epoch from (now() - r.started_at)) * r.speed)::numeric)
    else r.cursor_at end;
  return jsonb_build_object('ok', true, 'run', jsonb_build_object(
    'week', r.week, 'src', r.src_week, 'speed', r.speed, 'status', r.status,
    'started_at', r.started_at, 'cursor_at', r.cursor_at,
    'clock', clk,
    'feed_len', r.feed_len,
    'pct', case when r.feed_len is not null and r.feed_len > 0
      then least(100, round(clk / r.feed_len * 100)) end));
end $$;
grant execute on function sim_run_state(uuid) to authenticated;

-- admin_sim_start v3 (0252's body verbatim; default speed 20 → 100).
create or replace function admin_sim_start(p_league_id uuid, p_week int default null,
                                           p_src int default null, p_speed numeric default 100)
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
    values (p_league_id, wk, coalesce(p_src, wk), greatest(1, least(200, coalesce(p_speed, 100))));
  return jsonb_build_object('ok', true, 'week', wk, 'src', coalesce(p_src, wk), 'matchups', n);
end $$;
grant execute on function admin_sim_start(uuid, int, int, numeric) to authenticated;
