-- 0483 contest-coin probes: the wallet and the week's earn on a contest
-- league — the rule, the seed, the lines a final week pays (built, streak,
-- bargain, call, dead-on, heartbreaker / loss, bottom half, catch-up), the
-- cap, and that a second settle pays nothing twice.
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
  perform set_config('app.uid', case when u is null then '' else '00000000-0000-0000-0000-00000000000' || u end, false);
  perform set_config('app.email', coalesce(u, 'x') || '@test.dev', false);
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'), ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;
create or replace function dc_line(p_league uuid, p_roster int, p_week int, p_reason text) returns numeric language sql as $$
  select delta from coin_ledger where league_id = p_league and roster_id = p_roster and week = p_week and reason = p_reason;
$$;
create or replace function dc_bal(p_league uuid, p_roster int) returns numeric language sql as $$
  select coalesce((select coins from team_wallet where league_id = p_league and roster_id = p_roster), 0);
$$;
do $$
declare r jsonb; h uuid; g uuid; code text; gcode text; wk int := 44; sq jsonb; m1 uuid; m2 uuid; g1 uuid; g2 uuid; g3 uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'), ('00000000-0000-0000-0000-00000000000c', 'c@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('DC H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'dc0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('DC Board', 'high', 'board', 'season', 12, 50000); perform assert_ok(r, 'dc0b'); g := (r ->> 'league_id')::uuid; gcode := r ->> 'invite_code';
  -- THE RULE: off by default; settling an off league is refused; turning it on seeds the seats in
  perform assert_true(not (_bullseye_info((select l from league l where l.id = h)) ->> 'coin')::boolean, 'dc1 coin is off by default');
  perform assert_err(contest_settle_coin(h, wk), 'dc1b an off league settles nothing');
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'dc1c b joins before coin'); perform assert_ok(join_contest(gcode, 'Bees B'), 'dc1d');
  perform probe_as('a');
  r := set_contest_rules(h, null, null, null, null, null, null, null, null, true); perform assert_ok(r, 'dc1e coin on');
  perform assert_true((r -> 'bullseye' ->> 'coin')::boolean and dc_bal(h, 1) = 100 and dc_bal(h, 2) = 100, 'dc1f both seats seeded 100');
  perform assert_ok(set_contest_rules(g, null, null, null, null, null, null, null, null, true), 'dc1g coin on the board');
  perform probe_as('c'); perform assert_ok(join_contest(code, 'Sees'), 'dc1h c joins after coin'); perform assert_true(dc_bal(h, 3) = 100, 'dc1i …and is seeded on the way in');
  perform assert_ok(join_contest(gcode, 'Sees B'), 'dc1j');
  perform assert_true((select count(*) from pg_proc where proname = 'set_contest_rules') = 1, 'dc1k one overload');
  -- THE WEEK: a board of three (a=1, b=2, c=3) and an h2h of 1 v 2, 3 v 4 (4 empty)
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '2 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '2 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '2 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj) values
    ('2026', wk, 'dc-qb1', 'Q One', 'QB', 'PHI', 7000, 20), ('2026', wk, 'dc-qb2', 'Q Two', 'QB', 'SF', 6000, 18), ('2026', wk, 'dc-qb3', 'Q Three', 'QB', 'KC', 4000, 12),
    ('2026', wk, 'dc-rb1', 'R One', 'RB', 'PHI', 6000, 14), ('2026', wk, 'dc-rb2', 'R Two', 'RB', 'SF', 5500, 13), ('2026', wk, 'dc-rb3', 'R Three', 'RB', 'KC', 3500, 6),
    ('2026', wk, 'dc-wr1', 'W One', 'WR', 'NYJ', 6000, 14), ('2026', wk, 'dc-wr2', 'W Two', 'WR', 'SF', 5500, 13), ('2026', wk, 'dc-wr3', 'W Three', 'WR', 'KC', 5000, 12), ('2026', wk, 'dc-wr4', 'W Four', 'WR', 'BUF', 3000, 5),
    ('2026', wk, 'dc-te1', 'T One', 'TE', 'PHI', 4000, 9), ('2026', wk, 'dc-k1', 'K One', 'K', 'PHI', 3000, 8), ('2026', wk, 'dc-d1', 'D One', 'DEF', 'SF', 3000, 7)
    on conflict do nothing;
  sq := '{"S1":"dc-qb1","S2":"dc-rb1","S3":"dc-rb3","S4":"dc-wr1","S5":"dc-wr2","S6":"dc-wr3","S7":"dc-te1","S8":"dc-k1","S9":"dc-d1"}';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled') returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 3, 4, 'scheduled') returning id into m2;
  -- a and b save their own squads before kickoff (a swap log each); c never does (the CPU's build logs nothing)
  perform probe_as('a'); perform assert_ok(save_contest_entry(h, wk, sq), 'dc2 a saves'); perform assert_ok(save_contest_entry(g, wk, sq), 'dc2b a saves on the board');
  perform probe_as('b'); perform assert_ok(save_contest_entry(h, wk, sq), 'dc2c b saves'); perform assert_ok(save_contest_entry(g, wk, sq), 'dc2d');
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values (h, wk, 3, (select starters_json from sleeper_lineup where league_id = h and week = wk and roster_id = 1)) on conflict do nothing;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values (g, wk, 3, (select starters_json from sleeper_lineup where league_id = g and week = wk and roster_id = 1)) on conflict do nothing;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (g, wk, 3, 3, 'scheduled') returning id into g3;
  select id into g1 from matchup where league_id = g and week = wk and home_roster_id = 1; select id into g2 from matchup where league_id = g and week = wk and home_roster_id = 2;
  -- (the probe moves the kickoffs into the past below; the saves happened before them)
  update contest_build set at = now() - interval '4 days' where league_id in (h, g) and week = wk;
  -- the week plays out and goes final: a 120 (R Three, the $3.5k back, posts 14 on a 6 projection; K One, the cheapest spot, outscores Q One, the priciest)
  update nfl_slate set kickoff = now() - interval '3 days' where season = '2026' and week = wk;
  update matchup set status = 'final', home_final = 120, away_final = 112 where id = m1;     -- b loses by 8: a heartbreaker
  update matchup set status = 'final', home_final = 95, away_final = 0 where id = m2;        -- c beats the empty seat
  update matchup set status = 'final', home_final = 120, away_final = 120 where id = g1;
  update matchup set status = 'final', home_final = 112, away_final = 112 where id = g2;
  update matchup set status = 'final', home_final = 95, away_final = 95 where id = g3;      -- c: the bottom of three
  insert into matchup_state (matchup_id, game_window, home_score, away_score, slot_scores) values
    (m1, 'wk', 120, 112, '[{"side":"home","slot":"S1","score":10},{"side":"home","slot":"S2","score":15},{"side":"home","slot":"S3","score":14},{"side":"home","slot":"S4","score":14},{"side":"home","slot":"S5","score":13},{"side":"home","slot":"S6","score":12},{"side":"home","slot":"S7","score":9},{"side":"home","slot":"S8","score":26},{"side":"home","slot":"S9","score":7},
                            {"side":"away","slot":"S1","score":20},{"side":"away","slot":"S2","score":14},{"side":"away","slot":"S3","score":6},{"side":"away","slot":"S4","score":14},{"side":"away","slot":"S5","score":13},{"side":"away","slot":"S6","score":12},{"side":"away","slot":"S7","score":9},{"side":"away","slot":"S8","score":8},{"side":"away","slot":"S9","score":7}]'),
    (m2, 'wk', 95, 0, '[]'),
    (g1, 'wk', 120, 120, '[{"side":"home","slot":"S1","score":10},{"side":"home","slot":"S3","score":14},{"side":"home","slot":"S8","score":26}]'),
    (g2, 'wk', 112, 112, '[]'), (g3, 'wk', 95, 95, '[]')
    on conflict (matchup_id, game_window) do update set slot_scores = excluded.slot_scores, home_score = excluded.home_score, away_score = excluded.away_score;
  -- SETTLE the head-to-head week (as the worker: no auth)
  perform probe_as(null);
  r := contest_settle_coin(h, wk); perform assert_ok(r, 'dc3 settled');
  perform assert_true((r ->> 'seats')::int = 3, 'dc3b three human seats');
  perform assert_true(dc_line(h, 1, wk, 'built') = 40 and dc_line(h, 2, wk, 'built') = 40 and dc_line(h, 3, wk, 'built') is null, 'dc4 built: a and b saved their own; c did not');
  perform assert_true(dc_line(h, 1, wk, 'bargain') = 15 and dc_line(h, 2, wk, 'bargain') is null, 'dc4b the bargain: R Three doubled his 6 for a');
  perform assert_true(dc_line(h, 1, wk, 'call') = 10 and dc_line(h, 2, wk, 'call') is null, 'dc4c the call: a''s cheapest spot beat the priciest');
  perform assert_true(dc_line(h, 2, wk, 'heartbreaker') = 25 and dc_line(h, 1, wk, 'heartbreaker') is null and dc_line(h, 1, wk, 'loss') is null, 'dc4d the heartbreaker pays the loser by under 10; the winner nothing');
  perform assert_true(dc_line(h, 3, wk, 'loss') is null and dc_line(h, 3, wk, 'heartbreaker') is null, 'dc4e c won: nothing');
  perform assert_true(dc_line(h, 1, wk, 'catchup') is null, 'dc4f no catch-up on the first week');
  perform assert_true(dc_line(h, 1, wk, 'cap') = -15 and dc_bal(h, 1) = 150, 'dc4g the cap: 100 + 40 + 15 + 10 = 165 burns to 150');
  perform assert_true(dc_bal(h, 2) = 165 - 0 - 0 or dc_bal(h, 2) = 150, 'dc4h b: 100 + 40 + 25 = 165 → capped');
  perform assert_true(dc_line(h, 2, wk, 'cap') = -15 and dc_bal(h, 2) = 150, 'dc4i …to 150');
  r := contest_settle_coin(h, wk); perform assert_true((r ->> 'lines')::int = 0 and dc_bal(h, 1) = 150, 'dc5 a second settle pays nothing twice');
  -- the board: the bottom half pays
  r := contest_settle_coin(g, wk); perform assert_ok(r, 'dc6 the board settled');
  perform assert_true(dc_line(g, 3, wk, 'bottomhalf') = 20 and dc_line(g, 1, wk, 'bottomhalf') is null, 'dc6b the bottom of three is paid; the top is not');
  perform assert_true(dc_line(g, 2, wk, 'bottomhalf') is null, 'dc6c the middle of three sits in the top half');
  -- the streak and the catch-up, next week
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk + 1, 'PHI', 'DAL', '', now() - interval '1 day') on conflict do nothing;
  update nfl_slate set kickoff = now() - interval '1 day' where season = '2026' and week = wk + 1;
  insert into contest_build (league_id, week, roster_id, by_user, at) values (h, wk + 1, 1, '00000000-0000-0000-0000-00000000000a', now() - interval '2 days');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values (h, wk + 1, 1, 3, 'final', 50, 140), (h, wk + 1, 2, 4, 'final', 100, 0);
  r := contest_settle_coin(h, wk + 1); perform assert_ok(r, 'dc7 week two settled');
  perform assert_true(dc_line(h, 1, wk + 1, 'built') = 40 and dc_line(h, 1, wk + 1, 'streak') = 5, 'dc7b the streak: a built two weeks running, +5');
  perform assert_true(dc_line(h, 1, wk + 1, 'loss') = 15, 'dc7c a lost by 90: the plain loss line');
  perform assert_true(dc_line(h, 2, wk + 1, 'catchup') is null and dc_line(h, 3, wk + 1, 'catchup') is null, 'dc7d c (235) and b (212) sit in the top half of the season');
  perform assert_true(dc_line(h, 1, wk + 1, 'catchup') = 10, 'dc7e a (170) sits below the median: catch-up pays');
  -- MY TEAM reads the wallet
  perform probe_as('a');
  r := bullseye_my_weeks(h); perform assert_ok(r, 'dc8 my weeks');
  perform assert_true((r -> 'wallet' ->> 'coins')::numeric = dc_bal(h, 1) and jsonb_array_length(r -> 'wallet' -> 'lines') >= 6, 'dc8b the wallet and its lines ride MY WEEKS');
  perform assert_true((contest_state(h, wk) ->> 'wallet')::numeric = dc_bal(h, 1) and (contest_state(h, wk) ->> 'coin')::boolean, 'dc8c contest_state carries the seat''s wallet');
  perform assert_true(jsonb_typeof(bullseye_my_weeks(g) -> 'wallet') = 'object', 'dc8d …and the board league''s');
