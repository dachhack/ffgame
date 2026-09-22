-- 0337 + 0338 probes: ONE WAIVER SCHEDULE, AND THE CONTROLS AROUND IT.
--   • ws1 a league that never said anything gets the default schedule;
--   • ws2 a league that configured the old keys keeps what it had, day by day;
--   • ws3 the door reads the mode: locked and waivers shut, fa open,
--         waivers_to_fa shut until the run and open after it;
--   • ws4 the conflicts 0337 exists to kill cannot be expressed any more;
--   • ws5 the run days ARE the schedule — a hold lands on the next clearing day;
--   • ws6 AFTER GAMES WAIVERS CLEAR holds a drop past its own clock;
--   • ws7 the setter validates the seven days and the hold day;
--   • ws8 (0338) with NO daily run, a waivers_to_fa day has nothing to open
--         ON — the door stays shut instead of opening at a phantom 3am;
--   • ws9 (0338) the after-games hold ends at a run that HAPPENS — the chosen
--         day rolls forward to one the schedule clears, and a week with no run
--         at all leaves the rule inapplicable rather than expiring on nothing.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function ws_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ws_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function ws_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%'
  then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function ws_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000037' || u, false); perform set_config('app.email', 'ws' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000370' || g)::uuid, 'ws0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000370' || g)::uuid, 'ws0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'ws0%@test.dev';

