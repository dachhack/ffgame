-- DIVISION probes (0215) — labels on seats, and everything derived from them:
-- activation semantics, standings carrying the label, division winners taking
-- the top playoff seeds, and rematch weeks preferring divisional opponents.
-- Run with ON_ERROR_STOP; every failed assertion raises.
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- One 4-team league for the whole suite. Seats 2–4 stay unclaimed — divisions
-- are seat facts, not user facts, so nobody else needs to log in.
create or replace function div_fixture() returns uuid language plpgsql as $$
declare r jsonb; lid uuid;
begin
  perform probe_as('a');
  r := create_native_league('Two Divisions', '2026', 4, 5, 60);
  if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL div fixture: %', r; end if;
  return (r ->> 'league_id')::uuid;
end $$;

-- ── 1. the label RPC's gates ─────────────────────────────────────────────────
do $$
declare lid uuid; r jsonb;
begin
  lid := div_fixture();
  perform probe_as('b');
  perform assert_err(set_team_division(lid, 1, 'East'), 'commissioner', 'dv1a outsiders do not draw the map');
  perform probe_as('a');
  perform assert_err(set_team_division(lid, 9, 'East'), 'no such seat', 'dv1b a seat that does not exist');
  perform assert_err(set_team_division(lid, 1, repeat('x', 25)), '24', 'dv1c names cap at 24 characters');
  perform assert_ok(set_team_division(lid, 1, '  East  '), 'dv1d set (and the label is trimmed)');
  perform assert_true((select division from league_membership where league_id = lid and sleeper_roster_id = 1) = 'East',
    'dv1e trimmed label stored');
  perform assert_ok(set_team_division(lid, 1, ''), 'dv1f empty clears');
  perform assert_true((select division from league_membership where league_id = lid and sleeper_roster_id = 1) is null,
    'dv1g cleared to null');
end $$;

-- ── 2. activation: all seats labeled, at least two labels ────────────────────
do $$
declare lid uuid;
begin
  lid := div_fixture();
  perform probe_as('a');
  perform assert_true(not league_divisions_active(lid), 'dv2a unlabeled league: inactive');
  perform set_team_division(lid, 1, 'East');
  perform set_team_division(lid, 2, 'East');
  perform assert_true(not league_divisions_active(lid), 'dv2b HALF-labeled league: still inactive — no partial maps');
  perform set_team_division(lid, 3, 'East');
  perform set_team_division(lid, 4, 'East');
  perform assert_true(not league_divisions_active(lid), 'dv2c one label for everyone is not divisions');
  perform set_team_division(lid, 3, 'West');
  perform set_team_division(lid, 4, 'West');
  perform assert_true(league_divisions_active(lid), 'dv2d two full divisions: active');
end $$;

-- ── 3 + 4. standings carry the label; division winners take the top seeds ────
do $$
declare lid uuid; r jsonb; seeds jsonb;
begin
  lid := div_fixture();
  perform probe_as('a');
  perform set_team_division(lid, 1, 'East'); perform set_team_division(lid, 2, 'East');
  perform set_team_division(lid, 3, 'West'); perform set_team_division(lid, 4, 'West');

  -- Season: 1 goes 3-0, 2 goes 2-1, 3 goes 1-2, 4 goes 0-3. Global standings
  -- read 1,2,3,4 — but the West's best team is 3.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, 1, 4, 'final', 100, 50), (lid, 1, 2, 3, 'final', 90, 60),
    (lid, 2, 1, 3, 'final', 100, 55), (lid, 2, 2, 4, 'final', 88, 40),
    (lid, 3, 1, 2, 'final', 100, 70), (lid, 3, 3, 4, 'final', 80, 45);

  r := league_standings(lid);
  perform assert_true((r -> 0 ->> 'roster_id')::int = 1 and (r -> 0 ->> 'division') = 'East',
    'dv3a standings stay in global order and carry the division');
  perform assert_true((r -> 1 ->> 'roster_id')::int = 2, 'dv3b the wildcard-quality team is second in the TABLE');

  r := league_seed_standings(lid);
  perform assert_true((r -> 0 ->> 'roster_id')::int = 1 and (r -> 1 ->> 'roster_id')::int = 3
    and (r -> 2 ->> 'roster_id')::int = 2 and (r -> 3 ->> 'roster_id')::int = 4,
    'dv4a THE POINT: seeding reads 1,3,2,4 — each division''s best team before any wildcard');

  -- The bracket honors it: with 4 playoff teams, the 1-seed hosts the 4-seed.
  update draft set status = 'complete' where league_id = lid;
  r := generate_playoffs(lid);
  perform assert_ok(r, 'dv4b bracket generates');
  seeds := r -> 'bracket' -> 'seeds';
  perform assert_true(seeds = '[1, 3, 2, 4]'::jsonb,
    'dv4c the West winner is the 2-seed despite the worse record — divisions mean something');

  -- Clear ONE label: divisions deactivate, and seeding is the standings again.
  delete from matchup where league_id = lid and is_playoff;
  update league set settings_json = settings_json - 'playoff_bracket' where id = lid;
  perform set_team_division(lid, 4, null);
  r := generate_playoffs(lid);
  perform assert_ok(r, 'dv4d regenerate without divisions');
  perform assert_true((r -> 'bracket' -> 'seeds') = '[1, 2, 3, 4]'::jsonb,
    'dv4e half a map is no map: seeding falls back to the pure standings');
end $$;

-- ── 5. rematch weeks prefer divisional opponents ─────────────────────────────
do $$
declare lid uuid; r jsonb; wk4_div int;
begin
  lid := div_fixture();
  perform probe_as('a');
  perform set_team_division(lid, 1, 'East'); perform set_team_division(lid, 2, 'East');
  perform set_team_division(lid, 3, 'West'); perform set_team_division(lid, 4, 'West');

  -- 4 teams → weeks 1–3 are the full round-robin; weeks 4–5 are rematches.
  r := native_generate_schedule(lid, 5);
  perform assert_ok(r, 'dv5a 5-week schedule generates');
  perform assert_true((r ->> 'matchups')::int = 10, 'dv5b 2 games × 5 weeks');
  -- Round-robin weeks are untouched: every pair met exactly once in weeks 1–3.
  perform assert_true((
    select count(distinct least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id))
    from matchup where league_id = lid and week <= 3) = 6,
    'dv5c weeks 1–3 are still the complete round-robin');
  -- Rematch weeks pair inside the divisions: 1v2 and 3v4, both weeks.
  select count(*) into wk4_div from matchup m
    join league_membership h on h.league_id = lid and h.sleeper_roster_id = m.home_roster_id
    join league_membership a on a.league_id = lid and a.sleeper_roster_id = m.away_roster_id
  where m.league_id = lid and m.week in (4, 5) and h.division = a.division;
  perform assert_true(wk4_div = 4,
    'dv5d THE POINT: all four rematch games are divisional — the extra weeks are rivalry weeks');

  -- Divisions off → rematch weeks are plain circle-method repeats (no error,
  -- no divisional constraint). The count is the assertion: regeneration works.
  perform set_team_division(lid, 4, null);
  r := native_generate_schedule(lid, 5);
  perform assert_ok(r, 'dv5e regenerate without divisions still works');
  perform assert_true((select count(*) from matchup where league_id = lid and not is_playoff) = 10,
    'dv5f same shape, no divisional demand');
end $$;

select 'ALL DIVISION PROBES PASSED' as result;
