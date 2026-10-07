-- 0449 probes: THE AUTODRAFT KNOWS THE DEFAULT LINEUP TOO.
--
-- Founder, from a fresh classic league after an autodraft: "Autodrafted a
-- team but no RB2." The lineup-aware steps read only the roster builder's
-- spec, so a league that never opened the builder drafted by rank alone.
--   • a classic league with NO builder spec: after one RB, a QB, three WRs
--     and a TE, the open RB 2 is filled before another receiver, even though
--     every receiver on the board outranks every back left;
--   • …and the bench then goes two deep per position before the rank picks;
--   • a league on the 0161 COUNTS (roster_classic) is read the same way;
--   • a league WITH a builder spec is untouched (its spec wins).
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function adl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function adl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function adl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000061' || u, false); perform set_config('app.email', 'adl' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006101', 'adl01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006101', 'adl01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000006101';

-- A pool ranked like the founder's: one back on top, then eight receivers,
-- then the quarterbacks, tight ends, the other backs, kickers, defenses.
-- seed_league_pool ranks rows in the order given.
create or replace function adl_pool() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('slug', 'adl-' || p.pos || '-' || p.i, 'full', 'Adl ' || p.pos || ' ' || p.i, 'pos', p.pos, 'team', 'KC') order by p.ord)
    from (
      select 'RB' as pos, 1 as i, 1 as ord
      union all select 'WR', i, 1 + i from generate_series(1, 8) i
      union all select 'QB', i, 10 + i from generate_series(1, 3) i
      union all select 'TE', i, 13 + i from generate_series(1, 3) i
      union all select 'RB', i, 15 + i from generate_series(2, 6) i
      union all select 'K', i, 21 + i from generate_series(1, 2) i
      union all select 'DEF', i, 23 + i from generate_series(1, 2) i
    ) p
$$;

do $$
declare r jsonb; a uuid; b uuid; c uuid; rounds int; e text; pick text; ppos text; spec jsonb;
begin
  perform adl_as('01');

  -- ══ adl1. NO BUILDER SPEC: THE DEFAULT NINE ═══════════════════════════════
  r := create_native_league('ADL Default', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid;
  perform adl_true(jsonb_typeof((select settings_json -> 'roster_slots' from league where id = a)) is null, 'adl1 the league carries no builder spec');
  perform adl_ok(seed_league_pool(a, adl_pool()), 'adl1a pool');
  select d.rounds into rounds from draft d where d.league_id = a;
  spec := _league_slot_spec(a);
  perform adl_true(jsonb_array_length(spec) = 9 and (spec -> 1 -> 'pos') = '["RB"]'::jsonb and (spec -> 2 -> 'pos') = '["RB"]'::jsonb and (spec -> 6 -> 'pos') = '["RB","WR","TE"]'::jsonb,
    'adl1b the effective lineup is the default nine');
  -- The founder's first six rounds: RB, WR, QB, WR, WR, TE.
  foreach e in array array['adl-RB-1', 'adl-WR-1', 'adl-QB-1', 'adl-WR-2', 'adl-WR-3', 'adl-TE-1'] loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, e, 'draft');
  end loop;
  perform adl_true(jsonb_array_length(_autopick_open_spots(a, 1)) = 1 and (_autopick_open_spots(a, 1) -> 0 -> 'pos') = '["RB"]'::jsonb,
    'adl1c one spot is open, and it is RB 2');
  pick := native_autopick_slug(a, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = a and lp.slug = pick;
  perform adl_true(ppos = 'RB', 'adl1d round 7 fills RB 2 before another receiver (got ' || coalesce(pick, 'null') || ')');
  insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, pick, 'draft');
  -- The lineup is full; the bench goes two deep: a second QB before a fourth
  -- receiver would be depth by rank, but receivers are the top of the board
  -- and WR has 3 spots (WR, WR, FLEX) → up to 6; RB has 3 → up to 6.
  pick := native_autopick_slug(a, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = a and lp.slug = pick;
  perform adl_true(ppos = 'WR', 'adl1e round 8 is bench depth by rank, a receiver (got ' || coalesce(pick, 'null') || ')');

  -- ══ adl2. THE 0161 COUNTS ════════════════════════════════════════════════
  r := create_native_league('ADL Counts', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"roster_classic": {"QB": 1, "RB": 1, "WR": 3, "TE": 1, "FLEX": 1, "K": 1, "DEF": 1}}'::jsonb where id = b;
  perform adl_ok(seed_league_pool(b, adl_pool()), 'adl2 pool');
  select d.rounds into rounds from draft d where d.league_id = b;
  spec := _league_slot_spec(b);
  perform adl_true(jsonb_array_length(spec) = 9 and (select count(*) from jsonb_array_elements(spec) s where s -> 'pos' = '["WR"]'::jsonb) = 3
    and (select count(*) from jsonb_array_elements(spec) s where s -> 'pos' = '["RB"]'::jsonb) = 1,
    'adl2a the counts expand to three WR spots and one RB spot');
  foreach e in array array['adl-WR-1', 'adl-WR-2', 'adl-QB-1', 'adl-WR-3', 'adl-WR-4', 'adl-TE-1'] loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, e, 'draft');
  end loop;
  pick := native_autopick_slug(b, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = b and lp.slug = pick;
  perform adl_true(ppos = 'RB', 'adl2b with WR, WR, WR and the flex held by receivers, the open RB spot is filled (got ' || coalesce(pick, 'null') || ')');

  -- ══ adl3. A BUILDER SPEC STILL WINS ══════════════════════════════════════
  r := create_native_league('ADL Spec', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  c := (r ->> 'league_id')::uuid;
  perform adl_ok(set_league_classic_slots(c, '[{"pos":["QB"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["K"]},{"pos":["DEF"]}]'::jsonb), 'adl3 a lineup with no RB spot');
  perform adl_ok(seed_league_pool(c, adl_pool()), 'adl3a pool');
  select d.rounds into rounds from draft d where d.league_id = c;
  perform adl_true(_league_slot_spec(c) = (select settings_json -> 'roster_slots' from league where id = c), 'adl3b the spec is the lineup');
  foreach e in array array['adl-WR-1', 'adl-QB-1', 'adl-WR-2'] loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (c, 1, e, 'draft');
  end loop;
  pick := native_autopick_slug(c, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = c and lp.slug = pick;
  perform adl_true(ppos in ('WR', 'TE'), 'adl3c no RB spot, no RB taken for the lineup (got ' || coalesce(pick, 'null') || ')');

  raise notice 'autodraft-default-lineup probes done';
end $$;

select 'ALL AUTODRAFT-DEFAULT-LINEUP PROBES PASSED' as result;
