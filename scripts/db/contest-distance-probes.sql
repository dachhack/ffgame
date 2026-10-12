-- 0482 contest-distance probes: a one-team-total Bullseye week scores its
-- distance from the target and the lowest wins — the classic winner rule,
-- the contest board's week ranks, records and season rows, MY WEEKS, and the
-- conversion of finals stamped as rings.
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
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;
do $$
declare r jsonb; h uuid; s uuid; code text; scode text; wk int := 43; m1 uuid; m2 uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  -- a one-team-total league (h2h) and a per-spot one (board)
  r := create_contest_league('TD Total', 'bullseye', 'h2h', 'season', 4, 50000, 'total', 10); perform assert_ok(r, 'td0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('TD Slots', 'bullseye', 'board', 'season', 12, 50000, 'slots', 10); perform assert_ok(r, 'td0b'); s := (r ->> 'league_id')::uuid; scode := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'td0c'); perform assert_ok(join_contest(scode, 'Bees S'), 'td0d');
  perform assert_true(league_lower_wins(h) and not league_lower_wins(s), 'td1 lower wins on the total league only');
  perform assert_true(_contest_lower_wins((select l from league l where l.id = h)) and not _contest_lower_wins((select l from league l where l.id = s)), 'td1b …and the contest helper agrees');
  perform assert_true(golf_beats(h, 12.3, 30.1) and not golf_beats(h, 30.1, 12.3) and golf_beats(s, 30.1, 12.3), 'td1c the classic winner rule reads it');
  -- a final week stamped as distances: seat 1 lands 12.3 off, seat 2 30.1 off
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() - interval '3 days') on conflict do nothing;
  update nfl_slate set kickoff = now() - interval '3 days' where season = '2026' and week = wk;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values (h, wk, 1, 2, 'final', 12.3, 30.1) returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values (h, wk, 3, 4, 'final', 45.0, 8.8) returning id into m2;
  perform probe_as('a');
  r := contest_board(h, wk); perform assert_ok(r, 'td2 the week board');
  perform assert_true((r -> 'rows' -> 0 ->> 'roster_id')::int = 4 and (r -> 'rows' -> 1 ->> 'roster_id')::int = 1 and (r -> 'rows' -> 3 ->> 'roster_id')::int = 3, 'td2b the week ranks the smallest distance first');
  -- (the season rows are the enrolled seats: a's 1 and b's 2; 3 and 4 are empty seats the week still paired)
  perform assert_true((select (x ->> 'wins')::int from jsonb_array_elements(r -> 'season' -> 'rows') x where (x ->> 'roster_id')::int = 1) = 1
                  and (select (x ->> 'losses')::int from jsonb_array_elements(r -> 'season' -> 'rows') x where (x ->> 'roster_id')::int = 2) = 1, 'td2c the records: the lower distance won');
  perform assert_true((r -> 'season' -> 'rows' -> 0 ->> 'roster_id')::int = 1, 'td2d the season ranks by record, then the smaller total');
  r := bullseye_my_weeks(h); perform assert_ok(r, 'td3 my weeks');
  perform assert_true((r -> 'weeks' -> 0 ->> 'rank')::int = 2 and (r -> 'weeks' -> 0 ->> 'ring')::numeric = 12.3, 'td3b my week ranks second of four by distance');
  -- THE CONVERSION: finals stamped as rings read back as distances
  update matchup set home_final = 77.7, away_final = 59.9 where id = m1;   -- rings at span 90: 12.3 and 30.1 off
  update matchup set home_final = 135.0, away_final = 0 where id = m2;     -- 135 = 2×90 − 45 (past the dead-on bonus); 0 = a miss at the span
  perform assert_true(_bullseye_total_to_distance(h) = 2, 'td4 two finals converted');
  perform assert_true((select home_final from matchup where id = m1) = 12.3 and (select away_final from matchup where id = m1) = 30.1, 'td4b ring → distance');
  perform assert_true((select home_final from matchup where id = m2) = 45.0 and (select away_final from matchup where id = m2) = 90, 'td4c past the bonus, and a miss at the span');
  perform assert_true(_bullseye_total_to_distance(s) = 0, 'td4d a per-spot league is left alone');
end $$;
select 'ALL CONTEST-DISTANCE PROBES PASSED';
