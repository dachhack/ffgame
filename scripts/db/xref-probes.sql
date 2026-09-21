-- 0331 probes: ONE PLAYER, EVERY ID.
--   • the worker's batch writes, updates in place and never blanks an id it
--     already has with a null;
--   • a pool player reaches the crosswalk by espn_id FIRST and sleeper_id
--     second, and never by name;
--   • api_players carries the other ids, and still carries espn_id exactly
--     where 0326 put it;
--   • a player the crosswalk cannot place simply has no extra ids;
--   • a closed league still serves nothing (0327's opt-out is untouched).
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function xr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function xr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000025' || u, false); perform set_config('app.email', 'xr' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002501', 'xr01@test.dev'), ('00000000-0000-0000-0000-000000002502', 'xr02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000002501', 'xr01@test.dev'), ('00000000-0000-0000-0000-000000002502', 'xr02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000002501', '00000000-0000-0000-0000-000000002502');

do $$
declare r jsonb; lid uuid; p jsonb;
begin
  perform xr_as('01');
  r := create_native_league('Crosswalk', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform xr_true((r ->> 'ok')::boolean, 'xr0 league'); lid := (r ->> 'league_id')::uuid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, sleeper_id) values
    (lid, 'xr-espn',  'By Espn Id',   'RB', 'XRH', 1, 'xw111', null),
    (lid, 'xr-sleep', 'By Sleeper',   'WR', 'XRH', 2, null,  'sxw222'),
    (lid, 'xr-none',  'Unplaceable',  'TE', 'XRH', 3, null,  null);

  -- ── xr1. the worker's write ──
  r := upsert_player_xref(jsonb_build_array(
    jsonb_build_object('gsis_id', '00-0000111', 'full_name', 'By Espn Id', 'pos', 'RB',
      'espn_id', 'xw111', 'sleeper_id', 'sxw111', 'pfr_id', 'EspB00', 'yahoo_id', '9111',
      'sportradar_id', 'sr-111', 'latest_season', '2026'),
    jsonb_build_object('gsis_id', '00-0000222', 'full_name', 'By Sleeper', 'pos', 'WR',
      'sleeper_id', 'sxw222', 'yahoo_id', '9222', 'latest_season', '2026')));
  perform xr_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 2, 'xr1 two rows written');
  -- A second pass that has lost a column must not blank what we already knew.
  perform upsert_player_xref(jsonb_build_array(
    jsonb_build_object('gsis_id', '00-0000111', 'full_name', 'By Espn Id', 'espn_id', 'xw111',
      'pfr_id', null, 'latest_season', '2026')));
  perform xr_true((select pfr_id from player_xref where gsis_id = '00-0000111') = 'EspB00',
    'xr1 a missing column does not erase the id we had');
  perform xr_true((select count(*) from player_xref where gsis_id like '00-00001%') = 1,
    'xr1 and does not duplicate');

  -- ── xr2. the join, id-first ──
  r := api_players(lid);
  select jsonb_path_query_first(r -> 'players', '$[*] ? (@.slug == "xr-espn")') into p;
  perform xr_true((p ->> 'gsis_id') = '00-0000111', 'xr2 reached by espn_id');
  perform xr_true((p ->> 'espn_id') = 'xw111', 'xr2 and espn_id is still exactly where 0326 put it');
  perform xr_true((p ->> 'pfr_id') = 'EspB00' and (p ->> 'yahoo_id') = '9111'
    and (p ->> 'sportradar_id') = 'sr-111', 'xr2 with the other ids beside it');
  select jsonb_path_query_first(r -> 'players', '$[*] ? (@.slug == "xr-sleep")') into p;
  perform xr_true((p ->> 'gsis_id') = '00-0000222', 'xr2 a player with no espn_id is reached by his sleeper id');
  -- THE NAME TRAP: a crosswalk row that spells him EXACTLY as our pool does,
  -- carrying ids that belong to somebody else. A name join would take it.
  perform upsert_player_xref(jsonb_build_array(
    jsonb_build_object('gsis_id', '00-0000999', 'full_name', 'Unplaceable', 'pos', 'TE',
      'espn_id', 'xw999', 'sleeper_id', 'sxw999', 'latest_season', '2026')));
  r := api_players(lid);
  select jsonb_path_query_first(r -> 'players', '$[*] ? (@.slug == "xr-none")') into p;
  perform xr_true(p is not null and (p ->> 'gsis_id') is null,
    'xr2 a player the crosswalk cannot place is still listed, with no extra ids');
  perform xr_true((p ->> 'espn_id') is null and (p ->> 'sleeper_id') is null,
    'xr2 and a row with his exact NAME is not taken — ids only, always');

  -- ── xr3. the signed-in reader ──
  r := league_player_ids(lid);
  perform xr_true((r ->> 'ok')::boolean, 'xr3 a member reads the ids');
  perform xr_true((r -> 'ids' -> 'xr-espn' ->> 'gsis_id') = '00-0000111', 'xr3 keyed by our slug');
  perform xr_true(not (r -> 'ids' -> 'xr-none' ? 'gsis_id'),
    'xr3 and an unplaceable player carries no null keys');

  -- ── xr4. the door 0327 built is still the door ──
  perform xr_as('01');
  perform xr_true((commish_set_public_api(lid, false) ->> 'ok')::boolean, 'xr4 the commissioner opts out');
  perform xr_true(api_players(lid) is null, 'xr4 the public endpoint serves nothing at all');
  perform xr_as('02');
  perform xr_true(league_player_ids(lid) ->> 'error' = 'forbidden', 'xr4 and a stranger is refused');
  perform xr_as('01');
  perform xr_true((league_player_ids(lid) ->> 'ok')::boolean, 'xr4 while the league itself always could');
end $$;

select 'ALL XREF PROBES PASS' as result;
drop function if exists xr_true(boolean, text);
drop function if exists xr_as(text);
