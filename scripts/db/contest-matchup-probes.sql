-- 0479 contest-matchup probes: any matchup of a week as two squads, each
-- player sealed until his kickoff unless the squad is the reader's own; the
-- week's list for the picker; a board league's self-paired rows.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'), ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;
do $$
declare r jsonb; h uuid; g uuid; code text; gcode text; wk int := 41; sq jsonb; m1 uuid; m2 uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'), ('00000000-0000-0000-0000-00000000000c', 'c@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('CM H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'cm0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('CM Board', 'high', 'board', 'season', 12, 50000); perform assert_ok(r, 'cm0b'); g := (r ->> 'league_id')::uuid; gcode := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cm0c'); perform assert_ok(join_contest(gcode, 'Bees B'), 'cm0d');
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '3 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '3 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '3 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '3 days' where season = '2026' and week = wk;   -- re-runnable: a past run moved a kickoff
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj) values
    ('2026', wk, 'cm-qb1', 'Q One', 'QB', 'PHI', 7000, 20), ('2026', wk, 'cm-rb1', 'R One', 'RB', 'PHI', 6000, 14), ('2026', wk, 'cm-rb2', 'R Two', 'RB', 'SF', 5500, 13),
    ('2026', wk, 'cm-wr1', 'W One', 'WR', 'NYJ', 6000, 14), ('2026', wk, 'cm-wr2', 'W Two', 'WR', 'SF', 5500, 13), ('2026', wk, 'cm-wr3', 'W Three', 'WR', 'KC', 5000, 12),
    ('2026', wk, 'cm-te1', 'T One', 'TE', 'PHI', 4000, 9), ('2026', wk, 'cm-k1', 'K One', 'K', 'PHI', 3000, 8), ('2026', wk, 'cm-d1', 'D One', 'DEF', 'SF', 3000, 7)
    on conflict do nothing;
  sq := '{"S1":"cm-qb1","S2":"cm-rb1","S3":"cm-rb2","S4":"cm-wr1","S5":"cm-wr2","S6":"cm-wr3","S7":"cm-te1","S8":"cm-k1","S9":"cm-d1"}';
  -- the worker pairs the week: 1 v 2, 3 v 4
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled') returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 3, 4, 'scheduled') returning id into m2;
  perform assert_ok(save_contest_entry(h, wk, sq), 'cm1 b saves'); perform probe_as('a'); perform assert_ok(save_contest_entry(h, wk, sq), 'cm1b a saves');
  -- a reads: own squad open, b's sealed (nothing has kicked off)
  r := contest_matchup(h, wk);
  perform assert_ok(r, 'cm2 my matchup by default');
  perform assert_true((r -> 'matchup' ->> 'id')::uuid = m1 and (r -> 'matchup' ->> 'home')::int = 1 and r -> 'matchup' ->> 'away_team' = 'Bees', 'cm2b it is 1 v 2');
  perform assert_true((r -> 'matchup' -> 'home_entry' -> 0 ->> 'player_slug') = 'cm-qb1', 'cm3 my own squad is open');
  perform assert_true((r -> 'matchup' -> 'away_entry' -> 0 ->> 'sealed')::boolean and (r -> 'matchup' -> 'away_entry' -> 0 ->> 'player_slug') is null, 'cm3b the opponent''s is sealed');
  perform assert_true(jsonb_array_length(r -> 'matchups') = 2 and (r -> 'matchups' -> 0 ->> 'mine')::boolean, 'cm4 the week''s list, mine first');
  -- the other matchup, by id and by seat
  perform assert_true((contest_matchup(h, wk, m2) -> 'matchup' ->> 'home')::int = 3, 'cm5 another matchup by id');
  perform assert_true((contest_matchup(h, wk, null, 4) -> 'matchup' ->> 'away')::int = 4, 'cm5b …and by a seat in it');
  -- a board league: self-paired, one squad, the list is every seat with one
  perform probe_as('b'); perform assert_ok(save_contest_entry(g, wk, sq), 'cm7 b saves on the board');
  r := contest_matchup(g, wk);
  perform assert_ok(r, 'cm7b');
  perform assert_true(jsonb_typeof(r -> 'matchup' -> 'away_entry') = 'null' and (r -> 'matchup' ->> 'home')::int = (r -> 'matchup' ->> 'away')::int and jsonb_array_length(r -> 'matchups') = 1, 'cm7c one squad, self-paired');
  -- the Jets kick off: W One (NYJ) unseals for the opponent, the rest stay sealed
  perform probe_as('a');
  update nfl_slate set kickoff = now() - interval '1 hour' where season = '2026' and week = wk and home = 'NYJ';
  r := contest_matchup(h, wk);
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'matchup' -> 'away_entry') e where e ->> 'player_slug' = 'cm-wr1') = 1
                  and (select count(*) from jsonb_array_elements(r -> 'matchup' -> 'away_entry') e where (e ->> 'sealed')::boolean) = 8, 'cm6 a player unseals at his kickoff');
