-- 0245 probes: a guillotine league plays all 17 weeks.
--
-- The interesting cases are the ones a client cannot be trusted to remember:
-- flipping an EXISTING league to guillotine, flipping it back, and the create
-- path where no schedule exists yet and the client is about to make one. The
-- arithmetic that matters is that N teams need N-1 scored weeks — 17 weeks is
-- what lets an 18-team guillotine reach one survivor at all.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function gw_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000e0b0' || u, false);
  perform set_config('app.email', 'gw' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e0b01', 'gw1@test.dev')
on conflict (id) do nothing;

do $$
declare
  r    jsonb;
  lg   uuid;
  wks  int;
begin
  perform gw_as('1');
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000e0b01', 'gw1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000e0b01';

  r := create_native_league('Blade 18', '2026', 18, 15, 90);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: could not create the fixture — %', r ->> 'error';
  end if;
  lg := (r ->> 'league_id')::uuid;

  -- ── AT CREATION there is no schedule yet, so the format change must NOT
  -- invent one; the client generates it moments later at the right length.
  r := set_league_format(lg, 'guillotine');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: guillotine refused pre-draft — %', r ->> 'error';
  end if;
  if exists (select 1 from matchup where league_id = lg) then
    raise exception 'PROBE FAIL: the format change conjured a schedule before the client asked for one';
  end if;

  -- the client's half
  r := native_generate_schedule(lg, 17);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: a 17-week schedule was refused — %', r ->> 'error';
  end if;
  select count(distinct week) into wks from matchup where league_id = lg;
  if wks <> 17 then raise exception 'PROBE FAIL: % weeks, expected 17', wks; end if;

  -- ── AN 18-TEAM GUILLOTINE CAN ACTUALLY FINISH. One falls per completed
  -- week, so the season has to carry N-1 = 17 of them.
  if wks < (select count(*) - 1 from league_membership where league_id = lg) then
    raise exception 'PROBE FAIL: % weeks cannot eliminate down to one of % teams',
      wks, (select count(*) from league_membership where league_id = lg);
  end if;

  -- every seat plays every week: the floor reads a missing matchup as 0, so a
  -- bye would be an automatic elimination
  if exists (
    select 1 from league_membership m, generate_series(1, 17) w(week)
    where m.league_id = lg
      and not exists (select 1 from matchup mu
        where mu.league_id = lg and mu.week = w.week
          and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id))
  ) then
    raise exception 'PROBE FAIL: a seat byes in an 18-team guillotine season';
  end if;

  -- ── THE COMMISSIONER FLIP, which is the half no client owns. Back to
  -- standard: the bracket needs weeks 15-17 again, so the season shortens.
  r := set_league_format(lg, 'standard');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: could not switch back to standard — %', r ->> 'error';
  end if;
  select count(distinct week) into wks from matchup where league_id = lg;
  if wks <> 14 then
    raise exception 'PROBE FAIL: standard should re-cut to 14 weeks, got %', wks;
  end if;

  -- and forward again, on a league that already has a schedule
  r := set_league_format(lg, 'guillotine');
  if (r ->> 'schedule_error') is not null then
    raise exception 'PROBE FAIL: the re-cut failed — %', r ->> 'schedule_error';
  end if;
  select count(distinct week) into wks from matchup where league_id = lg;
  if wks <> 17 then
    raise exception 'PROBE FAIL: the flip to guillotine left % weeks', wks;
  end if;
  if (r ->> 'weeks')::int <> 17 then
    raise exception 'PROBE FAIL: the reply reports % weeks', r ->> 'weeks';
  end if;

  -- ── VAMPIRE IS NOT GUILLOTINE. It keeps its playoffs, so it keeps 14.
  r := set_league_format(lg, 'vampire');
  select count(distinct week) into wks from matchup where league_id = lg;
  if wks <> 14 then
    raise exception 'PROBE FAIL: vampire should hold 14 weeks, got %', wks;
  end if;

  raise notice 'guillotine-weeks probes done';
end $$;
select 'ALL GUILLOTINE-WEEKS PROBES PASSED' as result;
