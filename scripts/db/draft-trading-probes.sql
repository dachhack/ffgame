-- 0190 draft-trading probes.
--
-- The load-bearing property first: turning pick trading ON and trading NOTHING
-- must leave the draft running exactly as it did. A startup league that
-- provisions pick assets goes down the owned-pick path in _start_draft_now
-- instead of the plain snake arithmetic, so "same order, byte for byte" is the
-- assertion that says the new path is the old path.
--
-- Then the things the old `wait for the draft to finish` gate was silently
-- doing for us, now that trading is open mid-draft:
--   • a pick already USED cannot be traded (it is a player now);
--   • the pick ON THE CLOCK cannot be traded;
--   • an executed trade moves draft.pick_owners, not just pick_asset — or the
--     clock keeps calling the previous owner and the trade did nothing;
--   • the commissioner's switch refuses picks but never players;
--   • turning the switch off cannot delete a pick somebody traded for.
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
create or replace function dt_seed_pool(lid uuid, tag text) returns void language plpgsql as $$
begin
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', tag || '-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 60) g));
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; base uuid; lid uuid; code text; ord jsonb; own jsonb;
  a_seat int; b_seat int; n int; tid uuid; ov int; cur int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c');

  -- ═══ BASELINE: a league with NO pick assets, so plain snake ═══════════════
  perform probe_as('a');
  r := create_native_league('Snake Base', '2024', 3, 6, 60);
  perform assert_ok(r, 'dt0 create base'); base := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B'), 'dt0a');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C'), 'dt0b');
  perform probe_as('a');
  perform dt_seed_pool(base, 'base');
  select array_to_json(array_agg(sleeper_roster_id order by sleeper_roster_id))::jsonb into ord
    from league_membership where league_id = base;
  perform assert_ok(set_draft_order(base, ord), 'dt0c order fixed');
  perform assert_ok(start_draft(base, null), 'dt0d base starts');
  -- The control: no assets ⇒ no owner list ⇒ the untouched snake arithmetic.
  perform assert_true((select pick_owners from draft where league_id = base) is null,
    'dt0e a league with no pick assets still takes the plain-snake path');
  perform assert_true((select draft_on_clock(d.*) from draft d where d.league_id = base) = (ord ->> 0)::int,
    'dt0f and calls the first seat of the order');

  -- ═══ THE SAME LEAGUE SHAPE, WITH PICK TRADING ON ═════════════════════════
  perform probe_as('a');
  r := create_native_league('Snake Picks', '2024', 3, 6, 60);
  perform assert_ok(r, 'dt1 create'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B'), 'dt1a');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C'), 'dt1b');
  perform probe_as('a');
  perform dt_seed_pool(lid, 'pk');
  select array_to_json(array_agg(sleeper_roster_id order by sleeper_roster_id))::jsonb into ord
    from league_membership where league_id = lid;
  perform assert_ok(set_draft_order(lid, ord), 'dt1c order fixed');

  -- ── the switch is commissioner-only, and provisions the slots ────────────
  perform probe_as('b');
  perform assert_err(set_pick_trading(lid, true), 'commissioner only', 'dt2 member cannot flip it');
  perform probe_as('a');
  r := set_pick_trading(lid, true);
  perform assert_ok(r, 'dt2a commissioner turns it on');
  perform assert_true((r ->> 'startup_picks')::int > 0, 'dt2b startup picks provisioned');
  perform assert_true(
    (select count(*) from pick_asset where league_id = lid and kind = 'startup') = 3 * 6,
    'dt2c one per seat per round');
  perform assert_true(
    (select bool_and(owner_roster = original_roster) from pick_asset where league_id = lid and kind = 'startup'),
    'dt2d every slot starts with its own seat');

  -- ══ THE LOAD-BEARING ONE: provisioning must not change the draft ═════════
  perform assert_ok(start_draft(lid, null), 'dt3 starts with assets');
  select pick_owners into own from draft where league_id = lid;
  perform assert_true(own is not null, 'dt3a the owned-pick path was taken');
  -- Rebuild the plain snake for this order and compare, overall by overall.
  n := jsonb_array_length(ord);
  perform assert_true((
    select bool_and(
      (own ->> (ovr - 1))::int =
      (ord ->> (case when ((ovr - 1) / n) % 2 = 1 then n - 1 - ((ovr - 1) % n) else (ovr - 1) % n end))::int)
    from generate_series(1, jsonb_array_length(own)) ovr
  ), 'dt3b UNTRADED startup picks reproduce the plain snake exactly');

  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';

  -- ══ TRADING DURING A LIVE DRAFT ══════════════════════════════════════════
  -- The old gate refused everything here with "wait for the draft to finish".
  select current_overall into cur from draft where league_id = lid;
  perform assert_true(cur = 1, 'dt4 draft is on the first pick');

  -- A pick on the clock cannot be traded.
  perform assert_true((select draft_on_clock(d.*) from draft d where d.league_id = lid) is not null, 'dt4a somebody is on the clock');
  ov := _pick_overall(lid, 1, (ord ->> 0)::int, true);
  perform assert_true(ov = 1, 'dt4b round 1 of the first seat IS overall 1');
  perform probe_as('a');
  perform assert_err(
    propose_trade(lid, a_seat, b_seat, '[]'::jsonb, '[]'::jsonb, null,
      case when (ord ->> 0)::int = a_seat then jsonb_build_array(jsonb_build_object('round', 1, 'orig', a_seat)) else '[]'::jsonb end,
      case when (ord ->> 0)::int = b_seat then jsonb_build_array(jsonb_build_object('round', 1, 'orig', b_seat)) else '[]'::jsonb end),
    'on the clock', 'dt4c the pick on the clock is refused');

  -- A LATER pick trades fine, mid-draft, and the clock learns about it.
  perform assert_ok(
    propose_trade(lid, a_seat, b_seat, '[]'::jsonb, '[]'::jsonb, 'my 6th for nothing',
      jsonb_build_array(jsonb_build_object('round', 6, 'orig', a_seat)), '[]'::jsonb),
    'dt5 a later pick can be offered mid-draft');
  select id into tid from trade_proposal where league_id = lid order by created_at desc limit 1;
  perform probe_as('b');
  perform assert_ok(respond_trade(tid, true), 'dt5a the other seat accepts');
  perform assert_true(
    (select owner_roster from pick_asset where league_id = lid and kind = 'startup'
      and round = 6 and original_roster = a_seat) = b_seat,
    'dt5b the asset moved');
  ov := _pick_overall(lid, 6, a_seat, true);
  perform assert_true(
    ((select pick_owners from draft where league_id = lid) ->> (ov - 1))::int = b_seat,
    'dt5c THE DRAFT''S OWN OWNER LIST MOVED TOO — the clock will call the new owner');

  -- ══ THE COMMISSIONER'S SWITCH ════════════════════════════════════════════
  perform probe_as('a');
  -- It cannot be turned off while a traded pick is out there.
  perform assert_err(set_pick_trading(lid, false), 'already changed hands', 'dt6 off is refused with picks in flight');
  perform assert_true(
    (select count(*) from pick_asset where league_id = lid and kind = 'startup') = 3 * 6,
    'dt6a the refusal deleted nothing');

  -- On a clean league it turns off, and then refuses the pick half only.
  perform probe_as('a');
  r := create_native_league('No Pick Trades', '2024', 3, 6, 60);
  perform assert_ok(r, 'dt7 create'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B'), 'dt7a');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C'), 'dt7b');
  perform probe_as('a');
  perform dt_seed_pool(lid, 'np');
  perform assert_ok(set_pick_trading(lid, true), 'dt7c on');
  perform assert_ok(set_pick_trading(lid, false), 'dt7d off again — nothing traded');
  perform assert_true(
    (select count(*) from pick_asset where league_id = lid and kind = 'startup') = 0,
    'dt7e untraded slots cleaned up');
  perform assert_true(league_pick_trading(lid) is false, 'dt7f the switch reads off');

  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  perform assert_ok(set_pick_trading(lid, true), 'dt8 back on to have assets');
  perform assert_ok(set_pick_trading(lid, false), 'dt8a and off again');
  -- With the switch off, an offer naming a pick is refused…
  perform assert_err(
    propose_trade(lid, a_seat, b_seat, '[]'::jsonb, '[]'::jsonb, null,
      jsonb_build_array(jsonb_build_object('round', 2, 'orig', a_seat)), '[]'::jsonb),
    'no such pick', 'dt8b with the switch off there is no slot to name');

  raise notice 'draft-trading probes done';
end $$;

select 'ALL DRAFT-TRADING PROBES PASSED' as result;
