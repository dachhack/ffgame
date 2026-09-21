-- 0334 probes: THE MARKET REFRESHES ITSELF.
--   • the worker's write lands keyed by SLEEPER ID, updates in place, and
--     prunes a row the market has stopped pricing;
--   • a league reads the format it actually plays — a lineup starting two
--     quarterbacks gets the 2QB market, a half-PPR league its own;
--   • the ladder: the published board answers first, ESPN answers for the
--     players it does not price, and a player neither prices is absent
--     rather than zero (the client keeps the bake);
--   • a stale board falls back wholesale to ESPN;
--   • `adp_source` and `adp_format` say what answered.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function ab_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ab_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000026' || u, false); perform set_config('app.email', 'ab' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000002601', 'ab01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000002601', 'ab01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id = '00000000-0000-0000-0000-000000002601';

do $$
declare r jsonb; lid uuid;
begin
  perform ab_as('01');
  r := create_native_league('AdpBoard', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ab_true((r ->> 'ok')::boolean, 'ab0 league'); lid := (r ->> 'league_id')::uuid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, sleeper_id) values
    (lid, 'ab-qb',   'A Quarterback', 'QB', 'ABH', 1, 'e1', 'ab1'),
    (lid, 'ab-rb',   'A Runner',      'RB', 'ABH', 2, 'e2', 'ab2'),
    (lid, 'ab-espn', 'Espn Only',     'WR', 'ABH', 3, 'e3', 'ab3'),
    (lid, 'ab-none', 'Nobody Prices', 'TE', 'ABH', 4, null, 'ab4');

  -- ── ab1. the worker's write ──
  r := upsert_adp_board(jsonb_build_array(
    jsonb_build_object('sleeper_id', 'ab1', 'slug', 'ab-qb', 'adp_ppr', 40.5, 'adp_half', 44.0,
      'adp_std', 48.0, 'adp_2qb', 12.5, 'adp_dyn', 30.0),
    jsonb_build_object('sleeper_id', 'ab2', 'slug', 'ab-rb', 'adp_ppr', 10.1, 'adp_half', 11.0,
      'adp_std', 12.0, 'adp_2qb', 18.0),
    jsonb_build_object('sleeper_id', 'ab9', 'slug', null, 'adp_ppr', 99.0)),
    '2026-09-21T06:00:00Z');
  perform ab_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 3, 'ab1 three rows written');
  perform ab_true((select slug from adp_board where sleeper_id = 'ab9') is null,
    'ab1 a row we cannot place keeps its id and a null slug rather than a guessed name');
  perform ab_true(adp_board_is_fresh(), 'ab1 and the board reads fresh');

  -- A DRAFT BOARD'S WORTH OF DEPTH, in every format, so the thinness guard in
  -- league_market is not what these next assertions are measuring. (ab2b
  -- takes it away again on purpose.)
  insert into adp_board (sleeper_id, slug, adp_ppr, adp_half, adp_std, adp_2qb, source, fetched_at)
    select 'bulk' || g, 'bulk-' || g, 100 + g, 100 + g, 100 + g, 100 + g, 'sleeper',
           '2026-09-21T06:00:00Z'::timestamptz
      from generate_series(1, 320) g
    on conflict (sleeper_id) do nothing;

  -- ── ab2. the format follows the lineup ──
  perform ab_true(_league_adp_format(lid) = 'ppr', 'ab2 a default league reads the PPR market');
  r := league_market(lid);
  perform ab_true((r ->> 'adp_source') = 'sleeper' and (r ->> 'adp_format') = 'ppr',
    'ab2 and says so');
  perform ab_true((r -> 'adp' ->> 'ab-qb')::numeric = 40.5, 'ab2 with the PPR number');
  -- half PPR
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"ppr": 0.5}'::jsonb where id = lid;
  perform ab_true(_league_adp_format(lid) = 'half', 'ab2 half-PPR reads the half market');
  perform ab_true((league_market(lid) -> 'adp' ->> 'ab-qb')::numeric = 44.0, 'ab2 and gets that number');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"ppr": 0}'::jsonb where id = lid;
  perform ab_true((league_market(lid) -> 'adp' ->> 'ab-qb')::numeric = 48.0, 'ab2 standard scoring too');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"ppr": 1}'::jsonb where id = lid;

  -- SUPERFLEX: two QB-eligible spots in the lineup IS the 2QB market, and the
  -- quarterback is priced 28 picks differently because of it.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object(
    'roster_slots', jsonb_build_array(
      jsonb_build_object('pos', jsonb_build_array('QB')),
      jsonb_build_object('pos', jsonb_build_array('QB', 'RB', 'WR', 'TE')),
      jsonb_build_object('pos', jsonb_build_array('RB')),
      jsonb_build_object('pos', jsonb_build_array('WR')))) where id = lid;
  perform ab_true(_league_adp_format(lid) = '2qb', 'ab2 a lineup starting two QBs is a superflex market');
  r := league_market(lid);
  perform ab_true((r ->> 'adp_format') = '2qb' and (r -> 'adp' ->> 'ab-qb')::numeric = 12.5,
    'ab2 and the quarterback is priced as one — 12.5, not 40.5');
  perform ab_true((r -> 'adp' ->> 'ab-rb')::numeric = 18.0, 'ab2 the runner moves the other way');
  update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'roster_slots') where id = lid;

  -- ── ab2b. a format the market barely prices is not a market ──
  -- Two players priced in half-PPR is not a draft board, so a half-PPR league
  -- reads PPR and the row SAYS ppr rather than naming a market nobody read.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"ppr": 0.5}'::jsonb where id = lid;
  perform ab_true(_league_adp_format(lid) = 'half' and (league_market(lid) ->> 'adp_format') = 'half',
    'ab2b with a real half-PPR market, a half-PPR league reads it');
  -- Take the depth away: two priced players is not a draft board.
  update adp_board set adp_half = null where sleeper_id like 'bulk%';
  r := league_market(lid);
  perform ab_true(_league_adp_format(lid) = 'half', 'ab2b the league is still a half-PPR league');
  perform ab_true((r ->> 'adp_format') = 'ppr' and (r -> 'adp' ->> 'ab-qb')::numeric = 40.5,
    'ab2b but a board that cannot fill a draft hands it PPR, and SAYS ppr');
  update adp_board set adp_half = adp_ppr where sleeper_id like 'bulk%';
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"ppr": 1}'::jsonb where id = lid;

  -- ── ab3. the ladder ──
  insert into player_market (slug, adp, owned_pct, source, updated_at) values
    ('ab-qb', 77.7, 50, 'espn', now()), ('ab-espn', 61.1, 40, 'espn', now())
    on conflict (slug) do update set adp = excluded.adp, updated_at = now();
  r := league_market(lid);
  perform ab_true((r -> 'adp' ->> 'ab-qb')::numeric = 40.5,
    'ab3 where the board prices him, the board wins over ESPN');
  perform ab_true((r -> 'adp' ->> 'ab-espn')::numeric = 61.1,
    'ab3 where it does not, ESPN answers — per player, not per feed');
  perform ab_true(not (r -> 'adp' ? 'ab-none'),
    'ab3 and a player neither prices is absent, so the client keeps the bake');

  -- ── ab4. the refresh ──
  r := upsert_adp_board(jsonb_build_array(
    jsonb_build_object('sleeper_id', 'ab1', 'slug', 'ab-qb', 'adp_ppr', 35.0, 'adp_2qb', 11.0)),
    '2026-09-22T06:00:00Z');
  perform ab_true((league_market(lid) -> 'adp' ->> 'ab-qb')::numeric = 35.0, 'ab4 a new pull moves the number');
  perform ab_true(not exists (select 1 from adp_board where sleeper_id = 'ab2'),
    'ab4 and a player this pull stopped pricing leaves the board rather than sitting at yesterday''s');

  -- ── ab5. a stale board hands the column back to ESPN ──
  update adp_board set fetched_at = now() - interval '40 days';
  perform ab_true(not adp_board_is_fresh(), 'ab5 forty days is not a market');
  r := league_market(lid);
  perform ab_true((r ->> 'adp_source') = 'espn', 'ab5 so ESPN answers the column');
  perform ab_true((r -> 'adp' ->> 'ab-qb')::numeric = 77.7, 'ab5 with ESPN''s number');
  perform ab_true((r ->> 'adp_format') is null, 'ab5 and no format is claimed for a board that is not showing');
end $$;

select 'ALL ADP-BOARD PROBES PASS' as result;
drop function if exists ab_true(boolean, text);
drop function if exists ab_as(text);
