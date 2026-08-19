-- 0164 taxi/IR probes: STASH SPOTS + builder-driven DRAFT ROUNDS.
--
-- What must hold:
--   • set_league_roster_shape: commissioner-only, classic-only, pre-draft only;
--     rounds re-derive as starters + bench + taxi + ir and must land in the
--     draft machinery's 5..25 window;
--   • a builder save (set_league_classic_slots) re-syncs rounds too;
--   • set_roster_spot: taxi cap = shape.taxi; IR cap = shape.ir AND the player
--     carries a real IR/Out designation; back-to-active needs an open seat
--     (active < starters + bench);
--   • a stashed player cannot be STARTED — the sealed_pick trigger refuses;
--   • players outside native_roster pass the trigger untouched.
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
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; mid uuid; i int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Taxi League', '2026', 4, 7, 60);
  perform assert_ok(r, 'tx0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'TX-C'), 'tx1 c joins');

  -- classic-only, commissioner-only
  perform probe_as('b');
  perform assert_err(set_league_roster_shape(lid, 6, 1, 1), 'classic-league', 'tx2 shape refused in drip');
  perform probe_as('a');
  perform assert_ok(set_league_classic_access(lid, true), 'tx2a admin unlocks classic');
  perform probe_as('b');
  perform assert_ok(set_league_game_mode(lid, 'classic', 1), 'tx2b commish flips classic');
  perform probe_as('c');
  perform assert_err(set_league_roster_shape(lid, 6, 1, 1), 'commissioner', 'tx3 member refused');

  -- shape saves; rounds derive starters(4) + bench(4) + taxi(1) + ir(1) = 10
  perform probe_as('b');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["TE"]}]'::jsonb), 'tx4 builder spec saves');
  r := set_league_roster_shape(lid, 4, 1, 1);
  perform assert_ok(r, 'tx5 shape saves');
  perform assert_true((r ->> 'rounds')::int = 10, 'tx5a rounds = 4+4+1+1');
  perform assert_true((league_game_mode(lid) ->> 'rounds')::int = 10, 'tx5b draft.rounds synced');
  perform assert_true((league_game_mode(lid) -> 'shape' ->> 'bench')::int = 4, 'tx5c shape readable');

  -- derived rounds must fit the 5..25 draft window
  -- The FLOOR is unchanged; the ceiling moved to 99 in 0192, so the message did.
  perform assert_err(set_league_roster_shape(lid, 0, 0, 0), '5–99 rounds', 'tx6 too few rounds refused');

  -- a builder save re-syncs rounds: 5 spots ⇒ 5+4+1+1 = 11
  r := set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["K","DEF"]}]'::jsonb);
  perform assert_ok(r, 'tx7 five-spot spec saves');
  perform assert_true((r ->> 'rounds')::int = 11, 'tx7a rounds resynced by the builder');

  -- roster fixture: c (roster 2) holds 10 players — 8 will stay active
  -- (cap = starters 5 + bench 4 = 9), one goes taxi, one goes IR.
  reset role;
  for i in 1..8 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank) values (lid, 'tx-a' || i, 'Active ' || i, 'RB', 'ZZ', i);
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 2, 'tx-a' || i, 'draft');
  end loop;
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'tx-taxi1', 'Taxi One', 'WR', 'ZZ', 90), (lid, 'tx-hurt', 'Hurt Guy', 'TE', 'ZZ', 91);
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, 2, 'tx-taxi1', 'draft'), (lid, 2, 'tx-hurt', 'draft');
  insert into injury_status (player_slug, status) values ('tx-hurt', 'IR')
    on conflict (player_slug) do update set status = 'IR';
  set local role authenticated;

  -- designations: caps + the IR injury gate
  perform probe_as('c');
  perform assert_ok(set_roster_spot(lid, 'tx-taxi1', 'taxi'), 'tx8 taxi stash ok');
  perform assert_err(set_roster_spot(lid, 'tx-a1', 'taxi'), 'taxi is full', 'tx8a taxi cap bites');
  perform assert_err(set_roster_spot(lid, 'tx-a1', 'ir'), 'not IR/Out', 'tx8b healthy player refused IR');
  perform assert_ok(set_roster_spot(lid, 'tx-hurt', 'ir'), 'tx8c IR player stashes');
  perform assert_err(set_roster_spot(lid, 'tx-x', 'taxi'), 'not rostered', 'tx8d unknown player refused');

  -- back to active needs an open seat: 8 actives fill the 9-cap minus... no —
  -- cap is 9 and 8 are active, so ONE comes back; the second finds it full.
  perform assert_ok(set_roster_spot(lid, 'tx-hurt', 'active'), 'tx9 one seat open — return ok');
  perform assert_err(set_roster_spot(lid, 'tx-taxi1', 'active'), 'active roster is full', 'tx9a full active refuses return');
  perform assert_ok(set_roster_spot(lid, 'tx-hurt', 'ir'), 'tx9b re-stash for the start test');

  -- a stashed player cannot be started; unrostered slugs pass the trigger
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
  values (lid, 1, 2, 1, 'scheduled') returning id into mid;
  set local role authenticated;
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
  values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S1', 'tx-a1'),
         (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S2', 'probe-free');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S3', 'tx-hurt');
    raise exception 'PROBE FAIL tx10 — an IR player got into a lineup';
  exception when check_violation then null;
  end;
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S3', 'tx-taxi1');
    raise exception 'PROBE FAIL tx10a — a taxi player got into a lineup';
  exception when check_violation then null;
  end;

  -- the shape freezes once the draft leaves pending
  reset role;
  update draft set status = 'live' where league_id = lid;
  set local role authenticated;
  perform probe_as('b');
  perform assert_err(set_league_roster_shape(lid, 5, 1, 1), 'locks once the draft', 'tx11 frozen mid-draft');

end $$;

select 'ALL TAXI-IR PROBES PASSED' as status;
