-- 0345 probes: THE FINAL THAT WAS TAKEN TOO EARLY.
--   • sf1 a stamped final with no window rows has no scoring instant, so it
--         can be neither drifted nor stale;
--   • sf2 scored AFTER the week's last play — the ordinary case, clean;
--   • sf3 scored BEFORE the week's last play — stale, and `drifted` stays 0,
--         which is the whole point: the two checks see different things;
--   • sf4 the two-minute grace: a play landing seconds behind a resolve is a
--         tick doing its job, not a week that closed early;
--   • sf5 scored_at / last_play_at are the pair the count came from;
--   • sf6 another week's plays cannot make THIS week stale;
--   • sf7 a week with no plays at all is not stale (nothing to be late for);
--   • sf8 an unstamped final is not counted either way.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function sf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sf_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000045' || u, false); perform set_config('app.email', 'sf' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000450' || g)::uuid, 'sf0' || g || '@test.dev' from generate_series(1,1) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000450' || g)::uuid, 'sf0' || g || '@test.dev' from generate_series(1,1) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'sf0%@test.dev';

do $$
declare r jsonb; lid uuid; w jsonb; mid uuid; seas text := '2026';
        -- Weeks 93/94 are this suite's own. Other suites seed slate and play
        -- rows at low week numbers in the same season, and `stale` is measured
        -- against the week's plays — so borrowing a week would make this
        -- suite's answer depend on what ran before it (the lesson lt8 learned
        -- the hard way in 0342).
        wk int := 93; other int := 94;
        scored timestamptz;
begin
  perform sf_as('01');
  r := create_native_league('StaleFinal', seas, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  delete from live_play where week in (wk, other);
  delete from nfl_slate where season = seas and week in (wk, other);
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values (seas, wk, 'WSH', 'DAL', 'early', now() - interval '2 days');

  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, wk, 1, 2, 'final', 101.5, 99.5) returning id into mid;

  -- ── sf1. no window rows: no scoring instant to be early ──
  -- Same hole `drifted` has and for the same reason: a hand-built final was
  -- never resolved, so there is nothing to say it was resolved too soon.
  insert into live_play (week, game_id, player_slug, c, k, y)
    values (wk, 'g1', 'x-qb', 10, 'rush', 5);
  w := league_report_weeks(lid) -> 'weeks' -> 0;
  perform sf_true((w ->> 'stale')::int = 0,
    'sf1 a final with no window rows is not stale: ' || w::text);
  perform sf_true((w ->> 'drifted')::int = 0, 'sf1 …nor drifted');

  -- ── sf2. scored after the last play — the ordinary week ──
  scored := now() - interval '1 hour';
  insert into matchup_state (matchup_id, game_window, home_score, away_score, updated_at)
    values (mid, 'wk', 101.5, 99.5, scored);
  update live_play set ingested_at = scored - interval '30 minutes' where week = wk;
  w := league_report_weeks(lid) -> 'weeks' -> 0;
  perform sf_true((w ->> 'stale')::int = 0,
    'sf2 the last play landed BEFORE the scoring — nothing is late: ' || w::text);

  -- ── sf3. scored before the last play — stale, and drifted says nothing ──
  -- THE WHOLE POINT. The stored 101.5 still equals the sum of its own window
  -- rows exactly, because one pass wrote both; the football arrived after.
  update live_play set ingested_at = scored + interval '3 hours' where week = wk;
  w := league_report_weeks(lid) -> 'weeks' -> 0;
  perform sf_true((w ->> 'stale')::int = 1,
    'sf3 a play three hours after the scoring makes the final stale: ' || w::text);
  perform sf_true((w ->> 'drifted')::int = 0,
    'sf3 …and drifted is BLIND to it — the final and its window rows agree perfectly');

  -- ── sf4. the grace is for the tick's own race, not for being wrong ──
  update live_play set ingested_at = scored + interval '45 seconds' where week = wk;
  perform sf_true(((league_report_weeks(lid) -> 'weeks' -> 0) ->> 'stale')::int = 0,
    'sf4 a play 45s behind a resolve is one tick, not a week that closed early');
  update live_play set ingested_at = scored + interval '3 minutes' where week = wk;
  perform sf_true(((league_report_weeks(lid) -> 'weeks' -> 0) ->> 'stale')::int = 1,
    'sf4 …three minutes is past the grace');

  -- ── sf5. the console shows its working ──
  w := league_report_weeks(lid) -> 'weeks' -> 0;
  perform sf_true((w ->> 'scored_at')::timestamptz = scored,
    'sf5 scored_at is when the week was last scored: ' || w::text);
  perform sf_true((w ->> 'last_play_at')::timestamptz = scored + interval '3 minutes',
    'sf5 last_play_at is when its last play arrived');

  -- ── sf6. another week's plays are another week's problem ──
  update live_play set ingested_at = scored - interval '30 minutes' where week = wk;
  insert into live_play (week, game_id, player_slug, c, k, y, ingested_at)
    values (other, 'g9', 'x-rb', 10, 'rush', 5, scored + interval '9 hours');
  perform sf_true(((league_report_weeks(lid) -> 'weeks' -> 0) ->> 'stale')::int = 0,
    'sf6 a later play in week ' || other || ' does not make week ' || wk || ' stale');
  delete from live_play where week = other;

  -- ── sf7. a week nobody played has nothing to be late for ──
  delete from live_play where week = wk;
  w := league_report_weeks(lid) -> 'weeks' -> 0;
  perform sf_true((w ->> 'stale')::int = 0, 'sf7 no plays, no staleness: ' || w::text);
  perform sf_true(w ->> 'last_play_at' is null, 'sf7 …and last_play_at says why');

  -- ── sf8. an unstamped final is not this check's business ──
  insert into live_play (week, game_id, player_slug, c, k, y, ingested_at)
    values (wk, 'g1', 'x-qb', 10, 'rush', 5, scored + interval '3 hours');
  update matchup set home_final = null, away_final = null where id = mid;
  perform sf_true(((league_report_weeks(lid) -> 'weeks' -> 0) ->> 'stale')::int = 0,
    'sf8 a final with nothing stamped has no stored number to be stale');

  delete from live_play where week in (wk, other);
  delete from nfl_slate where season = seas and week in (wk, other);
end $$;

select 'ALL STALE-FINAL PROBES PASS' as result;
drop function if exists sf_true(boolean, text);
drop function if exists sf_as(text);
