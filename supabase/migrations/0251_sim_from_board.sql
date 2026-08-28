-- 0251 — ▶ SIM FROM THE BOARD: the dress rehearsal, playable in place.
--
-- Founder: "Can we make this all playable from the matchup board in the test
-- league?" The feed simulator (server/src/simulate.js) proves the whole live
-- path — baked plays → live_play → resolver → matchup_state → board — but it
-- was drivable only from a CLI or the GitHub workflow. This gives the board a
-- steering wheel: an admin taps ▶ on the test league's matchup board, and the
-- WORKER runs the same rehearsal on its own tick (0251's sweep in
-- server/src/simsweep.js reads sim_run and drips the feed).
--
-- The control plane is one row per league. START does the same pre-flight the
-- CLI did (lock picks, matchups → live, clear prior SIM rows) and arms the
-- row; the worker's sweep advances the feed clock and resolves; when the feed
-- is exhausted the sweep finalizes through the same resolver path (finals +
-- coin) and marks the run done. RESET is the CLI's reset, verbatim: SIM rows
-- only, never real ESPN data.
--
-- SAME DOUBLE GATE AS THE STAMP LEVER (0250): is_admin() AND test_live_at —
-- a rehearsal must never start on a real league. And one week can host ONE
-- sim at a time across all leagues: live_play SIM rows are keyed by week, not
-- league, so two leagues simming the same week would share (and reset would
-- destroy) each other's feed.

create table if not exists sim_run (
  league_id   uuid primary key references league(id) on delete cascade,
  week        int not null,
  src_week    int not null,
  -- game-feed seconds advanced per real second (the CLI's speed÷tick). 20 ≈ a
  -- full week in ~10 minutes of wall clock.
  speed       numeric not null default 20,
  started_at  timestamptz not null default now(),
  -- the feed position (seconds since each game's kickoff) already released —
  -- the worker's cursor, so a restarted worker never re-plays the past.
  cursor_at   numeric not null default 0,
  status      text not null default 'running' check (status in ('running', 'done')),
  created_at  timestamptz not null default now()
);
-- No client grants: the RPCs below are the only doors; the worker's service
-- role reads/updates it directly.

create or replace function admin_sim_start(p_league_id uuid, p_week int default null,
                                           p_src int default null, p_speed numeric default 20)
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
    values (p_league_id, wk, coalesce(p_src, wk), greatest(1, least(200, coalesce(p_speed, 20))));
  return jsonb_build_object('ok', true, 'week', wk, 'src', coalesce(p_src, wk), 'matchups', n);
end $$;
grant execute on function admin_sim_start(uuid, int, int, numeric) to authenticated;

-- The CLI's --reset, verbatim, plus the control row: matchups → scheduled,
-- picks unlocked, SIM feed + matchup_state cleared. Only the sim's own rows.
create or replace function admin_sim_reset(p_league_id uuid, p_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tl timestamptz; wk int; ids uuid[];
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select test_live_at into tl from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no league'); end if;
  if tl is null then
    return jsonb_build_object('ok', false, 'error', 'sandbox only — flip LIVE TEST on this league first');
  end if;
  wk := coalesce(p_week, (select week from sim_run where league_id = p_league_id));
  if wk is null then return jsonb_build_object('ok', false, 'error', 'no sim run to reset — name the week'); end if;
  select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
  if ids is not null then
    delete from matchup_state where matchup_id = any(ids);
    update sealed_pick set locked = false, revealed_at = null where matchup_id = any(ids);
    update matchup set status = 'scheduled', home_final = null, away_final = null,
                       home_coin = null, away_coin = null where id = any(ids);
  end if;
  delete from live_play where week = wk and game_id = 'SIM';
  delete from game_feed where week = wk and game_id like 'SIM:%';
  delete from sim_run where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'week', wk, 'matchups', coalesce(array_length(ids, 1), 0));
end $$;
grant execute on function admin_sim_reset(uuid, int) to authenticated;

-- The board's status line: the run row plus a computed feed position, so the
-- strip can say "SIM · 38:20 · running" without the client doing clock math
-- against a server timestamp it may disagree with.
create or replace function sim_run_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r sim_run%rowtype;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into r from sim_run where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', true, 'run', null); end if;
  return jsonb_build_object('ok', true, 'run', jsonb_build_object(
    'week', r.week, 'src', r.src_week, 'speed', r.speed, 'status', r.status,
    'started_at', r.started_at, 'cursor_at', r.cursor_at,
    'clock', case when r.status = 'running'
      then round((extract(epoch from (now() - r.started_at)) * r.speed)::numeric)
      else r.cursor_at end));
end $$;
grant execute on function sim_run_state(uuid) to authenticated;
