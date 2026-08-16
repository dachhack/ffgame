-- 0173 FAAB grant probes: per-team wallets + grants.
--
-- What must hold:
--   • commissioner-only;
--   • REFUSED unless the league is on FAAB (switching modes wipes balances,
--     so a grant made outside FAAB would silently evaporate);
--   • a grant is ADDITIVE off the EFFECTIVE balance — a seat that has never
--     been touched starts from the league default, not from zero;
--   • a negative grant claws back and FLOORS at 0 (never negative, or the
--     claim resolver's "bid <= balance" assumption breaks);
--   • roster_id null grants EVERY team in the league;
--   • unknown team refused, zero/oversized amounts refused;
--   • league_faab_wallets lists every seat with its effective balance.
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
declare r jsonb; lid uuid; code text; rid_b int; rid_c int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('FAAB League', '2026', 4, 7, 60);
  perform assert_ok(r, 'fb0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'FB-C'), 'fb1 c joins');
  select sleeper_roster_id into rid_b from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  select sleeper_roster_id into rid_c from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000c';

  -- outside FAAB the grant refuses (a mode flip would wipe it)
  perform probe_as('b');
  perform assert_err(commish_grant_faab(lid, rid_b, 25), 'FAAB first', 'fb2 refused on rolling waivers');

  -- switch to FAAB with a $100 season budget
  perform assert_ok(set_transaction_rules(lid, 'faab', 100, null), 'fb3 faab on');
  r := league_faab_wallets(lid);
  perform assert_ok(r, 'fb4 wallets read');
  perform assert_true((r ->> 'budget')::int = 100, 'fb4a league budget 100');
  perform assert_true(jsonb_array_length(r -> 'teams') = 4, 'fb4b four seats listed');
  perform assert_true((r -> 'teams' -> 0 ->> 'faab')::int = 100, 'fb4c untouched seat reads the default');
  perform assert_true((r -> 'teams' -> 0 ->> 'touched')::boolean is false, 'fb4d untouched flag');

  -- member refused
  perform probe_as('c');
  perform assert_err(commish_grant_faab(lid, rid_b, 25), 'commissioner', 'fb5 member refused');

  -- additive off the EFFECTIVE balance: untouched 100 + 25 = 125
  perform probe_as('b');
  perform assert_ok(commish_grant_faab(lid, rid_b, 25), 'fb6 grant one team');
  perform assert_true(member_faab(lid, rid_b) = 125, 'fb6a 100 default + 25');
  perform assert_true(member_faab(lid, rid_c) = 100, 'fb6b other seats untouched');

  -- claw-back floors at zero, never negative
  perform assert_ok(commish_grant_faab(lid, rid_b, -1000), 'fb7 claw back');
  perform assert_true(member_faab(lid, rid_b) = 0, 'fb7a floors at 0');

  -- overall grant: null roster hits every seat, each off its own balance
  perform assert_ok(commish_grant_faab(lid, null, 10), 'fb8 grant all');
  perform assert_true(member_faab(lid, rid_b) = 10, 'fb8a cleared seat 0 + 10');
  perform assert_true(member_faab(lid, rid_c) = 110, 'fb8b untouched seat 100 + 10');
  r := commish_grant_faab(lid, null, 5);
  perform assert_true((r ->> 'granted')::int = 4, 'fb8c granted count = every seat');

  -- validation
  perform assert_err(commish_grant_faab(lid, rid_b, 0), 'amount required', 'fb9 zero refused');
  perform assert_err(commish_grant_faab(lid, rid_b, 999999), 'out of range', 'fb9a oversized refused');
  perform assert_err(commish_grant_faab(lid, 9999, 5), 'no such team', 'fb9b unknown team refused');

  -- ceiling holds
  perform assert_ok(commish_grant_faab(lid, rid_c, 100000), 'fb10 huge grant');
  perform assert_true(member_faab(lid, rid_c) = 100000, 'fb10a caps at 100000');

  -- a mode flip still resets everyone (documented behaviour the refusal guards)
  perform assert_ok(set_transaction_rules(lid, 'rolling', null, null), 'fb11 back to rolling');
  perform assert_ok(set_transaction_rules(lid, 'faab', null, null), 'fb11a faab again');
  perform assert_true(member_faab(lid, rid_c) = 100, 'fb11b balances reset to the default');

  -- THE READ IS MODE-INDEPENDENT (v0.220.0 depends on this): the app's FAAB
  -- card shows balances even on a non-FAAB league and disables the grant
  -- levers, because hiding the numbers would make the refusal a mystery. If
  -- league_faab_wallets ever started refusing outside FAAB, that card would
  -- go blank with no explanation — so pin the contract here.
  perform assert_ok(set_transaction_rules(lid, 'rolling', null, null), 'fb12 rolling for the read test');
  r := league_faab_wallets(lid);
  perform assert_ok(r, 'fb12a wallets still readable off FAAB');
  perform assert_true(jsonb_array_length(r -> 'teams') >= 2, 'fb12b every seat still listed');
  perform assert_err(commish_grant_faab(lid, rid_b, 5), 'set waivers to FAAB', 'fb12c but the grant is still refused');
end $$;

select 'ALL FAAB-GRANT PROBES PASSED' as status;
