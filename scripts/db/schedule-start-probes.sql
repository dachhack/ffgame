-- 0280 probes: a schedule starts on a week the league can play.
--
-- What must hold:
--   • a league made BEFORE the season starts is unchanged — weeks 1..N, same
--     pairings, same sides (the byte-identical promise in 0280's header);
--   • a league made after week 1 has kicked off starts at the first OPEN week,
--     so league_live_week points at a week it can actually play;
--   • a schedule already carrying dead weeks heals at the draft door;
--   • the shift never runs over the playoffs, and never touches a league that
--     has played anything.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function ss_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function ss_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ss_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000005e' || u, false);
  perform set_config('app.email', 'ss' || u || '@test.dev', false);
end $$;
-- Build a 4-team classic league and return its id. The caller decides what the
-- slate looks like BEFORE calling, which is the whole variable under test.
create or replace function ss_league(nm text) returns uuid language plpgsql as $$
declare r jsonb; lid uuid;
begin
  perform ss_as('1');
  r := create_native_league(nm, '2026', 4, 7, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;
  perform ss_as('2'); perform native_join(r ->> 'invite_code', 'SS-2');
  perform ss_as('3'); perform native_join(r ->> 'invite_code', 'SS-3');
  perform ss_as('4'); perform native_join(r ->> 'invite_code', 'SS-4');
  perform ss_as('1');
  return lid;
end $$;

-- THE SLATE IS SHARED. This suite moves whole weeks of it around, and every
-- other suite in the runner reads the same rows, so snapshot it here and put it
-- back at the end rather than leaving a decade-shifted calendar half-rewritten.
drop table if exists ss_slate_backup;
create table ss_slate_backup as
  select season, week, home, kickoff from nfl_slate where season = '2026' and week between 1 and 18;
-- and start from a known calendar: earlier suites plant past kickoffs of their
-- own, and §0 below is the assertion that nothing has kicked off yet.
update nfl_slate set kickoff = now() + interval '10 years' where season = '2026' and week between 1 and 18;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005e1', 'ss1@test.dev'),
  ('00000000-0000-0000-0000-0000000005e2', 'ss2@test.dev'),
  ('00000000-0000-0000-0000-0000000005e3', 'ss3@test.dev'),
  ('00000000-0000-0000-0000-0000000005e4', 'ss4@test.dev')
on conflict (id) do nothing;
do $$ begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000005e1', 'ss1@test.dev'),
    ('00000000-0000-0000-0000-0000000005e2', 'ss2@test.dev'),
    ('00000000-0000-0000-0000-0000000005e3', 'ss3@test.dev'),
    ('00000000-0000-0000-0000-0000000005e4', 'ss4@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where email like 'ss_@test.dev';
end $$;

-- ── 0. the pre-season league is exactly what it was ────────────────────────
-- The runner pushes the regular-season slate a decade out, so nothing has
-- kicked off here: this is the untouched path, and it is the one every other
-- suite in this runner depends on.
do $$
declare lid uuid; r jsonb; sides text;
begin
  lid := ss_league('SS Preseason');
  r := native_generate_schedule(lid, 6);
  perform ss_ok(r, 'ss0 a pre-season schedule generates');
  perform ss_true((r ->> 'first_week')::int = 1, 'ss1 and it still starts at week 1');
  perform ss_true((select min(week) from matchup where league_id = lid) = 1
              and (select max(week) from matchup where league_id = lid) = 6,
    'ss2 weeks 1..6, as before');
  -- the fingerprint that proves the pairing math did not move
  select string_agg(week || ':' || home_roster_id || '>' || away_roster_id, ',' order by week, home_roster_id)
    into sides from matchup where league_id = lid;
  perform set_config('probe.ss_fingerprint', sides, false);
  perform ss_true(league_live_week(lid) = 1, 'ss3 and the league is live on week 1');
end $$;

-- ── 1. made mid-season: the schedule starts where the season is ────────────
do $$
declare lid uuid; r jsonb; sides text;
begin
  reset role;
  -- weeks 1-3 are behind us, week 4 is the next one up
  update nfl_slate set kickoff = now() - interval '20 days' where season = '2026' and week = 1;
  update nfl_slate set kickoff = now() - interval '13 days' where season = '2026' and week = 2;
  update nfl_slate set kickoff = now() - interval '6 days'  where season = '2026' and week = 3;
  perform ss_true(season_first_open_week('2026') = 4, 'ss4 week 4 is the first open week');

  lid := ss_league('SS Midseason');
  r := native_generate_schedule(lid, 6);
  perform ss_ok(r, 'ss5 a mid-season schedule generates');
  perform ss_true((r ->> 'first_week')::int = 4, 'ss6 and it starts at week 4, not week 1');
  perform ss_true((select min(week) from matchup where league_id = lid) = 4
              and (select max(week) from matchup where league_id = lid) = 9,
    'ss7 weeks 4..9');
  perform ss_true(league_live_week(lid) = 4,
    'ss8 the live week is a week the league can actually play');
  -- same fixtures as the pre-season league, six weeks later on the calendar
  select string_agg((week - 3) || ':' || home_roster_id || '>' || away_roster_id, ',' order by week, home_roster_id)
    into sides from matchup where league_id = lid;
  perform ss_true(sides = current_setting('probe.ss_fingerprint'),
    'ss9 the pairings and sides are the pre-season ones, only renumbered');
  -- every fixture points at its own week's kickoff, not week 1's
  perform ss_true(not exists (
    select 1 from matchup m where m.league_id = lid
      and m.lock_at is distinct from (select min(kickoff) from nfl_slate s
                                       where s.season = '2026' and s.week = m.week)),
    'ss10 each week locks at its own kickoff');
end $$;

-- ── 2. a league that already carries dead weeks heals at the draft door ────
do $$
declare lid uuid; r jsonb; i int;
begin
  lid := ss_league('SS Heal');
  reset role;
  -- the shape a league created before 0280 is sitting in RIGHT NOW: weeks 1..6
  -- generated against a slate that has since moved on.
  update nfl_slate set kickoff = now() + interval '10 years' where season = '2026' and week between 1 and 18;
  perform ss_as('1');
  perform ss_ok(native_generate_schedule(lid, 6), 'ss11 weeks 1..6 generated while nothing had kicked off');
  perform ss_true(league_live_week(lid) = 1, 'ss12 live week 1');
  reset role;
  update nfl_slate set kickoff = now() - interval '20 days' where season = '2026' and week = 1;
  update nfl_slate set kickoff = now() - interval '13 days' where season = '2026' and week = 2;
  update nfl_slate set kickoff = now() - interval '6 days'  where season = '2026' and week = 3;
  -- seed enough pool for a 4-team, 7-round draft
  for i in 1..60 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'ss-' || i, 'SS ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'SSH', i)
      on conflict do nothing;
  end loop;
  perform ss_as('1');
  -- THE DOOR: starting the draft heals the calendar first.
  perform ss_ok(start_draft(lid), 'ss13 the draft starts');
  perform ss_true((select min(week) from matchup where league_id = lid) = 4,
    'ss14 and the dead weeks are gone — the schedule now starts at week 4');
  perform ss_true(league_live_week(lid) = 4, 'ss15 the live week healed with it');
  perform ss_true((select count(distinct week) from matchup where league_id = lid) = 6,
    'ss16 still six weeks — a shift, not a truncation, while there is room');
  perform ss_true(not exists (
    select 1 from matchup m where m.league_id = lid
      and m.lock_at is distinct from (select min(kickoff) from nfl_slate s
                                       where s.season = '2026' and s.week = m.week)),
    'ss17 and each shifted week re-pointed at its own kickoff');
end $$;

-- ── 3. the shift stops at the playoffs, and leaves a played season alone ───
do $$
declare lid uuid; r jsonb;
begin
  lid := ss_league('SS Cap');
  reset role;
  update nfl_slate set kickoff = now() + interval '10 years' where season = '2026' and week between 1 and 18;
  perform ss_as('1');
  -- playoffs at 15 (the default), so a regular season may not pass week 14
  perform ss_true(league_last_regular_week(lid) = 14, 'ss18 the regular season ends at week 14');
  perform ss_ok(native_generate_schedule(lid, 14), 'ss19 a full 14 weeks while nothing has kicked off');
  reset role;
  update nfl_slate set kickoff = now() - interval '6 days' where season = '2026' and week between 1 and 3;
  perform ss_as('1');
  r := native_reschedule(lid);
  perform ss_ok(r, 'ss20 the commissioner can reschedule without drafting');
  perform ss_true((r ->> 'shifted')::int = 3, 'ss21 shifted three weeks');
  perform ss_true((select max(week) from matchup where league_id = lid) = 14,
    'ss22 and it stops at week 14 rather than running into the playoffs');
  perform ss_true((select min(week) from matchup where league_id = lid) = 4, 'ss23 starting at week 4');
  -- a second call is a no-op: the first week is open now
  r := native_reschedule(lid);
  perform ss_true((r ->> 'shifted')::int = 0, 'ss24 rescheduling twice does nothing the second time');
  -- and a league that has played something is never renumbered under its feet
  reset role;
  update matchup set status = 'final' where league_id = lid and week = 4;
  update nfl_slate set kickoff = now() - interval '1 day' where season = '2026' and week between 4 and 6;
  perform ss_as('1');
  r := native_reschedule(lid);
  perform ss_true((r ->> 'shifted')::int = 0 and (r ->> 'why') = 'season underway',
    'ss25 a season underway is left exactly where it is');
  reset role;
  raise notice 'schedule-start probes done';
end $$;

-- put the calendar back exactly as it was handed to us
update nfl_slate s set kickoff = b.kickoff from ss_slate_backup b
  where s.season = b.season and s.week = b.week and s.home = b.home;
drop table ss_slate_backup;

select 'ALL SCHEDULE-START PROBES PASSED' as status;
