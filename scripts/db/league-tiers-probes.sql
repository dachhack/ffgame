-- TIERS INSIDE ONE LEAGUE (0507) — in-season promotion and relegation.
-- Divisions are the tiers; each tier plays only inside itself; every period
-- the bottom movers of a tier swap with the top movers of the tier below on
-- the period's record (points break ties); only the current period's weeks
-- exist. Run with ON_ERROR_STOP; every failed assertion raises.
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', case when u = '' then '' else '00000000-0000-0000-0000-00000000000' || u end, false);
  perform set_config('app.email', case when u = '' then '' else u || '@test.dev' end, false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- An 8-team league, Premier = seats 1–4, Championship = seats 5–8.
create or replace function tier_fixture(labelled boolean default true) returns uuid language plpgsql as $$
declare r jsonb; lid uuid; i int;
begin
  perform probe_as('a');
  r := create_native_league('Tiered', '2026', 8, 5, 60);
  if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL tier fixture: %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  if labelled then
    for i in 1..8 loop perform set_team_division(lid, i, case when i <= 4 then 'Premier' else 'Championship' end); end loop;
  end if;
  return lid;
end $$;

-- Every regular-season matchup of week `wk` final: the lower roster id scores more.
create or replace function tier_finish(lid uuid, wk int) returns void language sql as $$
  update matchup set status = 'final', home_final = 200 - home_roster_id * 10, away_final = 200 - away_roster_id * 10
   where league_id = lid and week = wk and not is_playoff;
$$;
create or replace function tier_of(lid uuid, rid int) returns text language sql as $$
  select division from league_membership where league_id = lid and sleeper_roster_id = rid;
$$;
-- How many of the weeks' matchups cross a tier line.
create or replace function cross_tier(lid uuid, w1 int, w2 int) returns int language sql as $$
  select count(*)::int from matchup m
   where m.league_id = lid and m.week between w1 and w2 and not m.is_playoff
     and tier_of(lid, m.home_roster_id) is distinct from tier_of(lid, m.away_roster_id);
$$;

-- ── 1. the switch's gates ───────────────────────────────────────────────────
do $$
declare lid uuid;
begin
  lid := tier_fixture(false);
  perform probe_as('b');
  perform assert_err(set_league_tiers(lid, true), 'commissioner', 'tr1a outsiders cannot turn tiers on');
  perform probe_as('a');
  perform assert_err(set_league_tiers(lid, true), 'division', 'tr1b no divisions, no tiers');
  lid := tier_fixture(true);
  perform assert_err(set_league_tiers(lid, true, 1), '2 to 6', 'tr1c a period is 2–6 weeks');
  perform assert_err(set_league_tiers(lid, true, 4, 4), '1 to 3', 'tr1d movers are 1–3');
  perform assert_err(set_league_tiers(lid, true, 4, 3), 'at most 2', 'tr1e 3 movers each way from a 4-team tier is too many');
  perform assert_err(set_league_tiers(lid, true, 4, 2, array['Premier']), 'every division once', 'tr1f the order names every tier');
  perform assert_err(set_league_tiers(lid, true, 4, 2, array['Premier', 'Premier']), 'every division once', 'tr1g …once each');
end $$;

-- ── 2–6. a season of tier play ──────────────────────────────────────────────
do $$
declare lid uuid; r jsonb; st int; cap int;
begin
  lid := tier_fixture(true);
  perform probe_as('a');
  r := set_league_tiers(lid, true, 4, 2, array['Premier', 'Championship']);
  perform assert_ok(r, 'tr2a tiers on');
  st := (r ->> 'start')::int;
  cap := league_last_regular_week(lid);
  perform assert_true((select count(distinct week) from matchup where league_id = lid and not is_playoff) = 4,
    format('tr2b only the first period exists (weeks %s–%s), got %s weeks', st, st + 3,
      (select count(distinct week) from matchup where league_id = lid and not is_playoff)));
  perform assert_true((select count(*) from matchup where league_id = lid and week = st) = 4, 'tr2c four games a week, two per tier');
  perform assert_true(cross_tier(lid, st, st + 3) = 0, 'tr2d nobody plays across a tier line');
  perform assert_true((select count(distinct least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id))
                         from matchup where league_id = lid and week between st and st + 2 and tier_of(lid, home_roster_id) = 'Premier') = 6,
    'tr2e three weeks are a full round robin inside a 4-team tier');

  -- 3. not final yet: nothing moves
  perform probe_as('');
  r := tiers_advance(lid);
  perform assert_true(r ? 'skipped', 'tr3a a period still being played does not move anyone');
  perform probe_as('b');
  perform assert_err(tiers_advance(lid), 'worker', 'tr3b a member cannot run the boundary');

  -- 4. the period ends: bottom two of Premier (seats 3, 4) and top two of
  -- Championship (seats 5, 6) swap.
  perform tier_finish(lid, st); perform tier_finish(lid, st + 1); perform tier_finish(lid, st + 2); perform tier_finish(lid, st + 3);
  perform probe_as('');
  r := tiers_advance(lid);
  perform assert_ok(r, 'tr4a the boundary runs');
  perform assert_true((r ->> 'moved')::int = 4, format('tr4b four teams moved, got %s', r));
  perform assert_true(tier_of(lid, 3) = 'Championship' and tier_of(lid, 4) = 'Championship', 'tr4c the bottom two went down');
  perform assert_true(tier_of(lid, 5) = 'Premier' and tier_of(lid, 6) = 'Premier', 'tr4d the top two came up');
  perform assert_true(tier_of(lid, 1) = 'Premier' and tier_of(lid, 8) = 'Championship', 'tr4e everyone else stayed');
  perform assert_true((select count(*) from league_tier_move where league_id = lid and after_week = st + 3) = 4, 'tr4f the moves are logged');
  perform assert_true((select count(distinct week) from matchup where league_id = lid and not is_playoff and week > st + 3) = 4,
    'tr4g the next period is built');
  perform assert_true(cross_tier(lid, st + 4, st + 7) = 0, 'tr4h …inside the tiers as they now stand');
  perform assert_true(exists (select 1 from matchup where league_id = lid and week = st + 4
                               and 5 in (home_roster_id, away_roster_id) and 1 in (home_roster_id, away_roster_id))
                      or exists (select 1 from matchup where league_id = lid and week between st + 4 and st + 7
                               and 5 in (home_roster_id, away_roster_id) and 1 in (home_roster_id, away_roster_id)),
    'tr4i a promoted team meets its new tier');
  perform assert_true(exists (select 1 from league_message where league_id = lid and body like '%Tiers after week%'),
    'tr4j the league hears about it');

  -- 5. idempotent
  r := tiers_advance(lid);
  perform assert_true(r ? 'skipped' and (select count(*) from league_tier_move where league_id = lid) = 4,
    'tr5a running it again moves nobody');

  -- 6. what a member sees
  perform probe_as('a');
  r := league_tiers(lid);
  perform assert_ok(r, 'tr6a the read');
  perform assert_true(jsonb_array_length(r -> 'tiers') = 2 and (r -> 'tiers' -> 0 ->> 'tier') = 'Premier'
                      and jsonb_array_length(r -> 'tiers' -> 0 -> 'teams') = 4, 'tr6b two tiers, top first, four teams each');
  perform assert_true(jsonb_array_length(r -> 'moves') = 4, 'tr6c the moves come with it');
  perform assert_true((r ->> 'period_from')::int = st + 4, 'tr6d the table is the current period''s');

  -- 7. off again: the rest of the regular season, league-wide
  r := set_league_tiers(lid, false);
  perform assert_ok(r, 'tr7a tiers off');
  perform assert_true((select count(distinct week) from matchup where league_id = lid and not is_playoff and week >= st + 4) = cap - (st + 4) + 1,
    'tr7b every remaining regular-season week is scheduled again');
  perform assert_true(cross_tier(lid, st + 4, cap) > 0, 'tr7c …across the whole league');
  r := league_tiers(lid);
  perform assert_true((r ->> 'on')::boolean = false, 'tr7d the read says off');
end $$;

-- ── 8. a week that has started is never rebuilt ─────────────────────────────
do $$
declare lid uuid; r jsonb; st int;
begin
  lid := tier_fixture(true);
  perform probe_as('a');
  r := set_league_tiers(lid, true, 2, 1);
  perform assert_ok(r, 'tr8a tiers on, two-week periods, one mover');
  st := (r ->> 'start')::int;
  update matchup set status = 'locked' where league_id = lid and week = st;
  r := set_league_tiers(lid, false);
  -- st has started, so the rebuild runs from st + 1 and leaves st alone
  perform assert_ok(r, 'tr8b off with week one under way');
  perform assert_true((r ->> 'rebuilt_from')::int = st + 1, format('tr8c the rebuild starts after the started week, got %s', r));
  perform assert_true((select count(*) from matchup where league_id = lid and week = st and status = 'locked') = 4,
    'tr8d the started week is untouched');
end $$;

select 'ALL LEAGUE-TIERS PROBES PASSED';
