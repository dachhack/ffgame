-- 0478 swap-history probes.
--   • the first save is no swap; a change to a saved squad is a row per spot;
--   • the commissioner's fix logs as 'commish';
--   • a member reads their own any time; another seat's once the week unseals; the commissioner any time.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r; end if;
end $$;
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
declare r jsonb; h uuid; code text; wk int; sq jsonb; sq2 jsonb;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('SW League', 'high', 'h2h', 'season', 4, 50000);
  perform assert_ok(r, 'sw0 a contest league'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'sw0b b takes seat 2');
  -- a week with a priced board, in the future (so nothing is locked): week 40
  wk := 40;
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '3 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '3 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '3 days')
    on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '3 days' where season = '2026' and week = wk;   -- re-runnable: a past run moved a kickoff
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj) values
    ('2026', wk, 'sw-qb1', 'Q One', 'QB', 'PHI', 7000, 20), ('2026', wk, 'sw-qb2', 'Q Two', 'QB', 'SF', 6000, 18),
    ('2026', wk, 'sw-rb1', 'R One', 'RB', 'PHI', 6000, 14), ('2026', wk, 'sw-rb2', 'R Two', 'RB', 'SF', 5500, 13), ('2026', wk, 'sw-rb3', 'R Three', 'RB', 'KC', 5000, 12),
    ('2026', wk, 'sw-wr1', 'W One', 'WR', 'PHI', 6000, 14), ('2026', wk, 'sw-wr2', 'W Two', 'WR', 'SF', 5500, 13), ('2026', wk, 'sw-wr3', 'W Three', 'WR', 'KC', 5000, 12),
    ('2026', wk, 'sw-te1', 'T One', 'TE', 'PHI', 4000, 9), ('2026', wk, 'sw-k1', 'K One', 'K', 'PHI', 3000, 8), ('2026', wk, 'sw-d1', 'D One', 'DEF', 'SF', 3000, 7)
    on conflict do nothing;
  sq := '{"S1":"sw-qb1","S2":"sw-rb1","S3":"sw-rb2","S4":"sw-wr1","S5":"sw-wr2","S6":"sw-wr3","S7":"sw-te1","S8":"sw-k1","S9":"sw-d1"}';
  sq2 := '{"S1":"sw-qb2","S2":"sw-rb1","S3":"sw-rb3","S4":"sw-wr1","S5":"sw-wr2","S6":"sw-wr3","S7":"sw-te1","S8":"sw-k1","S9":"sw-d1"}';
  perform assert_ok(save_contest_entry(h, wk, sq), 'sw1 b saves a squad');
  perform assert_true((select count(*) from contest_swap where league_id = h) = 0, 'sw1b the first save is no swap');
  perform assert_ok(save_contest_entry(h, wk, sq2), 'sw2 b swaps two spots');
  perform assert_true((select count(*) from contest_swap where league_id = h and roster_id = 2 and kind = 'swap') = 2, 'sw2b two rows, one per spot');
  r := contest_swaps(h, wk);
  perform assert_ok(r, 'sw3 b reads their own');
  perform assert_true(jsonb_array_length(r -> 'swaps') = 2 and exists (select 1 from jsonb_array_elements(r -> 'swaps') x where x ->> 'slot' = 'S1' and x ->> 'out_name' = 'Q One' and x ->> 'in_name' = 'Q Two'), 'sw3b out Q One, in Q Two at S1');
  perform assert_ok(save_contest_entry(h, wk, sq2), 'sw4 saving the same squad again');
  perform assert_true((select count(*) from contest_swap where league_id = h) = 2, 'sw4b logs nothing');
  -- the commissioner's fix is history too (the worker would have paired the week; one row by hand)
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled');
  perform probe_as('a');
  perform assert_ok(commish_set_contest_squad(h, wk, 2, sq, 'ruling'), 'sw5 the commissioner puts it back');
  perform assert_true((select count(*) from contest_swap where league_id = h and roster_id = 2 and kind = 'commish') = 2, 'sw5b logged as the commissioner''s');
  perform assert_ok(contest_swaps(h, wk, 2), 'sw6 the commissioner reads any seat');
  -- another member: sealed until the week unseals
  perform assert_ok(save_contest_entry(h, wk, sq), 'sw7 a saves too');
  perform probe_as('b');
  perform assert_err(contest_swaps(h, wk, 1), 'unseal', 'sw8 b can''t read a''s before kickoff');
  update nfl_slate set kickoff = now() - interval '1 hour' where season = '2026' and week = wk and home = 'PHI';
  perform assert_ok(contest_swaps(h, wk, 1), 'sw9 …but can once the week has kicked off');
end $$;
select 'ALL CONTEST-SWAPS PROBES PASSED' as result;
