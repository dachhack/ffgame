-- 0403 probes: THE DEVY MARKET PRICES ON STATHEAD'S DEVY COMPOSITE.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function sh_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sh_rank(id text) returns int language sql as $$ select rank from college_price where espn_id = id $$;
create or replace function sh_ord(id text) returns int language sql as $$
  select (e ->> 'ord')::int from jsonb_array_elements(college_directory(array['QB','RB','WR','TE'], 2000)) e where e ->> 'espn_id' = id $$;

do $$
declare r jsonb; yr int := _college_season(); t1 timestamptz := now() - interval '1 hour'; t2 timestamptz := now(); sb int;
begin
  perform set_config('app.uid', '', false);
  perform sh_true(to_regclass('college_ktc') is null, 'sh0 KTC''s board is gone');
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '96101', 'full_name', 'Board Only', 'pos', 'WR', 'school_abbr', 'SHU', 'class_year', 1),
    jsonb_build_object('espn_id', '96102', 'full_name', 'Both Ways', 'pos', 'RB', 'school_abbr', 'SHU', 'class_year', 2),
    jsonb_build_object('espn_id', '96103', 'full_name', 'Stats Only', 'pos', 'QB', 'school_abbr', 'SHU', 'class_year', 3)));
  perform upsert_college_stats(yr - 1, jsonb_build_array(
    jsonb_build_object('espn_id', '96102', 'gp', 12, 'rush_yds', 300, 'rush_td', 1),
    jsonb_build_object('espn_id', '96103', 'gp', 12, 'pass_yds', 900, 'pass_td', 4)));

  -- A short batch never replaces the board.
  r := upsert_stathead_devy(jsonb_build_array(jsonb_build_object('espn_id', '96199', 'name', 'Gone Next Week', 'pos', 'WR', 'rank_1qb', 1)), t1);
  r := finish_stathead_devy(t1);
  perform sh_true(not (r ->> 'ok')::boolean, 'sh1 a short board is refused: ' || r::text);

  -- A full batch: three real players plus filler, keyed by ESPN id.
  r := upsert_stathead_devy((select jsonb_agg(x) from (
      select jsonb_build_object('espn_id', '96101', 'name', 'Board Only', 'pos', 'WR', 'rank_1qb', 1, 'rank_sf', 1, 'value_1qb', 9990) x
      union all select jsonb_build_object('espn_id', '96102', 'name', 'Both Ways', 'pos', 'RB', 'rank_1qb', 9)
      union all select jsonb_build_object('espn_id', (970000 + g)::text, 'name', 'Filler ' || g, 'pos', 'TE', 'rank_1qb', 100 + g)
        from generate_series(1, 1100) g) t), t2);
  perform sh_true((r ->> 'rows')::int = 1102, 'sh2 the batch lands: ' || r::text);
  r := finish_stathead_devy(t2);
  perform sh_true((r ->> 'ok')::boolean and (r ->> 'dropped')::int = 1, 'sh2a finishing drops the old batch''s row: ' || r::text);
  perform sh_true((r ->> 'matched')::int = 2, 'sh2b joined to college players by ESPN id, no names: ' || r::text);

  if _college_prices_frozen() then raise notice 'prices frozen today — price checks skipped'; return; end if;
  r := refresh_college_prices();
  perform sh_true(sh_rank('96101') = 1, 'sh3 on the board, no stats: priced from StatHead alone');
  sb := sh_ord('96102');
  perform sh_true(sh_rank('96102') = greatest(1, round(exp(0.5 * ln(9) + 0.5 * ln(sb))))::int,
    'sh4 both: halfway between StatHead 9 and stats ' || sb || ' → ' || sh_rank('96102'));
  perform sh_true(sh_rank('96103') = sh_ord('96103'), 'sh5 off the board: stats alone');
  perform sh_true(not exists (select 1 from college_price where espn_id = '970001'), 'sh6 a board row with no college player is not priced');

  delete from stathead_devy;
  delete from college_price where espn_id like '9610%';
  delete from college_player_stats where espn_id like '9610%';
  delete from college_player where espn_id like '9610%';
end $$;

select 'ALL STATHEAD-DEVY PROBES PASSED' as result;
