-- 0341 probes: THE WEEK'S SCOREBOARD, for anybody in the league.
--   • lt1 a member reads it, a stranger does not;
--   • lt2 the default week is the one being PLAYED, not week 1 in November;
--   • lt3 a stamped final is served as the final;
--   • lt4 an UNSTAMPED week serves the running total summed from the windows
--         — the thing leagueResults could never show;
--   • lt5 …and a window nobody has played contributes nothing, so a matchup
--         with no published rows reads null rather than 0–0;
--   • lt6 TOTALS ONLY — slot_scores never leaves the function.
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
declare r jsonb; lid uuid; sb jsonb; g jsonb; m1 uuid; m2 uuid;
begin
  perform lt_as('01');
  r := create_native_league('LeagueTab', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, 1, 1, 2, 'final', 118.5, 102.25) returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 2, 1, 2, 'live') returning id into m2;

  -- ── lt1. the door ──
  perform lt_as('02');
  perform lt_true(league_week_scoreboard(lid) ->> 'error' = 'forbidden',
    'lt1 someone not in the league gets nothing');
  perform lt_as('01');
  perform lt_true((league_week_scoreboard(lid) ->> 'ok')::boolean, 'lt1 a member reads it');

  -- ── lt2. which week ──
  sb := league_week_scoreboard(lid);
  perform lt_true((sb ->> 'week')::int = 2,
    'lt2 it opens on the week being PLAYED, not the first one (got ' || (sb ->> 'week') || ')');
  perform lt_true(sb -> 'weeks' = '[1, 2]'::jsonb,
    'lt2 …and says which weeks exist, so a pager knows its ends: ' || (sb -> 'weeks')::text);
  perform lt_true((league_week_scoreboard(lid, 1) ->> 'week')::int = 1, 'lt2 an explicit week is honoured');

  -- ── lt3. a final is the final ──
  g := league_week_scoreboard(lid, 1) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 118.5
              and (g -> 'away' ->> 'points')::numeric = 102.25,
    'lt3 a stamped week serves its stamped totals: ' || g::text);
  perform lt_true((g -> 'home' ->> 'live')::boolean is false, 'lt3 …and is not marked live');
  perform lt_true(g ->> 'status' = 'final' and (g -> 'home' ->> 'team') is not null,
    'lt3 with the status and the team name the page needs');

  -- ── lt4 / lt5. the live week ──
  -- Nothing published yet: null, NOT 0–0. A league that has not kicked off
  -- showing every game 0–0 is a board claiming a fact it does not have.
  g := league_week_scoreboard(lid, 2) -> 'games' -> 0;
  perform lt_true(g -> 'home' ->> 'points' is null and (g -> 'home' ->> 'live')::boolean is false,
    'lt5 an unplayed week reads null rather than a manufactured 0-0: ' || g::text);
  -- Two windows published by the worker — the sum is the score.
  insert into matchup_state (matchup_id, game_window, home_score, away_score)
    values (m2, 'early', 40.25, 31.0), (m2, 'late', 22.5, 19.75);
  g := league_week_scoreboard(lid, 2) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 62.75
              and (g -> 'away' ->> 'points')::numeric = 50.75,
    'lt4 an unstamped week sums its published windows — what leagueResults could never show: ' || g::text);
  perform lt_true((g -> 'home' ->> 'live')::boolean and (g -> 'away' ->> 'live')::boolean,
    'lt4 …and both halves are flagged live, so the page can say so');
  -- The stamp arrives: the board must not JUMP. The final IS the sum.
  update matchup set status = 'final', home_final = 62.75, away_final = 50.75 where id = m2;
  g := league_week_scoreboard(lid, 2) -> 'games' -> 0;
  perform lt_true((g -> 'home' ->> 'points')::numeric = 62.75 and (g -> 'home' ->> 'live')::boolean is false,
    'lt4 when the week closes the number stops moving rather than changing');

  -- ── lt6. totals only ──
  -- The whole safety of this function is that it never carries a lineup.
  update matchup_state set slot_scores = '[{"side":"home","slot":"1","slug":"josh-allen","score":31.0}]'::jsonb
    where matchup_id = m2 and game_window = 'early';
  sb := league_week_scoreboard(lid, 2);
  perform lt_true(sb::text not ilike '%josh-allen%' and sb::text not ilike '%slot_scores%',
    'lt6 no slot ever leaves the function — it says the score, never the lineup');
end $$;

select 'ALL LEAGUE-TAB PROBES PASS' as result;
drop function if exists lt_true(boolean, text);
drop function if exists lt_as(text);
