-- 0341 probes: THE WEEK'S SCOREBOARD, for anybody in the league.
--   • lt1 a member reads it, a stranger does not;
--   • lt2 the default week is the one being PLAYED, not week 1 in November;
--   • lt3 a stamped final is served as the final;
--   • lt4 an UNSTAMPED week serves the running total summed from the windows
--         — the thing leagueResults could never show;
--   • lt5 …and a window nobody has played contributes nothing, so a matchup
--         with no published rows reads null rather than 0–0;
--   • lt6 TOTALS ONLY — slot_scores never leaves the function;
--   • lt7 (0342/0343) THE BOARD TURNS WITH THE RUN — a finished week is still
--         the default before the league's waiver run and is not after it,
--         which is core's openWeekFrom rule asked in SQL;
--   • lt8 (0343) …and the pair it turns on is the LEAGUE'S, so a league that
--         moves its run moves its board.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function lt_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function lt_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000041' || u, false); perform set_config('app.email', 'lt' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000410' || g)::uuid, 'lt0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000410' || g)::uuid, 'lt0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'lt0%@test.dev';

do $$
declare r jsonb; lid uuid; sb jsonb; g jsonb; m1 uuid; m2 uuid; seas text := '2026';
begin
  perform lt_as('01');
  r := create_native_league('LeagueTab', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  -- ISOLATE THE WEEKS THIS SUITE USES. Other suites seed nfl_slate rows for
  -- high week numbers in this same season, and 0342 measures a week against
  -- its slate — so a stray row from an earlier suite turns one of this
  -- suite's "no slate" cases into a measured one. It passed alone and failed
  -- in the harness, which is the failure worth leaving a note about.
  delete from nfl_slate where season = seas and week in (91, 92, 94, 95, 96, 97);

  -- Weeks the SLATE does not carry: the scratch harness shifts every real
  -- kickoff ten years forward, so weeks 1 and 2 read as entirely in the
  -- future and would both be "not yet closed". These exercise the branch
  -- these assertions are about — a week with no slate, decided by its own
  -- matchups' status. lt7 below covers the slate-measured rule.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, 91, 1, 2, 'final', 118.5, 102.25) returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 92, 1, 2, 'live') returning id into m2;

  -- ── lt1. the door ──
  perform lt_as('02');
  perform lt_true(league_week_scoreboard(lid) ->> 'error' = 'forbidden',
    'lt1 someone not in the league gets nothing');
  perform lt_as('01');
  perform lt_true((league_week_scoreboard(lid) ->> 'ok')::boolean, 'lt1 a member reads it');

  -- ── lt2. which week ──
  sb := league_week_scoreboard(lid);
  perform lt_true((sb ->> 'week')::int = 92,
    'lt2 it opens on the week being PLAYED, not the first one (got ' || (sb ->> 'week') || ')');
  perform lt_true(sb -> 'weeks' = '[91, 92]'::jsonb,
    'lt2 …and says which weeks exist, so a pager knows its ends: ' || (sb -> 'weeks')::text);
  perform lt_true((league_week_scoreboard(lid, 91) ->> 'week')::int = 91, 'lt2 an explicit week is honoured');

  -- ── lt3. a final is the final ──
  g := league_week_scoreboard(lid, 91) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 118.5
              and (g -> 'away' ->> 'points')::numeric = 102.25,
    'lt3 a stamped week serves its stamped totals: ' || g::text);
  perform lt_true((g -> 'home' ->> 'live')::boolean is false, 'lt3 …and is not marked live');
  perform lt_true(g ->> 'status' = 'final' and (g -> 'home' ->> 'team') is not null,
    'lt3 with the status and the team name the page needs');

  -- ── lt4 / lt5. the live week ──
  -- Nothing published yet: null, NOT 0–0. A league that has not kicked off
  -- showing every game 0–0 is a board claiming a fact it does not have.
  g := league_week_scoreboard(lid, 92) -> 'games' -> 0;
  perform lt_true(g -> 'home' ->> 'points' is null and (g -> 'home' ->> 'live')::boolean is false,
    'lt5 an unplayed week reads null rather than a manufactured 0-0: ' || g::text);
  -- Two windows published by the worker — the sum is the score.
  insert into matchup_state (matchup_id, game_window, home_score, away_score)
    values (m2, 'early', 40.25, 31.0), (m2, 'late', 22.5, 19.75);
  g := league_week_scoreboard(lid, 92) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 62.75
              and (g -> 'away' ->> 'points')::numeric = 50.75,
    'lt4 an unstamped week sums its published windows — what leagueResults could never show: ' || g::text);
  perform lt_true((g -> 'home' ->> 'live')::boolean and (g -> 'away' ->> 'live')::boolean,
    'lt4 …and both halves are flagged live, so the page can say so');
  -- The stamp arrives: the board must not JUMP. The final IS the sum.
  update matchup set status = 'final', home_final = 62.75, away_final = 50.75 where id = m2;
  g := league_week_scoreboard(lid, 92) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 62.75 and (g -> 'home' ->> 'live')::boolean is false,
    'lt4 when the week closes the number stops moving rather than changing');

  -- ── lt6. totals only ──
  -- The whole safety of this function is that it never carries a lineup.
  update matchup_state set slot_scores = '[{"side":"home","slot":"1","slug":"josh-allen","score":31.0}]'::jsonb
    where matchup_id = m2 and game_window = 'early';
  sb := league_week_scoreboard(lid, 92);
  perform lt_true(sb::text not ilike '%josh-allen%' and sb::text not ilike '%slot_scores%',
    'lt6 no slot ever leaves the function — it says the score, never the lineup');

  -- ── lt7 (0342). WEDNESDAY, NOT THE STAMP ──
  -- Founder, with LEAGUE on week 3 and MATCHUP on week 2 at the same moment:
  -- "We should move default views to the next week on Weds AM." 0341 rolled
  -- the instant the last matchup STAMPED, which is Tuesday morning. Core's
  -- rule — a week runs to the first Wednesday 00:00 ET after its games are
  -- done — is what both clients ask; this pins its SQL shadow to the same
  -- boundary, so a change to one that is not made to the other fails here.
  --
  -- Week 96's games finish Monday 21 Sep 2026 at 20:15 ET (done 00:15 Tue),
  -- so its window runs to Wednesday 23 Sep 00:00 ET. Week 97 kicks the Sunday
  -- after. These are the founder's own dates: he photographed the two tabs
  -- disagreeing on Tuesday 22 Sep.
  delete from nfl_slate where season = seas and week in (96, 97);
  delete from matchup where league_id = lid;
  insert into nfl_slate (season, week, home, away, win, kickoff) values
    (seas, 96, 'WSH', 'DAL', 'early', '2026-09-20 13:00:00-04'),
    (seas, 96, 'PHI', 'NYG', 'mnf',   '2026-09-21 20:15:00-04'),
    (seas, 97, 'BUF', 'MIA', 'early', '2026-09-27 13:00:00-04');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, 96, 1, 2, 'final', 147.4, 111.7), (lid, 97, 1, 2, 'scheduled', null, null);

  -- 0343: the default pair is the DEFAULT RUN — Wednesday, 3:00am ET — not
  -- midnight. Founder: "We want it synced with the waiver run so that when you
  -- see the week matchup, you see the impacts of new rosters from the waiver
  -- run." Turning at midnight showed next week's matchup against last week's
  -- rosters, which is the one thing that page must not do.
  perform lt_true(nfl_week_closes_at(96, seas) = '2026-09-23 03:00:00-04'::timestamptz,
    'lt7 a week whose last game kicks Monday night closes at Wednesday''s 3am run (got '
      || coalesce(nfl_week_closes_at(96, seas)::text, 'null') || ')');
  -- The two sides of the boundary. A finished week is STILL the answer on
  -- Tuesday — that is the whole point of the rule, and it is exactly the state
  -- the founder photographed.
  perform lt_true(nfl_week_closes_at(96, seas) > '2026-09-23 02:59:00-04'::timestamptz,
    'lt7 …so Wednesday 2:59am, before the run, is still inside week 96''s window');
  perform lt_true(nfl_week_closes_at(96, seas) <= '2026-09-23 03:01:00-04'::timestamptz,
    'lt7 …and a minute after the run is outside it');
  perform lt_true(nfl_week_closes_at(96, seas) > '2026-09-23 00:00:00-04'::timestamptz,
    'lt7 …and midnight, which 0342 turned on, no longer does');
  -- A week that finishes AFTER the run on its own turnover day does not close
  -- that morning: the step is strictly forward, or the board would turn over
  -- behind the games it is still showing.
  delete from nfl_slate where season = seas and week = 95;
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values (seas, 95, 'KC', 'LV', 'late', '2026-09-23 01:00:00-04');   -- Wed 1am ET, done 5am
  perform lt_true(nfl_week_closes_at(95, seas) = '2026-09-30 03:00:00-04'::timestamptz,
    'lt7 a week still being played at its own run time runs to the NEXT one (got '
      || coalesce(nfl_week_closes_at(95, seas)::text, 'null') || ')');
  perform lt_true(nfl_week_closes_at(94, seas) is null,
    'lt7 a week with no slate is unmeasurable, and says so rather than guessing');

  -- ── lt8 (0343). THE PAIR IS THE LEAGUE'S ──
  -- Not a new rule: `waiver_game_hold_dow_effective` (0338) picks the day and
  -- `league_waiver_clear_min` (0337) the time, and this reads them.
  perform lt_true((league_week_turnover(lid) ->> 'dow')::int = 3
              and (league_week_turnover(lid) ->> 'minute')::int = 180
              and league_week_turnover(lid) ->> 'source' = 'run',
    'lt8 an unconfigured league turns over at its own default run: ' || league_week_turnover(lid)::text);
  -- Move the run and the board moves with it.
  perform lt_true((set_transaction_rules(lid, p_waiver_clear_min => 300,
      p_waiver_game_hold_dow => 2,
      p_waiver_days => '["waivers","waivers","waivers","waivers","waivers","waivers","waivers"]'::jsonb)
      ->> 'ok')::boolean, 'lt8 move the run to Tuesday 5am');
  perform lt_true((league_week_turnover(lid) ->> 'dow')::int = 2
              and (league_week_turnover(lid) ->> 'minute')::int = 300,
    'lt8 …and the turnover follows it: ' || league_week_turnover(lid)::text);
  -- Week 96's games are done Tuesday 00:15 ET, and a Tuesday 5am run is after
  -- that — so this league turns over the very morning after Monday night,
  -- three days before the default league does. That is the point: the board
  -- follows the rosters, whenever this league changes them.
  perform lt_true(nfl_week_closes_at(96, seas, 2, 300) = '2026-09-22 05:00:00-04'::timestamptz,
    'lt7/8 a Tuesday 5am league turns over Tuesday morning, right after its own run (got '
      || coalesce(nfl_week_closes_at(96, seas, 2, 300)::text, 'null') || ')');
  -- …and a run EARLIER than the finish waits a week rather than closing behind
  -- the games it is still showing.
  perform lt_true(nfl_week_closes_at(96, seas, 2, 0) = '2026-09-29 00:00:00-04'::timestamptz,
    'lt7/8 a Tuesday midnight run, already past when the games ended, waits for the next one (got '
      || coalesce(nfl_week_closes_at(96, seas, 2, 0)::text, 'null') || ')');
  -- A ROLLING LEAGUE HAS NO RUN to sync to — every dropped player clears on
  -- his own timer — so the board falls back to the default pair and says so
  -- rather than pretending it found one.
  perform lt_true((set_transaction_rules(lid, p_waiver_clear_min => -1) ->> 'ok')::boolean,
    'lt8 switch it to rolling 24h');
  perform lt_true((league_week_turnover(lid) ->> 'dow')::int = 3
              and (league_week_turnover(lid) ->> 'minute')::int = 180
              and league_week_turnover(lid) ->> 'source' = 'rolling',
    'lt8 …and it falls back to Wednesday 3am, labelled rolling: ' || league_week_turnover(lid)::text);
  -- An after-games hold of NONE is the other way to have no run.
  perform lt_true((set_transaction_rules(lid, p_waiver_clear_min => 180,
      p_waiver_game_hold_dow => -1) ->> 'ok')::boolean, 'lt8 turn the after-games hold off');
  perform lt_true(league_week_turnover(lid) ->> 'source' = 'no_hold_day',
    'lt8 …and that is named too rather than guessed at: ' || league_week_turnover(lid)::text);
  perform lt_true(league_week_turnover('00000000-0000-0000-0000-000000000000'::uuid) ->> 'source' = 'default',
    'lt8 a league that does not exist answers the default rather than throwing');

  delete from nfl_slate where season = seas and week in (94, 95, 96, 97);
  delete from matchup where league_id = lid;
end $$;

select 'ALL LEAGUE-TAB PROBES PASS' as result;
drop function if exists lt_true(boolean, text);
drop function if exists lt_as(text);
