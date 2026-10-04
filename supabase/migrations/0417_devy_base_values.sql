-- ═══════════════════════════════════════════════════════════════════════════
-- 0417 · DEVY VALUES FOR EVERYONE, 1QB AND SUPERFLEX (v0.601.0).
--
-- Founder: "put regularly updated devy base value in the options chip so
-- players in any league can see fresh devy values for 1QB and SF".
--
-- One list for any signed-in player, not just a devy league: StatHead's
-- composite ranks (stathead_devy, refreshed by the worker's watcher whenever
-- StatHead publishes a board) priced on Drip's devy curve with the underclass
-- discount (0413):
--   value_1qb = the devy market's price per share (prices are 1QB);
--   value_sf  = the same curve on the superflex rank, what a share would cost
--               if the market priced superflex.
-- Every number is a StatHead rank or computed from one (the third-party rule).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function devy_base_values(p_sort text default 'sf', p_pos text default null, p_q text default null,
                                            p_limit int default 100, p_offset int default 0) returns jsonb
  language sql stable security definer set search_path = public as $$
  with b as (
    select s.espn_id, coalesce(cp.full_name, s.name) as name, coalesce(cp.pos, s.pos) as pos,
           cp.school_abbr as school, cp.class_year, s.rank_1qb, s.rank_sf, _college_class_mult(cp.class_year) as m
      from stathead_devy s
      left join college_player cp on cp.espn_id = s.espn_id
     where coalesce(cp.pos, s.pos) in ('QB', 'RB', 'WR', 'TE')
       and coalesce(cp.active, true)
       and s.rank_1qb >= 1
       and (p_pos is null or p_pos = '' or coalesce(cp.pos, s.pos) = upper(p_pos))
       and (p_q is null or length(trim(p_q)) < 2
            or coalesce(cp.full_name, s.name) ilike '%' || trim(p_q) || '%'
            or upper(coalesce(cp.school_abbr, '')) = upper(trim(p_q)))
  ), v as (
    select espn_id, name, pos, school, class_year, rank_1qb, rank_sf,
           greatest(1, round(_college_curve(rank_1qb) * m, 2)) as value_1qb,
           case when rank_sf is null then null else greatest(1, round(_college_curve(rank_sf) * m, 2)) end as value_sf,
           m < 1 as underclass,
           case when p_sort = '1qb' then rank_1qb else coalesce(rank_sf, 100000 + rank_1qb) end as ord
      from b
  ), pg as (
    select * from v order by ord, rank_1qb, espn_id
     limit least(greatest(coalesce(p_limit, 100), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'as_of', (select max(as_of) from stathead_devy),
    'total', (select count(*) from v),
    'rows', coalesce((select jsonb_agg(to_jsonb(pg) - 'ord' order by pg.ord, pg.rank_1qb, pg.espn_id) from pg), '[]'::jsonb))
$$;
revoke all on function devy_base_values(text, text, text, int, int) from public;
grant execute on function devy_base_values(text, text, text, int, int) to authenticated;
