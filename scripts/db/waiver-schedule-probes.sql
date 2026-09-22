-- 0337 probes: ONE WAIVER SCHEDULE.
--   • ws1 a league that never said anything gets SLEEPER'S schedule;
--   • ws2 a league that configured the old keys keeps what it had, day by day;
--   • ws3 the door reads the mode: locked and waivers shut, fa open,
--         waivers_to_fa shut until the run and open after it;
--   • ws4 the conflicts 0337 exists to kill cannot be expressed any more;
--   • ws5 the run days ARE the schedule — a hold lands on the next clearing day;
--   • ws6 AFTER GAMES WAIVERS CLEAR holds a drop past its own clock;
--   • ws7 the setter validates the seven days and the hold day.
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

  -- ── ws1. nothing said → Sleeper's own schedule ──
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
    'ws4 a waivers day clears and stays shut — Sleeper''s own words');

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
  perform ws_ok(set_transaction_rules(lid, p_waiver_days =>
    '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb,
    p_waiver_hold_days => 0, p_waiver_game_hold_dow => 3), 'ws6 every day open, no hold, Wednesday after-games');
  t := waiver_hold_until(lid);
  perform ws_true(t > now(),
    'ws6 a hold of NONE still holds once the games have started — that is the rule''s whole job');
  perform ws_true(extract(dow from t at time zone 'America/New_York')::int = 3
              and extract(hour from t at time zone 'America/New_York')::int = 3,
    'ws6 …until Wednesday''s 3am run (got dow '
      || extract(dow from t at time zone 'America/New_York')::int || ')');
  perform ws_ok(set_transaction_rules(lid, p_waiver_game_hold_dow => -1), 'ws6 turn it off');
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
end $$;

select 'ALL WAIVER-SCHEDULE PROBES PASS' as result;
drop function if exists ws_true(boolean, text);
drop function if exists ws_ok(jsonb, text);
drop function if exists ws_refused(jsonb, text, text);
drop function if exists ws_as(text);
