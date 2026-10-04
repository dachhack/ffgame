-- ═══════════════════════════════════════════════════════════════════════════
-- 0404 · THE DEVY MARKET GOES ALL THE WAY DOWN.
--
-- Founder: "Can we go super deep with devy players for shares?"
--
-- allot_devy_shares already took any active college player — an unpriced one
-- at the 1-point floor (_devy_price) — but devy_market listed only the top
-- 1,000 priced players and the apps searched only that list, so nobody could
-- find the deep ones. Now:
--   · the list is every active college QB/RB/WR/TE: priced players by price
--     rank, then the unpriced by StatHead's devy rank, then by name;
--   · p_query searches that whole pool by name or school (the apps call it
--     as you type);
--   · each row carries sh_rank, StatHead's 1QB devy composite rank, so a
--     deep player still shows where the board has him.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists devy_market(uuid, int);
create or replace function devy_market(p_league_id uuid, p_limit int default 1000, p_query text default null)
  returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as needle)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', 'c-' || t.espn_id, 'name', t.full_name, 'pos', t.pos, 'school', t.school_abbr,
        'class_year', t.class_year, 'rank', t.rank, 'sh_rank', t.sh_rank, 'youth', coalesce(t.youth = 1, false),
        'price', _devy_price(null, 'c-' || t.espn_id)) order by t.ord)
      from (
        select cp.espn_id, cp.full_name, cp.pos, cp.school_abbr, cp.class_year, p.rank, p.youth, s.rank_1qb as sh_rank,
               row_number() over (order by p.rank nulls last, s.rank_1qb nulls last, cp.full_name) as ord
          from college_player cp
          left join college_price p on p.espn_id = cp.espn_id
          left join stathead_devy s on s.espn_id = cp.espn_id
         where cp.active and cp.pos in ('QB', 'RB', 'WR', 'TE')
           and ((select needle from q) is null
                or cp.full_name ilike '%' || (select needle from q) || '%'
                or cp.school_abbr ilike (select needle from q) || '%'
                or cp.school ilike '%' || (select needle from q) || '%')
         order by ord
         limit least(greatest(coalesce(p_limit, 1000), 1), 5000)) t), '[]'::jsonb)
  end
$$;
grant execute on function devy_market(uuid, int, text) to authenticated;
