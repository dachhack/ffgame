-- 0143 league-scoring probes: the commissioner's layering knobs.
--
-- What must hold:
--   • commish (or admin) writes; members read (with can_edit false);
--     outsiders get nothing either way;
--   • bounds are enforced with clear errors;
--   • ALL-DEFAULT settings store NOTHING — settings_json.scoring is removed,
--     so "reset" and "never touched" are the same state;
--   • reads always answer complete (defaults fill for missing keys).
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

-- ── 0. fixture: b commissions a league, c joins, d stays outside ────────────
-- (b, not a: 'a' is a probe ADMIN from earlier suites in this shared DB.)
do $$
declare r jsonb; lid uuid; code text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Scoring Knobs League', '2026', 4, 7, 60);
  perform assert_ok(r, 's0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.sc_lid', lid::text, false);
  perform probe_as('c'); perform assert_ok(native_join(code, 'SC-C'), 's1 c joins');
end $$;

-- ── 1. untouched league reads complete defaults ─────────────────────────────
do $$
declare lid uuid := current_setting('probe.sc_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('c');
  r := league_scoring(lid);
  perform assert_ok(r, 's2 member reads');
  perform assert_true((r ->> 'td_bonus')::int = 0 and (r ->> 'yd_mult')::numeric = 1 and (r ->> 'to_penalty')::int = 0,
    's3 defaults fill');
  perform assert_true(not (r ->> 'can_edit')::boolean, 's4 member cannot edit');
  reset role;
end $$;

-- ── 2. commish sets; member sees; outsider bounced; bounds enforced ─────────
do $$
declare lid uuid := current_setting('probe.sc_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_league_scoring(lid, 2, 1.5, 2), 's5 commish sets');
  r := league_scoring(lid);
  perform assert_true((r ->> 'td_bonus')::int = 2 and (r ->> 'yd_mult')::numeric = 1.5 and (r ->> 'to_penalty')::int = 2,
    's6 stored and read back');
  perform assert_true((r ->> 'can_edit')::boolean, 's7 commish can_edit');

  perform assert_err(set_league_scoring(lid, 7, 1, 0), 'TD bonus', 's8 td bound');
  perform assert_err(set_league_scoring(lid, 0, 0.4, 0), 'multiplier', 's9 yd bound');
  perform assert_err(set_league_scoring(lid, 0, 1, 6), 'turnover', 's10 to bound');

  perform probe_as('c');
  perform assert_err(set_league_scoring(lid, 1, 1, 1), 'forbidden', 's11 member cannot set');
  r := league_scoring(lid);
  perform assert_true((r ->> 'td_bonus')::int = 2, 's12 member sees the standing knobs');

  perform probe_as('d');
  perform assert_true(league_scoring(lid) ->> 'error' = 'forbidden', 's13 outsider reads nothing');
  perform assert_err(set_league_scoring(lid, 1, 1, 1), 'forbidden', 's14 outsider cannot set');
  reset role;
end $$;

-- ── 3. all-default stores NOTHING (reset == never touched) ──────────────────
do $$
declare lid uuid := current_setting('probe.sc_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_league_scoring(lid, 0, 1.0, 0), 's15 reset to defaults');
  reset role;
  perform assert_true((select settings_json -> 'scoring' from league where id = lid) is null
    or jsonb_typeof((select settings_json -> 'scoring' from league where id = lid)) = 'null',
    's16 reset removed the key');
  set local role authenticated;
  perform probe_as('c');
  r := league_scoring(lid);
  perform assert_true((r ->> 'td_bonus')::int = 0 and (r ->> 'yd_mult')::numeric = 1 and (r ->> 'to_penalty')::int = 0,
    's17 defaults again after reset');
  reset role;
end $$;

-- ── 4. scoped bonus rules (0145): sanitize, store, read back ────────────────
do $$
declare lid uuid := current_setting('probe.sc_lid')::uuid; r jsonb; sc jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  r := set_league_scoring(lid, 0, 1.0, 0, '[
    {"pos": ["qb", "WR", "??"], "team": ["dal"], "tenure": "rookie", "bonus_mult": 1.5, "bonus_pts": 3},
    {"tenure": "vet4", "td_bonus": 99},
    {"pos": ["TE"]},
    "junk"
  ]'::jsonb);
  perform assert_ok(r, 's18 scoped set accepted');
  sc := league_scoring(lid) -> 'scoped';
  perform assert_true(jsonb_array_length(sc) = 2, 's19 valueless + junk rules dropped');
  perform assert_true(sc -> 0 -> 'pos' = '["QB", "WR"]'::jsonb, 's20 pos codes uppercased, invalid dropped');
  perform assert_true(sc -> 0 ->> 'tenure' = 'rookie' and (sc -> 0 ->> 'bonus_mult')::numeric = 1.5, 's21 scope + values stored');
  perform assert_true((sc -> 1 ->> 'td_bonus')::int = 6, 's22 td bonus clamped to 6');
  -- scoped alone keeps the settings key; clearing scoped + defaults removes it
  perform assert_ok(set_league_scoring(lid, 0, 1.0, 0, '[]'::jsonb), 's23 clear scoped');
  perform assert_true((select settings_json -> 'scoring' from league where id = lid) is null
    or jsonb_typeof((select settings_json -> 'scoring' from league where id = lid)) = 'null',
    's24 all-default + no scoped stores nothing');
  reset role;
end $$;

select 'ALL LEAGUE-SCORING PROBES PASSED' as result;
