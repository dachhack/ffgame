-- 0189 draft-lottery probes.
--
-- A lottery is the one draft control where "it ran" is not enough — the whole
-- point is that the result can be inspected afterwards. So these assert the
-- SHAPE and the FAIRNESS, not just the ok:
--
--   • commissioner-only, and pending-only (the order locks at start);
--   • shares are validated as a whole — a bad entry writes NONE of them;
--   • a drawn order is a permutation: every seat exactly once;
--   • a zero share still drafts (behind everyone drawn), it is not excluded;
--   • an overwhelming share wins the top pick almost always — the weights are
--     actually being used, which a uniform shuffle would also pass "is it a
--     permutation" with;
--   • the recorded result names each seat's share and the odds it had.
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
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; ids int[]; top int; wins int := 0; i int;
  a_seat int; b_seat int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c');

  perform probe_as('a');
  r := create_native_league('Lottery FC', '2024', 3, 5, 60);
  perform assert_ok(r, 'lo0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B'), 'lo0a b joins');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C'), 'lo0b c joins');

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = lid;
  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';

  -- ── commissioner only ────────────────────────────────────────────────────
  perform probe_as('b');
  perform assert_err(set_lottery_shares(lid, jsonb_build_object(b_seat, 999)), 'commissioner only', 'lo1 member cannot set shares');
  perform assert_err(run_draft_lottery(lid), 'commissioner only', 'lo1a member cannot run it');

  -- ── shares validate as a whole ───────────────────────────────────────────
  perform probe_as('a');
  perform assert_err(set_lottery_shares(lid, jsonb_build_object('999', 5)), 'no seat', 'lo2 unknown seat refused');
  perform assert_err(set_lottery_shares(lid, jsonb_build_object(a_seat, -1)), 'whole number', 'lo2a negative refused');
  perform assert_err(set_lottery_shares(lid, jsonb_build_object(a_seat, 1.5)), 'whole number', 'lo2b fraction refused');
  perform assert_true((select lottery_shares from draft where league_id = lid) is null,
    'lo2c a refused set wrote nothing');

  -- ── a real share table ───────────────────────────────────────────────────
  r := set_lottery_shares(lid, jsonb_build_object(a_seat, 1000, b_seat, 1));
  perform assert_ok(r, 'lo3 shares set');
  perform assert_true((r -> 'shares' ->> a_seat::text)::int = 1000, 'lo3a stored');

  -- ── the draw is a permutation, every time ────────────────────────────────
  for i in 1 .. 25 loop
    r := run_draft_lottery(lid);
    perform assert_ok(r, 'lo4 lottery runs');
    perform assert_true(jsonb_array_length(r -> 'order') = array_length(ids, 1), 'lo4a every seat drawn');
    perform assert_true(
      (select count(distinct v::int) from jsonb_array_elements_text(r -> 'order') v) = array_length(ids, 1),
      'lo4b no seat drawn twice');
    perform assert_true(
      (select bool_and(v::int = any(ids)) from jsonb_array_elements_text(r -> 'order') v),
      'lo4c only real seats drawn');
    -- C holds no share at all, so it defaults to 1 and can still be drawn.
    top := ((r -> 'order' -> 0)::text)::int;
    if top = a_seat then wins := wins + 1; end if;
  end loop;
  -- 1000 : 1 : 1 — the top seat should come up essentially always. Twenty of
  -- twenty-five is a floor loose enough never to flake and tight enough that a
  -- uniform shuffle (expected ~8) fails it.
  perform assert_true(wins >= 20, format('lo5 the heavy share wins the top pick (got %s/25)', wins));

  -- ── what the draw recorded ───────────────────────────────────────────────
  perform assert_true(jsonb_array_length(r -> 'result') = array_length(ids, 1), 'lo6 result covers every seat');
  perform assert_true((r -> 'result' -> 0 ->> 'share') is not null, 'lo6a share recorded');
  perform assert_true((r -> 'result' -> 0 ->> 'odds')::numeric > 0.9, 'lo6b the top seat had >90% odds on its draw');
  perform assert_true((select draft_order from draft where league_id = lid) = (r -> 'order'), 'lo6c order stored');

  -- ── a member can read it back ────────────────────────────────────────────
  perform probe_as('c');
  r := draft_lottery(lid);
  perform assert_ok(r, 'lo7 any member reads the lottery');
  perform assert_true(jsonb_array_length(r -> 'result') = array_length(ids, 1), 'lo7a result visible to members');
  perform assert_true((r ->> 'locked')::boolean is false, 'lo7b not locked while pending');

  -- ── a ZERO share still drafts ────────────────────────────────────────────
  perform probe_as('a');
  perform assert_ok(set_lottery_shares(lid, jsonb_build_object(a_seat, 0, b_seat, 0)), 'lo8 zero shares');
  r := run_draft_lottery(lid);
  perform assert_ok(r, 'lo8a runs with zeroes');
  perform assert_true(jsonb_array_length(r -> 'order') = array_length(ids, 1), 'lo8b zero-share seats still drafted');

  -- ── and it locks once the draft starts ───────────────────────────────────
  -- start_draft wants a pool to draft FROM, so seed one first.
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'lot-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g));
  perform assert_ok(start_draft(lid, null), 'lo9 draft starts');
  perform assert_err(run_draft_lottery(lid), 'locks once the draft starts', 'lo9a no re-draw mid-draft');
  perform assert_err(set_lottery_shares(lid, jsonb_build_object(a_seat, 5)), 'locks once the draft starts', 'lo9b no re-weighting mid-draft');

  raise notice 'lottery probes done';
end $$;

select 'ALL LOTTERY PROBES PASSED' as result;
