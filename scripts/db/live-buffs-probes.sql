-- 0155 live-buffs probes: the league switch on real-time power-ups.
--
-- What must hold:
--   • default is ON; the commissioner flips it; a member is refused the flip;
--   • any member reads the switch; an outsider reads nothing;
--   • with the switch OFF, arm_buff refuses BEFORE touching the wallet —
--     no charge, clear error; back ON, the same arm proceeds past the switch
--     (to the wallet, which in this fixture simply reports insufficient).
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

do $$
declare r jsonb; lid uuid; code text; mid uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Buffs League', '2026', 4, 7, 60);
  perform assert_ok(r, 'lb0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'LB-C'), 'lb1 c joins');

  -- a scheduled matchup with c's seat in it, for the arm probe
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
  values (lid, 1, 2, 1, 'scheduled') returning id into mid;

  set local role authenticated;

  -- default on, member-readable, outsider refused
  perform probe_as('c');
  perform assert_true((league_live_buffs(lid) ->> 'on')::boolean, 'lb2 default on');
  perform assert_err(set_league_live_buffs(lid, false), 'commissioner', 'lb3 member cannot flip');
  perform probe_as('d');
  perform assert_err(league_live_buffs(lid), 'forbidden', 'lb4 outsider reads nothing');

  -- commissioner flips off; the switch reads off; arming refuses pre-wallet
  perform probe_as('b');
  perform assert_ok(set_league_live_buffs(lid, false), 'lb5 commish turns off');
  perform probe_as('c');
  perform assert_true(not (league_live_buffs(lid) ->> 'on')::boolean, 'lb6 reads off');
  perform assert_err(arm_buff(mid, 'momentum'), 'turned off', 'lb7 arm refused while off');

  -- hero path while off: adding refused, pure disarm (shrink) allowed
  perform probe_as('b');
  perform assert_ok(set_league_live_buffs(lid, false), 'lb7a off again for hero probes');
  perform probe_as('c');
  perform assert_err(hero_set_buffs(mid, '["momentum"]'::jsonb), 'turned off', 'lb7b hero add refused while off');
  perform assert_ok(hero_set_buffs(mid, '[]'::jsonb), 'lb7c hero clear allowed while off');

  -- back on: the same arm gets PAST the switch (this fixture has no wallet,
  -- so the honest outcome is the wallet's refusal, not the switch's)
  perform probe_as('b');
  perform assert_ok(set_league_live_buffs(lid, true), 'lb8 commish turns on');
  perform probe_as('c');
  r := arm_buff(mid, 'momentum');
  perform assert_true(coalesce(r ->> 'error', '') <> 'live power-ups are turned off in this league',
    'lb9 switch no longer the blocker (got ' || coalesce(r ->> 'error', 'ok') || ')');
  reset role;
end $$;

select 'ALL LIVE-BUFFS PROBES PASSED' as result;
