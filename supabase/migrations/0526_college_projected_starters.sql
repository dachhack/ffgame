-- ═══════════════════════════════════════════════════════════════════════════
-- 0526 · COLLEGE PROJECTED STARTERS (v0.736.0)
--
-- Founder, after v0.735.4 emptied a college game's pregame box (it had listed
-- the Dolphins under Miami): "We have projections for college players in the
-- app. Where do we get those?" … "Build it". The estimate is 0379's
-- _college_proj (this season's per-game line blended with last season's,
-- 3+ effective games), which until now reached only players in a league's
-- pool. A box score lists both schools' players, so this serves, for each
-- school asked, its top-projected active QB, 2 RB, 3 WR and TE with the
-- per-game line the app scores by the league's own rules. Offense only, as
-- the stats sweep is. Signed-in members, up to 40 schools a call.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function college_projected_starters(p_schools text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  with asked as (
    select distinct upper(s) as school from unnest(coalesce(p_schools, '{}'::text[])) s
     where s is not null limit 40
  ), cand as (
    select cp.espn_id, cp.full_name, cp.pos, upper(cp.school_abbr) as school, b.line, b.ppg,
           row_number() over (partition by upper(cp.school_abbr), cp.pos order by b.ppg desc, cp.full_name) as rk
      from college_player cp
      join asked a on a.school = upper(cp.school_abbr)
      join lateral (select * from _college_proj(cp.espn_id)) b on true
     where cp.active and cp.pos in ('QB', 'RB', 'WR', 'TE')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', 'c-' || espn_id, 'full', full_name, 'pos', pos, 'school', school, 'line', line, 'ppg', ppg)
           order by school, pos, rk), '[]'::jsonb)
    from cand
   where rk <= case pos when 'QB' then 1 when 'RB' then 2 when 'WR' then 3 else 1 end
$$;
revoke all on function college_projected_starters(text[]) from public, anon;
grant execute on function college_projected_starters(text[]) to authenticated;