end $$;
-- ── 0512: THE COMMISSIONER WHO ISN'T PLAYING SEES EVERY PICK ─────────────────
-- (cm3b above: a commissioner who plays still sees the other squad sealed.)
do $$
declare r jsonb; h uuid; code text; wk int := 42; sq jsonb;
begin
  perform probe_as('c');
  r := create_contest_league('CM Referee', 'high', 'h2h', 'week', 2, 50000, 'slots', 10, 'Commish', '2026', 0, null, false);
  perform assert_ok(r, 'cr0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  update league set contest_week = wk where id = h;
  -- the commissioner steps out of seat 1: it waits for a player, as an AI seat does
  update league_membership set app_user_id = null, enrolled = false, controller = 'ai' where league_id = h and sleeper_roster_id = 1;
  perform probe_as('a'); perform assert_ok(join_contest(code, 'Ants'), 'cr1 a joins');
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cr1b b joins');
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '3 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '3 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '3 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '3 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj)
    select '2026', wk, slug, name, pos, team, salary, proj from pod_salary where season = '2026' and week = 41 and slug like 'cm-%' on conflict do nothing;
  sq := '{"S1":"cm-qb1","S2":"cm-rb1","S3":"cm-rb2","S4":"cm-wr1","S5":"cm-wr2","S6":"cm-wr3","S7":"cm-te1","S8":"cm-k1","S9":"cm-d1"}';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled');
  perform probe_as('a'); perform assert_ok(save_contest_entry(h, wk, sq), 'cr2 a saves');
  perform probe_as('b'); perform assert_ok(save_contest_entry(h, wk, sq), 'cr2b b saves');
  -- nothing has kicked off; the commissioner reads the matchup
  perform probe_as('c');
  r := contest_matchup(h, wk);
  perform assert_ok(r, 'cr3 the commissioner reads it');
  perform assert_true(r ->> 'me' is null, 'cr3b …holding no seat');
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'matchup' -> 'home_entry') e where e ->> 'player_slug' is not null) = 9
                  and (select count(*) from jsonb_array_elements(r -> 'matchup' -> 'away_entry') e where e ->> 'player_slug' is not null) = 9,
                  'cr4 every pick on both sides is open to them before kickoff');
  -- a player in it still sees the other side sealed
  perform probe_as('b');
  r := contest_matchup(h, wk);
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'matchup' -> 'home_entry') e where (e ->> 'sealed')::boolean) = 9, 'cr5 a player still sees the other squad sealed');
end $$;
-- ── 0513: ONE MATCHUP, FOR ANYONE WITH THE LINK ───────────────────────────────
do $$
declare r jsonb; h uuid; mid uuid; wk int := 42; other uuid;
begin
  select id into h from league where name = 'CM Referee' order by created_at desc limit 1;
  select id into mid from matchup where league_id = h and week = wk limit 1;
  update nfl_slate set kickoff = now() + interval '3 days' where season = '2026' and week = wk;
  perform set_config('app.uid', '', false); perform set_config('app.email', '', false);   -- signed out
  r := public_contest_matchup(mid);
  perform assert_ok(r, 'pm1 a signed-out reader gets the matchup');
  perform assert_true(r ->> 'home_team' = 'Ants' or r ->> 'away_team' = 'Ants', 'pm1b with its team names');
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'home_entry') e where (e ->> 'sealed')::boolean) = 9
                  and (select count(*) from jsonb_array_elements(r -> 'away_entry') e where (e ->> 'sealed')::boolean) = 9
                  and r -> 'names' = '{}'::jsonb, 'pm2 before kickoff every pick is sealed, and no name leaves');
  update nfl_slate set kickoff = now() - interval '1 hour' where season = '2026' and week = wk and home = 'NYJ';
  r := public_contest_matchup(mid);
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'home_entry') e where e ->> 'player_slug' = 'cm-wr1') = 1
                  and (select count(*) from jsonb_array_elements(r -> 'home_entry') e where (e ->> 'sealed')::boolean) = 8
                  and r -> 'names' -> 'cm-wr1' ->> 'name' = 'W One', 'pm3 a player turns at his kickoff, named');
  perform assert_true(not exists (select 1 from jsonb_array_elements(coalesce(r -> 'state' -> 'slots', '[]'::jsonb)) x where x ? 'slug' or x ? 'player_slug'), 'pm4 the score rows carry no player id');
  update league set settings_json = settings_json || '{"public_api": false}' where id = h;
  perform assert_true(not coalesce((public_contest_matchup(mid) ->> 'ok')::boolean, false), 'pm5 a league that turned public reads off is not served');
  update league set settings_json = settings_json - 'public_api' where id = h;
  select m.id into other from matchup m join league l on l.id = m.league_id where not _is_contest(l) limit 1;
  if other is not null then perform assert_true(not coalesce((public_contest_matchup(other) ->> 'ok')::boolean, false), 'pm6 only contest matchups'); end if;
end $$;
select 'ALL CONTEST-MATCHUP PROBES PASSED' as result;
