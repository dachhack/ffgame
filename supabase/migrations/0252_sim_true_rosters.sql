-- 0252: THE REHEARSAL FIELDS YOUR ACTUAL ROSTER (v0.368.2).
--
-- Founder, mid-rehearsal, with the auction roster open beside the board:
-- "the sim isn't using my actual roster." Both sides were fielding the same
-- all-star lineup (both seats started J. Allen) — the signature of the
-- auto-slotter filling from a stale pool rather than anyone's roster.
--
-- THE MECHANISM: the board and the sim both draw lineups from the week's
-- sleeper_lineup pool rows, and for a native league those are only rewritten
-- from native_roster by native_materialize (0064) — which deliberately skips
-- any week whose matchups are not all 'scheduled', because the resolver may
-- be reading a live week mid-game. Correct in production, and exactly the
-- freeze that bit the sandbox: a week the sim has ever locked or finalized is
-- skipped forever after, so its pool kept whatever it held before the
-- league's draft — and the client auto-slot then WROTE picks from that stale
-- pool, which the next admin_sim_start locked as lineups.
--
-- The fix lives in the pre-flight, where the week is being reset anyway:
--   1. native_materialize_week — the 0064 rewrite scoped to ONE week and
--      WITHOUT the all-scheduled guard. Safe precisely here: the lever is
--      double-gated (admin + 🧪 LIVE TEST), the pre-flight is about to own
--      the week, and admin_sim_reset returns it to 'scheduled'.
--   2. Stale sealed picks are DELETED before the lock: a pick naming a
--      player who is not on that seat's current native roster is a relic of
--      the old pool, and locking it would score a player the manager does
--      not hold. Emptied-spot rows (player_slug null) are kept — an emptied
--      spot is a decision (v0.247.0), not staleness.
-- Sleeper-mirror sandboxes are untouched: their sleeper_lineup rows ARE the
-- roster truth, so both steps are native-only.

-- ── 1 · One week's pool, force-rewritten from the rosters ────────────────────
create or replace function native_materialize_week(p_league_id uuid, p_week int)
  returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_native_league(p_league_id) then return 0; end if;
  delete from sleeper_lineup where league_id = p_league_id and week = p_week;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
  select p_league_id, p_week, t.roster_id,
         jsonb_agg(jsonb_build_object(
           'slot', t.slot, 'slug', t.slug, 'player_slug', t.slug,
           'full', t.full_name, 'pos', t.pos, 'team', t.team
         ) order by t.slot)
  from (
    select nr.roster_id, nr.slug, lp.full_name, lp.pos, lp.team,
           row_number() over (partition by nr.roster_id order by lp.rank) as slot
    from native_roster nr
    join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = p_league_id
  ) t
  group by t.roster_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 2 · admin_sim_start grows the roster refresh ─────────────────────────────
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
    values (p_league_id, wk, coalesce(p_src, wk), greatest(1, least(200, coalesce(p_speed, 20))));
  return jsonb_build_object('ok', true, 'week', wk, 'src', coalesce(p_src, wk), 'matchups', n);
end $$;
grant execute on function admin_sim_start(uuid, int, int, numeric) to authenticated;

-- ── 3 · admin_sim_reset refreshes too ────────────────────────────────────────
-- Strictly, reset's contract is "revert what the sim touched" — but a reset
-- that leaves a stale pool + stale picks standing shows the manager a lineup
-- of players nobody holds until the next ▶ quietly swaps it. The sandbox
-- lever owns the week either way, so the refresh runs on both ends: after a
-- reset the board reads the real rosters immediately.
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
  end if;
  delete from live_play where week = wk and game_id = 'SIM';
  delete from game_feed where week = wk and game_id like 'SIM:%';
  delete from sim_run where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'week', wk, 'matchups', coalesce(array_length(ids, 1), 0));
end $$;
grant execute on function admin_sim_reset(uuid, int) to authenticated;
