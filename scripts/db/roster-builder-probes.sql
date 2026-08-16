-- 0163 roster-builder probes: the POSITION BUILDER for classic leagues.
--
-- What must hold:
--   • commissioner-only, classic-league-only;
--   • validation: unknown positions refused, empty spots refused, >20 refused,
--     duplicate positions within a spot dedupe, bb coerces to boolean;
--   • a saved spec wins over roster_classic in league_game_mode ('slots');
--   • clearing (null / []) falls back to the counts model;
--   • the slot-cap trigger honors the SPEC's spot count;
--   • the spec FREEZES once the draft leaves pending.
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
declare r jsonb; lid uuid; code text; mid uuid; big jsonb; i int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Builder League', '2026', 4, 7, 60);
  perform assert_ok(r, 'sb0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'SB-C'), 'sb1 c joins');

  -- drip league: builder refused until the league is classic
  perform probe_as('b');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"]}]'::jsonb), 'classic-league', 'sb2 refused in drip');
  perform probe_as('a');
  perform assert_ok(set_league_classic_access(lid, true), 'sb2a admin unlocks classic');
  perform probe_as('b');
  perform assert_ok(set_league_game_mode(lid, 'classic', 1), 'sb2b commish flips classic');

  -- member refused; validation bites
  perform probe_as('c');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"]}]'::jsonb), 'commissioner', 'sb3 member refused');
  perform probe_as('b');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["ZZ"]}]'::jsonb), 'unknown position', 'sb4 unknown pos refused');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":[]}]'::jsonb), 'at least one', 'sb5 empty spot refused');
  big := '[]'::jsonb;
  for i in 1..21 loop big := big || jsonb_build_array('{"pos":["RB"]}'::jsonb); end loop;
  perform assert_err(set_league_classic_slots(lid, big), 'cap at 20', 'sb6 21 spots refused');

  -- a good spec saves; dupes dedupe; bb sticks; member reads it via game_mode
  -- (0171: DL/LB/DB in NEW specs need the admin's IDP flag first)
  perform probe_as('a');
  perform assert_ok(set_league_position_access(lid, '["IDP"]'::jsonb), 'sb6b admin enables IDP');
  perform probe_as('b');
  r := set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB","WR","TE","RB"],"bb":true},{"pos":["QB","RB","WR","TE","K","DEF","DL","LB","DB"]}]'::jsonb);
  perform assert_ok(r, 'sb7 spec saves');
  perform assert_true((r ->> 'starters')::int = 3, 'sb7a three starters');
  perform assert_true(jsonb_array_length(r -> 'slots' -> 1 -> 'pos') = 3, 'sb7b dupe pos deduped');
  perform assert_true((r -> 'slots' -> 1 ->> 'bb')::boolean, 'sb7c bb stored');
  perform probe_as('c');
  perform assert_true(jsonb_array_length(league_game_mode(lid) -> 'slots') = 3, 'sb8 member reads the spec');

  -- the slot cap honors the SPEC count: 3 'wk' rows in, the 4th out
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
  values (lid, 1, 2, 1, 'scheduled') returning id into mid;
  set local role authenticated;
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
  values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S1', 'probe-qb'),
         (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S2', 'probe-rb'),
         (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S3', 'probe-wr');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S4', 'probe-te');
    raise exception 'PROBE FAIL sb9 — a 4th row got past a 3-spot spec';
  exception when check_violation then null;
  end;

  -- clearing falls back to the counts model
  perform probe_as('b');
  perform assert_ok(set_league_classic_slots(lid, null), 'sb10 clear');
  perform assert_true((league_game_mode(lid) -> 'slots') is null
    or jsonb_typeof(league_game_mode(lid) -> 'slots') = 'null', 'sb10a spec gone after clear');
  perform assert_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"],"bb":true}]'::jsonb), 'sb10b re-set for freeze test');

  -- freeze once the draft leaves pending
  reset role;
  update draft set status = 'live' where league_id = lid;
  set local role authenticated;
  perform probe_as('b');
  perform assert_err(set_league_classic_slots(lid, '[{"pos":["QB"]}]'::jsonb), 'locks once the draft', 'sb11 frozen mid-draft');

end $$;

select 'ALL ROSTER-BUILDER PROBES PASSED' as status;
