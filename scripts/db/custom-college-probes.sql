-- 0410 probes: CUSTOM COLLEGE PLAYERS — the commissioner adds one the
-- directory doesn't have; he behaves like any college player in the league
-- and nowhere else.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function cc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cc_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cc_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function cc_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000059' || u, false); perform set_config('app.email', 'cc' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000005901', 'cc01@test.dev'), ('00000000-0000-0000-0000-000000005902', 'cc02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000005901', 'cc01@test.dev'), ('00000000-0000-0000-0000-000000005902', 'cc02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-0000000059%';
insert into app_admin (email, note) values ('cc01@test.dev', 'custom college probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; cs text;
begin
  perform cc_as('01');
  r := create_native_league('Custom College', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cc_as('02'); perform cc_ok(native_join(code, 'CC-2'), 'cc0 join');

  perform cc_err(commish_add_custom_college(lid, 'Joe Small', 'RB'), 'commissioner only', 'cc1 a manager can''t');
  perform cc_as('01');
  perform cc_err(commish_add_custom_college(lid, 'Joe Small', 'RB'), 'college players are off', 'cc1a not without COLLEGE');
  perform cc_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'cc1b COLLEGE on');
  perform cc_ok(set_league_roster_shape(lid, 2, 0, 0, 0, 2), 'cc1c two devy spots');
  update league set settings_json = settings_json - 'roster_slots' where id = lid;
  perform cc_ok(seed_league_pool(lid, '[{"slug":"cc-qb1","full":"Cc Qb","pos":"QB","team":"BUF"},{"slug":"c-95901","full":"Fbs Wr","pos":"WR"}]'::jsonb), 'cc1d pool');

  perform cc_err(commish_add_custom_college(lid, 'Jo', 'RB'), '3–40', 'cc2 a real name');
  perform cc_err(commish_add_custom_college(lid, 'Joe Small', 'LB'), 'QB, RB, WR, TE or K', 'cc2a a fantasy position');
  perform cc_err(commish_add_custom_college(lid, 'Joe Small', 'RB', 'Ferris St', 2, 'XFL'), 'level must be', 'cc2b a known level');
  r := commish_add_custom_college(lid, 'Joe Small', 'rb', 'Ferris St', 2, 'd2');
  perform cc_ok(r, 'cc2c a D2 back'); cs := r ->> 'slug';
  perform cc_true(cs ~ '^c-99[0-9]{7}$', 'cc2d a college slug from the reserved range: ' || cs);
  perform cc_err(commish_add_custom_college(lid, 'joe small', 'RB'), 'already in this league', 'cc2e once per league');
  perform cc_true((select level from league_pool where league_id = lid and league_pool.slug = cs limit 1) is not null, 'cc3 he is in the pool');
  perform cc_true((select level from league_pool lp where lp.league_id = lid and lp.slug = cs) = 'college', 'cc3a as a college player');

  -- the league's reads know him; nothing global does
  r := league_pool_college(lid);
  perform cc_true((r -> 'players' -> cs ->> 'custom')::boolean and r -> 'players' -> cs ->> 'school' = 'Ferris St'
    and r -> 'players' -> cs ->> 'class_label' = 'SO' and r -> 'players' -> cs ->> 'level' = 'D2', 'cc4 league_pool_college has his entry');
  perform cc_true((college_meta_for(array[cs]) -> cs ->> 'cls')::int = 2, 'cc4a his class answers a class rule');
  r := college_player_card(substr(cs, 3));
  perform cc_true((r ->> 'ok')::boolean and (r ->> 'custom')::boolean and r ->> 'name' = 'Joe Small', 'cc4b his card');
  perform cc_true(not exists (select 1 from college_player where espn_id = substr(cs, 3)), 'cc4c not in the directory');
  perform cc_true(not exists (select 1 from jsonb_array_elements(devy_market(lid, 5000, 'Joe Small')) x where x ->> 'slug' = cs), 'cc4d not in the devy market');

  -- he lands in devy like any college player
  insert into native_roster (league_id, roster_id, slug) values (lid, 2, cs);
  perform cc_true((select spot from native_roster where league_id = lid and native_roster.slug = cs and roster_id = 2) = 'devy', 'cc5 a custom player lands in devy');
  perform cc_err(commish_remove_custom_college(lid, cs), 'dropped first', 'cc5a can''t remove a rostered one');
  r := league_custom_college(lid);
  perform cc_true(jsonb_array_length(r) = 1 and (r -> 0 ->> 'roster_id')::int = 2, 'cc5b the list says who has him');

  -- a pre-draft re-seed keeps him even unrostered
  delete from native_roster where league_id = lid and native_roster.slug = cs;
  perform cc_ok(seed_league_pool(lid, '[{"slug":"cc-qb1","full":"Cc Qb","pos":"QB","team":"BUF"}]'::jsonb), 'cc6 re-seed');
  perform cc_true(exists (select 1 from league_pool lp where lp.league_id = lid and lp.slug = cs), 'cc6a the re-seed kept him');
  perform cc_true(not exists (select 1 from league_pool lp where lp.league_id = lid and lp.slug = 'c-95901'), 'cc6b and dropped what the directory no longer sends');

  perform cc_ok(commish_remove_custom_college(lid, cs), 'cc7 remove');
  perform cc_true(not exists (select 1 from league_pool lp where lp.league_id = lid and lp.slug = cs), 'cc7a gone from the pool');

  -- a market league doesn't take them
  update league set settings_json = settings_json || '{"devy_mode":"shares"}'::jsonb where id = lid;
  perform cc_err(commish_add_custom_college(lid, 'Joe Other', 'RB'), 'devy spots', 'cc8 a market league says no');
  raise notice 'custom college probes done';
end $$;

select 'ALL CUSTOM-COLLEGE PROBES PASSED' as result;
