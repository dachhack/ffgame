-- 0314 probes: A MID-WEEK PICKUP JOINS THE LIVE WEEK'S POOL.
--
-- What must hold:
--   • a scheduled week is rewritten from the rosters, as before;
--   • a LIVE week gains every active player missing from its pool, appended,
--     and loses nothing — a dropped man who already played stays;
--   • a stashed (IR/taxi) pickup is not added to a live week;
--   • a final week is never touched.
\set QUIET on
\pset pager off
create or replace function pl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function pl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function pl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000006' || u, false); perform set_config('app.email', 'pl' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000601', 'pl01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000601', 'pl01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000000601';

do $$
declare r jsonb; lid uuid; seat int; other int; pool8 jsonb; pool9 jsonb; n int;
  slugs8 text[]; slugs9 text[];
begin
  perform pl_as('01');
  r := create_native_league('PickupLiveWeek', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform pl_ok(r, 'pl0 classic league'); lid := (r ->> 'league_id')::uuid;
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'plp-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'SEA', 'exp', 0))
    from generate_series(1, 12) g));
  select min(sleeper_roster_id) into seat from league_membership where league_id = lid;
  select max(sleeper_roster_id) into other from league_membership where league_id = lid;
  -- Two weeks: 8 live, 9 scheduled, 7 final.
  delete from matchup where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values
    (lid, 7, seat, other, 'final'), (lid, 8, seat, other, 'live'), (lid, 9, seat, other, 'scheduled');
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, seat, 'plp-1', 'draft'), (lid, seat, 'plp-2', 'draft');
  update draft set status = 'complete' where league_id = lid;

  -- pl1. the live week has no pool row yet: the refresh gives it one (add-only from nothing)
  n := native_materialize(lid);
  select array_agg(coalesce(e ->> 'slug', e ->> 'player_slug') order by 1) into slugs8
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e where sl.league_id = lid and sl.week = 8 and sl.roster_id = seat;
  perform pl_true(slugs8 = array['plp-1', 'plp-2'], 'pl1 live week gets the roster — got ' || coalesce(slugs8::text, 'null'));
  select array_agg(coalesce(e ->> 'slug', e ->> 'player_slug') order by 1) into slugs9
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e where sl.league_id = lid and sl.week = 9 and sl.roster_id = seat;
  perform pl_true(slugs9 = array['plp-1', 'plp-2'], 'pl1 scheduled week rewritten — got ' || coalesce(slugs9::text, 'null'));
  perform pl_true(not exists (select 1 from sleeper_lineup where league_id = lid and week = 7), 'pl1 the final week is untouched');

  -- pl2. a Sunday pickup joins the live week; a drop does not leave it
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, seat, 'plp-3', 'waiver');
  delete from native_roster where league_id = lid and roster_id = seat and slug = 'plp-2';
  perform native_materialize(lid);
  select array_agg(coalesce(e ->> 'slug', e ->> 'player_slug') order by 1) into slugs8
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e where sl.league_id = lid and sl.week = 8 and sl.roster_id = seat;
  perform pl_true(slugs8 = array['plp-1', 'plp-2', 'plp-3'], 'pl2 live week: the pickup appended, the drop kept — got ' || coalesce(slugs8::text, 'null'));
  select array_agg(coalesce(e ->> 'slug', e ->> 'player_slug') order by 1) into slugs9
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e where sl.league_id = lid and sl.week = 9 and sl.roster_id = seat;
  perform pl_true(slugs9 = array['plp-1', 'plp-3'], 'pl2 scheduled week: rewritten to the current roster — got ' || coalesce(slugs9::text, 'null'));
  perform pl_true((select count(*) from sleeper_lineup where league_id = lid and week = 8 and roster_id = seat) = 1, 'pl2 one row per seat per week');

  -- pl3. idempotent: a second refresh appends nothing
  perform native_materialize(lid);
  perform pl_true((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = lid and week = 8 and roster_id = seat) = 3, 'pl3 a second refresh appends nothing');

  -- pl4. a stashed pickup does not join the live week
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values (lid, seat, 'plp-4', 'waiver', 'ir');
  perform native_materialize(lid);
  perform pl_true((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = lid and week = 8 and roster_id = seat) = 3, 'pl4 an IR pickup is not appended to the live week');

  -- pl5. the appended entry is marked, and reads through the pool reader's keys
  perform pl_true(exists (select 1 from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
    where sl.league_id = lid and sl.week = 8 and sl.roster_id = seat and e ->> 'slug' = 'plp-3' and e ->> 'player_slug' = 'plp-3' and (e ->> 'added')::boolean),
    'pl5 the pickup carries slug, player_slug and the added mark');
end $$;
select 'ALL PICKUP-LIVE-WEEK PROBES PASSED' as result;
