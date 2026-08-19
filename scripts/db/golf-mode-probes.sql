-- 0200 golf-mode + zero-fill probes.
--
--   • golf is CLASSIC-only, commissioner-only, and freezes at the draft;
--   • it inverts which result is a WIN in the standings, and the points
--     tiebreak with it — and nothing else about the table;
--   • it inverts both playoff comparisons;
--   • a league that never opens the setting scores and ranks identically;
--   • the per-spot zero-fill rule stores, bounds itself, and is REFUSED on a
--     best-ball spot rather than silently dropped;
--   • and the two settings are independent: a normal league may use the
--     zero-fill rule, and a golf league need not.
\set QUIET on
\pset pager off

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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; nlid uuid; code text; a_seat int; b_seat int; st jsonb;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  -- ══ THE SETTING ══════════════════════════════════════════════════════════
  r := create_native_league('Golf', '2024', 2, 8, 60);   -- drip to start
  perform assert_ok(r, 'gf0 a drip league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform assert_err(set_league_golf(lid, true), 'classic-league setting',
    'gf1 golf is a classic setting — a drip league has no weekly total to invert');
  perform assert_true(league_golf(lid) = false, 'gf1a and it is off by default');
  perform probe_as('b'); perform assert_ok(native_join(code, 'GF-B'), 'gf1b join'); perform probe_as('a');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"game_mode":"classic"}'::jsonb
    where id = lid;
  perform assert_ok(set_league_golf(lid, true), 'gf2 the commissioner turns it on');
  perform assert_true(league_golf(lid), 'gf2a …and it reads back on');
  perform assert_true((league_game_mode(lid) ->> 'golf')::boolean, 'gf2b the screens can see it');
  perform probe_as('b');
  perform assert_err(set_league_golf(lid, false), 'commissioner only', 'gf3 a member cannot set it');
  perform probe_as('a');

  -- ══ WHICH RESULT IS A WIN ════════════════════════════════════════════════
  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  -- A scores 80, B scores 120. In golf, A wins.
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (gen_random_uuid(), lid, 1, a_seat, b_seat, 'final', 80, 120);
  st := league_standings(lid);
  perform assert_true((select (e ->> 'wins')::int from jsonb_array_elements(st) e
                        where (e ->> 'roster_id')::int = a_seat) = 1,
    'gf4 the LOWER score is the win');
  perform assert_true((select (e ->> 'losses')::int from jsonb_array_elements(st) e
                        where (e ->> 'roster_id')::int = b_seat) = 1,
    'gf4a …and the higher score is the loss');
  perform assert_true((st -> 0 ->> 'roster_id')::int = a_seat, 'gf4b the table leads with the winner');
  -- Points for and against are still the points SCORED — golf changes which end
  -- you aim at, not how the number is made.
  perform assert_true((select (e ->> 'pf')::numeric from jsonb_array_elements(st) e
                        where (e ->> 'roster_id')::int = a_seat) = 80,
    'gf4c points for are untouched');

  -- The tiebreak runs the other way too: equal wins, FEWER points is better.
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (gen_random_uuid(), lid, 2, a_seat, b_seat, 'final', 100, 100);
  perform assert_true(
    (select (e ->> 'wins')::int from jsonb_array_elements(league_standings(lid)) e
       where (e ->> 'roster_id')::int = a_seat) = 1,
    'gf5 a tie is a win for nobody, in golf as anywhere else');

  -- ══ TURN IT OFF AND THE SAME ROWS READ THE OTHER WAY ═════════════════════
  perform assert_ok(set_league_golf(lid, false), 'gf6 off again');
  perform assert_true((select (e ->> 'wins')::int from jsonb_array_elements(league_standings(lid)) e
                        where (e ->> 'roster_id')::int = b_seat) = 1,
    'gf6a the same finals now make the HIGHER score the win');
  perform assert_ok(set_league_golf(lid, true), 'gf6b back on for the playoff cases');

  -- ══ THE PLAYOFF COMPARISONS ══════════════════════════════════════════════
  perform assert_true(
    (select playoff_winner(m, jsonb_build_object(a_seat::text, 1, b_seat::text, 2))
       from matchup m where m.league_id = lid and m.week = 1) = a_seat,
    'gf7 a playoff game goes to the lower score');
  perform assert_ok(set_league_golf(lid, false), 'gf7a and with golf off…');
  perform assert_true(
    (select playoff_winner(m, jsonb_build_object(a_seat::text, 1, b_seat::text, 2))
       from matchup m where m.league_id = lid and m.week = 1) = b_seat,
    'gf7b …the very same game goes to the higher one');
  perform assert_ok(set_league_golf(lid, true), 'gf7c back on');

  -- ══ IT FREEZES AT THE DRAFT ══════════════════════════════════════════════
  update draft set status = 'live' where league_id = lid;
  perform assert_err(set_league_golf(lid, false), 'locks once the draft starts',
    'gf8 the whole board is valued differently — this is not a mid-season toggle');
  update draft set status = 'pending' where league_id = lid;

  -- ══ THE ZERO-FILL RULE ═══════════════════════════════════════════════════
  r := set_league_classic_slots(lid,
    '[{"pos":["QB"],"zero_pts":10},{"pos":["RB"]},{"pos":["RB","WR","TE"],"zero_pts":7}]'::jsonb);
  perform assert_ok(r, 'gf9 a per-spot zero-fill saves');
  perform assert_true((r -> 'slots' -> 0 ->> 'zero_pts')::int = 10, 'gf9a stored on the spot that asked');
  perform assert_true((r -> 'slots' -> 1 ? 'zero_pts') = false, 'gf9b and nowhere else');
  perform assert_true((r -> 'slots' -> 2 ->> 'zero_pts')::int = 7, 'gf9c each spot names its own number');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"],"zero_pts":10,"bb":true}]'::jsonb),
    'can''t also carry a zero-points rule',
    'gf10 a best-ball spot is REFUSED, not silently stripped — it fills itself, so it is never unfilled');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"],"zero_pts":500}]'::jsonb),
    'must be 0-200', 'gf10a an absurd fill is refused');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"],"zero_pts":"ten"}]'::jsonb),
    'needs a number', 'gf10b and so is a word');
  perform assert_ok(set_league_classic_slots(lid, '[{"pos":["QB"],"zero_pts":0}]'::jsonb),
    'gf10c zero IS a legal fill — "a blank spot scores nothing" said out loud');
  r := set_league_classic_slots(lid, '[{"pos":["QB"]}]'::jsonb);
  perform assert_ok(r, 'gf11 saving without the key clears it');
  perform assert_true((r -> 'slots' -> 0 ? 'zero_pts') = false, 'gf11a …and it is gone');

  -- ══ THE TWO SETTINGS ARE INDEPENDENT ═════════════════════════════════════
  r := create_native_league('Not Golf', '2024', 2, 8, 60);
  perform assert_ok(r, 'gf12 a second league'); nlid := (r ->> 'league_id')::uuid;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"game_mode":"classic"}'::jsonb
    where id = nlid;
  perform assert_true(league_golf(nlid) = false, 'gf12a it plays normally');
  perform assert_ok(set_league_classic_slots(nlid, '[{"pos":["QB"],"zero_pts":10},{"pos":["RB"]}]'::jsonb),
    'gf12b …and may still use the zero-fill rule — a forgotten lineup scoring nothing is a problem in any league');

  raise notice 'golf-mode probes done';
end $$;

select 'ALL GOLF-MODE PROBES PASSED' as result;
