-- 0125 co-manager + waitlist probes. Run with ON_ERROR_STOP; failures raise.
--
-- The sealed_pick section runs under SET ROLE authenticated: these probes exist
-- to exercise RLS, and the scratch runner's superuser BYPASSES row security —
-- a superuser "probe" of a policy proves nothing at all.
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
create or replace function probe_uid(u text) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-00000000000' || u)::uuid
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
on conflict (id) do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- ── 1. a full league, and the waiting room ───────────────────────────────────
do $$
declare r jsonb; lid uuid; code text;
begin
  perform probe_as('a');
  r := create_native_league('TM Probe League', '2026', 4, 7, 60);
  perform assert_ok(r, 'tm1 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.tm_lid', lid::text, false);
  perform set_config('probe.tm_code', code, false);

  perform probe_as('b'); perform assert_ok(native_join(code, 'Seat B'), 'tm2 b joins');
  perform probe_as('c'); perform assert_ok(native_join(code, 'Seat C'), 'tm3 c joins');
  perform probe_as('d'); perform assert_ok(native_join(code, 'Seat D'), 'tm4 d joins — full');

  -- the fifth joiner used to bounce off 'league is full'; now the join
  -- SUCCEEDS as a waitlist entry, visibly and idempotently
  perform probe_as('e');
  r := native_join(code);
  perform assert_ok(r, 'tm5 full-league join succeeds');
  perform assert_true(r ->> 'status' = 'waitlisted', 'tm6 …as waitlisted');
  -- scoped to THIS league: e may be waitlisted elsewhere by an earlier suite
  perform assert_true(exists (select 1 from jsonb_array_elements(my_waitlist()) x
                               where (x ->> 'league_id')::uuid = lid), 'tm7 e sees the waiting room');
  r := native_join(code);
  perform assert_true(r ->> 'status' = 'waitlisted', 'tm8 idempotent re-join');
  perform assert_true((select count(*) from jsonb_array_elements(my_waitlist()) x
                        where (x ->> 'league_id')::uuid = lid) = 1, 'tm9 still one row');

  -- the commissioner sees the pool
  perform probe_as('a');
  perform assert_true(jsonb_array_length(admin_league_joiners(lid)) = 1, 'tm10 joiner pool has e');
end $$;

-- ── 2. co-manager grants ─────────────────────────────────────────────────────
do $$
declare r jsonb; lid uuid := current_setting('probe.tm_lid')::uuid; bseat int;
begin
  perform probe_as('a');
  select sleeper_roster_id into bseat from league_membership
    where league_id = lid and app_user_id = probe_uid('b');
  perform set_config('probe.tm_bseat', bseat::text, false);

  -- gates: non-commish may not grant; ownerless seat refuses; owner refuses
  perform probe_as('c');
  perform assert_err(commish_set_manager(lid, bseat, p_app_user_id => probe_uid('e')), 'forbidden', 'tm11 member cannot grant');
  perform probe_as('a');
  perform assert_err(commish_set_manager(lid, bseat, p_app_user_id => probe_uid('b')), 'already own', 'tm12 owner not a co-manager');
  perform assert_err(commish_set_manager(lid, bseat, p_email => 'nobody@test.dev'), 'no account', 'tm13 unknown email refused');

  -- the real grant, straight from the waitlist — which it clears
  perform assert_ok(commish_set_manager(lid, bseat, p_app_user_id => probe_uid('e')), 'tm14 e co-manages seat B');
  perform probe_as('e');
  perform assert_true(not exists (select 1 from jsonb_array_elements(my_waitlist()) x
                                   where (x ->> 'league_id')::uuid = lid), 'tm15 waitlist row cleared');
  perform assert_true(owns_roster(lid, bseat), 'tm16 owns_roster opens to the co-manager');
  perform assert_ok(set_team_name(lid, bseat, 'Two Headed Team'), 'tm17 co-manager renames');

  -- my_teams: e sees the seat as a co-manager, with B''s pick identity
  r := my_teams();
  perform assert_true(jsonb_array_length(r) = 1, 'tm18 my_teams has the seat');
  perform assert_true((r -> 0 ->> 'comanager')::boolean, 'tm19 flagged comanager');
  perform assert_true((r -> 0 ->> 'pick_user_id')::uuid = probe_uid('b'), 'tm20 pick identity = the OWNER');
  -- …and b sees the same seat as their own
  perform probe_as('b');
  r := my_teams();
  perform assert_true((r -> 0 ->> 'comanager')::boolean = false, 'tm21 owner not flagged');
  perform assert_true((r -> 0 ->> 'pick_user_id')::uuid = probe_uid('b'), 'tm22 owner picks as self');

  perform probe_as('a');
  perform assert_true(jsonb_array_length(team_managers(lid)) = 1, 'tm23 manager list has one grant');
end $$;

-- ── 3. sealed_pick RLS — the part that makes co-management real ──────────────
do $$
declare lid uuid := current_setting('probe.tm_lid')::uuid;
        bseat int := current_setting('probe.tm_bseat')::int;
        cseat int; mid uuid; n int;
