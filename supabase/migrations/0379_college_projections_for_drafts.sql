-- ═══════════════════════════════════════════════════════════════════════════
-- 0379 · A COLLEGE PROJECTION THE DRAFT CAN RANK BY.
--
-- Founder: "do we have college player projections for the year? We need to
-- rank them in drafts."
--
-- No feed projects a college player; Stathead doesn't either. What there is
-- (0369) is every FBS player's line for last season and this season so far.
-- Until now the pool was ranked, and the AI's lineups priced (0373), by the
-- latest season with 4+ games, which in September meant last year's line for
-- everyone and this year's for no one. And the draft room had no college
-- projection at all: 0373's lines only reach rostered players, so in a draft
-- every college player's PROJ read "—" and sorted last.
--
-- ── ONE ESTIMATE, BLENDED ──────────────────────────────────────────────────
-- _college_proj(espn_id): a per-game line from the player's latest season
-- blended with the one before it — each game this season counts fully, each
-- game last season counts half — so three good games this year move him, and
-- a year of evidence still steadies him. It needs 3 effective games (three
-- this season, or six last season); a freshman with no stats has no line,
-- and ranks after everyone who has one, as before.
--
-- The same estimate now drives:
--   • college_directory — the order a pool is seeded in (so RANK, and the
--     autopick that follows it);
--   • college_proj_lines — the AI's weekly lines (0373);
--   • college_pool_lines(league) — NEW: a line for every college player in a
--     league's pool, which the draft rooms install so PROJ ranks them against
--     each other and against the NFL.
-- Offense only (0369 sweeps passing, rushing and receiving): a college
-- defender has no line yet.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _college_proj(p_espn_id text)
  returns table (season int, eff numeric, line jsonb, ppg numeric)
  language sql stable security definer set search_path = public as $$
  with s as (
    select st.*, row_number() over (order by st.season desc) as rn
      from college_player_stats st
     where st.espn_id = p_espn_id and coalesce(st.gp, 0) > 0
  ), w as (
    select max(s.season) filter (where rn = 1) as season,
           sum(case when rn = 1 then 1.0 else 0.5 end * s.gp) as eff,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.pass_yds, 0)) as pass_yds,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.pass_td, 0))  as pass_td,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.ints, 0))     as ints,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.rush_yds, 0)) as rush_yds,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.rush_td, 0))  as rush_td,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.rec, 0))      as rec,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.rec_yds, 0))  as rec_yds,
           sum(case when rn = 1 then 1.0 else 0.5 end * coalesce(s.rec_td, 0))   as rec_td
      from s where rn <= 2
  )
  select w.season, w.eff,
    jsonb_build_object(
      'passYd', round(w.pass_yds / w.eff, 2), 'passTd', round(w.pass_td / w.eff, 3), 'int', round(w.ints / w.eff, 3),
      'rushYd', round(w.rush_yds / w.eff, 2), 'rushTd', round(w.rush_td / w.eff, 3),
      'rec', round(w.rec / w.eff, 2), 'recYd', round(w.rec_yds / w.eff, 2), 'recTd', round(w.rec_td / w.eff, 3)),
    round((w.pass_yds * 0.04 + w.pass_td * 4 - w.ints * 2 + w.rush_yds * 0.1 + w.rush_td * 6
           + w.rec + w.rec_yds * 0.1 + w.rec_td * 6) / w.eff, 2)
    from w where w.eff >= 3
$$;
revoke all on function _college_proj(text) from public, anon, authenticated;

-- ── college_directory — 0369's shape, ranked by the blend ──
-- `season` is the latest season in the blend and `gp` its effective games.
create or replace function college_directory(p_positions text[] default array['QB','RB','WR','TE'], p_limit int default 600)
  returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select cp.espn_id, cp.full_name as full, cp.pos, cp.school_abbr, cp.class_label, cp.class_year,
           best.season, round(best.eff, 1) as gp, round(best.ppg, 1) as ppg,
           row_number() over (order by best.ppg desc nulls last, cp.class_year desc nulls last, cp.full_name) as ord
      from college_player cp
      left join lateral (select * from _college_proj(cp.espn_id)) best on true
     where cp.active and cp.pos = any(p_positions)
     order by ord
     limit least(greatest(coalesce(p_limit, 600), 1), 2000)
  ) t
$$;
grant execute on function college_directory(text[], int) to authenticated;

-- ── college_proj_lines — 0375's body, the blend in place of one season ──
create or replace function college_proj_lines(p_week int) returns jsonb
  language sql stable security definer set search_path = public as $$
  with slugs as (
    select distinct nr.slug from native_roster nr where nr.slug ~ '^c-[0-9]+$'
  ), judged as (
    select exists (select 1 from nfl_slate where week = p_week)
       and exists (select 1 from nfl_slate where week between 201 and 223) as ok
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', s.slug,
      'gp', b.eff,
      'line', b.line,
      'has_game', case when (select ok from judged)
                       then classic_kickoff_for(null, p_week, s.slug) is not null end)), '[]'::jsonb)
    from slugs s
    left join lateral (select * from _college_proj(substr(s.slug, 3))) b on true
$$;
grant execute on function college_proj_lines(int) to authenticated, service_role;

-- ── NEW: a line for every college player in a league's pool ──
create or replace function college_pool_lines(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  -- Granted to signed-in users only (as the stats table's own read is).
  select coalesce((select jsonb_agg(jsonb_build_object('slug', lp.slug, 'gp', b.eff, 'ppg', b.ppg, 'line', b.line))
                     from league_pool lp
                     join lateral (select * from _college_proj(substr(lp.slug, 3))) b on true
                    where lp.league_id = p_league_id and lp.level = 'college'), '[]'::jsonb)
$$;
grant execute on function college_pool_lines(uuid) to authenticated, service_role;
