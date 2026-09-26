-- ═══════════════════════════════════════════════════════════════════════════
-- 0373 · A PROJECTION FOR COLLEGE PLAYERS, SO THE AI CAN RANK THEM.
--
-- Every AI lineup (auto-slot, unmanaged seats, best-ball fills) ranks by
-- projectedPoints, and a college player had none: all zero, so an AI seat in
-- a college-only or mixed league started college players in whatever order it
-- found them. There is still no college projection feed; what there is, is
-- what he has done (0369's season lines, by ESPN id).
--
-- college_proj_lines(week) hands every rostered college player's PER-GAME line
-- from the same season college_directory ranks by (the latest with 4+ games),
-- in the NFL projection's own shape, so the client scores it under the
-- league's catalog exactly as it scores an NFL line. Plus `has_game` for that
-- board week — by classic_kickoff_for, the rule the locks use (0372) — so a
-- college player with no game (a bye; in a mixed league, any week after the
-- college season) is benched like an NFL player on bye. NULL when the week
-- has no slate to judge by: no claim, as for an NFL player with no known team.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function college_proj_lines(p_week int) returns jsonb
  language sql stable security definer set search_path = public as $$
  with slugs as (
    select distinct nr.slug from native_roster nr where nr.slug ~ '^c-[0-9]+$'
  ), judged as (
    select exists (select 1 from nfl_slate where week = p_week)
       and exists (select 1 from nfl_slate where week between 201 and 215) as ok
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', s.slug,
      'gp', b.gp,
      'line', case when b.gp is null then null else jsonb_build_object(
        'passYd', round(coalesce(b.pass_yds, 0)::numeric / b.gp, 2),
        'passTd', round(coalesce(b.pass_td, 0)::numeric / b.gp, 3),
        'int',    round(coalesce(b.ints, 0)::numeric / b.gp, 3),
        'rushYd', round(coalesce(b.rush_yds, 0)::numeric / b.gp, 2),
        'rushTd', round(coalesce(b.rush_td, 0)::numeric / b.gp, 3),
        'rec',    round(coalesce(b.rec, 0)::numeric / b.gp, 2),
        'recYd',  round(coalesce(b.rec_yds, 0)::numeric / b.gp, 2),
        'recTd',  round(coalesce(b.rec_td, 0)::numeric / b.gp, 3)) end,
      'has_game', case when (select ok from judged)
                       then classic_kickoff_for(null, p_week, s.slug) is not null end)), '[]'::jsonb)
    from slugs s
    left join lateral (
      select st.* from college_player_stats st
       where st.espn_id = substr(s.slug, 3) and coalesce(st.gp, 0) >= 4
       order by st.season desc limit 1) b on true
$$;
grant execute on function college_proj_lines(int) to authenticated, service_role;
