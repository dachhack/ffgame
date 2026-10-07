-- ═══════════════════════════════════════════════════════════════════════════
-- 0447 · BULLSEYE ACROSS LEAGUES — the week's darts board for everyone who
-- played it (docs/bullseye.md §11 → shipped).
--
-- Founder: "could do head to head and weekly ranked battles". 0446 gave a
-- league its own week board. This is the cross-league one: every team in
-- every bullseye league, ranked by the week's ring total. Ring totals are
-- comparable across leagues by construction — a dart banks radius − distance
-- whatever the card said — so no shared card is needed; each league keeps
-- its own deal (and its own catalog-anchored sets, bullseye.ts).
--
-- WHAT A STRANGER SEES: a team name and a number. The league's name is said
-- only to its own members (the caller's enrolments); roster ids never leave.
-- A league whose commissioner never turned the setting on is not on it.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function bullseye_global_board(p_week int, p_season text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  return jsonb_build_object('ok', true, 'week', p_week,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
          'rank', z.rk, 'team', z.team_name, 'final', z.fin,
          'league', case when z.member then z.lname end,
          'variant', z.variant,
          'mine', z.member and z.app_user_id = uid)
        order by z.rk, z.lname, z.team_name)
      from (
        select x.fin, m.team_name, m.app_user_id, l.name as lname, l.settings_json ->> 'bullseye' as variant,
               exists (select 1 from league_membership me where me.league_id = l.id and me.app_user_id = uid and me.enrolled) as member,
               rank() over (order by x.fin desc) as rk
        from (
          select mu.league_id, mu.home_roster_id as rid, mu.home_final as fin from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.home_final is not null
          union all
          select mu.league_id, mu.away_roster_id, mu.away_final from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.away_final is not null
             and mu.away_roster_id <> mu.home_roster_id
        ) x
        join league l on l.id = x.league_id
          and coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
          and l.settings_json ->> 'bullseye' in ('slots', 'total')
          and (p_season is null or l.season = p_season)
        join league_membership m on m.league_id = l.id and m.sleeper_roster_id = x.rid
      ) z), '[]'::jsonb));
end $$;
grant execute on function bullseye_global_board(int, text) to authenticated;
