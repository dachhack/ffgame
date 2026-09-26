-- ═══════════════════════════════════════════════════════════════════════════
-- 0375 · BOWL GAMES.
--
-- ESPN files every bowl and CFP game under ONE postseason "week" (47 games,
-- 12 Dec – 26 Jan for 2026), so bowl weeks come from the calendar instead: the
-- worker (server/src/poll/collegeSlate.js) buckets them into Eastern
-- Tuesday–Monday weeks and writes them at board weeks 216.. (BOWL 1, 2, …),
-- capped at 223. Everything keyed on board weeks then takes them as it takes
-- 201..215:
--
--   · classic_kickoff_for looks for a college player's game in 201..223, so a
--     MIXED league's NFL Weeks 15–17 find his bowl game — the fantasy-playoff
--     gap Phase 4 left — and the mirror scores it there;
--   · college_proj_lines judges has_game across them;
--   · set_playoff_rules lets a college-calendar bracket start or run into bowl
--     weeks, ending by the last week the slate holds (Week 15 without bowls).
-- The regular season still ends by Week 15 (league_last_regular_week).
-- Bodies from 0372, 0373, 0374 with only the marked 0375 changes.
-- ═══════════════════════════════════════════════════════════════════════════

-- "Week 13" for 213, "Bowl week 2" for 217.
create or replace function college_week_label(p_week int) returns text
  language sql immutable as $$
  select case when p_week > 215 then 'Bowl week ' || (p_week - 215) else 'Week ' || (p_week - 200) end
$$;

-- ── classic_kickoff_for — 0372's body, bowl weeks included ──
create or replace function classic_kickoff_for(p_league_id uuid, p_week int, p_slug text)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p_slug ~ '^c-[0-9]+$' then (
      select min(s.kickoff)
        from college_player cp
        join nfl_slate s
          on upper(s.home) = upper(cp.school_abbr) or upper(s.away) = upper(cp.school_abbr)
       where cp.espn_id = substr(p_slug, 3) and cp.school_abbr is not null
         and case when p_week > 200
                  -- the college calendar: that week's game
                  then s.week = p_week and s.season = (select max(season) from nfl_slate where week = p_week)
                  -- an NFL week: the college game inside its window
                  else s.week between 201 and 223   -- 0375: bowl weeks too
                   and s.kickoff between (select lo from nfl_week_window(p_week)) and (select hi from nfl_week_window(p_week))
             end)
    else (
      select min(s.kickoff)
        from league_pool p
        join nfl_slate s
          on s.week = p_week
         and s.season = (select max(season) from nfl_slate where week = p_week)
         and (upper(s.home) = upper(p.team) or upper(s.away) = upper(p.team))
       where p.league_id = p_league_id and p.slug = p_slug and p.team <> '')
  end;
$$;
grant execute on function classic_kickoff_for(uuid, int, text) to authenticated;

-- ── college_proj_lines — 0373's body, bowl weeks included ──
create or replace function college_proj_lines(p_week int) returns jsonb
  language sql stable security definer set search_path = public as $$
  with slugs as (
    select distinct nr.slug from native_roster nr where nr.slug ~ '^c-[0-9]+$'
  ), judged as (
    select exists (select 1 from nfl_slate where week = p_week)
       and exists (select 1 from nfl_slate where week between 201 and 223) as ok
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', s.slug,
      'gp', b.gp,
      'line', case when b.gp is null then null else jsonb_build_object(
        'passYd', round(coalesce(b.pass_yds, 0)::numeric / b.gp, 2),
        'passTd', round(coalesce(b.pass_td, 0)::numeric / b.gp, 3),
        'int',    round(coalesce(b.ints, 0)::numeric / b.gp, 3),
        'rushYd', round(coalesce(b.rush_yds, 0)::numeric / b.gp, 2),
        'rushTd', round(coalesce(b.rush_td, 0)::numeric / b.gp, 3),
        'rec',    round(coalesce(b.rec, 0)::numeric / b.gp, 2),
        'recYd',  round(coalesce(b.rec_yds, 0)::numeric / b.gp, 2),
        'recTd',  round(coalesce(b.rec_td, 0)::numeric / b.gp, 3)) end,
      'has_game', case when (select ok from judged)
                       then classic_kickoff_for(null, p_week, s.slug) is not null end)), '[]'::jsonb)
    from slugs s
    left join lateral (
      select st.* from college_player_stats st
       where st.espn_id = substr(s.slug, 3) and coalesce(st.gp, 0) >= 4
       order by st.season desc limit 1) b on true
$$;
grant execute on function college_proj_lines(int) to authenticated, service_role;

-- ── set_playoff_rules — 0374's body, brackets into bowl weeks ──
create or replace function set_playoff_rules(p_league_id uuid, p_teams int default null, p_start_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean; sw int; tm int; rounds int; last_wk int; seas text;
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
    -- 0375: bowl weeks (216+) are playable too; the last playable week is the
    -- last one the college slate holds for this season (Week 15 without bowls).
    select season into seas from league where id = p_league_id;
    last_wk := greatest(215, coalesce((select max(week) from nfl_slate where season = seas and week between 216 and 223), 215));
    if p_start_week is not null and (p_start_week < 202 or p_start_week > last_wk) then
      return jsonb_build_object('ok', false, 'error',
        'college playoffs must start between college Week 2 and ' || college_week_label(last_wk));
    end if;
    sw := coalesce(p_start_week, league_playoff_start(p_league_id));
    tm := coalesce(p_teams, league_playoff_teams(p_league_id));
    rounds := case tm when 0 then 0 when 2 then 1 when 4 then 2 else 3 end;
    if rounds > 0 and sw + rounds - 1 > last_wk then
      return jsonb_build_object('ok', false, 'error',
        'a bracket of ' || tm || ' needs ' || rounds || ' weeks — start by ' || college_week_label(last_wk - rounds + 1)
        || ' so it ends by ' || college_week_label(last_wk));
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
