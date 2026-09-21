-- 0330 probes: THE MATCHUP MULTIPLIER.
--   • a StatHead row lands keyed by SLEEPER id and an ESPN row by ATHLETE id,
--     side by side, without either overwriting the other;
--   • the reader prefers StatHead PER PLAYER and falls back to ESPN per
--     player, so a man one source has never heard of still has a week;
--   • `rows` carries the multiplier, the opponent, the home flag, the status
--     and WHICH source answered, while `projections` still carries the plain
--     points 0329's callers read;
--   • a second poll updates in place rather than duplicating;
--   • the old row shape (espn_id, no key) still writes, because the ESPN
--     path did not change its rows.
\set QUIET on
\pset pager off
create or replace function mm_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function mm_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000024' || u, false); perform set_config('app.email', 'mm' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002401', 'mm01@test.dev'), ('00000000-0000-0000-0000-000000002402', 'mm02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000002401', 'mm01@test.dev'), ('00000000-0000-0000-0000-000000002402', 'mm02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000002402');

do $$
declare r jsonb; lid uuid; seas text;
begin
  perform mm_as('01');
  r := create_native_league('Multiplier', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform mm_true((r ->> 'ok')::boolean, 'mm0 league'); lid := (r ->> 'league_id')::uuid;
  select season into seas from league where id = lid;
  -- One player both sources know, one only StatHead has a sleeper id for,
  -- one only ESPN can reach, and one neither can.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, sleeper_id) values
    (lid, 'mm-both',  'Both Sources', 'RB', 'MMH', 1, '111', 's111'),
    (lid, 'mm-sh',    'StatHead Only', 'WR', 'MMH', 2, null,  's222'),
    (lid, 'mm-espn',  'ESPN Only',    'TE', 'MMH', 3, '333', null),
    (lid, 'mm-none',  'No Crosswalk', 'QB', 'MMH', 4, null,  null);

  -- ── mm1. two sources, one table ──
  r := upsert_week_projections(seas, 3, jsonb_build_array(
    jsonb_build_object('key', 's111', 'source', 'stathead', 'pts', 18.4, 'mult', 1.08, 'opp', 'ARI', 'home', false, 'status', null),
    jsonb_build_object('key', 's222', 'source', 'stathead', 'pts', 11.1, 'mult', 0.92, 'opp', 'SEA', 'home', true, 'status', 'backup')));
  perform mm_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 2, 'mm1 two StatHead rows written');
  -- The ESPN path's own row shape, unchanged from 0329.
  r := upsert_week_projections(seas, 3, jsonb_build_array(
    jsonb_build_object('espn_id', '111', 'pts', 15.0, 'line', jsonb_build_object('ruYd', 80)),
    jsonb_build_object('espn_id', '333', 'pts', 9.5, 'line', jsonb_build_object('reYd', 60))));
  perform mm_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 2, 'mm1 the old row shape still writes');
  perform mm_true((select count(*) from nfl_week_proj where season = seas and week = 3) = 4,
    'mm1 four rows: the same player from two sources is two rows, not a collision');
  perform mm_true((select player_key from nfl_week_proj where season = seas and week = 3 and source = 'espn' and espn_id = '111') = '111',
    'mm1 an espn row keys itself on its athlete id');

  -- ── mm2. the reader prefers StatHead, per player ──
  r := league_week_projections(lid, 3);
  perform mm_true((r ->> 'ok')::boolean, 'mm2 the league reads it');
  perform mm_true((r -> 'rows' -> 'mm-both' ->> 'source') = 'stathead'
    and (r -> 'projections' ->> 'mm-both')::numeric = 18.4,
    'mm2 where both answer, StatHead wins');
  perform mm_true((r -> 'rows' -> 'mm-espn' ->> 'source') = 'espn'
    and (r -> 'projections' ->> 'mm-espn')::numeric = 9.5,
    'mm2 where only ESPN can reach him, ESPN answers');
  perform mm_true((r -> 'rows' -> 'mm-sh' ->> 'source') = 'stathead',
    'mm2 and a player with no espn_id is served by his sleeper id');
  perform mm_true(not (r -> 'rows' ? 'mm-none') and not (r -> 'projections' ? 'mm-none'),
    'mm2 a player neither source can place is absent, not zero');

  -- ── mm3. what the row carries ──
  perform mm_true((r -> 'rows' -> 'mm-both' ->> 'mult')::numeric = 1.08,
    'mm3 the multiplier — the half a custom-scoring league needs');
  perform mm_true((r -> 'rows' -> 'mm-both' ->> 'opp') = 'ARI'
    and (r -> 'rows' -> 'mm-both' ->> 'home')::boolean = false,
    'mm3 the matchup it came from');
  perform mm_true((r -> 'rows' -> 'mm-sh' ->> 'status') = 'backup', 'mm3 and why a number is soft');
  perform mm_true((r -> 'rows' -> 'mm-espn' ->> 'mult') is null,
    'mm3 an ESPN row has no multiplier, and says so rather than inventing 1');

  -- ── mm4. a second poll ──
  perform upsert_week_projections(seas, 3, jsonb_build_array(
    jsonb_build_object('key', 's111', 'source', 'stathead', 'pts', 0, 'mult', 0, 'opp', 'ARI', 'home', false, 'status', 'RES')));
  perform mm_true((select count(*) from nfl_week_proj where season = seas and week = 3) = 4,
    'mm4 the refresh does not duplicate');
  r := league_week_projections(lid, 3);
  perform mm_true((r -> 'rows' -> 'mm-both' ->> 'status') = 'RES'
    and (r -> 'rows' -> 'mm-both' ->> 'mult')::numeric = 0,
    'mm4 a man placed on IR comes back at zero WITH the reason');
  perform mm_true((league_week_projections(lid, 9) -> 'rows') = '{}'::jsonb,
    'mm4 a week nobody has polled is empty, not an error');

  -- ── mm5. who may read it (0327 still rules) ──
  perform mm_as('02');
  perform mm_true((league_week_projections(lid, 3) ->> 'ok')::boolean, 'mm5 a public league answers anyone');
  perform mm_as('01');
  perform mm_true((commish_set_public_api(lid, false) ->> 'ok')::boolean, 'mm5 the commissioner opts out');
  perform mm_as('02');
  perform mm_true(league_week_projections(lid, 3) ->> 'error' = 'forbidden', 'mm5 and a stranger reads nothing');
end $$;

select 'ALL MATCHUP-MULT PROBES PASS' as result;
drop function if exists mm_true(boolean, text);
drop function if exists mm_as(text);
