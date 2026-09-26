-- 0366 probes: DEVY SPOTS.
--
--   • devy spots need COLLEGE, are counted in the draft's rounds, and lock
--     once the draft starts;
--   • a college player lands in devy; nobody moves an NFL player in, and a
--     college player cannot move out;
--   • the split holds at every acquisition gate: pos_cap_error (devy full, NFL
--     full, no position caps on devy) and trade_cap_error (by spot);
--   • roster_illegal_reason names a college player outside devy and an
--     overfull devy shelf, and position caps ignore devy rows;
--   • autopick fills NFL spots first, then devy;
--   • a league with no devy spots is untouched (college rows behave as before);
--   • the pool filter takes a level.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function dv_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dv_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dv_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000037' || u, false); perform set_config('app.email', 'dv' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003701', 'dv01@test.dev'),
  ('00000000-0000-0000-0000-000000003702', 'dv02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000003701', 'dv01@test.dev'),
  ('00000000-0000-0000-0000-000000003702', 'dv02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003702');
insert into app_admin (email, note) values ('dv01@test.dev', 'devy probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; plain uuid; code text; rounds0 int; e text; boom boolean;
begin
  perform dv_as('01');
  r := create_native_league('Devy', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform dv_ok(r, 'dv0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform dv_as('02'); perform dv_ok(native_join(code, 'DV-2'), 'dv0 join'); perform dv_as('01');

  -- ══ dv1. THE SHAPE ═══════════════════════════════════════════════════════
  r := set_league_roster_shape(lid, 2, 0, 0, 0, 2);
  perform dv_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'devy spots need college players%',
    'dv1 devy spots need COLLEGE');
  perform dv_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'dv1 COLLEGE on');
  select rounds into rounds0 from draft where league_id = lid;
  r := set_league_roster_shape(lid, 2, 0, 0, 0, 2);
  perform dv_ok(r, 'dv1a shape with two devy spots');
  perform dv_true((r -> 'shape' ->> 'devy')::int = 2, 'dv1b devy is in the shape');
  perform dv_true((r ->> 'draft_rounds')::int = (r ->> 'rounds')::int, 'dv1c devy spots are drafted (not a stash)');
  perform dv_true((select rounds from draft where league_id = lid) = (r ->> 'rounds')::int, 'dv1d draft.rounds follows');
  r := set_league_roster_shape(lid, 2, 0, 0, 0);
  perform dv_true((r -> 'shape' ->> 'devy')::int = 2, 'dv1e the five-argument form leaves devy alone');

  -- A pool: four NFL, three college.
  update league set settings_json = settings_json - 'roster_slots' where id = lid;
  perform dv_ok(seed_league_pool(lid, '[
    {"slug":"dv-qb1","full":"Dv Qb One","pos":"QB","team":"BUF"},
    {"slug":"dv-qb2","full":"Dv Qb Two","pos":"QB","team":"KC"},
    {"slug":"dv-wr1","full":"Dv Wr One","pos":"WR","team":"DET"},
    {"slug":"dv-wr2","full":"Dv Wr Two","pos":"WR","team":"MIA"},
    {"slug":"c-93701","full":"Col Qb","pos":"QB"},
    {"slug":"c-93702","full":"Col Wr","pos":"WR"},
    {"slug":"c-93703","full":"Col Rb","pos":"RB"}]'::jsonb), 'dv1f pool');

  -- ══ dv2. LANDING AND MOVES ═══════════════════════════════════════════════
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'c-93701');
  perform dv_true((select spot from native_roster where league_id = lid and slug = 'c-93701') = 'devy',
    'dv2 a college player lands in devy');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'dv-qb1');
  perform dv_true((select spot from native_roster where league_id = lid and slug = 'dv-qb1') = 'active',
    'dv2a an NFL player lands where he always did');
  r := set_roster_spot(lid, 'dv-qb1', 'devy');
  perform dv_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'devy spots hold college players',
    'dv2b nobody moves an NFL player into devy');
  r := set_roster_spot(lid, 'c-93701', 'active');
  perform dv_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'a college player stays in a devy spot%',
    'dv2c a college player cannot leave devy');
  r := set_roster_spot(lid, 'c-93701', 'taxi');
  perform dv_true((r ->> 'ok')::boolean is false, 'dv2d nor go to taxi');

  -- ══ dv3. THE ACQUISITION GATE ════════════════════════════════════════════
  perform dv_true(pos_cap_error(lid, 1, 'c-93702') is null, 'dv3 a second college player fits');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'c-93702');
  e := pos_cap_error(lid, 1, 'c-93703');
  perform dv_true(e = 'devy spots are full — this league has 2', 'dv3a a third does not: ' || coalesce(e, 'null'));
  perform dv_true(pos_cap_error(lid, 1, 'c-93703', false, 'c-93702') is null, 'dv3b unless one is dropped in the same move');
  -- Fill the NFL side to its limit: rounds − devy.
  select rounds into rounds0 from draft where league_id = lid;
  update league_pool set rank = rank where league_id = lid; -- no-op, keeps the fixture honest
  for i in 1 .. (rounds0 - 2 - 1) loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'dv-fill-' || i, 'Filler ' || i, 'WR', 'NYJ', 100 + i);
    insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'dv-fill-' || i);
  end loop;
  e := pos_cap_error(lid, 1, 'dv-wr1');
  perform dv_true(e like 'NFL roster is full — %', 'dv3c NFL spots full: ' || coalesce(e, 'null'));
  perform dv_true(devy_room_error(lid, 2, 'dv-wr1') is null, 'dv3d another team is not affected');
  -- Position caps don't see devy rows: cap college QBs at zero NFL QBs' worth.
  update league set settings_json = settings_json || '{"pos_caps":{"QB":1}}'::jsonb where id = lid;
  perform dv_true(league_pos_cap(lid, 'QB') = 1, 'dv3e (fixture) QB cap is 1');
  perform dv_true(pos_cap_error(lid, 2, 'c-93703') is null, 'dv3f a devy player ignores position caps');
  update league set settings_json = settings_json - 'pos_caps' where id = lid;

  -- ══ dv4. LEGALITY ════════════════════════════════════════════════════════
  update draft set status = 'complete' where league_id = lid;
  perform dv_true(roster_illegal_reason(lid, 1) is null, 'dv4 a full, correct devy roster is legal: ' || coalesce(roster_illegal_reason(lid, 1), ''));
  update native_roster set spot = 'active' where league_id = lid and slug = 'c-93702';
  perform dv_true(roster_illegal_reason(lid, 1) like 'Col Wr is a college player outside the devy spots%',
    'dv4a a college player outside devy is illegal');
  update native_roster set spot = 'devy' where league_id = lid and slug = 'c-93702';
  update league set settings_json = jsonb_set(settings_json, '{roster_shape,devy}', '1') where id = lid;
  perform dv_true(roster_illegal_reason(lid, 1) like 'the devy squad holds 2 (limit 1)%', 'dv4b an overfull devy shelf is illegal');
  update league set settings_json = jsonb_set(settings_json, '{roster_shape,devy}', '2') where id = lid;
  r := set_league_roster_shape(lid, null, null, null, null, 3);
  perform dv_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'devy spots lock once the draft starts',
    'dv4c devy spots lock after the draft');

  -- ══ dv5. TRADES ══════════════════════════════════════════════════════════
  insert into native_roster (league_id, roster_id, slug) values (lid, 2, 'c-93703'), (lid, 2, 'dv-qb2');
  e := trade_cap_error(lid, 1, '["dv-fill-1"]'::jsonb, '["c-93703"]'::jsonb);
  perform dv_true(e like '%devy spots (2)%', 'dv5 taking a third devy player is refused: ' || coalesce(e, 'null'));
  perform dv_true(trade_cap_error(lid, 1, '["c-93702"]'::jsonb, '["c-93703"]'::jsonb) is null, 'dv5a devy for devy is fine');
  e := trade_cap_error(lid, 1, '["c-93702"]'::jsonb, '["dv-qb2"]'::jsonb);
  perform dv_true(e like '%NFL roster%', 'dv5b a devy player for an NFL one overfills the NFL side: ' || coalesce(e, 'null'));
  perform dv_true(trade_cap_error(lid, 1, '["dv-fill-1"]'::jsonb, '["dv-qb2"]'::jsonb) is null, 'dv5c NFL for NFL is fine');

  -- ══ dv6. AUTOPICK ════════════════════════════════════════════════════════
  delete from native_roster where league_id = lid and roster_id = 2;
  insert into native_roster (league_id, roster_id, slug) values (lid, 2, 'dv-wr2');
  perform dv_true(native_autopick_slug(lid, 2, rounds0) not like 'c-%', 'dv6 autopick takes NFL players first');
  delete from native_roster where league_id = lid and roster_id = 1 and slug = 'c-93702';
  perform dv_true(native_autopick_slug(lid, 1, rounds0) ~ '^c-[0-9]+$', 'dv6a with the NFL side full, it takes a college player');

  -- ══ dv7. A LEAGUE WITHOUT DEVY SPOTS IS UNTOUCHED ════════════════════════
  r := create_native_league('No Devy', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  plain := (r ->> 'league_id')::uuid;
  perform dv_ok(set_league_position_access(plain, '["COLLEGE"]'::jsonb), 'dv7 COLLEGE on, no devy spots');
  perform dv_ok(seed_league_pool(plain, '[{"slug":"c-93701","full":"Col Qb","pos":"QB"}]'::jsonb), 'dv7 pool');
  insert into native_roster (league_id, roster_id, slug) values (plain, 1, 'c-93701');
  perform dv_true((select spot from native_roster where league_id = plain and slug = 'c-93701') = 'active',
    'dv7a with no devy spots a college player lands active, as before');
  perform dv_true(devy_room_error(plain, 1, 'c-93702') is null, 'dv7b and nothing splits the roster');

  -- ══ dv8. THE POOL FILTER TAKES A LEVEL ═══════════════════════════════════
  r := create_native_league('Filter', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform dv_ok(set_league_pool_filter((r ->> 'league_id')::uuid, '{"level":"college"}'::jsonb), 'dv8 level college');
  perform dv_true((select settings_json -> 'pool_filter' ->> 'level' from league where id = (r ->> 'league_id')::uuid) = 'college',
    'dv8a stored');
  r := set_league_pool_filter((r ->> 'league_id')::uuid, '{"level":"pro"}'::jsonb);
  perform dv_true((r ->> 'ok')::boolean is false, 'dv8b an unknown level is refused');

  -- ══ dv9. ROLLOVER (0368) ═════════════════════════════════════════════════
  -- Team 1 holds one college player in devy and a full NFL side.
  perform dv_ok(set_keeper_count(lid, 1), 'dv9 one keeper');
  r := rollover_league(lid, 14, false);
  perform dv_ok(r, 'dv9a rollover');
  plain := (r ->> 'league_id')::uuid;
  perform dv_true((select spot from native_roster where league_id = plain and slug = 'c-93701' and roster_id = 1) = 'devy',
    'dv9b the devy player carries, still in devy');
  perform dv_true((select count(*) from native_roster where league_id = plain and roster_id = 1 and spot <> 'devy') = 1,
    'dv9c and the keeper count still means one NFL keeper');
  perform dv_true((select keeper_slots from draft where league_id = plain) = 3, 'dv9d the draft counts keepers + devy as pre-filled');
  perform dv_true((r ->> 'keeper_slots')::int = 3, 'dv9e and says so');
  delete from league_pool where league_id = plain;

  delete from league_pool where league_id in (lid, plain);
  raise notice 'devy probes done';
end $$;

select 'ALL DEVY PROBES PASSED' as result;
