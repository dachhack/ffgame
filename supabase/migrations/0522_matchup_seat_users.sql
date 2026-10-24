-- ═══════════════════════════════════════════════════════════════════════════
-- 0522 · WHO SPEAKS FOR EACH SEAT OF A MATCHUP (v0.732.9)
--
-- Devy Test 1, college week of 10/19 (founder: "CPU managers playing out
-- players?"): Team 4 showed B. Brown, J. Buckley and A. Dabbs, Team 6's
-- starters, as OFF ROSTER in its own lineup. Team 4 never picked them. Both
-- seats are seat agents (0180): their sealed_pick rows are written under the
-- agent's uid, and league_membership.app_user_id is NULL for both. The boards
-- split a matchup's rows by membership uid (getRevealedPicks), found neither,
-- and returned every row unsplit; the board then read all of them as the
-- opponent's, last row per spot winning, so Team 6's locked spots landed on
-- Team 4's side. seat_agent is server-only (RLS, no policies), so the client
-- had no way to know. The worker's resolver already does (resolve.js).
--
-- matchup_seat_users: each seat's speaking uid, membership first, else its
-- agent, for any member of the matchup's league (the same gate as the open
-- classic lineups, 0178). An agent uid is plumbing, not a person.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function matchup_seat_users(p_matchup uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when not (is_league_member_of_matchup(p_matchup) or is_admin()) then null else (
    select jsonb_build_object(
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home_user', coalesce(
        (select lm.app_user_id from league_membership lm where lm.league_id = m.league_id and lm.sleeper_roster_id = m.home_roster_id),
        (select sa.agent_user_id from seat_agent sa where sa.league_id = m.league_id and sa.roster_id = m.home_roster_id)),
      'away_user', coalesce(
        (select lm.app_user_id from league_membership lm where lm.league_id = m.league_id and lm.sleeper_roster_id = m.away_roster_id),
        (select sa.agent_user_id from seat_agent sa where sa.league_id = m.league_id and sa.roster_id = m.away_roster_id)))
      from matchup m where m.id = p_matchup)
  end;
$$;
revoke all on function matchup_seat_users(uuid) from public;
grant execute on function matchup_seat_users(uuid) to authenticated;
