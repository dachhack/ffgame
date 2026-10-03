-- ═══════════════════════════════════════════════════════════════════════════
-- 0420 · DEVY VALUES LIST ONLY PLAYERS ON A ROSTER (v0.604.0).
--
-- Founder, over the devy values list: "How do we have guys with no schools?"
-- After v0.603.0 loaded full rosters, 868 of StatHead's 6,996 still had no
-- college_player row: 749 that ESPN marks inactive at a school we sweep (off
-- the team this season: injured, out of eligibility, done playing), 95 active
-- at Division II/III/NAIA schools we don't sweep, 14 with no ESPN record, and
-- a handful of ESPN roster gaps. None of them can be bought (no price row), so
-- the list was showing players nobody can invest in. Now it lists only
-- players on an FBS/FCS roster this season; their StatHead ranks stay as
-- StatHead has them, so a gap in the rank column is a player left out.
-- The CSV (0418) reads this function, so it follows.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function devy_base_values(p_sort text default 'sf', p_pos text default null, p_q text default null,
                                            p_limit int default 100, p_offset int default 0) returns jsonb
  language sql stable security definer set search_path = public as $$
  with b as (
    select s.espn_id, coalesce(cp.full_name, s.name) as name, coalesce(cp.pos, s.pos) as pos,
           cp.school_abbr as school, cp.class_year, s.rank_1qb, s.rank_sf, _college_class_mult(cp.class_year) as m
      from stathead_devy s
      join college_player cp on cp.espn_id = s.espn_id and cp.active   -- 0420: on a roster now
     where coalesce(cp.pos, s.pos) in ('QB', 'RB', 'WR', 'TE')
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
