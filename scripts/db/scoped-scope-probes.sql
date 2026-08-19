-- 0197 scoped-scope probes.
--
--   • a scoped bonus may name SLOTS and FLAGS, and both survive the round trip
--     through the sanitizer;
--   • the sanitizer still throws away what it doesn't recognise, and still
--     drops a rule with no VALUE in it;
--   • a starting spot may require a FLAG, deduped case-insensitively and
--     bounded, and the spec keeps it;
--   • and every existing shape still round-trips unchanged, because a scope
--     nobody set must not start appearing.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; rule jsonb; spot jsonb;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev')
    on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000a';
  perform probe_as('a');

  r := create_native_league('Scoped Scopes', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ss0 classic league'); lid := (r ->> 'league_id')::uuid;

  -- ══ SLOT + FLAG SCOPES SURVIVE ═══════════════════════════════════════════
  r := set_league_scoring(lid, 0, 1, 0, '[
    {"slot": ["S3", "s5"], "bonus_mult": 1.5},
    {"flag": ["  Franchise Tag  ", "Rookie Deal"], "bonus_pts": 2},
    {"pos": ["QB"], "slot": ["S1"], "flag": ["Franchise Tag"], "td_bonus": 2}
  ]'::jsonb);
  perform assert_ok(r, 'ss1 three scoped rules save');
  perform assert_true(jsonb_array_length(r -> 'scoped') = 3, 'ss1a all three survived');
  rule := (r -> 'scoped') -> 0;
  perform assert_true(rule -> 'slot' @> '"S3"'::jsonb and rule -> 'slot' @> '"S5"'::jsonb,
    'ss1b slot ids are uppercased and kept, got ' || (rule ->> 'slot'));
  rule := (r -> 'scoped') -> 1;
  perform assert_true(rule -> 'flag' @> '"Franchise Tag"'::jsonb,
    'ss1c a flag label is TRIMMED but not uppercased — it is displayed as typed, got ' || (rule ->> 'flag'));
  rule := (r -> 'scoped') -> 2;
  perform assert_true((rule ? 'pos') and (rule ? 'slot') and (rule ? 'flag') and (rule ->> 'td_bonus') = '2',
    'ss1d scopes stack on one rule');

  -- The sanitizer still throws away nonsense and valueless rules.
  r := set_league_scoring(lid, 0, 1, 0, '[
    {"slot": ["../etc/passwd"], "bonus_pts": 1},
    {"flag": ["ok"], "junk": "dropped"},
    {"slot": ["S2"]}
  ]'::jsonb);
  perform assert_ok(r, 'ss2 save');
  perform assert_true(jsonb_array_length(r -> 'scoped') = 1,
    'ss2a a bad slot token, a valueless flag rule and a valueless slot rule all go, got ' || (r ->> 'scoped'));
  perform assert_true(not ((r -> 'scoped') -> 0 ? 'slot'), 'ss2b …and the surviving rule kept no bad token');
  perform assert_true(not ((r -> 'scoped') -> 0 ? 'junk'), 'ss2c unknown keys never land');

  -- A rule with NO scope at all is still legal — it pays everyone.
  r := set_league_scoring(lid, 0, 1, 0, '[{"bonus_mult": 1.2}]'::jsonb);
  perform assert_ok(r, 'ss3 an unscoped rule');
  perform assert_true(jsonb_array_length(r -> 'scoped') = 1 and not ((r -> 'scoped') -> 0 ? 'slot'),
    'ss3a and it gains no scope it was not given');

  -- ══ A SPOT MAY REQUIRE A FLAG ════════════════════════════════════════════
  r := set_league_classic_slots(lid, '[
    {"pos": ["QB"]},
    {"pos": ["RB"], "flags": ["Franchise Tag", "franchise tag", "  Keeper  "]},
    {"pos": ["WR"], "teams": ["KC"], "max_exp": 0, "flags": ["Rookie Deal"]}
  ]'::jsonb);
  perform assert_ok(r, 'ss4 a spec with flag conditions');
  spot := (r -> 'slots') -> 1;
  perform assert_true(jsonb_array_length(spot -> 'flags') = 2,
    'ss4a the duplicate label is deduped case-insensitively, got ' || (spot ->> 'flags'));
  spot := (r -> 'slots') -> 2;
  perform assert_true((spot ? 'flags') and (spot ? 'teams') and (spot ->> 'max_exp') = '0',
    'ss4b a flag condition stacks with the team and tenure filters');
  spot := (r -> 'slots') -> 0;
  perform assert_true(not (spot ? 'flags'), 'ss4c a spot with no flag condition gains none');

  -- Bounds.
  perform assert_err(set_league_classic_slots(lid,
    jsonb_build_array(jsonb_build_object('pos', '["QB"]'::jsonb, 'flags', jsonb_build_array(repeat('x', 25))))),
    'flag name too long', 'ss5 an absurd label is refused');
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"],"flags":["a","b","c","d","e","f","g","h","i"]}]'::jsonb),
    'at most 8 flags', 'ss5a nine flags on one spot is refused');

  raise notice 'scoped-scope probes done';
end $$;

select 'ALL SCOPED-SCOPE PROBES PASSED' as result;