do $$
declare r jsonb; lid uuid; lid2 uuid; d jsonb; sun timestamptz; mon timestamptz; t timestamptz;
begin
  perform ws_as('01');
  r := create_native_league('WaiverSched', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  -- ── ws1. nothing said → the default schedule ──
  d := league_waiver_days(lid);
  perform ws_true(jsonb_array_length(d) = 7, 'ws1 seven days');
  perform ws_true(d ->> 0 = 'waivers_to_fa', 'ws1 Sunday clears to free agency: ' || (d ->> 0));
  perform ws_true((select bool_and(d ->> i = 'waivers') from generate_series(1, 6) i),
    'ws1 Monday through Saturday are waivers days: ' || d::text);
  perform ws_true(league_waiver_clear_min(lid) = 180, 'ws1 and the run is 3:00am ET');
  perform ws_true(league_waiver_game_hold_dow(lid) = 3, 'ws1 with Wednesday''s after-games hold');
  -- THE CHANGE THIS IS: unset used to read OPEN, which made the wire a race.
  perform ws_true(fa_window_open_at(lid, '2026-09-23 12:00:00-04'::timestamptz) is false,
    'ws1 a Wednesday lunchtime is a WAIVERS day now, not an open wire');

  -- ── ws2. a league that configured the old keys keeps them ──
  perform ws_as('01');
  r := create_native_league('WaiverOld', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid2 := (r ->> 'league_id')::uuid;
  -- free agency on Sun/Sat only, waiting for the run on Sunday, runs Wed + Sun
  perform ws_ok(set_transaction_rules(lid2, p_fa_mode => 'open',
    p_fa_dow => '[0,6]'::jsonb, p_fa_after_waivers_dow => '[0]'::jsonb,
    p_waiver_clear_dow => '[0,3]'::jsonb, p_waiver_clear_min => 180), 'ws2 the old keys');
  d := league_waiver_days(lid2);
  perform ws_true(d ->> 0 = 'waivers_to_fa', 'ws2 Sunday: free agency that waits for the run → waivers_to_fa');
  perform ws_true(d ->> 6 = 'fa', 'ws2 Saturday: free agency, no wait → fa');
  perform ws_true(d ->> 3 = 'waivers', 'ws2 Wednesday: no free agency, the run visits → waivers');
  perform ws_true(d ->> 1 = 'locked' and d ->> 2 = 'locked',
    'ws2 Monday/Tuesday: no free agency and no run → locked, which is what that already meant');

  -- ── ws3. the door reads the mode ──
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["fa","waivers","locked","waivers_to_fa","fa","fa","fa"]'::jsonb), 'ws3 an explicit schedule');
  sun := '2026-09-20 12:00:00-04'::timestamptz;   -- a Sunday
  mon := '2026-09-21 12:00:00-04'::timestamptz;   -- Monday
  perform ws_true(fa_window_open_at(lid, sun), 'ws3 an fa day is open at noon');
  perform ws_true(not fa_window_open_at(lid, mon), 'ws3 a waivers day is shut');
  perform ws_true(not fa_window_open_at(lid, '2026-09-22 12:00:00-04'::timestamptz), 'ws3 a locked day is shut');
  perform ws_true(not fa_window_open_at(lid, '2026-09-23 02:59:00-04'::timestamptz),
    'ws3 waivers_to_fa is shut a minute before the run');
  perform ws_true(fa_window_open_at(lid, '2026-09-23 03:01:00-04'::timestamptz),
    'ws3 …and open a minute after it — the run has spoken');

  -- ── ws4. the conflicts, no longer expressible ──
  perform ws_true(league_waiver_day_clears(lid, '2026-09-23 03:01:00-04'::timestamptz),
    'ws4 a waivers_to_fa day ALWAYS clears — the door can no longer open on a run that never happened');
  perform ws_true(not league_waiver_day_clears(lid, '2026-09-22 03:01:00-04'::timestamptz)
              and not fa_window_open_at(lid, '2026-09-22 03:01:00-04'::timestamptz),
    'ws4 locked is one setting saying both halves, not two pickers colliding');
  perform ws_true(league_waiver_day_clears(lid, mon) and not fa_window_open_at(lid, mon),
    'ws4 a waivers day clears and stays shut — one setting saying both');

  -- ── ws5. the hold lands on the next CLEARING day ──
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["waivers","fa","fa","waivers","fa","fa","fa"]'::jsonb,
    p_waiver_hold_days => 1, p_waiver_game_hold_dow => -1), 'ws5 clears Sunday and Wednesday only');
  t := waiver_hold_until(lid);
  perform ws_true(extract(dow from t at time zone 'America/New_York')::int in (0, 3),
    'ws5 a drop clears on a day the run actually visits (got dow '
      || extract(dow from t at time zone 'America/New_York')::int || ')');
  perform ws_true(extract(hour from t at time zone 'America/New_York')::int = 3, 'ws5 at the run''s own time');

  -- ── ws6. after games, waivers clear Wednesday ──
  delete from nfl_slate where season = '2026' and week = 99;
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values ('2026', 99, 'WSH', 'DAL', 'early', now() - interval '2 hours');
  -- 0338: the Wednesday named here has to be a Wednesday the run visits, or
  -- the hold would end on a morning that decides nobody — which is now ws9's
  -- assertion rather than this one's silent assumption.
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["fa","fa","fa","waivers","fa","fa","fa"]'::jsonb,
    p_waiver_hold_days => 0, p_waiver_game_hold_dow => 3), 'ws6 open all week but Wednesday''s run, no hold');
  t := waiver_hold_until(lid);
  perform ws_true(t > now(),
    'ws6 a hold of NONE still holds once the games have started — that is the rule''s whole job');
  perform ws_true(extract(dow from t at time zone 'America/New_York')::int = 3
              and extract(hour from t at time zone 'America/New_York')::int = 3,
    'ws6 …until Wednesday''s 3am run (got dow '
      || extract(dow from t at time zone 'America/New_York')::int || ')');
  -- Turn the after-games rule off AND take the run back out: a hold of NONE
  -- means "free the moment he is dropped", which is only true where there is
  -- no run for the drop to wait for. (With a run in the week a hold of NONE
  -- still lands on the next one — 0319's rule, and ws5's assertion.)
  perform ws_ok(set_transaction_rules(lid, p_waiver_game_hold_dow => -1,
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb), 'ws6 turn it off');
  perform ws_true(waiver_hold_until(lid) <= now() + interval '1 minute',
    'ws6 and with NONE the drop is a free agent at once, as before');
  delete from nfl_slate where season = '2026' and week = 99;

  -- ── ws7. the setter is strict about a schedule ──
  perform ws_refused(set_transaction_rules(lid, p_waiver_days => '["fa","fa"]'::jsonb),
    'seven days', 'ws7 a short schedule');
  perform ws_refused(set_transaction_rules(lid, p_waiver_days =>
    '["fa","fa","fa","fa","fa","fa","maybe"]'::jsonb), 'each day is', 'ws7 an invented mode');
  perform ws_refused(set_transaction_rules(lid, p_waiver_game_hold_dow => 9),
    'after-games hold is a day', 'ws7 an eighth day of the week');
  perform ws_ok(set_transaction_rules(lid, p_waiver_days => '[]'::jsonb), 'ws7 an empty list clears it');
  perform ws_true(league_waiver_days(lid) ->> 0 = 'waivers_to_fa',
    'ws7 …back to the default schedule, since the old keys were never set here');

  -- ── ws8 (0338). NO DAILY RUN: a waivers_to_fa day has no run to open on ──
  -- Founder: "looks like the three waiver selections can conflict with the
  -- daily schedule?" This was the conflict. ROLLING 24H means every dropped
  -- player clears on his OWN 24-hour clock and no run is ever held — but the
  -- door still asked "has the run spoken?" and coalesce(clear_min, 180)
  -- answered 3:00am, a time such a league is never shown. The wire opened
  -- every Sunday morning on a run that had never happened.
  perform ws_ok(set_transaction_rules(lid, p_waiver_clear_min => 180, p_waiver_days =>
    '["waivers_to_fa","waivers","waivers","waivers","waivers","waivers","waivers"]'::jsonb),
    'ws8 the default week on a daily run');
  perform ws_true(fa_window_open_at(lid, sun),
    'ws8 with a 3am run, Sunday noon is open — the run has spoken');
  perform ws_ok(set_transaction_rules(lid, p_waiver_clear_min => -1), 'ws8 …now switch to rolling 24h');
  perform ws_true(league_waiver_clear_min(lid) is null, 'ws8 which is a league with no run at all');
  perform ws_true(not fa_window_open_at(lid, sun),
    'ws8 and the SAME Sunday noon is shut — nothing cleared, so nothing opens');
  perform ws_true(not fa_window_open_at(lid, '2026-09-20 03:01:00-04'::timestamptz),
    'ws8 …including a minute past the 3am that used to let it through');
  perform ws_true(not fa_window_open_at(lid, '2026-09-20 23:59:00-04'::timestamptz),
    'ws8 …and at the end of the day: shut is shut, not shut-until-3am');
  -- The day itself was never the problem, and switching back proves it: the
  -- stored schedule is untouched, so a commissioner gets his Sunday back.
  perform ws_ok(set_transaction_rules(lid, p_waiver_clear_min => 180), 'ws8 back to a daily run');
  perform ws_true(league_waiver_days(lid) ->> 0 = 'waivers_to_fa' and fa_window_open_at(lid, sun),
    'ws8 …and Sunday is a two-stage day again, never having been rewritten');

  -- ── ws9 (0338). THE AFTER-GAMES HOLD ENDS AT A RUN THAT HAPPENS ──
  -- "Dropped players stay on waivers until Wednesday" is a promise about a
  -- RUN. Name a Wednesday the schedule spends as FREE AGENCY and the hold used
  -- to expire at 3am Wednesday having decided nobody — the door bug backwards.
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["waivers_to_fa","waivers","waivers","fa","waivers","waivers","waivers"]'::jsonb,
    p_waiver_game_hold_dow => 3, p_waiver_hold_days => 0), 'ws9 a schedule whose Wednesday is open');
  perform ws_true(waiver_game_hold_dow_effective(lid) = 4,
    'ws9 the hold rolls forward to Thursday, the next morning the run visits (got '
      || coalesce(waiver_game_hold_dow_effective(lid)::text, 'null') || ')');
  delete from nfl_slate where season = '2026' and week = 99;
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values ('2026', 99, 'WSH', 'DAL', 'early', now() - interval '2 hours');
  t := waiver_hold_until(lid);
  perform ws_true(extract(dow from t at time zone 'America/New_York')::int = 4
              and extract(hour from t at time zone 'America/New_York')::int = 3,
    'ws9 …and a drop after kickoff is held to THURSDAY 3am, not a Wednesday that clears nobody (got dow '
      || extract(dow from t at time zone 'America/New_York')::int || ')');
  -- A week with no run anywhere: the rule has nothing to wait for, so it does
  -- not apply at all. Holding a player until a morning that decides nobody
  -- would be the same bug wearing the opposite face.
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb), 'ws9 now open every single day');
  perform ws_true(waiver_game_hold_dow_effective(lid) is null,
    'ws9 no day holds a run, so the after-games hold has nowhere to land');
  perform ws_true(waiver_hold_until(lid) <= now() + interval '1 minute',
    'ws9 …and a hold of NONE is honoured rather than deferred to a phantom run');
  -- And the ordinary case is untouched: a Wednesday the run visits stays put.
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["waivers_to_fa","waivers","waivers","waivers","waivers","waivers","waivers"]'::jsonb),
    'ws9 the default week again');
  perform ws_true(waiver_game_hold_dow_effective(lid) = 3,
    'ws9 a Wednesday the run does visit is left exactly where it was');
  delete from nfl_slate where season = '2026' and week = 99;
end $$;

select 'ALL WAIVER-SCHEDULE PROBES PASS' as result;
drop function if exists ws_true(boolean, text);
drop function if exists ws_ok(jsonb, text);
drop function if exists ws_refused(jsonb, text, text);
drop function if exists ws_as(text);
