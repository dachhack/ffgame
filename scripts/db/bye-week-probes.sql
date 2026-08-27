-- 0247 probes: a bye is not a zero.
--
-- The bug being pinned here executed a team for not playing: the guillotine
-- floor read a missing matchup as 0, which is always the lowest score. So the
-- assertions below are mostly about WHO SURVIVES a week they sat out — and,
-- just as important, that the blade still falls on somebody. A "fix" that
-- made the guillotine stop eliminating anyone would pass a test that only
-- checked the byed seat.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function bw_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000b1e0' || u, false);
  perform set_config('app.email', 'bw' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b1e01', 'bw1@test.dev')
on conflict (id) do nothing;

do $$
declare
  r        jsonb;
  lg       uuid;
  byer     int;   -- the seat sitting out week 1
  floorman int;   -- the lowest scorer who actually played
  n        int;
  role     text;
  st       jsonb;
  ent      jsonb;
begin
  perform bw_as('1');
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000b1e01', 'bw1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000b1e01';

  -- FIVE teams: odd on purpose. This is the shape the founder can already
  -- build from the team stepper today.
  r := create_native_league('Odd Blade', '2026', 5, 5, 60);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: fixture refused — %', r ->> 'error';
  end if;
  lg := (r ->> 'league_id')::uuid;
  r := set_league_format(lg, 'guillotine');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: guillotine refused — %', r ->> 'error';
  end if;
  update draft set status = 'complete' where league_id = lg;
  r := native_generate_schedule(lg, 17);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: schedule refused — %', r ->> 'error';
  end if;

  -- ── the bye exists, and it is exactly one seat a week ────────────────────
  -- If this ever stops being true the rest of the suite is asserting nothing.
  for n in 1..17 loop
    if (select count(*) from league_membership m
        where m.league_id = lg
          and not exists (select 1 from matchup mu where mu.league_id = lg and mu.week = n
            and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id))) <> 1 then
      raise exception 'PROBE FAIL: week % does not sit exactly one seat', n;
    end if;
  end loop;

  select m.sleeper_roster_id into byer from league_membership m
  where m.league_id = lg
    and not exists (select 1 from matchup mu where mu.league_id = lg and mu.week = 1
      and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id));

  -- ── score week 1 so the byed seat would have been the floor at 0 ─────────
  -- Everyone who played scores 100+; on the old code the byed seat's imputed
  -- 0 wins the race to the bottom outright.
  update matchup set status = 'final',
    home_final = 100 + home_roster_id, away_final = 100 + away_roster_id
  where league_id = lg and week = 1;
  floorman := (select case when mu.home_final <= mu.away_final then mu.home_roster_id else mu.away_roster_id end
    from matchup mu where mu.league_id = lg and mu.week = 1
    order by least(mu.home_final, mu.away_final) asc limit 1);

  r := guillotine_tick(lg);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: the tick errored — %', r ->> 'error';
  end if;

  -- THE POINT OF THE MIGRATION
  if (select eliminated_week from league_membership
      where league_id = lg and sleeper_roster_id = byer) is not null then
    raise exception 'PROBE FAIL: seat % was executed for a week it did not play', byer;
  end if;
  -- …and the blade still fell, on the lowest team that actually played
  if (select count(*) from league_membership where league_id = lg and eliminated_week = 1) <> 1 then
    raise exception 'PROBE FAIL: week 1 eliminated % teams',
      (select count(*) from league_membership where league_id = lg and eliminated_week = 1);
  end if;
  if (select eliminated_week from league_membership
      where league_id = lg and sleeper_roster_id = floorman) is null then
    raise exception 'PROBE FAIL: the real floor (seat %) survived', floorman;
  end if;
  -- the register names the score it died on, not an imputed zero
  if exists (select 1 from league_txn where league_id = lg and kind = 'elimination'
             and note like '%, 0%') then
    raise exception 'PROBE FAIL: an elimination is logged against a 0 score';
  end if;

  -- ── the board does not put a byed team on the block ──────────────────────
  -- The alive list IS the death order on screen; a bye pinned at 0.0 sat at
  -- the top of it all week telling the league that team was about to die.
  -- Park the league ON a week whose byed seat is still alive: the seat that
  -- sits in week 2 may be the one the blade just took, and then there would be
  -- no living bye to assert about.
  select min(w.week) into n from generate_series(2, 17) w(week)
  where exists (
    select 1 from league_membership m
    where m.league_id = lg and m.eliminated_week is null
      and not exists (select 1 from matchup mu where mu.league_id = lg and mu.week = w.week
        and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)));
  if n is null then raise exception 'PROBE FAIL: no week sits a living seat'; end if;
  update matchup set status = 'final',
    home_final = 100 + home_roster_id, away_final = 100 + away_roster_id
  where league_id = lg and week < n;           -- earlier weeks settled…
  select m.sleeper_roster_id into byer from league_membership m
  where m.league_id = lg and m.eliminated_week is null
    and not exists (select 1 from matchup mu where mu.league_id = lg and mu.week = n
      and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id));

  st := guillotine_state(lg);                  -- …so week n is the one in play
  if (st ->> 'week')::int <> n then
    raise exception 'PROBE FAIL: the board is on week %, expected %', st ->> 'week', n;
  end if;
  select e into ent from jsonb_array_elements(st -> 'alive') e
    where (e ->> 'roster_id')::int = byer;
  if ent is null then
    raise exception 'PROBE FAIL: the byed seat is missing from the alive list';
  end if;
  if not coalesce((ent ->> 'bye')::boolean, false) then
    raise exception 'PROBE FAIL: the byed seat is not marked on bye — %', ent;
  end if;
  if ent ->> 'pts' is not null then
    raise exception 'PROBE FAIL: a byed seat reports % points', ent ->> 'pts';
  end if;
  if ((st -> 'alive') -> 0) ->> 'roster_id' = ent ->> 'roster_id' then
    raise exception 'PROBE FAIL: the byed seat sorts to the top of the death list';
  end if;

  -- ── a bye is distinguishable from a schedule nobody has built ────────────
  -- Both look like "no matchup" from a seat, and the client has to tell them
  -- apart to say anything true on the screen.
  role := league_week_role(lg, byer, n);
  if role <> 'bye' then raise exception 'PROBE FAIL: the byed seat reads % at week %', role, n; end if;
  role := league_week_role(lg, floorman, 1);
  if role <> 'playing' then raise exception 'PROBE FAIL: a playing seat reads %', role; end if;
  role := league_week_role(lg, byer, 18);
  if role <> 'unbuilt' then
    raise exception 'PROBE FAIL: a week nobody plays reads % (a bye it is not)', role;
  end if;

  raise notice 'bye-week probes done';
end $$;
select 'ALL BYE-WEEK PROBES PASSED' as result;
