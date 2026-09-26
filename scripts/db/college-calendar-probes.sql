-- 0371 probes: THE COLLEGE CALENDAR.
--
--   • practice weeks are 101..199; a college board week (201+) counts;
--   • set_league_calendar: admin only, classic + COLLEGE required, no devy;
--     narrows the pool to college, gives a college lineup (no K/DEF), and
--     re-lays the schedule on college weeks with lock_at from the college slate;
--   • no playoffs on the college calendar; the regular season caps at 215;
--   • the backstop refuses COLLEGE off, or devy spots, on a college calendar;
--   • college_live_schools names the schools with active rostered players;
--   • back to 'nfl' undoes it.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function cc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cc_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cc_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000039' || u, false); perform set_config('app.email', 'cc' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'cc01@test.dev'),
  ('00000000-0000-0000-0000-000000003902', 'cc02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'cc01@test.dev'),
  ('00000000-0000-0000-0000-000000003902', 'cc02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000003902');
insert into app_admin (email, note) values ('cc01@test.dev', 'calendar probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; boom boolean;
begin
  -- ══ cc0. PRACTICE IS 101..199 ════════════════════════════════════════════
  perform cc_true(is_practice_week(103) and not is_practice_week(203) and not is_practice_week(3),
    'cc0 preseason is practice; college and NFL weeks count');

  -- A college slate for this suite's season: weeks 201..203, all ahead.
  insert into nfl_slate (season, week, home, away, win, kickoff, game_id) values
    ('2031', 201, 'ALA', 'FSU', 'wk', now() + interval '2 days', 'cc1'),
    ('2031', 201, 'UGA', 'CLEM', 'wk', now() + interval '2 days 3 hours', 'cc2'),
    ('2031', 202, 'ALA', 'UGA', 'wk', now() + interval '9 days', 'cc3'),
    ('2031', 203, 'FSU', 'CLEM', 'wk', now() + interval '16 days', 'cc4')
  on conflict do nothing;

  perform cc_as('01');
  r := create_native_league('College Only', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cc_ok(r, 'cc1 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cc_as('02'); perform cc_ok(native_join(code, 'CC-2'), 'cc1 join');

  -- ══ cc2. WHO AND WHEN ════════════════════════════════════════════════════
  r := set_league_calendar(lid, 'college');
  perform cc_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'admin only', 'cc2 admin only');
  perform cc_as('01');
  r := set_league_calendar(lid, 'college');
  perform cc_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'turn on college players%', 'cc2a COLLEGE first');
  perform cc_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'cc2b COLLEGE on');

  -- ══ cc3. ON TO THE COLLEGE CALENDAR ══════════════════════════════════════
  perform native_generate_schedule(lid, 3);
  r := set_league_calendar(lid, 'college');
  perform cc_ok(r, 'cc3 college calendar');
  perform cc_true((select settings_json ->> 'calendar' from league where id = lid) = 'college', 'cc3a stored');
  perform cc_true((select settings_json -> 'pool_filter' ->> 'level' from league where id = lid) = 'college', 'cc3b pool narrowed to college');
  perform cc_true((select not jsonb_path_exists(settings_json -> 'roster_slots', '$[*].pos[*] ? (@ == "K" || @ == "DEF")')
                     and jsonb_array_length(settings_json -> 'roster_slots') = 8 from league where id = lid),
    'cc3c a college lineup: eight spots, no kicker or defense');
  perform cc_true((select min(week) from matchup where league_id = lid) = 201
              and (select max(week) from matchup where league_id = lid) = 203, 'cc3d the schedule sits on college weeks 201..203');
  perform cc_true((select lock_at from matchup where league_id = lid and week = 201 limit 1)
                = (select min(kickoff) from nfl_slate where season = '2031' and week = 201),
    'cc3e lock_at is the college week''s first kickoff');
  -- 0374: college playoffs, on by default: 4 teams from college Week 13.
  perform cc_true(league_playoff_teams(lid) = 4 and league_playoff_start(lid) = 213 and league_last_regular_week(lid) = 212,
    'cc3f playoffs default on: Week 13 start, so the regular season ends at Week 12');

  -- ══ cc4. THE BACKSTOP ════════════════════════════════════════════════════
  boom := false;
  begin perform set_league_position_access(lid, '[]'::jsonb); exception when others then boom := true; end;
  perform cc_true(boom, 'cc4 COLLEGE cannot come off a college-calendar league');
  boom := false;
  begin
    update league set settings_json = jsonb_set(settings_json, '{roster_shape}', '{"bench":2,"taxi":0,"ir":0,"out":0,"devy":2}') where id = lid;
  exception when others then boom := true; end;
  perform cc_true(boom, 'cc4a nor can it hold devy spots');

  -- ══ cc5. WHICH GAMES TO POLL ═════════════════════════════════════════════
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '93901', 'full_name', 'Cal Runner', 'pos', 'RB', 'school_id', '93333', 'school_abbr', 'CCU')));
  perform cc_ok(seed_league_pool(lid, '[{"slug":"c-93901","full":"Cal Runner","pos":"RB"}]'::jsonb), 'cc5 pool');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'c-93901');
  perform cc_true((select spot from native_roster where league_id = lid and slug = 'c-93901') = 'active',
    'cc5a on the college calendar a college player is simply active');
  perform cc_true('93333' = any(college_live_schools()), 'cc5b his school is polled');
  perform cc_true(college_calendar_in_use(), 'cc5c the worker sees a college league');

  -- ══ cc7. COLLEGE PLAYOFFS (0374) ═════════════════════════════════════════
  r := set_playoff_rules(lid, null, 20);
  perform cc_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'college playoffs must start between%', 'cc7 no Week 20');
  r := set_playoff_rules(lid, null, 15);
  perform cc_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'a bracket of 4 needs 2 weeks — start by Week 14 so it ends by Week 15%',
    'cc7a a 4-team bracket cannot start Week 15 (it would run past Week 15)');
  perform cc_ok(set_playoff_rules(lid, 2, 15), 'cc7b a 2-team final in Week 15 fits');
  perform cc_true(league_playoff_start(lid) = 215, 'cc7c a college week number is stored as its board week');
  -- A played regular season (201..203) and a bracket the week after it.
  insert into nfl_slate (season, week, home, away, win, kickoff, game_id)
    values ('2031', 204, 'ALA', 'UGA', 'wk', now() + interval '23 days', 'cc5') on conflict do nothing;
  perform cc_ok(set_playoff_rules(lid, 2, 204), 'cc7d start Week 4 (given as board week 204)');
  update draft set status = 'complete' where league_id = lid;
  update matchup set status = 'final', home_final = 100, away_final = 90 where league_id = lid and not is_playoff;
  r := generate_playoffs(lid, null, true);
  perform cc_ok(r, 'cc7e the worker''s auto bracket builds once the college regular season is final');
  perform cc_true((select count(*) = 1 and min(week) = 204 from matchup where league_id = lid and is_playoff),
    'cc7f the final is on college Week 4');
  perform cc_true((select lock_at from matchup where league_id = lid and is_playoff)
                = (select min(kickoff) from nfl_slate where season = '2031' and week = 204),
    'cc7g and locks at that college week''s first kickoff');
  delete from matchup where league_id = lid and is_playoff;

  -- ══ cc8. BOWL WEEKS (0375) ═══════════════════════════════════════════════
  -- Bowl season lands at 216+; a TBD placeholder row is enough to open a week.
  insert into nfl_slate (season, week, home, away, win, kickoff, game_id) values
    ('2031', 216, 'NAVY', 'ARMY', 'wk', now() + interval '80 days', 'cc6'),
    ('2031', 217, 'TBD-cc7', 'TBD', 'wk', now() + interval '87 days', 'cc7')
  on conflict do nothing;
  perform cc_ok(set_playoff_rules(lid, 2, 217), 'cc8 a final in BOWL 2 fits');
  perform cc_true(league_playoff_start(lid) = 217, 'cc8a stored at board week 217');
  r := set_playoff_rules(lid, 2, 218);
  perform cc_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'college playoffs must start between college Week 2 and Bowl week 2',
    'cc8b no week past the last bowl week, and the bound is named as a bowl week');
  perform cc_true(classic_kickoff_for(null, 216, 'c-93901') is null, 'cc8e a player whose school has no bowl has no game');
  perform cc_true(college_week_label(217) = 'Bowl week 2' and college_week_label(213) = 'Week 13', 'cc8f week labels');
  perform cc_ok(set_playoff_rules(lid, 2, 15), 'cc8g back to a Week 15 final');
  update matchup set status = 'scheduled', home_final = null, away_final = null where league_id = lid;
  update draft set status = 'pending' where league_id = lid;

  -- ══ cc6. AND BACK ════════════════════════════════════════════════════════
  delete from native_roster where league_id = lid;
  r := set_league_calendar(lid, 'nfl');
  perform cc_ok(r, 'cc6 back to the NFL calendar');
  perform cc_true((select settings_json ->> 'calendar' is null and settings_json -> 'pool_filter' ->> 'level' is null
                     from league where id = lid), 'cc6a calendar and level cleared');
  perform cc_true((select max(week) from matchup where league_id = lid) < 200, 'cc6b the schedule is back on NFL weeks');
  perform cc_true(league_playoff_start(lid) = 15, 'cc6c and the college playoff start is cleared (NFL default 15)');

  delete from league_pool where league_id = lid;
  delete from college_player where espn_id = '93901';
  delete from nfl_slate where season = '2031';
  raise notice 'college calendar probes done';
end $$;

select 'ALL COLLEGE-CALENDAR PROBES PASSED' as result;
