-- 0192 roster-size probes.
--
--   • a roster bigger than the old 25 is CREATABLE, and 99 is the new edge;
--   • the roster SHAPE (starters + bench + taxi + IR) reaches the same edge,
--     with no per-field ceiling of its own left to clamp it silently;
--   • and the constraint that was doing the real work all along — THE POOL HAS
--     TO FILL THE DRAFT — now REFUSES IN NUMBERS ("120 picks, 60 rounds x 2
--     teams, pool holds 50") rather than in a shrug, then lets the same draft
--     start once the pool covers it.
\set QUIET on
\pset pager off

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
/** n players into the league's pool, tagged so suites don't collide. */
create or replace function rs_seed_pool(lid uuid, tag text, n int) returns void language plpgsql as $$
begin
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', tag || '-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, n) g));
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; big uuid; code text; rounds_now int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  -- ══ THE OLD CEILING IS GONE ══════════════════════════════════════════════
  -- 40 rounds was refused outright before this migration ("roster size must be
  -- 5–25"), which is the size a dynasty with a taxi squad actually wants.
  r := create_native_league('Deep Roster', '2024', 2, 40, 60);
  perform assert_ok(r, 'rs1 a 40-round league is creatable');
  big := (r ->> 'league_id')::uuid;
  perform assert_true((select rounds from draft where league_id = big) = 40, 'rs1a the draft carries 40 rounds');

  -- The new edge, and one past it.
  r := create_native_league('At The Edge', '2024', 2, 99, 60);
  perform assert_ok(r, 'rs2 99 is allowed');
  r := create_native_league('Over The Edge', '2024', 2, 100, 60);
  perform assert_err(r, 'roster size must be 5–99', 'rs2a 100 is refused, and says the new bound');
  r := create_native_league('Under The Floor', '2024', 2, 4, 60);
  perform assert_err(r, 'roster size must be 5–99', 'rs2b the floor still holds');

  -- set_roster_rules moves an existing league to the same edge.
  perform assert_ok(set_roster_rules(big, 60, null), 'rs3 a pending league resizes past 25');
  perform assert_true((select rounds from draft where league_id = big) = 60, 'rs3a and the draft agrees');
  perform assert_err(set_roster_rules(big, 120, null), 'roster size must be 5–99', 'rs3b past the edge refused');

  -- ══ THE ROSTER SHAPE HAS NO CEILING OF ITS OWN ═══════════════════════════
  -- Classic only: the shape is the starting spec plus its stashes.
  r := create_native_league('Shapely', '2024', 2, 12, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'rs4 classic league');
  lid := (r ->> 'league_id')::uuid;
  -- Bench 40 / taxi 12 / IR 10 used to CLAMP to 20 / 8 / 8 without saying so.
  r := set_league_roster_shape(lid, 40, 12, 10);
  perform assert_ok(r, 'rs4a a deep shape saves');
  perform assert_true((r -> 'shape' ->> 'bench')::int = 40, 'rs4b bench 40 stored, not clamped to 20');
  perform assert_true((r -> 'shape' ->> 'taxi')::int = 12, 'rs4c taxi 12 stored, not clamped to 8');
  perform assert_true((r -> 'shape' ->> 'ir')::int = 10, 'rs4d IR 10 stored, not clamped to 8');
  rounds_now := (select rounds from draft where league_id = lid);
  perform assert_true(rounds_now = (r ->> 'rounds')::int and rounds_now > 25,
    'rs4e the draft took the derived round count, past the old cap');
  -- Past the total, it refuses rather than clamping — and names the sum.
  perform assert_err(set_league_roster_shape(lid, 90, 20, 20), 'the draft needs 5–99 rounds',
    'rs4f a shape over the total is refused, not silently trimmed');

  -- ══ THE POOL HAS TO FILL THE DRAFT ═══════════════════════════════════════
  -- This is the constraint the arbitrary cap was standing in for. `big` is a
  -- 2-seat league at 60 rounds: 120 picks needed.
  perform assert_ok(set_roster_rules(big, 60, null), 'rs5 still 60 rounds');
  perform probe_as('b');
  perform assert_ok(native_join((select invite_code from league where id = big), 'B'), 'rs5a a second seat');
  perform probe_as('a');
  perform rs_seed_pool(big, 'rs-small', 50);
  perform assert_err(start_draft(big, null), 'it needs 120 picks (60 rounds x 2 teams)',
    'rs5b a draft bigger than its pool is refused at the door, in numbers');
  perform assert_true((select status from draft where league_id = big) = 'pending',
    'rs5c and the refusal left the draft pending');
  -- Seed enough and the same draft starts.
  perform rs_seed_pool(big, 'rs-big', 130);
  perform assert_ok(start_draft(big, null), 'rs6 with a pool that covers it, the draft starts');
  perform assert_true((select status from draft where league_id = big) = 'live', 'rs6a live');

  -- An unseeded pool still fails first, with its own message.
  r := create_native_league('No Pool', '2024', 2, 10, 60);
  perform assert_ok(r, 'rs7 create');
  code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B2'), 'rs7a join');
  perform probe_as('a');
  perform assert_err(start_draft((r ->> 'league_id')::uuid, null), 'player pool not seeded',
    'rs7b an empty pool is still its own error');

  raise notice 'roster-size probes done';
end $$;

select 'ALL ROSTER-SIZE PROBES PASSED' as result;
