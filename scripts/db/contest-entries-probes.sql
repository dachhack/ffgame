-- 0481 contest-entries probes: entries per member on a leaderboard league
-- (the rule, another seat under it, head-to-head stays one), and the seat
-- through contest_state / save_contest_entry / contest_swaps /
-- bullseye_my_weeks / contest_matchup / the board.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function assert_err(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected an error, got %', msg, r; end if; end $$;
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
declare r jsonb; g uuid; h uuid; gcode text; hcode text; wk int := 42; sq jsonb; sq2 jsonb; rid2 int; rid3 int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'), ('00000000-0000-0000-0000-00000000000c', 'c@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('ME Board', 'high', 'board', 'season', 12, 50000); perform assert_ok(r, 'me0'); g := (r ->> 'league_id')::uuid; gcode := r ->> 'invite_code';
  r := create_contest_league('ME H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'me0b'); h := (r ->> 'league_id')::uuid; hcode := r ->> 'invite_code';
  -- THE RULE: one by default; 1–50; head-to-head stays one
  perform assert_true((_bullseye_info((select l from league l where l.id = g)) ->> 'max_entries')::int = 1, 'me1 one entry per member by default');
  perform assert_err(set_contest_rules(g, null, null, null, null, null, null, null, 0), 'me1b 0 is refused');
  perform assert_err(set_contest_rules(g, null, null, null, null, null, null, null, 51), 'me1c 51 is refused');
  perform assert_err(set_contest_rules(h, null, null, null, null, null, null, null, 2), 'me1d head-to-head stays one');
  r := set_contest_rules(g, null, null, null, null, null, null, null, 3); perform assert_ok(r, 'me1e three on the board');
  perform assert_true((r -> 'bullseye' ->> 'max_entries')::int = 3 and (r -> 'bullseye' ->> 'my_entries')::int = 1, 'me1f the info carries the rule and my count');
  perform assert_true((select count(*) from pg_proc where proname = 'set_contest_rules') = 1, 'me1g one overload');
  -- ANOTHER ENTRY: a seated member, under the rule
  perform assert_err(add_contest_entry(h, 'Second'), 'me2 head-to-head: one entry');
  perform probe_as('b');
  perform assert_err(add_contest_entry(g, 'Bees Two'), 'me2b join first');
  perform assert_ok(join_contest(gcode, 'Bees'), 'me2c b joins');
  r := add_contest_entry(g, 'Bees Two'); perform assert_ok(r, 'me2d a second seat'); rid2 := (r ->> 'roster_id')::int;
  perform assert_true(rid2 = 3 and r ->> 'team' = 'Bees Two', 'me2e the next seat number, its own name');
  r := add_contest_entry(g, null); perform assert_ok(r, 'me2f a third, default name'); rid3 := (r ->> 'roster_id')::int;
  perform assert_true(rid3 = 4 and r ->> 'team' is not null and r ->> 'team' <> 'Bees', 'me2g a default name, not the first seat''s');
  perform assert_err(add_contest_entry(g, 'Bees Four'), 'me2h the fourth is refused');
  perform assert_true((select count(*) from league_membership where league_id = g and app_user_id = '00000000-0000-0000-0000-00000000000b' and enrolled) = 3, 'me2i three seats');
  r := join_contest(gcode, 'again'); perform assert_ok(r, 'me2j joining again');
  perform assert_true((r ->> 'already')::boolean and (r ->> 'roster_id')::int = 2, 'me2k …is the first seat, idempotent');
  perform assert_true((_bullseye_info((select l from league l where l.id = g)) ->> 'my_entries')::int = 3, 'me2l my_entries counts them');
  -- THE SEAT THROUGH THE READS AND THE SAVE
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '3 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '3 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '3 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '3 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj) values
    ('2026', wk, 'me-qb1', 'Q One', 'QB', 'PHI', 7000, 20), ('2026', wk, 'me-qb2', 'Q Two', 'QB', 'SF', 6500, 18), ('2026', wk, 'me-rb1', 'R One', 'RB', 'PHI', 6000, 14), ('2026', wk, 'me-rb2', 'R Two', 'RB', 'SF', 5500, 13),
    ('2026', wk, 'me-wr1', 'W One', 'WR', 'NYJ', 6000, 14), ('2026', wk, 'me-wr2', 'W Two', 'WR', 'SF', 5500, 13), ('2026', wk, 'me-wr3', 'W Three', 'WR', 'KC', 5000, 12),
    ('2026', wk, 'me-te1', 'T One', 'TE', 'PHI', 4000, 9), ('2026', wk, 'me-k1', 'K One', 'K', 'PHI', 3000, 8), ('2026', wk, 'me-d1', 'D One', 'DEF', 'SF', 3000, 7)
    on conflict do nothing;
  sq := '{"S1":"me-qb1","S2":"me-rb1","S3":"me-rb2","S4":"me-wr1","S5":"me-wr2","S6":"me-wr3","S7":"me-te1","S8":"me-k1","S9":"me-d1"}';
  sq2 := '{"S1":"me-qb2","S2":"me-rb1","S3":"me-rb2","S4":"me-wr1","S5":"me-wr2","S6":"me-wr3","S7":"me-te1","S8":"me-k1","S9":"me-d1"}';
  r := contest_state(g, wk); perform assert_ok(r, 'me3 state');
  perform assert_true((r ->> 'roster_id')::int = 2 and jsonb_array_length(r -> 'seats') = 3 and (r ->> 'max_entries')::int = 3, 'me3b my first seat by default, the seats listed');
  r := contest_state(g, wk, '2026', 3); perform assert_true((r ->> 'roster_id')::int = 3 and r ->> 'team' = 'Bees Two', 'me3c the seat asked for');
  r := contest_state(g, wk, '2026', 1); perform assert_true((r ->> 'roster_id')::int = 2, 'me3d a seat that isn''t mine reads as my first');
  r := save_contest_entry(g, wk, sq); perform assert_ok(r, 'me4 save to my first'); perform assert_true((r ->> 'roster_id')::int = 2, 'me4b …seat 2');
  r := save_contest_entry(g, wk, sq2, '2026', 3); perform assert_ok(r, 'me4c save to my second'); perform assert_true((r ->> 'roster_id')::int = 3, 'me4d …seat 3');
  perform assert_err(save_contest_entry(g, wk, sq, '2026', 1), 'me4e a seat that isn''t mine is refused');
  perform assert_true((contest_state(g, wk, '2026', 3) -> 'entry' -> 0 ->> 'player_slug') = 'me-qb2' and (contest_state(g, wk, '2026', 2) -> 'entry' -> 0 ->> 'player_slug') = 'me-qb1', 'me4f each seat keeps its own squad');
  -- SWAPS per seat: seat 3 changes its quarterback; seat 2 did nothing
  perform assert_ok(save_contest_entry(g, wk, sq, '2026', 3), 'me5 seat 3 swaps');
  perform assert_true(jsonb_array_length(contest_swaps(g, wk, 3) -> 'swaps') = 1 and jsonb_array_length(contest_swaps(g, wk, 2) -> 'swaps') = 0 and jsonb_array_length(contest_swaps(g, wk) -> 'swaps') = 0, 'me5b the swaps are the seat''s own');
  -- MY WEEKS per seat
  r := bullseye_my_weeks(g); perform assert_ok(r, 'me6 my weeks'); perform assert_true((r ->> 'roster_id')::int = 2 and jsonb_array_length(r -> 'seats') = 3, 'me6b my first seat, the seats listed');
  r := bullseye_my_weeks(g, 4); perform assert_true((r ->> 'roster_id')::int = 4, 'me6c the seat asked for');
  -- THE MATCHUP: both of my squads are open to me; the list marks every seat of mine
  r := contest_matchup(g, wk); perform assert_ok(r, 'me7 my matchup');
  perform assert_true((r ->> 'me')::int = 2 and (r -> 'matchup' -> 'home_entry' -> 0 ->> 'player_slug') = 'me-qb1', 'me7b my first seat, its squad open');
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'matchups') x where (x ->> 'mine')::boolean) = 2, 'me7c both of my squads are mine in the list');
  r := contest_matchup(g, wk, null, 3); perform assert_true((r ->> 'me')::int = 3 and (r -> 'matchup' -> 'home_entry' -> 0 ->> 'player_slug') is not null, 'me7d my second seat, open too');
  -- THE BOARD: every seat of mine is me; the me row is one of them
  r := contest_board(g, wk); perform assert_ok(r, 'me8 the board');
  perform assert_true((select count(*) from jsonb_array_elements(r -> 'season' -> 'rows') x where (x ->> 'me')::boolean) = 3 and (r -> 'season' -> 'me' ->> 'roster_id')::int in (2, 3, 4), 'me8b three rows of mine on the standings');
  -- a holds one seat still
  perform probe_as('a');
  perform assert_true(jsonb_array_length(contest_state(g, wk) -> 'seats') = 1, 'me9 a has one seat');
end $$;
select 'ALL CONTEST-ENTRIES PROBES PASSED';