end $$;
-- ── THE WEEKLY DRAFT SETUP (0488): coin from creation, and a one-week league's week ──
do $$
declare r jsonb; l uuid; wk int;
begin
  perform probe_as('a');
  wk := (contest_week_now('2026') ->> 'week')::int;
  perform assert_true(wk is not null, 'ws0 the form can ask which week it is');
  -- coin from the start: the setting is on and the creator's wallet is seeded
  r := create_contest_league('WS Coin', 'high', 'board', 'season', 12, 50000, 'slots', 10, null, '2026', 0, null, true);
  perform assert_ok(r, 'ws1 a league with coin from creation'); l := (r ->> 'league_id')::uuid;
  perform assert_true((select settings_json ->> 'coin' from league where id = l) = 'true', 'ws2 coin is on');
  perform assert_true(jsonb_typeof(bullseye_my_weeks(l) -> 'wallet') = 'object', 'ws3 …and the creator has a wallet');
  -- a one-week league names its week: this week or later, through 18
  r := create_contest_league('WS Week', 'high', 'board', 'week', 12, 50000, 'slots', 10, null, '2026', 0, least(wk + 1, 18), false);
  perform assert_ok(r, 'ws4 a one-week league for a later week'); l := (r ->> 'league_id')::uuid;
  perform assert_true((select contest_week from league where id = l) = least(wk + 1, 18), 'ws5 …plays that week');
  r := create_contest_league('WS Past', 'high', 'board', 'week', 12, 50000, 'slots', 10, null, '2026', 0, wk - 1, false);
  perform assert_err(r, 'ws6 a week already gone is refused');
  r := create_contest_league('WS Far', 'high', 'board', 'week', 12, 50000, 'slots', 10, null, '2026', 0, 19, false);
  perform assert_err(r, 'ws7 week 19 is refused');
  r := create_contest_league('WS Now', 'high', 'board', 'week', 12, 50000, 'slots', 10, null, '2026', 0, null, false);
  perform assert_ok(r, 'ws8 no week named = this week'); l := (r ->> 'league_id')::uuid;
  perform assert_true((select contest_week from league where id = l) = wk, 'ws9 …which is this one');
  perform assert_true((select settings_json ->> 'coin' from league where id = l) is null, 'ws10 coin off unless asked');
