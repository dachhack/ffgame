-- 0324: THE LEAGUE'S HISTORY — past champions, a record book, and every
-- manager's all-time line.
--
-- The gap list's third priority, and the one it called "a screen, not a
-- schema": Sleeper, Yahoo (2026 Record Book), League Tycoon and MFL (back to
-- 1980) all show a league its own past; Drip kept every season's rows and
-- never showed them. The data has been there since 0073 stamped a champion
-- and 0182 started rolling a league into its next season — this reads it.
--
-- THE LINEAGE. A native league's seasons share one sleeper_league_id
-- ('native-…'), which is how _rollover_target already finds next season. So
-- the lineage is every native league row with that key, oldest first, and a
-- league that has never rolled over is a lineage of one — which still has a
-- record book, it is just a short one. An imported league (Sleeper, ESPN) has
-- no rollover of ours, so it stands alone.
--
-- WHAT IS COUNTED. Regular-season finals decide the records and the manager
-- lines; playoff finals are in the record book's single-week rows (a
-- semi-final is a real 180-point week) but never in a W-L. The median game
-- (0320) is a standings display, not a game, so it is not here either.
-- Preseason weeks (the 101+ offset) are practice and are excluded outright.
--
-- WHO A MANAGER IS. app_user_id where the seat is claimed, else the seat
-- itself — so a league whose seats changed hands keeps two honest lines
-- rather than one wrong one, and an unclaimed seat still has a history.

-- ═══ 1. the lineage ══════════════════════════════════════════════════════════
create or replace function _lineage_ids(p_league_id uuid) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select case
    when (select provider from league where id = p_league_id) <> 'native'
      or (select coalesce(kind, 'league') from league where id = p_league_id) <> 'league'
      then array[p_league_id]
    else coalesce((
      select array_agg(l2.id order by l2.season)
      from league l1 join league l2 on l2.sleeper_league_id = l1.sleeper_league_id
      where l1.id = p_league_id and l2.provider = 'native'
        and coalesce(l2.kind, 'league') = 'league' and not coalesce(l2.is_mock, false)
    ), array[p_league_id]) end;
$$;
grant execute on function _lineage_ids(uuid) to authenticated;

-- A member of ANY season may read the history of all of them — a manager who
-- joined last August should see the seasons he missed, and the league's past
-- is not a secret from the league.
create or replace function _may_read_history(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from unnest(_lineage_ids(p_league_id)) x(id)
     where is_league_member(x.id) or is_league_commish(x.id));
$$;
grant execute on function _may_read_history(uuid) to authenticated;

