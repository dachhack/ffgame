-- 0340 probes: THE TRENDING BOARD.
--   • tb1 the worker's door is service-role only — a member cannot write it;
--   • tb2 an upsert merges by sleeper id and carries both directions;
--   • tb3 pruning is by the PULL'S OWN STAMP, not wall-clock age;
--   • tb4 freshness is a day, and a stale board serves nothing rather than
--         yesterday's "trending now";
--   • tb5 league_market serves the map to a member and refuses a stranger;
--   • tb6 only placeable rows reach a screen, and the other boards still work.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function tb_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tb_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000040' || u, false); perform set_config('app.email', 'tb' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000400' || g)::uuid, 'tb0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000400' || g)::uuid, 'tb0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'tb0%@test.dev';

do $$
declare r jsonb; lid uuid; m jsonb; stamp timestamptz := now();
begin
  perform tb_as('01');
  r := create_native_league('TrendBoard', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  -- ── tb1. the door ──
  -- The upsert is the worker's; a member holding a session must not be able to
  -- rewrite what the whole platform reads as a market signal.
  perform tb_true(not has_function_privilege('authenticated', 'upsert_trend_board(jsonb, text, int)', 'execute'),
    'tb1 a signed-in member cannot write the board');
  perform tb_true(not has_function_privilege('anon', 'upsert_trend_board(jsonb, text, int)', 'execute'),
    'tb1 …nor an anonymous caller');
  perform tb_true(has_function_privilege('service_role', 'upsert_trend_board(jsonb, text, int)', 'execute'),
    'tb1 …and the worker can');
  perform tb_true(has_function_privilege('authenticated', 'trend_board_is_fresh()', 'execute'),
    'tb1 freshness is readable, since a screen has to label the column');

  -- ── tb2. the merge ──
  delete from trend_board;
  r := upsert_trend_board(jsonb_build_array(
        jsonb_build_object('sleeper_id', '11435', 'slug', 'emanuel-wilson', 'adds', 1507383, 'drops', 0),
        jsonb_build_object('sleeper_id', '9228', 'slug', 'bryce-young', 'adds', 770216, 'drops', 40000),
        jsonb_build_object('sleeper_id', 'TB', 'slug', 'tb-dst', 'adds', 0, 'drops', 526470),
        jsonb_build_object('sleeper_id', '10213', 'adds', 335502, 'drops', 0)),
      stamp::text, 24);
  perform tb_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 4, 'tb2 four rows in: ' || r::text);
  perform tb_true((select adds from trend_board where sleeper_id = '9228') = 770216
              and (select drops from trend_board where sleeper_id = '9228') = 40000,
    'tb2 both directions ride one row — churn is not a recommendation');
  perform tb_true((select slug from trend_board where sleeper_id = '10213') is null,
    'tb2 a row the worker could not place is STORED with a null slug, not thrown away');
  perform tb_true((select hours from trend_board where sleeper_id = 'TB') = 24,
    'tb2 …and every row carries the window its counts cover');
  -- A second pull at the SAME stamp corrects rather than duplicates.
  r := upsert_trend_board(jsonb_build_array(
        jsonb_build_object('sleeper_id', '11435', 'slug', 'emanuel-wilson', 'adds', 1600000, 'drops', 1),
        jsonb_build_object('sleeper_id', '9228', 'slug', 'bryce-young', 'adds', 770216, 'drops', 40000),
        jsonb_build_object('sleeper_id', 'TB', 'slug', 'tb-dst', 'adds', 0, 'drops', 526470),
        jsonb_build_object('sleeper_id', '10213', 'adds', 335502, 'drops', 0)),
      stamp::text, 24);
  perform tb_true((select count(*) from trend_board) = 4
              and (select adds from trend_board where sleeper_id = '11435') = 1600000,
    'tb2 the same id upserts in place rather than doubling');
  -- A row the index can place LATER keeps the slug it gains, and a pull that
  -- has no slug for it does not wipe one already learned.
  r := upsert_trend_board(jsonb_build_array(
        jsonb_build_object('sleeper_id', '10213', 'slug', 'tre-tucker', 'adds', 335502, 'drops', 0),
        jsonb_build_object('sleeper_id', '11435', 'adds', 1600000, 'drops', 1),
        jsonb_build_object('sleeper_id', '9228', 'slug', 'bryce-young', 'adds', 770216, 'drops', 40000),
        jsonb_build_object('sleeper_id', 'TB', 'slug', 'tb-dst', 'adds', 0, 'drops', 526470)),
      stamp::text, 24);
  perform tb_true((select slug from trend_board where sleeper_id = '10213') = 'tre-tucker',
    'tb2 a later pull can place a row the earlier one could not');
  perform tb_true((select slug from trend_board where sleeper_id = '11435') = 'emanuel-wilson',
    'tb2 …and a pull with no slug does not erase one already learned');

  -- ── tb3. the prune ──
  -- A player the wire stops moving drops out rather than sitting at yesterday's
  -- count. Keyed on the pull's stamp, so a retry cannot delete its own rows.
  stamp := now() + interval '1 minute';
  r := upsert_trend_board(jsonb_build_array(
        jsonb_build_object('sleeper_id', '9228', 'slug', 'bryce-young', 'adds', 900000, 'drops', 40000)),
      stamp::text, 24);
  perform tb_true((r ->> 'pruned')::int = 3 and (select count(*) from trend_board) = 1,
    'tb3 rows absent from the newest pull are pruned: ' || r::text);
  perform tb_true((select adds from trend_board where sleeper_id = '9228') = 900000,
    'tb3 …and the surviving row carries the new count');

  -- ── tb4. freshness ──
  perform tb_true(trend_board_is_fresh(), 'tb4 a pull from now is fresh');
  update trend_board set fetched_at = now() - interval '25 hours';
  perform tb_true(not trend_board_is_fresh(),
    'tb4 a day-old board is NOT fresh — a stale "trending now" is worse than none');
  m := league_market(lid);
  perform tb_true(m -> 'trend' = '{}'::jsonb,
    'tb4 …and league_market serves an empty map rather than yesterday''s counts');
  perform tb_true(m ->> 'trend_as_of' is not null,
    'tb4 while still saying WHEN, so a screen can explain the empty column');

  -- ── tb5. who may read it ──
  update trend_board set fetched_at = now();
  m := league_market(lid);
  perform tb_true((m -> 'trend' -> 'bryce-young' ->> 'a')::bigint = 900000
              and (m -> 'trend' -> 'bryce-young' ->> 'd')::bigint = 40000,
    'tb5 a member reads both directions: ' || (m -> 'trend')::text);
  perform tb_true((m ->> 'trend_hours')::int = 24, 'tb5 …and the window they cover');
  perform tb_as('02');
  perform tb_true(league_market(lid) ->> 'error' = 'forbidden',
    'tb5 someone not in the league gets nothing — league_market is a member''s door');
  perform tb_as('01');

  -- ── tb6. only what a screen can draw, and nothing else broken ──
  r := upsert_trend_board(jsonb_build_array(
        jsonb_build_object('sleeper_id', '9228', 'slug', 'bryce-young', 'adds', 900000, 'drops', 40000),
        jsonb_build_object('sleeper_id', '99999', 'adds', 4242, 'drops', 0)),
      now()::text, 24);
  m := league_market(lid);
  perform tb_true((m -> 'trend') ? 'bryce-young' and jsonb_typeof(m -> 'trend') = 'object'
              and (select count(*) from jsonb_object_keys(m -> 'trend')) = 1,
    'tb6 an unplaced row stays in the board but never reaches a screen keyed by slug');
  -- 0340 re-emits league_market; the keys it already served must still be there.
  perform tb_true((m ? 'adp') and (m ? 'own') and (m ? 'dyn') and (m ? 'picks') and (m ? 'proj')
              and (m ? 'adp_format') and (m ? 'dyn_format'),
    'tb6 every key league_market served before 0340 is still served: ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(m) k));
  delete from trend_board;
end $$;

select 'ALL TREND-BOARD PROBES PASS' as result;
drop function if exists tb_true(boolean, text);
drop function if exists tb_as(text);
