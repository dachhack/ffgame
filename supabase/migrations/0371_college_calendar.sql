-- ═══════════════════════════════════════════════════════════════════════════
-- 0371 · COLLEGE PLAYERS, PHASE 3 — THE COLLEGE CALENDAR.
--
-- A college-only league plays Saturdays, scored live off ESPN's college
-- play-by-play. Every live table (live_play, game_feed, matchup, nfl_slate)
-- keys on a bare board week, so a college Week 3 cannot share week 3 with the
-- NFL. It takes the preseason's trick instead: college Week N is board week
-- 200 + N (preseason is 100 + N). The worker writes the college slate into
-- nfl_slate at those weeks and runs a college context beside the NFL ones.
--
--   · is_practice_week is now 101..199 — "above 100" used to mean practice,
--     and a college week must count (standings, coin) like any other;
--   · settings_json.calendar = 'college' (set_league_calendar, admin, before
--     the draft): needs COLLEGE (0365), no devy spots, and narrows the pool
--     to college players. Schedules start at the first open college week and
--     end at college week 15; lock_at comes from the college slate;
--   · college-calendar leagues play no playoffs yet (league_playoff_teams = 0,
--     which makes generation a quiet no-op, as for a league that turned them
--     off);
--   · college_live_schools() tells the worker which schools' games to poll:
--     only those with a college player on an active roster in such a league.
-- Bodies copied from 0280 (native_generate_schedule, _shift_schedule_to_open_
-- week), 0246/0073 and 0365 with only the marked 0371 changes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function is_practice_week(p_week int) returns boolean
  language sql immutable as $$ select coalesce(p_week, 0) between 101 and 199 $$;

create or replace function league_is_college_calendar(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select settings_json ->> 'calendar' from league where id = p_league_id), 'nfl') = 'college'
$$;
grant execute on function league_is_college_calendar(uuid) to authenticated;

