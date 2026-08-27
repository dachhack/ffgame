-- 0244 probes: a league may hold up to 32 teams.
--
-- The change is two characters, and that is exactly why it is worth probing:
-- the risk was never the bound itself but the 120-line function body carried
-- across with it. So these assert the NEW bound at both ends AND that a league
-- created at the top of the range still comes out whole — seats, draft,
-- schedule and the contract keys 0218 added. A cap raise that quietly dropped
-- the salary_cap key would pass any test that only counted teams.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function tc_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c0a0' || u, false);
  perform set_config('app.email', 'tc' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0a01', 'tc1@test.dev')
on conflict (id) do nothing;

do $$
declare
  r        jsonb;
  lg       uuid;
  seats    int;
  d        record;
  wks      int;
begin
  perform tc_as('1');
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000c0a01', 'tc1@test.dev')
  on conflict (id) do nothing;
  -- founding a native league is gated on the `native` entitlement (0095), so
  -- the fixture grants itself one; without it every create below returns
  -- "invite-only" and the suite would be asserting the GATE, not the cap.
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c0a01';

  -- ── the new ceiling ──────────────────────────────────────────────────────
  r := create_native_league('Cap 32', '2026', 32, 15, 90);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: 32 teams refused — %', r ->> 'error';
  end if;
  lg := nullif(r ->> 'league_id', '')::uuid;

  -- ── and that it is a CEILING, not a suggestion ───────────────────────────
  r := create_native_league('Cap 33', '2026', 33, 15, 90);
  if coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: 33 teams was accepted';
  elsif (r ->> 'error') not like '%2–32%' then
    raise exception 'PROBE FAIL: the refusal still quotes the old range — %', r ->> 'error';
  end if;

  -- the floor is untouched by the raise
  r := create_native_league('Cap 1', '2026', 1, 15, 90);
  if coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: a 1-team league was accepted';
  end if;

  -- ── the league at the top of the range is WHOLE ──────────────────────────
  -- Every seat exists, not just the count the caller asked for.
  select count(*) into seats from league_membership where league_id = lg;
  if seats <> 32 then
    raise exception 'PROBE FAIL: 32 asked for, % seats minted', seats;
  end if;

  -- the draft came with it, at the rounds requested
  select * into d from draft where league_id = lg;
  if not found then
    raise exception 'PROBE FAIL: no draft row for a 32-team league';
  elsif d.rounds <> 15 then
    raise exception 'PROBE FAIL: rounds % , expected 15', d.rounds;
  end if;

  -- ── the body carried across intact (the real risk of a copied function) ──
  -- 0218's contract keys land on a contract league; if the copy had dropped
  -- the capkeys branch this is where it shows.
  r := create_native_league('Cap 32 contract', '2026', 32, 15, 90, 'auction', 200, 15, 1,
                            null, null, null, 'classic', 'contract', null);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: 32-team contract league refused — %', r ->> 'error';
  else
    if (select settings_json ->> 'salary_cap' from league
        where id = (r ->> 'league_id')::uuid) is null then
      raise exception 'PROBE FAIL: the copied body lost salary_cap';
    end if;
    if (select settings_json ->> 'continuity' from league
        where id = (r ->> 'league_id')::uuid) <> 'contract' then
      raise exception 'PROBE FAIL: the copied body lost continuity';
    end if;
  end if;

  -- ── a schedule can be built for a league this size ───────────────────────
  -- 32 is even, so nobody byes; the point is that generation does not choke on
  -- a field this wide (it pairs any n >= 2 and ghosts an odd one).
  r := native_generate_schedule(lg, 14);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: schedule refused for 32 teams — %', r ->> 'error';
  else
    select count(distinct week) into wks from matchup where league_id = lg;
    if wks <> 14 then
      raise exception 'PROBE FAIL: % weeks generated, expected 14', wks;
    end if;
    -- every seat plays every week, or the guillotine floor (which reads a
    -- missing matchup as 0) would eliminate whoever sat out
    if exists (
      select 1 from league_membership m, generate_series(1, 14) w(week)
      where m.league_id = lg
        and not exists (select 1 from matchup mu
          where mu.league_id = lg and mu.week = w.week
            and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id))
    ) then
      raise exception 'PROBE FAIL: a seat has a week with no matchup in a 32-team league';
    end if;
  end if;

  raise notice 'team-cap probes done';
end $$;
select 'ALL TEAM-CAP PROBES PASSED' as result;