end $$;

-- ── THE COIN RULES (0489): the suite, a league's overrides, the allowance, the ceiling off, a purse by hand ──
do $$
declare r jsonb; h uuid; wk int := 46; m1 uuid; m2 uuid; b1 numeric; b2 numeric; n int;   -- 44 and 45 are dc's
begin
  perform probe_as('a');
  select id into h from league where name = 'DC H2H' order by created_at desc limit 1;
  -- the standard suite reads the same on both sides
  r := contest_coin_rules(h); perform assert_ok(r, 'cr0 a member reads the rules');
  perform assert_true(r -> 'rules' = r -> 'defaults', 'cr1 untouched = the standard suite');
  perform assert_true((r -> 'defaults' ->> 'built')::int = 40 and (r -> 'defaults' ->> 'cap')::int = 150 and (r -> 'defaults' ->> 'allowance')::int = 0, 'cr2 the standard numbers');
  -- the gate and the shape
  perform probe_as('b'); perform assert_err(set_contest_coin_rules(h, '{"built": 50}'), 'cr3 a member cannot set them'); perform probe_as('a');
  perform assert_err(set_contest_coin_rules(h, '{"winning": 50}'), 'cr4 not an event');
  perform assert_err(set_contest_coin_rules(h, '{"built": -5}'), 'cr5 not a negative');
  r := set_contest_coin_rules(h, '{"built": 50, "bargain": 0, "allowance": 10, "cap": 0, "streak": 7, "streak_cap": 100}');
  perform assert_ok(r, 'cr6 the commissioner sets them');
  perform assert_true((r -> 'rules' ->> 'built')::int = 50 and (r -> 'rules' ->> 'bargain')::int = 0 and (r -> 'rules' ->> 'loss')::int = 15, 'cr7 overrides over the suite');
  perform assert_true(exists (select 1 from league_message where league_id = h and kind = 'txn' and txn ->> 'kind' = 'coin_rules' and body like '%built ◎50%' and body like '%bargain off%'), 'cr8 the league hears what differs');
  -- a fresh week under the new rules: a and b build (a has built 44 and 45 too; b only 44); a beats b by 10
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() - interval '3 days') on conflict do nothing;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values (h, wk, 1, 2, 'final', 100, 90) returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values (h, wk, 3, 4, 'final', 80, 0) returning id into m2;
  insert into contest_build (league_id, week, roster_id, by_user, at) values (h, wk, 1, probe_uid('a'), now() - interval '4 days'), (h, wk, 2, probe_uid('b'), now() - interval '4 days') on conflict do nothing;
  b1 := dc_bal(h, 1); b2 := dc_bal(h, 2);
  r := contest_settle_coin(h, wk); perform assert_ok(r, 'cr9 the week settles');
  perform assert_true((select delta from coin_ledger where league_id = h and roster_id = 1 and week = wk and reason = 'built') = 50, 'cr10 built pays the league''s 50');
  perform assert_true((select delta from coin_ledger where league_id = h and roster_id = 1 and week = wk and reason = 'streak') = 14, 'cr11 the streak pays 7 a week (a: two weeks in a row)');
  perform assert_true(not exists (select 1 from coin_ledger where league_id = h and roster_id = 2 and week = wk and reason = 'streak'), 'cr11b b missed 45, no streak');
  perform assert_true((select delta from coin_ledger where league_id = h and roster_id = 1 and week = wk and reason = 'allowance') = 10, 'cr12 the allowance pays everyone…');
  perform assert_true((select delta from coin_ledger where league_id = h and roster_id = 3 and week = wk and reason = 'allowance') = 10, 'cr13 …the seat that never built too');
  perform assert_true((select delta from coin_ledger where league_id = h and roster_id = 2 and week = wk and reason = 'loss') = 15, 'cr14 a loss by 10 pays the standard 15');
  perform assert_true(not exists (select 1 from coin_ledger where league_id = h and week = wk and reason = 'cap'), 'cr15 no ceiling, no burn');
  perform assert_true(dc_bal(h, 1) = b1 + (select sum(delta) from coin_ledger where league_id = h and roster_id = 1 and week = wk)
    and (select sum(delta) from coin_ledger where league_id = h and roster_id = 1 and week = wk) >= 74, 'cr16 a''s purse is the week''s lines (catch-up may ride along): ' || dc_bal(h, 1) || ' from ' || b1);
  -- the purse by hand
  perform probe_as('b'); perform assert_err(commish_adjust_contest_wallet(h, 2, 25, 'nice try'), 'cr17 a member cannot edit a purse'); perform probe_as('a');
  perform assert_err(commish_adjust_contest_wallet(h, 2, 0, null), 'cr18 zero is nothing');
  b2 := dc_bal(h, 2);
  r := commish_adjust_contest_wallet(h, 2, 25, 'for the heartbreak'); perform assert_ok(r, 'cr19 the commissioner gives 25');
  perform assert_true((r ->> 'coins')::numeric = b2 + 25 and dc_bal(h, 2) = b2 + 25, 'cr20 …and the purse shows it');
  perform assert_true(exists (select 1 from league_message where league_id = h and txn ->> 'kind' = 'coin' and body like '%gave%◎25%for the heartbreak%'), 'cr21 the league hears it');
  r := commish_adjust_contest_wallet(h, 2, -5, null); perform assert_ok(r, 'cr22 …and takes 5'); perform assert_true(dc_bal(h, 2) = b2 + 20, 'cr23 net 20');
  r := contest_wallets(h); perform assert_ok(r, 'cr24 every purse');
  select count(*) into n from jsonb_array_elements(r -> 'rows'); perform assert_true(n >= 3, 'cr25 …one row a seat');
  -- back to standard, and the seed follows the rules
  perform assert_ok(set_contest_coin_rules(h, '{}'), 'cr26 standard again');
  perform assert_true(contest_coin_rules(h) -> 'rules' = _contest_coin_defaults(), 'cr27 …fully');
  r := create_contest_league('CR Seedless', 'high', 'board', 'season', 12, 50000, 'slots', 10, null, '2026', 0, null, true); perform assert_ok(r, 'cr28');
  perform assert_ok(set_contest_coin_rules((r ->> 'league_id')::uuid, '{"seed": 0}'), 'cr29 seed off');
  perform probe_as('c'); perform assert_ok(join_contest(r ->> 'invite_code', 'Seedless C'), 'cr30 c joins'); perform assert_true(dc_bal((r ->> 'league_id')::uuid, 2) = 0, 'cr31 …and is seeded nothing');
  perform probe_as('a');
end $$;

select 'ALL CONTEST-COIN PROBES PASSED';