-- ═══ 2. the history ══════════════════════════════════════════════════════════
-- One call, because every part of it reads the same handful of leagues: the
-- seasons with their champions and final tables, the record book, and the
-- all-time manager lines.
create or replace function league_history(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; out_ jsonb;
begin
  if not _may_read_history(p_league_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  ids := _lineage_ids(p_league_id);

  with seasons as (
    select l.id, l.season, l.name, l.settings_json,
           nullif(l.settings_json ->> 'playoff_champion', '')::int as champ
    from league l where l.id = any (ids)
  ),
  -- Every final game as two rows, one per side: the shape every record below
  -- wants. Preseason (101+) never counts.
  sides as (
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.home_roster_id as roster_id, m.away_roster_id as opp,
           m.home_final::numeric as pts, m.away_final::numeric as opp_pts
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
    union all
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.away_roster_id, m.home_roster_id, m.away_final::numeric, m.home_final::numeric
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
  ),
  -- A seat's regular season, per season.
  reg as (
    select s.league_id, s.roster_id,
           count(*) filter (where s.pts > s.opp_pts)::int as w,
           count(*) filter (where s.pts < s.opp_pts)::int as l,
           count(*) filter (where s.pts = s.opp_pts)::int as t,
           round(sum(s.pts), 2) as pf, round(sum(s.opp_pts), 2) as pa
      from sides s where not s.is_playoff
     group by s.league_id, s.roster_id
  ),
  -- The title game: the deepest non-consolation playoff round that finished.
  finals as (
    select distinct on (m.league_id) m.league_id, m.home_roster_id, m.away_roster_id,
           m.home_final::numeric as hf, m.away_final::numeric as af
      from matchup m
     where m.league_id = any (ids) and m.is_playoff and not m.is_consolation
       and m.status = 'final' and m.home_final is not null and m.away_final is not null
     order by m.league_id, m.playoff_round desc nulls last, m.week desc
  ),
  -- Who held each seat, per season, and what they called themselves.
  seats as (
    select mm.league_id, mm.sleeper_roster_id as roster_id, mm.team_name, mm.app_user_id, mm.avatar_url,
           coalesce(mm.app_user_id::text, 'seat:' || mm.sleeper_roster_id) as mgr
      from league_membership mm where mm.league_id = any (ids)
  )
  select jsonb_build_object(
    'ok', true,
    'league_id', p_league_id,
    'seasons_count', (select count(*) from seasons),
    -- ── the seasons, newest first ──
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'league_id', s.id, 'season', s.season, 'name', s.name,
        'current', s.id = p_league_id,
        'champion', case when s.champ is not null then jsonb_build_object(
            'roster_id', s.champ,
            'team', (select st.team_name from seats st where st.league_id = s.id and st.roster_id = s.champ),
            'avatar', (select st.avatar_url from seats st where st.league_id = s.id and st.roster_id = s.champ)) end,
        'runner_up', (select case when f.hf is null then null else
             jsonb_build_object('roster_id', case when f.hf > f.af then f.away_roster_id else f.home_roster_id end,
                                'team', (select st.team_name from seats st where st.league_id = s.id
                                          and st.roster_id = case when f.hf > f.af then f.away_roster_id else f.home_roster_id end))
           end from finals f where f.league_id = s.id),
        -- the regular-season table, best first
        'table', coalesce((
          select jsonb_agg(jsonb_build_object(
              'roster_id', r.roster_id,
              'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id),
              'w', r.w, 'l', r.l, 't', r.t, 'pf', r.pf, 'pa', r.pa)
            order by r.w desc, r.pf desc)
          from reg r where r.league_id = s.id), '[]'::jsonb),
        -- the season's own high-water mark
        'high_week', (select jsonb_build_object('week', x.week, 'roster_id', x.roster_id, 'points', round(x.pts, 2),
                               'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id))
                        from sides x where x.league_id = s.id order by x.pts desc limit 1))
        order by s.season desc)
      from seasons s), '[]'::jsonb),
    -- ── the record book, all-time across the lineage ──
    'records', jsonb_build_object(
      'top_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'playoff', x.is_playoff, 'points', round(x.pts, 2),
                   'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'opp_points', round(x.opp_pts, 2),
                   'opp', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp)) as e
            from sides x order by x.pts desc limit 10) q), '[]'::jsonb),
      'low_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'points', round(x.pts, 2), 'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id)) as e
            from sides x order by x.pts limit 5) q), '[]'::jsonb),
      'blowouts', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts desc limit 5) q), '[]'::jsonb),
      'nailbiters', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts limit 5) q), '[]'::jsonb),
      'top_seasons', coalesce((select jsonb_agg(e order by (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'pf', r.pf, 'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r order by r.pf desc limit 5) q), '[]'::jsonb),
      'best_records', coalesce((select jsonb_agg(e order by (e ->> 'pct')::numeric desc, (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'pct', round((r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0), 3),
                   'pf', r.pf, 'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r where r.w + r.l + r.t >= 4 order by (r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0) desc, r.pf desc limit 5) q), '[]'::jsonb)),
    -- ── the managers, all-time ──
    -- Ordered by titles, then wins: a champions-first table, which is the one
    -- argument this screen exists to settle.
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'manager', g.mgr, 'team', g.team, 'app_user_id', g.uid,
          'seasons', g.seasons, 'w', g.w, 'l', g.l, 't', g.t, 'pf', g.pf,
          'titles', g.titles, 'finals', g.finals)
        order by g.titles desc, g.w desc, g.pf desc)
      from (
        select st.mgr,
               max(st.app_user_id::text)::uuid as uid,
               -- the name they go by now: the latest season's team name
               (array_agg(st.team_name order by (select se.season from seasons se where se.id = st.league_id) desc))[1] as team,
               count(distinct st.league_id)::int as seasons,
               coalesce(sum(r.w), 0)::int as w, coalesce(sum(r.l), 0)::int as l,
               coalesce(sum(r.t), 0)::int as t, coalesce(round(sum(r.pf), 2), 0) as pf,
               count(*) filter (where exists (select 1 from seasons se
                  where se.id = st.league_id and se.champ = st.roster_id))::int as titles,
               count(*) filter (where exists (select 1 from finals f
                  where f.league_id = st.league_id
                    and st.roster_id in (f.home_roster_id, f.away_roster_id)))::int as finals
          from seats st
          left join reg r on r.league_id = st.league_id and r.roster_id = st.roster_id
         group by st.mgr
      ) g), '[]'::jsonb))
  into out_;
  return out_;
end $$;
grant execute on function league_history(uuid) to authenticated;
