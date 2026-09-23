-- 0357 probes: THE COMMISSIONER REDRAWS A WEEK.
--   • a swap: each team's saved picks follow it into its new game; the league
--     is told the new pairings; the change is logged;
--   • a swap with a team on bye: it takes the game, the other takes the bye,
--     and the lineup it leaves behind is removed (an orphan would be adopted);
--   • only open weeks are listed;
--   • refusals: a manager, no reason, one team twice, two teams already
--     playing each other, a week that has kicked off, a playoff week, a drip
--     power-up armed for one of the games.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function rd_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rd_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rd_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rd_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000020' || u, false);
      perform set_config('app.email', 'rd' || u || '@test.dev', false); end $$;
insert into auth.users (id, email)
  select ('00000000-0000-0000-0000-0000000020' || lpad(g::text, 2, '0'))::uuid, 'rd' || lpad(g::text, 2, '0') || '@test.dev'
  from generate_series(1, 5) g on conflict (id) do nothing;
insert into app_user (id, email)
  select ('00000000-0000-0000-0000-0000000020' || lpad(g::text, 2, '0'))::uuid, 'rd' || lpad(g::text, 2, '0') || '@test.dev'
  from generate_series(1, 5) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id::text like '00000000-0000-0000-0000-0000000020%';
-- Week 93 is ahead; week 92 kicked off an hour ago.
insert into nfl_slate (season, week, win, home, away, kickoff) values
  ('2026', 93, 'sun_early', 'PHI', 'DAL', now() + interval '3 days'),
  ('2026', 92, 'thu', 'NYJ', 'BUF', now() - interval '1 hour')
on conflict do nothing;

do $$
declare r jsonb; lid uuid; code text; ra int; rb int; rc int; rdd int; re int; m1 uuid; m2 uuid; m9 uuid; mp uuid;
        ub uuid := '00000000-0000-0000-0000-000000002002'; ud uuid := '00000000-0000-0000-0000-000000002004'; line text;
begin
  perform rd_as('01');
  r := create_native_league('Redrawn', '2026', 5, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform rd_ok(r, 'r0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform rd_as('02'); perform rd_ok(native_join(code, 'RD-B'), 'r0 B');
  perform rd_as('03'); perform rd_ok(native_join(code, 'RD-C'), 'r0 C');
  perform rd_as('04'); perform rd_ok(native_join(code, 'RD-D'), 'r0 D');
  perform rd_as('05'); perform rd_ok(native_join(code, 'RD-E'), 'r0 E');
  perform rd_as('01');
  select sleeper_roster_id into ra from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000002001';
  select sleeper_roster_id into rb from league_membership where league_id = lid and app_user_id = ub;
  select sleeper_roster_id into rc from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000002003';
  select sleeper_roster_id into rdd from league_membership where league_id = lid and app_user_id = ud;
  select sleeper_roster_id into re from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000002005';
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'rd-b', 'B Back', 'RB', 'PHI', 1), (lid, 'rd-d', 'D Back', 'RB', 'DAL', 2);
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 93, ra, rb, 'scheduled') returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 93, rc, rdd, 'scheduled') returning id into m2;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 92, ra, rb, 'scheduled') returning id into m9;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, is_playoff) values (lid, 94, ra, rb, 'scheduled', true) returning id into mp;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values
    (m1, ub, 'wk', 'RB1', 'rd-b'), (m2, ud, 'wk', 'RB1', 'rd-d');

  -- ── r1. listing ──
  r := commish_open_schedule(lid);
  perform rd_true((select array_agg((w ->> 'week')::int) from jsonb_array_elements(r -> 'weeks') w) = array[93],
    'r1 only week 93 is open: ' || (r -> 'weeks')::text);
  perform rd_true(r #>> '{weeks,0,byes,0,name}' = 'RD-E', 'r1 E is on bye in 93');

  -- ── r2. swap B and C ──
  r := commish_swap_opponents(lid, 93, rb, rc, 'rivalry week');
  perform rd_ok(r, 'r2 swap');
  perform rd_true((select home_roster_id = ra and away_roster_id = rc from matchup where id = m1), 'r2 A now plays C');
  perform rd_true((select home_roster_id = rb and away_roster_id = rdd from matchup where id = m2), 'r2 B now plays D, on C''s side');
  perform rd_true((select matchup_id from sealed_pick where app_user_id = ub and player_slug = 'rd-b') = m2, 'r2 B''s lineup followed B');
  perform rd_true((select matchup_id from sealed_pick where app_user_id = ud and player_slug = 'rd-d') = m2, 'r2 D''s stayed');
  select body into line from league_message where league_id = lid order by created_at desc, id desc limit 1;
  perform rd_true(line = '🔀 The commissioner redrew week 93: RD-C now plays ' || _txn_team(lid, ra) || '; RD-B now plays RD-D — rivalry week',
    'r2 told: ' || coalesce(line, '∅'));
  perform rd_true((select count(*) from schedule_edit_log where league_id = lid) = 1, 'r2 logged');

  -- ── r3. swap D with E, who is on bye ──
  perform rd_ok(commish_swap_opponents(lid, 93, rdd, re, 'E wanted a game'), 'r3 bye swap');
  perform rd_true((select home_roster_id = rb and away_roster_id = re from matchup where id = m2), 'r3 E takes D''s game');
  perform rd_true(not exists (select 1 from matchup where league_id = lid and week = 93 and rdd in (home_roster_id, away_roster_id)), 'r3 D on bye');
  perform rd_true(not exists (select 1 from sealed_pick where app_user_id = ud and matchup_id = m2), 'r3 D''s orphaned lineup removed');
  perform rd_true((select matchup_id from sealed_pick where app_user_id = ub and player_slug = 'rd-b') = m2, 'r3 B''s untouched');

  -- ── r4. refusals ──
  perform rd_as('02');
  perform rd_refused(commish_swap_opponents(lid, 93, ra, rb, 'x'), 'commissioner only', 'r4 a manager');
  perform rd_refused(commish_open_schedule(lid), 'commissioner only', 'r4 a manager reads nothing');
  perform rd_as('01');
  perform rd_refused(commish_swap_opponents(lid, 93, ra, rb, ''), 'say why', 'r4 no reason');
  perform rd_refused(commish_swap_opponents(lid, 93, ra, ra, 'x'), 'two different', 'r4 same team');
  perform rd_refused(commish_swap_opponents(lid, 93, ra, rc, 'x'), 'already play', 'r4 already opponents');
  perform rd_refused(commish_swap_opponents(lid, 92, ra, rc, 'x'), 'kicked off', 'r4 kicked off');
  perform rd_refused(commish_swap_opponents(lid, 94, ra, rc, 'x'), 'playoff', 'r4 playoff');
  insert into applied_state (matchup_id, app_user_id, week, payload_json) values (m1, '00000000-0000-0000-0000-000000002001', 93, '{}');
  perform rd_refused(commish_swap_opponents(lid, 93, rc, rb, 'x'), 'power-up', 'r4 an armed power-up');
  update matchup set status = 'live' where id = m2;
  perform rd_refused(commish_swap_opponents(lid, 93, rc, rb, 'x'), 'started', 'r4 a started week');
end $$;
select 'ALL REDRAW PROBES PASS';
