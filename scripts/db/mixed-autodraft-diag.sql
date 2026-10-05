-- Diagnostic (read-only): why an autodraft in a mixed NFL + college league
-- took one college player per college spot and no K or D/ST (v0.637.x).
-- Run through dbquery.yml. Names only what the question needs.
\pset pager off
\set ON_ERROR_STOP on

-- 1. The league(s): COLLEGE on, NFL calendar, native.
select l.id, l.name, l.season, l.created_at::date,
       l.settings_json -> 'positions_extra' as extras,
       l.settings_json ->> 'calendar' as calendar,
       l.settings_json -> 'roster_shape' as shape,
       l.settings_json -> 'pool_filter' as pool_filter,
       l.settings_json ->> 'devy_mode' as devy_mode,
       league_is_mixed(l.id) as mixed,
       (select jsonb_agg(jsonb_build_object('pos', s.value -> 'pos', 'level', s.value ->> 'level', 'label', s.value ->> 'label') order by s.ord)
          from jsonb_array_elements(coalesce(l.settings_json -> 'roster_slots', '[]'::jsonb)) with ordinality s(value, ord)) as slots
  from league l
 where l.provider = 'native' and _league_has_college(l.settings_json)
   and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'nfl'
 order by l.created_at desc
 limit 5;

-- 2. Their drafts.
select d.league_id, d.status, d.mode, d.rounds, d.stash_slots, d.devy_from, d.devy_rounds, d.current_overall,
       jsonb_array_length(coalesce(d.pick_owners, '[]'::jsonb)) as owners_n
  from draft d join league l on l.id = d.league_id
 where l.provider = 'native' and _league_has_college(l.settings_json)
   and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'nfl'
 order by l.created_at desc limit 5;

-- 3. Their pools by position and level — are K and DEF there at all?
select lp.league_id, lp.level, lp.pos, count(*) as n, min(lp.rank) as best_rank, max(lp.rank) as worst_rank
  from league_pool lp join league l on l.id = lp.league_id
 where l.provider = 'native' and _league_has_college(l.settings_json)
   and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'nfl'
 group by lp.league_id, lp.level, lp.pos
 order by lp.league_id, lp.level, lp.pos;

-- 4. Each team's roster by level/pos/spot.
select nr.league_id, nr.roster_id, nr.spot, lp.level, lp.pos, count(*) as n
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  join league l on l.id = nr.league_id
 where l.provider = 'native' and _league_has_college(l.settings_json)
   and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'nfl'
 group by nr.league_id, nr.roster_id, nr.spot, lp.level, lp.pos
 order by nr.league_id, nr.roster_id, nr.spot, lp.level, lp.pos;

-- 5. The picks, in order, for the most recent such league: round, who, pos, level, auto?
with lg as (
  select l.id from league l
   where l.provider = 'native' and _league_has_college(l.settings_json)
     and coalesce(l.settings_json ->> 'calendar', 'nfl') = 'nfl'
   order by l.created_at desc limit 1)
select dp.round, dp.overall, dp.roster_id, dp.slug, lp.pos, lp.level, dp.auto, dp.made_at
  from draft_pick dp join lg on lg.id = dp.league_id
  left join league_pool lp on lp.league_id = dp.league_id and lp.slug = dp.slug
 order by dp.overall
 limit 80;
