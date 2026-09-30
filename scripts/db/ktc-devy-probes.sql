-- 0400 probes: KTC'S DEVY BOARD SEEDS EARLY-SEASON PRICES.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function kt_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function kt_rank(id text) returns int language sql as $$ select rank from college_price where espn_id = id $$;
create or replace function kt_ord(id text) returns int language sql as $$
  select (e ->> 'ord')::int from jsonb_array_elements(college_directory(array['QB','RB','WR','TE'], 2000)) e where e ->> 'espn_id' = id $$;

do $$
declare r jsonb; yr int := _college_season(); sb int; sc int;
begin
  perform set_config('app.uid', '', false);
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '96001', 'full_name', 'Kay Seed Jr.', 'pos', 'WR', 'school_abbr', 'KSU', 'class_year', 1),
    jsonb_build_object('espn_id', '96002', 'full_name', 'Half Way', 'pos', 'RB', 'school_abbr', 'KSU', 'class_year', 2),
    jsonb_build_object('espn_id', '96003', 'full_name', 'Stats Only', 'pos', 'QB', 'school_abbr', 'KSU', 'class_year', 3),
    jsonb_build_object('espn_id', '96004', 'full_name', 'Twin Name', 'pos', 'WR', 'school_abbr', 'AAA', 'class_year', 2),
    jsonb_build_object('espn_id', '96005', 'full_name', 'Twin Name', 'pos', 'WR', 'school_abbr', 'BBB', 'class_year', 2)));
  perform upsert_college_stats(yr - 1, jsonb_build_array(
    jsonb_build_object('espn_id', '96002', 'gp', 12, 'rush_yds', 300, 'rush_td', 1),
    jsonb_build_object('espn_id', '96003', 'gp', 12, 'pass_yds', 900, 'pass_td', 4)));
  perform upsert_college_stats(yr, jsonb_build_array(
    jsonb_build_object('espn_id', '96002', 'gp', 2, 'rush_yds', 50),
    jsonb_build_object('espn_id', '96003', 'gp', 5, 'pass_yds', 400)));

  r := set_college_ktc(jsonb_build_array(jsonb_build_object('name', 'Kay Seed', 'pos', 'WR', 'school', 'KSU', 'rank', 1, 'value', 9999)));
  perform kt_true(not (r ->> 'ok')::boolean, 'kt1 a short read never wipes the board');

  r := (select jsonb_agg(x) from (
    select jsonb_build_object('name', 'Kay Seed', 'pos', 'WR', 'school', 'KSU', 'rank', 1, 'value', 9999) x
    union all select jsonb_build_object('name', 'Half Way', 'pos', 'RB', 'school', 'MIAMI', 'rank', 5, 'value', 6000)
    union all select jsonb_build_object('name', 'Stats Only', 'pos', 'QB', 'school', 'KSU', 'rank', 3, 'value', 7000)
    union all select jsonb_build_object('name', 'Twin Name', 'pos', 'WR', 'school', 'CCC', 'rank', 9, 'value', 4000)
    union all select jsonb_build_object('name', 'Nobody Here ' || g, 'pos', 'TE', 'school', 'ZZZ', 'rank', 20 + g, 'value', 100) from generate_series(1, 20) g) t);
  r := set_college_ktc(r);
  perform kt_true((r ->> 'matched')::int = 3, 'kt2 three match (a suffix, a school mismatch that is unique, not the twins): ' || r::text);
  perform kt_true(not exists (select 1 from college_ktc where espn_id in ('96004', '96005')), 'kt2a a name twin with no school hit stays unmatched');

  if _college_prices_frozen() then raise notice 'prices frozen today — price checks skipped'; return; end if;
  r := refresh_college_prices();
  perform kt_true(kt_rank('96001') = 1, 'kt3 no stats yet: priced from KTC alone (rank 1)');
  perform kt_true((select base from college_price where espn_id = '96001') = 10, 'kt3a …at the top of the curve');
  sc := kt_ord('96003');
  perform kt_true(kt_rank('96003') = sc, 'kt4 five games this season: stats only (' || kt_rank('96003') || ' vs ' || sc || ')');
  sb := kt_ord('96002');
  perform kt_true(kt_rank('96002') = greatest(1, round(exp(0.5 * ln(5) + 0.5 * ln(sb))))::int,
    'kt5 two games: halfway between KTC 5 and stats ' || sb || ' → ' || kt_rank('96002'));

  delete from college_ktc;
  delete from college_price where espn_id like '9600%';
  delete from college_player_stats where espn_id like '9600%';
  delete from college_player where espn_id like '9600%';
  raise notice 'ktc probes done';
end $$;

select 'ALL KTC-DEVY PROBES PASSED' as result;
