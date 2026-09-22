-- ═══════════════════════════════════════════════════════════════════════════
-- 0343 · THE BOARD TURNS WITH THE RUN
--
-- Founder, asked whether "Weds AM" meant midnight or the waiver run: "We want
-- it synced with the waiver run so that when you see the week matchup, you see
-- the impacts of new rosters from the waiver run."
--
-- 0342 turned the board at Wednesday 00:00 ET, which was the right DAY for the
-- wrong reason and three hours early. The run that reshapes every roster for
-- the week ahead is AFTER-GAMES WAIVERS CLEAR (0337): a player dropped once
-- the week's games have started stays on waivers until that morning's run, and
-- the claims on him are decided AT the league's clear time. Turning the board
-- over at midnight showed you next week's matchup against last week's rosters
-- — the one thing that page must not do.
--
-- So the boundary stops being a constant and becomes THIS LEAGUE'S RUN: the
-- day its after-games hold clears on, at the time its claims are decided. A
-- league that moved its run to Tuesday 5am turns over Tuesday 5am, and its
-- board, its wire and its rulebook all agree about what week it is.
--
-- NOT A NEW RULE, A READ OF ONE THAT EXISTS. Both halves are already settled
-- and already have their own migrations behind them:
--   · WHICH DAY — `waiver_game_hold_dow_effective` (0338), which is the chosen
--     day rolled forward to one the schedule's run actually visits, so the
--     board cannot turn over on a morning that clears nobody;
--   · WHAT TIME — `league_waiver_clear_min` (0337), the daily run's own clock.
--
-- A ROLLING LEAGUE HAS NO RUN. Every dropped player clears on his own 24-hour
-- timer, so there is no moment when the week's rosters settle. It gets the
-- default pair — Wednesday, 3:00am ET — because the board still has to turn
-- over somewhere and that is the hour the rest of the game uses. Same for a
-- schedule whose run visits no day at all.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 0. A NULL THAT WAS READING AS "NO RUN AT ALL" ═════════════════════════
-- Found while wiring the turnover, and much bigger than the thing that found
-- it. `league_waiver_day_clears` (0337) answers "does the run visit this day?"
-- and, for a league with no EXPLICIT schedule, falls back to the legacy rule:
-- the day is in `waiver_clear_dow`, or there is no `waiver_clear_dow` and the
-- run visits every day.
--
-- That second half never happened. With the key absent, `settings_json ->
-- 'waiver_clear_dow'` is SQL NULL, so `jsonb_typeof(NULL)` is NULL, so
-- `NULL <> 'array'` is NULL — and NULL OR NULL OR NULL is NULL, not true. The
-- function returned NULL for every league that had never touched the old key,
-- which is every league created since 0337 and most created before it.
--
-- NULL IS NOT TRUE, and every caller treats it as a no:
--   · `waiver_hold_until` walks nine days looking for a clearing day, finds
--     none, and falls through to its "no run to wait for" branch — so a
--     dropped player cleared a flat 24 hours after the drop instead of at the
--     league's 3:00am run. The schedule was being ignored outright.
--   · AFTER GAMES WAIVERS CLEAR needs a clearing day to land on, so it was
--     inert: the rule that stops the fastest phone winning every injury did
--     nothing at all for those leagues.
--   · and 0338's `waiver_game_hold_dow_effective` answered null, which is
--     what made this visible — the board had no run to turn over on.
--
-- The probes never caught it because every waiver suite sets an explicit
-- schedule or an explicit `waiver_clear_dow` before asserting anything, which
-- is exactly the branch that worked. ws1 asserted the default league's DAYS
-- and its DOOR; nothing asserted its RUN.
create or replace function league_waiver_day_clears(p_league_id uuid, p_at timestamptz) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    -- `jsonb_typeof = 'array'`, not `is not null`: clearing the schedule writes
    -- the key with a JSON null in it, and a JSON null is not SQL NULL — so
    -- `is not null` read a CLEARED schedule as an explicit one.
    when (select jsonb_typeof(l.settings_json -> 'waiver_days') = 'array' from league l where l.id = p_league_id)
      then league_waiver_day(p_league_id, p_at) in ('waivers', 'waivers_to_fa')
    -- COALESCE TO TRUE (0343): with no `waiver_clear_dow` at all, every one of
    -- these comparisons is NULL, and the sentence this implements ends "…and
    -- the run visits every day". A missing picker means no restriction, not no
    -- run.
    else (select coalesce(
                   jsonb_typeof(l.settings_json -> 'waiver_clear_dow') <> 'array'
                   or jsonb_array_length(l.settings_json -> 'waiver_clear_dow') = 0
                   or l.settings_json -> 'waiver_clear_dow'
                      @> to_jsonb(extract(dow from p_at at time zone 'America/New_York')::int),
                   true)
            from league l where l.id = p_league_id)
  end;
$$;
grant execute on function league_waiver_day_clears(uuid, timestamptz) to authenticated;

