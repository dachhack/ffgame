-- ═══════════════════════════════════════════════════════════════════════════
-- 0374 · COLLEGE PLAYOFFS.
--
-- 0371 switched playoffs off for college-calendar leagues. They are back on:
-- the bracket machinery never cared what a week was called — every round is
-- `start_week + round` and lock_at comes from nfl_slate at that week — so it
-- runs on board weeks 201+ as it runs on 1..18. What changes is the calendar:
--
--   · league_playoff_start: a college league's default is college Week 13
--     (board week 213), so a 4-team bracket plays Weeks 13–14 and an 8-team
--     one Weeks 13–15. A stored start is a board week, as the board expects
--     (last regular week = start − 1).
--   · league_playoff_teams: the college exception goes; the default is 4 as
--     for any league.
--   · league_last_regular_week: a college league's regular season ends the
--     week before its playoffs (or at 215 with none).
--   · set_playoff_rules: on the college calendar, a start between college
--     Week 2 and 15 (given as 2..15 or 202..215), and the bracket must end by
--     Week 15 — there are no college regular-season games after it.
--   · set_league_calendar: switching either way clears a stored start week,
--     since one calendar's week means nothing on the other.
-- Conference championship week (15) is a real, shorter slate; a Week 15 final
-- is allowed, and the commissioner can end sooner.
-- Bodies from 0073, 0246, 0371 with only the marked 0374 changes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_playoff_start(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when coalesce(settings_json ->> 'calendar', 'nfl') = 'college'
              then coalesce(nullif(settings_json ->> 'playoff_start_week', '')::int, 213)
              else coalesce(nullif(settings_json ->> 'playoff_start_week', '')::int, 15) end
    from league where id = p_league_id;
$$;

create or replace function league_playoff_teams(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'playoff_teams', '')::int, 4) from league where id = p_league_id;
$$;

create or replace function league_last_regular_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_is_college_calendar(p_league_id)
              then case when league_playoff_teams(p_league_id) > 0
                        then least(215, league_playoff_start(p_league_id) - 1) else 215 end
              when league_playoff_teams(p_league_id) > 0
              then least(18, league_playoff_start(p_league_id) - 1)
              else 18 end;
$$;

-- ── set_playoff_rules — 0246's body, college-aware ──
create or replace function set_playoff_rules(p_league_id uuid, p_teams int default null, p_start_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean; sw int; tm int; rounds int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'playoffs are underway — settings are locked');
  end if;
  select count(*)::int into n from league_membership where league_id = p_league_id;
  -- 0 = OFF. Anything else is still a real bracket, and the shapes the builder
  -- knows how to seed and advance are still 2, 4, 6 and 8 (0073/0215) — a
  -- larger field needs the bracket engine generalised, not just this bound.
  if p_teams is not null and p_teams <> 0 and (p_teams not in (2, 4, 6, 8) or p_teams > n) then
    return jsonb_build_object('ok', false, 'error', 'playoff teams must be 0 (no playoffs), 2, 4, 6, or 8 (and fit the league)');
  end if;
  -- 0374: a college-calendar league's weeks are board weeks 201..215; a plain
  -- college week number (2..15) is read as one. Its bracket must also END by
  -- Week 15, since the college regular season does.
  college := league_is_college_calendar(p_league_id);
  if college then
    if p_start_week is not null and p_start_week between 2 and 15 then p_start_week := 200 + p_start_week; end if;
    if p_start_week is not null and (p_start_week < 202 or p_start_week > 215) then
      return jsonb_build_object('ok', false, 'error', 'college playoffs must start between college Week 2 and Week 15');
    end if;
    sw := coalesce(p_start_week, league_playoff_start(p_league_id));
    tm := coalesce(p_teams, league_playoff_teams(p_league_id));
    rounds := case tm when 0 then 0 when 2 then 1 when 4 then 2 else 3 end;
    if rounds > 0 and sw + rounds - 1 > 215 then
      return jsonb_build_object('ok', false, 'error',
        'a bracket of ' || tm || ' needs ' || rounds || ' weeks — start by college Week ' || (216 - rounds - 200) || ' so it ends by Week 15');
    end if;
  elsif p_start_week is not null and (p_start_week < 2 or p_start_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'playoffs must start between week 2 and 18');
  end if;
  -- Turning them OFF clears a bracket that was only ever SCHEDULED. The guard
  -- above already refused if any playoff game has been played, so this can
  -- never erase a result.
  if p_teams = 0 then
    delete from matchup where league_id = p_league_id and is_playoff;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_teams is not null then jsonb_build_object('playoff_teams', p_teams) else '{}'::jsonb end
      || case when p_start_week is not null then jsonb_build_object('playoff_start_week', p_start_week) else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'playoff_teams', league_playoff_teams(p_league_id),
    'playoff_start_week', league_playoff_start(p_league_id));
end $$;
grant execute on function set_playoff_rules(uuid, int, int) to authenticated;

-- ── set_league_calendar — 0371's body, clearing the playoff start ──
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
        -- 0374: an NFL playoff week means nothing here; the college default
        -- (Week 13) applies until the commissioner picks one.
        - 'playoff_start_week'
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
    update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'calendar' - 'playoff_start_week')
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
