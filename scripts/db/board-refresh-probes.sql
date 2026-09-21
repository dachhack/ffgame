-- 0335 probes: THE OTHER TWO BAKES REFRESH THEMSELVES.
--   • the dynasty board holds players (keyed by sleeper id) and rookie picks
--     (keyed by the market's own label) in one table, and a league reads the
--     format it plays — superflex values for a superflex lineup;
--   • the season board holds a PER-WEEK PPR RATE, which is a level for the
--     client's own catalog to score, never a score;
--   • both prune on the caller's word, keyed on the source's stamp;
--   • a stale board hands the column back to the bake by going empty, which
--     is the client's cue — never a zero.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function br_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function br_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000027' || u, false); perform set_config('app.email', 'br' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000002701', 'br01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000002701', 'br01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id = '00000000-0000-0000-0000-000000002701';

do $$
declare r jsonb; lid uuid;
begin
  perform br_as('01');
  r := create_native_league('Boards', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform br_true((r ->> 'ok')::boolean, 'br0 league'); lid := (r ->> 'league_id')::uuid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id) values
    (lid, 'br-qb',  'A Quarterback', 'QB', 'BRH', 1, 'br1'),
    (lid, 'br-rb',  'A Runner',      'RB', 'BRH', 2, 'br2'),
    (lid, 'br-none','Unplaced',      'TE', 'BRH', 3, 'br9');

  -- ── br1. the dynasty board: players and picks in one table ──
  r := upsert_dyn_board(jsonb_build_array(
    jsonb_build_object('key', 'br1', 'kind', 'player', 'sleeper_id', 'br1', 'slug', 'br-qb',
      'v1qb', 5735, 'vsf', 10729),
    jsonb_build_object('key', 'br2', 'kind', 'player', 'sleeper_id', 'br2', 'slug', 'br-rb',
      'v1qb', 9000, 'vsf', 8200),
    jsonb_build_object('key', 'ktc:9999', 'kind', 'player', 'slug', null, 'v1qb', 400, 'vsf', 380),
    jsonb_build_object('key', 'pick:2027 Early 1st', 'kind', 'pick', 'label', '2027 Early 1st',
      'v1qb', 7174, 'vsf', 6944)),
    '2026-09-21T00:00:00Z');
  perform br_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 4, 'br1 four rows written');
  perform br_true(dyn_board_is_fresh(), 'br1 and the board reads fresh');

  r := league_market(lid);
  perform br_true((r ->> 'dyn_format') = '1qb', 'br1 a one-QB league reads the 1QB market');
  perform br_true((r -> 'dyn' ->> 'br-qb')::numeric = 5735, 'br1 with the 1QB value');
  perform br_true((r -> 'picks' ->> '2027 Early 1st')::numeric = 7174,
    'br1 and the pick board, keyed by the market''s own label');
  perform br_true(not (r -> 'dyn' ? 'br-none'),
    'br1 a pool player the board does not carry is absent, so the bake answers');

  -- ── br2. superflex is a different market, and one flag moves both ──
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object(
    'roster_slots', jsonb_build_array(
      jsonb_build_object('pos', jsonb_build_array('QB')),
      jsonb_build_object('pos', jsonb_build_array('QB', 'RB', 'WR', 'TE')),
      jsonb_build_object('pos', jsonb_build_array('RB')))) where id = lid;
  r := league_market(lid);
  perform br_true((r ->> 'dyn_format') = 'sf', 'br2 a lineup starting two QBs is a superflex dynasty market');
  perform br_true((r -> 'dyn' ->> 'br-qb')::numeric = 10729,
    'br2 and the quarterback is worth 10729 rather than 5735 — the same player, the other market');
  perform br_true((r -> 'picks' ->> '2027 Early 1st')::numeric = 6944, 'br2 the picks move with him');
  perform br_true((r -> 'dyn' ->> 'br-rb')::numeric = 8200, 'br2 and the runner moves the other way');
  update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'roster_slots') where id = lid;

  -- ── br3. the season board is a LEVEL ──
  r := upsert_proj_board(jsonb_build_array(
    jsonb_build_object('sleeper_id', 'br1', 'slug', 'br-qb', 'ppg', 17.0, 'gp', 17,
      'per_week', 17.0, 'ros_ppg', 16.4, 'games_left', 15),
    jsonb_build_object('sleeper_id', 'br2', 'slug', 'br-rb', 'ppg', 20.0, 'gp', 8.5,
      'per_week', 10.0)),
    '2026-09-21T16:00:00Z');
  perform br_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 2, 'br3 two season lines written');
  r := league_market(lid);
  perform br_true((r -> 'proj' ->> 'br-qb')::numeric = 17.0, 'br3 a full-season player''s rate is his PPG');
  perform br_true((r -> 'proj' ->> 'br-rb')::numeric = 10.0,
    'br3 and a half-season player''s rate carries the games — 20.0 a game is 10.0 a week');
  perform br_true(not (r -> 'proj' ? 'br-none'), 'br3 a player it does not carry keeps the bake');

  -- ── br4. the refresh prunes what the source dropped ──
  perform upsert_dyn_board(jsonb_build_array(
    jsonb_build_object('key', 'br1', 'kind', 'player', 'sleeper_id', 'br1', 'slug', 'br-qb',
      'v1qb', 6000, 'vsf', 11000)),
    '2026-09-28T00:00:00Z');
  perform br_true((league_market(lid) -> 'dyn' ->> 'br-qb')::numeric = 6000, 'br4 a new pull moves the value');
  perform br_true(not exists (select 1 from dyn_board where key = 'br2'),
    'br4 and a player the new board dropped leaves rather than sitting at last week''s');
  perform br_true(not exists (select 1 from dyn_board where kind = 'pick'),
    'br4 including the picks, which came from the same pull');

  -- ── br5. a stale board is an empty map, never a zero ──
  update dyn_board set fetched_at = now() - interval '40 days';
  update proj_board set fetched_at = now() - interval '40 days';
  perform br_true(not dyn_board_is_fresh() and not proj_board_is_fresh(), 'br5 forty days is not a market');
  r := league_market(lid);
  perform br_true((r -> 'dyn') = '{}'::jsonb and (r -> 'picks') = '{}'::jsonb and (r -> 'proj') = '{}'::jsonb,
    'br5 so all three go empty — the client''s cue to keep the bake');
  perform br_true((r ->> 'dyn_format') is null, 'br5 and no format is claimed for a board nobody read');
  perform br_true((r ->> 'ok')::boolean, 'br5 while the call itself still answers');
end $$;

select 'ALL BOARD-REFRESH PROBES PASS' as result;
drop function if exists br_true(boolean, text);
drop function if exists br_as(text);