begin
  perform probe_as('a');
  select sleeper_roster_id into cseat from league_membership
    where league_id = lid and app_user_id = probe_uid('c');
  -- a week-1 matchup, B vs C; the native probes seeded a FUTURE week-1 kickoff,
  -- so the 0058 window-lock trigger lets rows through
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values ('2026', 1, 'SEA', 'KC', 'snf', '2026-09-09T20:20:00-04:00') on conflict do nothing;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 1, bseat, cseat, 'scheduled') returning id into mid;
  perform set_config('probe.tm_mid', mid::text, false);

  -- Everything below runs as the authenticated role, or it proves nothing.
  set local role authenticated;

  -- e (co-manager) writes THE OWNER'S row — the entire design in one insert
  perform probe_as('e');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id)
    values (mid, probe_uid('b'), 'snf', 'S1', 'probe-player', null);
  perform assert_true(true, 'tm24 co-manager writes owner row');

  -- …and reads it back through the co-manager select policy
  select count(*) into n from sealed_pick where matchup_id = mid and app_user_id = probe_uid('b');
  perform assert_true(n = 1, 'tm25 co-manager reads owner row');

  -- e updates it (unlocked) — the update policy
  update sealed_pick set metric_id = 'probe-metric'
    where matchup_id = mid and app_user_id = probe_uid('b') and roster_slot = 'S1';
  select count(*) into n from sealed_pick
    where matchup_id = mid and app_user_id = probe_uid('b') and metric_id = 'probe-metric';
  perform assert_true(n = 1, 'tm26 co-manager updates owner row');

  -- d (a member, NOT a co-manager) must not write b's rows
  perform probe_as('d');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, probe_uid('b'), 'snf', 'S2', 'probe-player-2');
    raise exception 'PROBE FAIL tm27 — a non-co-manager wrote someone else''s pick';
  exception when insufficient_privilege then
    perform assert_true(true, 'tm27 stranger rejected');
  end;

  -- e's grant is league-scoped: e may not write b's rows via a DIFFERENT
  -- league's matchup (none exists here — the closest expressible check: e may
  -- not write rows for c, a seat e does not co-manage)
  perform probe_as('e');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, probe_uid('c'), 'snf', 'S1', 'probe-player-3');
    raise exception 'PROBE FAIL tm28 — co-manager wrote a seat they do not manage';
  exception when insufficient_privilege then
    perform assert_true(true, 'tm28 wrong seat rejected');
  end;

  reset role;
end $$;

-- ── 4. detach ────────────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.tm_lid')::uuid;
        bseat int := current_setting('probe.tm_bseat')::int;
begin
  perform probe_as('a');
  perform assert_err(commish_set_manager(lid, bseat, p_app_user_id => probe_uid('d'), p_remove => true), 'not a co-manager', 'tm29 removing a non-grant errors');
  perform assert_ok(commish_set_manager(lid, bseat, p_app_user_id => probe_uid('e'), p_remove => true), 'tm30 detach');
  perform probe_as('e');
  perform assert_true(not owns_roster(lid, bseat), 'tm31 access gone with the grant');
  perform assert_true(jsonb_array_length(my_teams()) = 0, 'tm32 my_teams empty again');
end $$;

-- ── 5. the members list carries wallet balances (0130) ──────────────────────
-- The commissioner's grant/dock lever needs the number it's moving: coin on
-- every row, 0 for a wallet that was never minted, live after seed and dock.
do $$
declare lid uuid := current_setting('probe.tm_lid')::uuid;
        bseat int := current_setting('probe.tm_bseat')::int;
        r jsonb;
begin
  perform probe_as('a');
  select e into r from jsonb_array_elements(admin_league_members(lid)) e
    where (e ->> 'roster_id')::int = bseat;
  perform assert_true(r ? 'coin' and (r ->> 'coin')::numeric = 0, 'tm33 unminted wallet reads 0');
  perform assert_ok(commish_seed_coin(lid, bseat, 37), 'tm34 seed 37');
  select e into r from jsonb_array_elements(admin_league_members(lid)) e
    where (e ->> 'roster_id')::int = bseat;
  perform assert_true((r ->> 'coin')::numeric = 37, 'tm35 balance surfaces');
  perform assert_ok(commish_seed_coin(lid, bseat, -12), 'tm36 dock 12');
  select e into r from jsonb_array_elements(admin_league_members(lid)) e
    where (e ->> 'roster_id')::int = bseat;
  perform assert_true((r ->> 'coin')::numeric = 25, 'tm37 dock reflected');
end $$;

-- ── 6. league-wide coin levers (0131) ────────────────────────────────────────
-- Bulk lands on every seat (b sits at 25 from §5, so +10 → 35), clear zeroes
-- the whole league, and both keep the ledger invariant: sum(delta) == balance.
do $$
declare lid uuid := current_setting('probe.tm_lid')::uuid;
        bseat int := current_setting('probe.tm_bseat')::int;
        r jsonb; n numeric;
begin
  perform probe_as('a');
  r := commish_bulk_coin(lid, 10);
  perform assert_true((r ->> 'ok')::boolean and (r ->> 'teams')::int >= 2, 'tm38 bulk hits every seat');
  select coins into n from team_wallet where league_id = lid and roster_id = bseat;
  perform assert_true(n = 35, 'tm39 bulk is additive (25 + 10)');
  perform assert_err(commish_bulk_coin(lid, 0), 'amount required', 'tm40 zero bulk refused');
  r := commish_clear_coin(lid);
  perform assert_true((r ->> 'ok')::boolean and (r ->> 'cleared')::int >= 2, 'tm41 clear touches funded wallets');
  select coalesce(sum(coins), -1) into n from team_wallet where league_id = lid;
  perform assert_true(n = 0, 'tm42 every wallet at exactly 0');
  select coalesce(sum(delta), -1) into n from coin_ledger where league_id = lid;
  perform assert_true(n = 0, 'tm43 ledger sums to the balances (0)');
  r := commish_clear_coin(lid);
  perform assert_true((r ->> 'ok')::boolean and (r ->> 'cleared')::int = 0, 'tm44 clearing zeroes is a no-op');
  perform probe_as('d');
  perform assert_err(commish_bulk_coin(lid, 5), 'forbidden', 'tm45 member cannot bulk');
  perform assert_err(commish_clear_coin(lid), 'forbidden', 'tm46 member cannot clear');
end $$;

select 'ALL TEAM-MANAGER PROBES PASSED' as result;