-- The pair core's `openWeekFrom` takes: a weekday (0 = Sunday … 3 = Wednesday)
-- and minutes past midnight ET. Readable by any member — it is the answer to
-- "what week is it", which is not a secret from anyone in the league.
create or replace function league_week_turnover(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare d int; m int;
begin
  -- No membership check: this is a calendar fact about a league, the same
  -- shape as its schedule, and the screens that need it include ones a
  -- prospective member sees. It reveals nothing a rulebook does not.
  if not exists (select 1 from league where id = p_league_id) then
    return jsonb_build_object('dow', 3, 'minute', 180, 'source', 'default');
  end if;
  d := waiver_game_hold_dow_effective(p_league_id);
  m := league_waiver_clear_min(p_league_id);
  -- Either half missing means there is no run to sync to: an after-games hold
  -- of NONE, a schedule that clears no day, or a rolling league with no daily
  -- run at all. The default pair is what the board falls back on, and `source`
  -- says which answer a screen is looking at rather than leaving it to guess.
  if d is null or m is null then
    return jsonb_build_object('dow', 3, 'minute', 180,
      'source', case when d is null and m is null then 'no_run'
                     when d is null then 'no_hold_day' else 'rolling' end);
  end if;
  return jsonb_build_object('dow', d, 'minute', m, 'source', 'run');
end $$;
grant execute on function league_week_turnover(uuid) to authenticated, anon;

-- 0342's body, with the boundary read off that pair rather than pinned to
-- Wednesday midnight. Same walk, same DST care: `date_trunc` in the zone, then
-- add days, then add the run's minutes to the ET midnight instant IN the zone
-- — never as raw milliseconds, because the DST switches happen at 2:00am ET
-- and midnight + 3h is 2am or 4am on those two days.
-- THE OLD SIGNATURE GOES FIRST. 0342's `nfl_week_closes_at(int, text)` and this
-- one differ only in trailing defaults, so a two-argument call matches BOTH and
-- Postgres refuses it — "could not choose a best candidate function", which is
-- every PostgREST call and every probe. 0337 learned this about
-- set_transaction_rules; it is the same mistake and the same fix.
drop function if exists nfl_week_closes_at(int, text);

create or replace function nfl_week_closes_at(p_week int, p_season text default null,
                                              p_dow int default 3, p_minute int default 180)
  returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare seas text; last_kick timestamptz; done timestamptz; t timestamp; dw int; mn int;
begin
  dw := ((coalesce(p_dow, 3) % 7) + 7) % 7;
  mn := least(greatest(coalesce(p_minute, 180), 0), 1439);
  seas := case when p_season is not null
                 and exists (select 1 from nfl_slate where week = p_week and season = p_season)
               then p_season
               else (select max(season) from nfl_slate where week = p_week) end;
  select max(kickoff) into last_kick from nfl_slate where week = p_week and season = seas;
  if last_kick is null then return null; end if;          -- no slate: unmeasurable
  done := last_kick + interval '4 hours';
  t := date_trunc('day', done at time zone 'America/New_York');
  t := t + make_interval(days => ((dw - extract(dow from t)::int) + 7) % 7, mins => mn);
  -- Strictly after the games are done: a run earlier on the same day belongs
  -- to next week's occurrence, not to the week that has just ended.
  if (t at time zone 'America/New_York') <= done then
    t := t + interval '7 days';
  end if;
  return t at time zone 'America/New_York';
end $$;
grant execute on function nfl_week_closes_at(int, text, int, int) to authenticated;

create or replace function league_week_scoreboard(p_league_id uuid, p_week int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wk int; seas text; r record; closes timestamptz; turn jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  wk := p_week;
  if wk is null then
    select season into seas from league where id = p_league_id;
    turn := league_week_turnover(p_league_id);
    -- The first week whose review window has not closed, in schedule order.
    for r in
      select m.week,
             count(*) filter (where m.status <> 'final') as unfinished
        from matchup m where m.league_id = p_league_id
       group by m.week order by m.week
    loop
      closes := nfl_week_closes_at(r.week, seas, (turn ->> 'dow')::int, (turn ->> 'minute')::int);
      if closes is null then
        -- No slate to measure: the matchups' own status decides, as 0341 did.
        if r.unfinished > 0 then wk := r.week; exit; end if;
      elsif now() < closes then
        wk := r.week; exit;
      end if;
    end loop;
    if wk is null then select max(week) into wk from matchup where league_id = p_league_id; end if;
  end if;
  if wk is null then return jsonb_build_object('ok', true, 'week', null, 'games', '[]'::jsonb); end if;

  return jsonb_build_object('ok', true, 'week', wk,
    'weeks', coalesce((select jsonb_agg(distinct week order by week) from matchup where league_id = p_league_id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(g order by g.ord) from (
      select m.home_roster_id as ord, jsonb_build_object(
        'matchup_id', m.id,
        'status', m.status,
        'playoff', m.is_playoff, 'consolation', m.is_consolation, 'label', m.playoff_label,
        'home', jsonb_build_object('roster_id', m.home_roster_id,
          'team', _txn_team(p_league_id, m.home_roster_id),
          'points', coalesce(m.home_final,
            (select round(sum(s.home_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.home_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id)),
        'away', jsonb_build_object('roster_id', m.away_roster_id,
          'team', _txn_team(p_league_id, m.away_roster_id),
          'points', coalesce(m.away_final,
            (select round(sum(s.away_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.away_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id))) as g
        from matchup m
       where m.league_id = p_league_id and m.week = wk
    ) g), '[]'::jsonb));
end $$;
grant execute on function league_week_scoreboard(uuid, int) to authenticated;
