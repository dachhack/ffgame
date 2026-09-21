-- 0332: THE HISTORY IS NOT THE ACCOUNT — a leak 0326 opened, found by the
-- probe suite 0324 left behind.
--
-- WHAT HAPPENED. 0324 keyed the record book on `app_user_id`, so a seat that
-- changed hands keeps two honest manager lines, and gated the whole surface
-- on membership. 0326 needed that gate to admit an ANONYMOUS caller — the
-- public API's whole audience — so `_may_read_history` grew "or the league
-- is public", and 0327 made a native league public by default.
--
-- `api_history` was careful: it strips `app_user_id` and replaces the manager
-- key with an opaque handle before anything leaves the building. But
-- `league_history` is granted to `authenticated` and is security definer, so
-- ANY signed-in account could call it directly against ANY public league and
-- be handed the account ids of that league's managers. The API's redaction
-- was a wrapper around a door that was already open.
--
-- 0324's own probe said so out loud — "h3 a stranger reads nothing" has been
-- failing since 0326 — and it took a full-suite run during the StatHead audit
-- to notice, because the suite prints its PASS line whether or not the block
-- that precedes it threw.
--
-- THE CONTRACT, STATED ONCE AND ENFORCED IN ONE PLACE:
--
--   · A MEMBER, a commissioner of any season in the lineage, or an admin
--     reads the history in full, `app_user_id` included. That is what the
--     app's own screens use it for.
--   · ANYBODY ELSE reading a public league — signed in or anonymous, through
--     the RPC or through the API — gets the same history with the account
--     ids REMOVED and the manager key replaced by a stable opaque handle. A
--     tool can still group a manager's rows; nobody is handed an identifier
--     they could go looking for elsewhere.
--   · A league that has opted OUT of the public API is refused outright, as
--     it always was.
--
-- The redaction moves INTO `league_history`, which is the only place that can
-- guarantee it. `api_history` keeps its own pass for the same reason a belt
-- keeps working next to braces.
create or replace function league_history(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; out_ jsonb; mine boolean;
begin
  if not _may_read_history(p_league_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  ids := _lineage_ids(p_league_id);
  -- WHOSE HISTORY IS THIS. Asked once, here, before any of it is built: the
  -- answer decides only whether the account ids survive the last statement.
  mine := is_admin() or exists (
    select 1 from unnest(ids) x(id) where is_league_member(x.id) or is_league_commish(x.id));

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
          'titles', g.titles, 'finals', g.finals,
          'awards', g.awards, 'badges', g.badges)
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
                    and st.roster_id in (f.home_roster_id, f.away_roster_id)))::int as finals,
               -- 0325: the trophy case. Weekly awards won across every season
               -- this manager held a seat in, and the badges pinned on them.
               coalesce(sum((select count(*) from league_award_win aw
                  where aw.league_id = st.league_id and aw.roster_id = st.roster_id)), 0)::int as awards,
               coalesce(jsonb_agg(distinct jsonb_build_object(
                     'icon', bg.icon, 'name', bg.bname, 'season', bg.season))
                   filter (where bg.key is not null), '[]'::jsonb) as badges
          from seats st
          left join reg r on r.league_id = st.league_id and r.roster_id = st.roster_id
          left join lateral (
            select g.key, g.season, b.icon, b.name as bname
              from league_badge_grant g
              join league_badge b on b.league_id = g.league_id and b.key = g.key
             where g.league_id = st.league_id and g.roster_id = st.roster_id) bg on true
         group by st.mgr
      ) g), '[]'::jsonb))
  into out_;
  -- THE REDACTION. A reader who is here only because the league is public
  -- gets the history without the accounts behind it. Same shape, same rows,
  -- same ordering — one key dropped and one key hashed, so a tool written
  -- against the public API and one written against the app see the same
  -- document apart from an identifier neither of them should be using.
  if not mine and out_ ? 'managers' then
    out_ := jsonb_set(out_, '{managers}', coalesce((
      select jsonb_agg((m - 'app_user_id') || jsonb_build_object(
               'manager', substr(md5(coalesce(m ->> 'manager', '')), 1, 12)))
        from jsonb_array_elements(out_ -> 'managers') m), '[]'::jsonb));
    out_ := out_ || jsonb_build_object('redacted', true);
  end if;
  return out_;
end $$;
grant execute on function league_history(uuid) to authenticated;
