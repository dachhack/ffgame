-- 0417 probes: the devy values list (any signed-in player, 1QB and SF).
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function dv_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
begin;
do $$
declare j jsonb; r jsonb;
begin
  delete from stathead_devy;
  insert into college_player (espn_id, full_name, pos, school_abbr, class_year, active) values
    ('97701', 'Value Quarterback', 'QB', 'DVU', 3, true),
    ('97702', 'Value Receiver', 'WR', 'DVU', 2, true),
    ('97703', 'Value Lineman', 'DL', 'DVU', 3, true),
    ('97704', 'Gone Back', 'RB', 'DVU', 4, false)
    on conflict (espn_id) do update set full_name = excluded.full_name, pos = excluded.pos, class_year = excluded.class_year, active = excluded.active;
  insert into stathead_devy (espn_id, name, pos, rank_1qb, rank_sf, as_of) values
    ('97701', 'Value Quarterback', 'QB', 20, 2, now()),
    ('97702', 'Value Receiver', 'WR', 1, 5, now()),
    ('97703', 'Value Lineman', 'DL', 3, 3, now()),
    ('97704', 'Gone Back', 'RB', 4, 4, now());
  j := devy_base_values();
  perform dv_true((j ->> 'total')::int = 2, 'dv1 skill players on the board, active only: ' || j::text);
  perform dv_true(j -> 'rows' -> 0 ->> 'name' = 'Value Quarterback', 'dv2 SF order puts the SF #2 QB first');
  r := j -> 'rows' -> 0;
  perform dv_true((r ->> 'value_1qb')::numeric = 8 and (r ->> 'value_sf')::numeric = 11.40, 'dv3 the QB: 1QB #20 = 8.00, SF #2 = 11.40 — ' || r::text);
  r := j -> 'rows' -> 1;
  perform dv_true((r ->> 'value_1qb')::numeric = 11.04 and (r ->> 'underclass')::boolean, 'dv4 a sophomore #1 is 12 × 0.92 — ' || r::text);
  j := devy_base_values('1qb');
  perform dv_true(j -> 'rows' -> 0 ->> 'name' = 'Value Receiver', 'dv5 1QB order');
  perform dv_true((devy_base_values('sf', 'qb') ->> 'total')::int = 1 and (devy_base_values('sf', null, 'receiver') ->> 'total')::int = 1,
    'dv6 position and name filters');
  perform dv_true(_devy_price(null, 'c-97702') is not null, 'dv7 (sanity) the market price function still answers');
  declare csv text := devy_base_values_csv(); lines text[];
  begin
    lines := string_to_array(trim(trailing chr(10) from csv), chr(10));
    perform dv_true(array_length(lines, 1) = 3, 'dv8 the CSV: a header and one line per player — ' || csv);
    perform dv_true(lines[1] = 'rank_sf,rank_1qb,name,pos,school,class,value_1qb,value_sf,underclass_discount,refreshed', 'dv8a its header');
    perform dv_true(lines[2] like '2,20,"Value Quarterback",QB,DVU,JR,8.00,11.40,no,____-__-__', 'dv8b the QB line: ' || lines[2]);
    perform dv_true(lines[3] like '5,1,"Value Receiver",WR,DVU,SO,11.04,%,yes,%', 'dv8c the sophomore line: ' || lines[3]);
  end;
end $$;
rollback;
-- 0419: a player the roster sweep missed isn't a new listing (until Oct 5).
begin;
do $$
begin
  insert into college_player (espn_id, full_name, pos, school_abbr, class_year) values ('97799', 'Missed Receiver', 'WR', 'DVU', 3);
  perform dv_true((select first_seen from college_player where espn_id = '97799')
                  = case when now() < timestamptz '2026-10-05 00:00+00' then timestamptz '2026-01-01' else (select first_seen from college_player where espn_id = '97799') end,
    'dv9 a backfilled player is dated as already known');
  perform dv_true(now() >= timestamptz '2026-10-05 00:00+00' or (select first_seen from college_player where espn_id = '97799') < now() - interval '30 days',
    'dv9a …so a market won''t list him as new');
end $$;
rollback;
\echo ALL DEVY-VALUES PROBES PASSED
