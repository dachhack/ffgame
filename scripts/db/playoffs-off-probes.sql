-- 0246 probes: playoffs can be turned off.
--
-- The dangerous case is not the setting, it is 0162's AUTO poke: it fires from
-- any member's league load, all season, and before this it would build a
-- bracket for a league that wanted none. So the assertions below spend most of
-- their effort on the two ways a bracket gets built, and on the promise that
-- turning them off can never erase a result.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function po_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000f0c0' || u, false);
  perform set_config('app.email', 'po' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0c01', 'po1@test.dev')
on conflict (id) do nothing;

do $$
declare
  r   jsonb;
  lg  uuid;
  n   int;
begin
  perform po_as('1');
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000f0c01', 'po1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000f0c01';

  r := create_native_league('Playoff Off', '2026', 8, 12, 90);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: fixture league refused — %', r ->> 'error';
  end if;
  lg := (r ->> 'league_id')::uuid;

  -- ── the default is unchanged: a league that never spoke still plays 4 ─────
  if league_playoff_teams(lg) <> 4 then
    raise exception 'PROBE FAIL: default playoff teams is now %', league_playoff_teams(lg);
  end if;

  -- ── OFF is accepted, and reads back as off ───────────────────────────────
  r := set_playoff_rules(lg, 0, null);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: 0 was refused — %', r ->> 'error';
  end if;
  if league_playoff_teams(lg) <> 0 then
    raise exception 'PROBE FAIL: after setting 0 the league reports %', league_playoff_teams(lg);
  end if;
  if (r ->> 'playoff_teams')::int <> 0 then
    raise exception 'PROBE FAIL: the reply reports % teams', r ->> 'playoff_teams';
  end if;

  -- ── the AUTO poke must be a QUIET no-op, not an error ────────────────────
  -- It runs on every league load for every member; an error here would paint
  -- a banner on a screen that is working exactly as configured.
  r := generate_playoffs(lg, null, true);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: the auto poke errored on an off league — %', r ->> 'error';
  end if;
  if coalesce((r ->> 'generated')::boolean, false) then
    raise exception 'PROBE FAIL: the auto poke built a bracket for an off league';
  end if;
  if exists (select 1 from matchup where league_id = lg and is_playoff) then
    raise exception 'PROBE FAIL: an off league has playoff matchups';
  end if;

  -- ── the COMMISSIONER's own call is refused, and says why ─────────────────
  r := generate_playoffs(lg, null, false);
  if coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: a bracket was generated for an off league';
  end if;
  if (r ->> 'error') not like '%no playoffs%' then
    raise exception 'PROBE FAIL: unhelpful refusal — %', r ->> 'error';
  end if;

  -- ── back ON, and the knobs still work ────────────────────────────────────
  r := set_playoff_rules(lg, 6, 15);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: could not turn playoffs back on — %', r ->> 'error';
  end if;
  if league_playoff_teams(lg) <> 6 or league_playoff_start(lg) <> 15 then
    raise exception 'PROBE FAIL: back on reads % teams / week %',
      league_playoff_teams(lg), league_playoff_start(lg);
  end if;

  -- a shape the bracket builder does not know is still refused, and the
  -- refusal now names 0 as an option
  r := set_playoff_rules(lg, 5, null);
  if coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: 5 playoff teams was accepted';
  end if;
  if (r ->> 'error') not like '%0 (no playoffs)%' then
    raise exception 'PROBE FAIL: the refusal does not offer 0 — %', r ->> 'error';
  end if;

  -- ── GUILLOTINE TURNS THEM OFF ON ITS OWN ─────────────────────────────────
  -- 17 weeks of regular season and a bracket booked for week 15 cannot both be
  -- true, and the survivor is already the result.
  r := set_league_format(lg, 'guillotine');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: guillotine refused — %', r ->> 'error';
  end if;
  if league_playoff_teams(lg) <> 0 then
    raise exception 'PROBE FAIL: a guillotine league still books % playoff teams', league_playoff_teams(lg);
  end if;

  -- and switching away leaves them off rather than silently re-booking a
  -- bracket the commissioner never asked for again
  r := set_league_format(lg, 'standard');
  if league_playoff_teams(lg) <> 0 then
    raise exception 'PROBE FAIL: leaving guillotine re-enabled playoffs by itself';
  end if;

  raise notice 'playoffs-off probes done';
end $$;
select 'ALL PLAYOFFS-OFF PROBES PASSED' as result;