-- 0 for the NFL calendar, 200 for the college one.
create or replace function league_week_base(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_is_college_calendar(p_league_id) then 200 else 0 end
$$;

-- The first week still ahead, on this league's calendar.
create or replace function league_first_open_week(p_league_id uuid, p_season text) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_is_college_calendar(p_league_id) then (
    select min(w.week) from (
      select s.week, min(s.kickoff) as k from nfl_slate s
       where s.season = p_season and s.week between 201 and 215
       group by s.week) w
     where w.k > now())
  else season_first_open_week(p_season) end
$$;

-- 0073's reader: a college-calendar league plays no playoffs (yet).
create or replace function league_playoff_teams(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when coalesce(settings_json ->> 'calendar', 'nfl') = 'college' then 0
              else coalesce(nullif(settings_json ->> 'playoff_teams', '')::int, 4) end
    from league where id = p_league_id;
$$;

-- 0280's cap, on the league's calendar: college Week 15 is the last.
create or replace function league_last_regular_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_is_college_calendar(p_league_id) then 215
              when league_playoff_teams(p_league_id) > 0
              then least(18, league_playoff_start(p_league_id) - 1)
              else 18 end;
$$;

create or replace function set_league_calendar(p_league_id uuid, p_calendar text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; dstat text; weeks int; sched jsonb;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_calendar not in ('nfl', 'college') then
    return jsonb_build_object('ok', false, 'error', 'calendar must be nfl or college');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the calendar locks once the draft starts');
  end if;
  if p_calendar = 'college' then
    if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
      return jsonb_build_object('ok', false, 'error', 'the college calendar is for classic leagues');
    end if;
    if not _league_has_college(lg.settings_json) then
      return jsonb_build_object('ok', false, 'error', 'turn on college players (COLLEGE) first');
    end if;
    if coalesce((lg.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      return jsonb_build_object('ok', false, 'error', 'devy spots are for NFL leagues — set them to 0 first');
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('calendar', 'college')
        || jsonb_build_object('pool_filter', coalesce(settings_json -> 'pool_filter', '{}'::jsonb) || '{"level":"college"}'::jsonb)
      where id = p_league_id;
    -- College pools hold no kickers or team defenses, so a lineup that wants
    -- them can never be legal: give such a league (or one with no spec) the
    -- college default — QB, 2 RB, 3 WR, TE, FLEX.
    if coalesce(jsonb_path_exists(lg.settings_json -> 'roster_slots', '$[*].pos[*] ? (@ == "K" || @ == "DEF")'), true) then
      perform set_league_classic_slots(p_league_id,
        '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["RB","WR","TE"]}]'::jsonb);
    end if;
  else
    update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'calendar')
        || case when settings_json -> 'pool_filter' is null then '{}'::jsonb
                else jsonb_build_object('pool_filter', (settings_json -> 'pool_filter') - 'level') end
      where id = p_league_id;
  end if;
  -- Re-lay the schedule on the new calendar, same length, while nothing is
  -- played. A league with no schedule yet keeps none.
  select count(distinct week) into weeks from matchup where league_id = p_league_id and not is_playoff;
  if weeks > 0 then
    sched := native_generate_schedule(p_league_id, least(weeks, 15));
  end if;
  return jsonb_build_object('ok', true, 'calendar', p_calendar, 'schedule', sched);
end $$;
grant execute on function set_league_calendar(uuid, text) to authenticated;

-- Schools (ESPN team ids) whose games the worker must poll live: any with a
-- college player on an active roster in a college-calendar league.
create or replace function college_live_schools() returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct cp.school_id), array[]::text[])
    from native_roster nr
    join league l on l.id = nr.league_id
    join college_player cp on cp.espn_id = substr(nr.slug, 3)
   where nr.slug ~ '^c-[0-9]+$' and nr.spot = 'active'
     and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'college'
     and cp.school_id is not null
$$;
revoke all on function college_live_schools() from public, anon, authenticated;
grant execute on function college_live_schools() to service_role;

-- Is any league on the college calendar? The worker skips the college
-- context entirely when not.
create or replace function college_calendar_in_use() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where coalesce(settings_json ->> 'calendar', 'nfl') = 'college')
$$;
revoke all on function college_calendar_in_use() from public, anon, authenticated;
grant execute on function college_calendar_in_use() to service_role;

-- ── the backstop — 0365's trigger function, plus the calendar ──
create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  -- 0371: the college calendar needs college players, and has no devy spots
  -- (devy is an NFL league's shelf).
  if coalesce(new.settings_json ->> 'calendar', 'nfl') = 'college' then
    if not _league_has_college(new.settings_json) then
      raise exception 'a college-calendar league needs college players turned on (0371)';
    end if;
    if coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      raise exception 'a college-calendar league has no devy spots (0371)';
    end if;
  end if;
  return new;
end $$;

-- ── native_generate_schedule — 0280's body, college-aware start ──
create or replace function native_generate_schedule(p_league_id uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids int[]; n int; ghost boolean := false; wk int; idx int; i int;
  a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
  use_div boolean; rot int; pool int[]; pairs int[]; div_a text; j int; pick int;
  start_wk int; cap int; last_wk int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 18 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–18');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  use_div := league_divisions_active(p_league_id);
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;  -- 0 = bye

  select l.season into seas from league l where l.id = p_league_id;
  -- 0371: a college-calendar league plays board weeks 201+.
  start_wk := coalesce(league_first_open_week(p_league_id, seas), league_week_base(p_league_id) + 1);
  cap := league_last_regular_week(p_league_id);
  if start_wk > cap then
    return jsonb_build_object('ok', false, 'error',
      format('no weeks left to play — the next open week is %s and the regular season ends at %s',
             start_wk, cap));
  end if;
  delete from matchup where league_id = p_league_id;  -- all scheduled (checked above)

  for idx in 1..p_weeks loop
    wk := start_wk + idx - 1;
    exit when wk > cap;                      -- a short season, honestly short
    last_wk := wk;
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

    if use_div and idx > n - 1 then
      -- REMATCH WEEK, divisions on: greedy division-first pairing. `rot`
      -- rotates which division mate each seat meets so consecutive rematch
      -- weeks differ; anyone whose division is exhausted pairs across.
      rot := idx - (n - 1);
      select array_agg(m.sleeper_roster_id order by m.division, m.sleeper_roster_id)
        into pool from league_membership m where m.league_id = p_league_id;
      pairs := '{}';
      while coalesce(array_length(pool, 1), 0) >= 2 loop
        a := pool[1]; pool := pool[2:];
        select m.division into div_a from league_membership m
          where m.league_id = p_league_id and m.sleeper_roster_id = a;
        -- division mates still unpaired, rotation picking among them
        select count(*) into j from unnest(pool) u
          join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
          where m.division = div_a;
        if j > 0 then
          pick := ((rot - 1) % j) + 1;
          select u into b from (
            select u, row_number() over (order by u) as rn from unnest(pool) u
            join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
            where m.division = div_a) t where t.rn = pick;
        else
          b := pool[1];
        end if;
        pool := array_remove(pool, b);
        pairs := pairs || a || b;
      end loop;
      -- (an odd human count leaves one seat over: that seat's bye, as before)
      i := 1;
      while i < coalesce(array_length(pairs, 1), 0) loop
        a := pairs[i]; b := pairs[i + 1]; i := i + 2;
        if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
        insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, hm, aw, 'scheduled', la)
        on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
        made := made + 1;
      end loop;
      continue;
    end if;

    for i in 0..(n / 2 - 1) loop
      -- circle method: ids[n] fixed, the rest rotate one step per week
      a := ids[((idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n]
                else ids[((idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', greatest(last_wk - start_wk + 1, 0),
    'matchups', made, 'first_week', start_wk, 'last_week', last_wk);
end $$;
grant execute on function native_generate_schedule(uuid, int) to authenticated;

-- ── _shift_schedule_to_open_week — 0280's body, college-aware ──
create or replace function _shift_schedule_to_open_week(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare first_wk int; open_wk int; delta int; cap int; seas text; w int; dropped int := 0; la timestamptz;
begin
  if exists (select 1 from matchup m where m.league_id = p_league_id
               and (m.status <> 'scheduled' or m.is_playoff)) then
    return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'season underway');
  end if;
  select min(week) into first_wk from matchup where league_id = p_league_id;
  if first_wk is null then return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'no schedule'); end if;

  select l.season into seas from league l where l.id = p_league_id;
  open_wk := coalesce(league_first_open_week(p_league_id, seas), first_wk);  -- 0371: college-aware
  delta := open_wk - first_wk;
  if delta <= 0 then return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'already open'); end if;

  cap := league_last_regular_week(p_league_id);
  delete from matchup where league_id = p_league_id and week + delta > cap;
  get diagnostics dropped = row_count;

  -- DESCENDING, one week at a time. A single `week = week + delta` update would
  -- collide with the rows already sitting on the target weeks — the unique key
  -- on (league_id, week, home, away) is checked per row, not at statement end.
  for w in reverse coalesce((select max(week) from matchup where league_id = p_league_id), 0)
           .. first_wk loop
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = w + delta;
    update matchup set week = w + delta, lock_at = la
      where league_id = p_league_id and week = w;
  end loop;

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'shifted', delta, 'first_week', open_wk,
                            'dropped_weeks', dropped, 'cap', cap);
end $$;
