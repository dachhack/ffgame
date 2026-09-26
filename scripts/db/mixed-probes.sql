-- 0372 probes: NFL AND COLLEGE PLAYERS BOTH SCORING (mixed leagues).
--
--   • a mixed league is COLLEGE on, NFL calendar, no devy spots;
--   • a spot's level (nfl / college) is stored for a mixed league and refused
--     anywhere else; the backstop keeps it from outliving the mix;
--   • a college player's kickoff is his school's game inside the NFL week's
--     window (and that week's game on the college calendar);
--   • classic_pick_lock follows it, so the lineup guard locks him at his own
--     game, not at Thursday night;
--   • seal_due_college_picks seals exactly the college picks whose game began;
--   • the worker's readers see mixed leagues.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function mx_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function mx_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function mx_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000040' || u, false); perform set_config('app.email', 'mx' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000004001', 'mx01@test.dev'),
  ('00000000-0000-0000-0000-000000004002', 'mx02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000004001', 'mx01@test.dev'),
  ('00000000-0000-0000-0000-000000004002', 'mx02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000004002');
insert into app_admin (email, note) values ('mx01@test.dev', 'mixed probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; dv uuid; code text; mid uuid; boom boolean;
        sat timestamptz := now() - interval '1 hour';        -- the Alabama game has begun
        thu timestamptz := now() + interval '1 day';         -- NFL week's first kickoff still ahead
        nextsat timestamptz := now() + interval '7 days';
begin
  -- NFL week 5 of season 2032 (future Thursday + Sunday), and two college weeks:
  -- 205 (inside NFL week 5's window: began an hour ago) and 206 (next week).
  insert into nfl_slate (season, week, home, away, win, kickoff, game_id) values
    ('2032', 4, 'NYJ', 'NE', 'wk', now() - interval '3 days', 'mxn0'),   -- week 5's window opens 12h after this
    ('2032', 5, 'BUF', 'MIA', 'wk', thu, 'mxn1'),
    ('2032', 5, 'KC', 'DEN', 'wk', thu + interval '3 days', 'mxn2'),
    ('2032', 205, 'MXALA', 'MXFSU', 'wk', sat, 'mxc1'),
    ('2032', 206, 'MXALA', 'MXUGA', 'wk', nextsat, 'mxc2'),
    ('2032', 205, 'MXUGA', 'MXCLE', 'wk', now() + interval '5 hours', 'mxc3')
  on conflict do nothing;
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '94001', 'full_name', 'Mx Tide Back', 'pos', 'RB', 'school_abbr', 'MXALA', 'school_id', '94333'),
    jsonb_build_object('espn_id', '94002', 'full_name', 'Mx Dawg Wideout', 'pos', 'WR', 'school_abbr', 'MXUGA', 'school_id', '94061')));

  perform mx_as('01');
  r := create_native_league('Mixed', '2032', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform mx_ok(r, 'mx0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform mx_as('02'); perform mx_ok(native_join(code, 'MX-2'), 'mx0 join'); perform mx_as('01');

  -- ══ mx1. WHAT A MIXED LEAGUE IS ══════════════════════════════════════════
  perform mx_true(not league_is_mixed(lid), 'mx1 without COLLEGE a league is not mixed');
  r := set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB","WR","TE"],"level":"college"}]'::jsonb);
  perform mx_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'NFL/college spots are for leagues where both score%',
    'mx1a a level is refused outside a mixed league');
  perform mx_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'mx1b COLLEGE on');
  perform mx_true(league_is_mixed(lid), 'mx1c COLLEGE on, NFL calendar, no devy: mixed');

  -- ══ mx2. SPOT LEVELS ═════════════════════════════════════════════════════
  r := set_league_classic_slots(lid, '[{"pos":["QB"],"level":"nfl"},{"pos":["RB","WR","TE"],"level":"college"},{"pos":["RB","WR","TE"]}]'::jsonb);
  perform mx_ok(r, 'mx2 levels saved');
  perform mx_true((select settings_json -> 'roster_slots' -> 0 ->> 'level' = 'nfl'
                      and settings_json -> 'roster_slots' -> 1 ->> 'level' = 'college'
                      and not (settings_json -> 'roster_slots' -> 2 ? 'level') from league where id = lid),
    'mx2a nfl, college, and a spot for either');
  r := set_league_classic_slots(lid, '[{"pos":["QB"],"level":"pro"}]'::jsonb);
  perform mx_true((r ->> 'ok')::boolean is false, 'mx2b an unknown level is refused');
  boom := false;
  begin perform set_league_roster_shape(lid, 2, 0, 0, 0, 2); exception when others then boom := true; end;
  perform mx_true(boom, 'mx2c devy spots cannot join a league whose spots carry levels');

  -- ══ mx3. A COLLEGE PLAYER'S KICKOFF ══════════════════════════════════════
  perform mx_ok(seed_league_pool(lid, '[
    {"slug":"c-94001","full":"Mx Tide Back","pos":"RB"},
    {"slug":"c-94002","full":"Mx Dawg Wideout","pos":"WR"},
    {"slug":"mx-bills-qb","full":"Mx Bills Qb","pos":"QB","team":"BUF"}]'::jsonb), 'mx3 pool');
  perform mx_true(classic_kickoff_for(lid, 5, 'c-94001') = sat, 'mx3a his school''s game inside NFL week 5');
  perform mx_true(classic_kickoff_for(lid, 206, 'c-94001') = nextsat, 'mx3b on the college calendar, that week''s game');
  perform mx_true(classic_kickoff_for(lid, 5, 'mx-bills-qb') = thu, 'mx3c an NFL player is unchanged');

  -- ══ mx4. THE LOCK AND THE SEAL ═══════════════════════════════════════════
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 5, 1, 2, 'scheduled') returning id into mid;
  perform mx_true(classic_pick_lock(mid, 'c-94001', window_kickoff(5, 'wk')) = sat,
    'mx4 the lineup guard locks him at his own game, not Thursday night');
  perform mx_true(classic_pick_lock(mid, 'c-94002', window_kickoff(5, 'wk')) = now() + interval '5 hours'
                  or classic_pick_lock(mid, 'c-94002', window_kickoff(5, 'wk')) > now(),
    'mx4a a college player whose game is later still has time');
  -- A manager cannot put him in once his game has begun (the guard reads it)…
  boom := false;
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, '00000000-0000-0000-0000-000000004001', 'wk', 'S2', 'c-94001');
  exception when others then boom := true; end;
  perform mx_true(boom, 'mx4b THE POINT: no starting a college player after his kickoff, though the NFL week has not begun');
  -- …so the fixture is written as the server writes it (no signed-in user).
  perform set_config('app.uid', '', false);
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values
    (mid, '00000000-0000-0000-0000-000000004001', 'wk', 'S2', 'c-94001'),
    (mid, '00000000-0000-0000-0000-000000004001', 'wk', 'S3', 'c-94002'),
    (mid, '00000000-0000-0000-0000-000000004001', 'wk', 'S1', 'mx-bills-qb');
  perform mx_as('01');
  perform mx_true(not has_function_privilege('authenticated', 'seal_due_college_picks(int)', 'execute'), 'mx4c only the worker seals');
  perform mx_true(seal_due_college_picks(5) = 1, 'mx4d exactly one college pick seals');
  perform mx_true((select locked from sealed_pick where matchup_id = mid and roster_slot = 'S2')
              and not (select locked from sealed_pick where matchup_id = mid and roster_slot = 'S3')
              and not (select locked from sealed_pick where matchup_id = mid and roster_slot = 'S1'),
    'mx4e the Alabama back sealed; the later college game and the NFL player did not');

  -- ══ mx5. THE WORKER'S READERS ════════════════════════════════════════════
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'c-94001');
  perform mx_true(mixed_leagues_exist() and college_calendar_in_use(), 'mx5 the worker sees a mixed league');
  perform mx_true('94333' = any(college_live_schools()), 'mx5a and polls his school');

  -- ══ mx6. A DEVY LEAGUE IS NOT MIXED ══════════════════════════════════════
  r := create_native_league('Devy Not Mixed', '2032', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  dv := (r ->> 'league_id')::uuid;
  perform mx_ok(set_league_position_access(dv, '["COLLEGE"]'::jsonb), 'mx6 COLLEGE on');
  perform mx_ok(set_league_roster_shape(dv, 2, 0, 0, 0, 2), 'mx6a devy spots');
  perform mx_true(not league_is_mixed(dv), 'mx6b devy leagues keep college players on the shelf');

  delete from league_pool where league_id in (lid, dv);
  delete from college_player where espn_id in ('94001', '94002');
  delete from nfl_slate where season = '2032';
  raise notice 'mixed probes done';
end $$;

select 'ALL MIXED PROBES PASSED' as result;
