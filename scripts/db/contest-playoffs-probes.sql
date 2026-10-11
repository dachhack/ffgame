-- 0476 contest-playoffs probes — a season head-to-head contest league plays
-- the classic bracket.
--
--   • the classic defaults apply (four teams from week 15); a board league
--     and a one-week league are refused the setting;
--   • the worker's auto poke books round 1 from the regular-season
--     standings once that season is final, and never twice;
--   • a finished round advances; the title crowns a champion;
--   • the regular-season standings (contest_board) stop at the bracket and
--     MY WEEKS names the game; the rules lock once underway.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', case when u = '' then '' else '00000000-0000-0000-0000-00000000000' || u end, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; h uuid; g uuid; wk1 uuid; code text; st jsonb; rows jsonb; champ int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  perform probe_as('a');

  -- ══ the leagues ══
  r := create_contest_league('CP H2H', 'high', 'h2h', 'season', 4, 50000);
  perform assert_ok(r, 'cp0 a four-seat head-to-head league'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('CP Board', 'high', 'board', 'season', 12, 50000);
  perform assert_ok(r, 'cp0b a leaderboard league'); g := (r ->> 'league_id')::uuid;
  r := create_contest_league('CP Week', 'high', 'h2h', 'week', 4, 50000);
  perform assert_ok(r, 'cp0c a one-week league'); wk1 := (r ->> 'league_id')::uuid;
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cp0d b takes seat 2'); perform probe_as('a');

  -- ══ the rules ══
  st := playoff_state(h);
  perform assert_true((st ->> 'playoff_teams')::int = 4 and (st ->> 'playoff_start_week')::int = 15, 'cp1 the classic defaults: four teams from week 15');
  perform assert_err(set_playoff_rules(g, 2, 6), 'head-to-head', 'cp2 a leaderboard league plays no bracket');
  perform assert_err(set_playoff_rules(wk1, 2, 6), 'head-to-head', 'cp2b nor a one-week league');
  perform assert_ok(set_playoff_rules(h, 4, 6), 'cp3 four teams from week 6');
  perform assert_err(set_playoff_rules(h, 6, 6), 'fit the league', 'cp3b six teams do not fit four seats');

  -- ══ the regular season: weeks 4 and 5 by hand ══
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (h, 4, 1, 2, 'final', 120, 100), (h, 4, 3, 4, 'final', 90, 95),
    (h, 5, 3, 1, 'final', 110, 130), (h, 5, 4, 2, 'final', 80, 80);
  -- the classic seeding rule: wins, then points for (seat 3 out-scored seat 2)
  perform assert_true(jsonb_path_query_array(league_standings(h), '$[*].roster_id') = '[1, 4, 3, 2]'::jsonb, 'cp4 seeded by the regular season: 1 (2–0), 4 (1–0–1), then points for');

  -- ══ the worker books round 1 (service role: no auth.uid) ══
  perform probe_as('');
  r := generate_playoffs(h, null, true);
  perform assert_ok(r, 'cp5 the auto poke books round 1 once the regular season is final');
  perform assert_true(r -> 'bracket' -> 'seeds' = '[1, 4, 3, 2]'::jsonb, 'cp5b the top four, in standings order');
  perform assert_true((select count(*) from matchup where league_id = h and is_playoff and week = 6 and not is_consolation) = 2, 'cp5c two semifinals at week 6');
  perform assert_true((select string_agg(home_roster_id || '-' || away_roster_id, ',' order by bracket_pos) from matchup where league_id = h and is_playoff and week = 6 and not is_consolation) = '1-2,4-3', 'cp5d 1 v 4 and 2 v 3 by seed');
  r := generate_playoffs(h, null, true);
  perform assert_true(coalesce((r ->> 'generated')::boolean, true) = false, 'cp6 booking again is a no-op');

  -- ══ a finished round advances; the title crowns ══
  update matchup set status = 'final', home_final = 100, away_final = 90 where league_id = h and is_playoff and week = 6;
  perform assert_ok(advance_playoffs(h), 'cp7 advance after round 1');
  perform assert_true((select count(*) from matchup where league_id = h and is_playoff and week = 7 and not is_consolation and playoff_label = 'Championship') = 1, 'cp7b the final at week 7');
  perform assert_true((select home_roster_id || '-' || away_roster_id from matchup where league_id = h and is_playoff and week = 7 and not is_consolation) = '1-4', 'cp7c the two home winners meet');
  update matchup set status = 'final', home_final = 150, away_final = 140 where league_id = h and is_playoff and week = 7;
  r := advance_playoffs(h);
  perform assert_true((r ->> 'champion')::int = 1, 'cp8 seat 1 is champion');

  -- ══ what the members see ══
  perform probe_as('b');
  rows := contest_board(h) -> 'season' -> 'rows';
  perform assert_true((select (x ->> 'wins')::int from jsonb_array_elements(rows) x where (x ->> 'roster_id')::int = 1) = 2
                  and (select (x ->> 'weeks')::int from jsonb_array_elements(rows) x where (x ->> 'roster_id')::int = 1) = 2,
                  'cp9 the regular-season record stops at the bracket (2–0 over 2 weeks, not 4–0)');
  rows := bullseye_my_weeks(h) -> 'weeks';
  perform assert_true((select x ->> 'label' from jsonb_array_elements(rows) x where (x ->> 'week')::int = 6) = 'Semifinal'
                  and (select (x ->> 'playoff')::boolean from jsonb_array_elements(rows) x where (x ->> 'week')::int = 7), 'cp10 MY WEEKS names the game');
  st := playoff_state(h);
  perform assert_true(st ->> 'champion_team' is not null and jsonb_array_length(st -> 'matchups') >= 3, 'cp11 playoff_state carries the bracket and the champion');
  perform probe_as('a');
  perform assert_err(set_playoff_rules(h, 2, 6), 'underway', 'cp12 the rules lock once underway');
end $$;

select 'ALL CONTEST-PLAYOFFS PROBES PASSED' as result;
