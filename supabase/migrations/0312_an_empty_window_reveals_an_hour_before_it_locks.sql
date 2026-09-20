-- 0312: AN EMPTY OPPOSING WINDOW REVEALS AN HOUR BEFORE IT LOCKS (v0.434.0).
--
-- Founder: "We should have players sub only if every opposing slot in their
-- window is unopposed. That way, an hour before when the players lock, the
-- window can reveal and players can do the substitution action."
--
-- The engine half is core's bestBallBackups: a slot is a backup only when the
-- opponent left its WHOLE window empty. This is the reveal half. The
-- opponent's picks stay sealed until kickoff (0262) — but a window they left
-- entirely empty reveals nothing about any pick, only that there are none,
-- so it can be shown early. This answers, for the caller's matchup, the
-- windows in which the opponent has NO filled pick and which are within an
-- hour of locking (lock = kickoff − 1h, 0260; so from kickoff − 2h), or
-- already locked. The board draws those windows' opposing halves as empty
-- and offers the sub while there is still time to choose it.
--
-- WHAT COUNTS AS EMPTY follows the resolver (server/src/resolve.js
-- sideLineup), because a reveal that the scorer then contradicts is worse
-- than none:
--   • a seat with sealed rows is scored FROM those rows — a window with no
--     row in it scores empty. Those windows are the answer.
--   • a seat with NO rows at all is fielded by the resolver (best lineup, or
--     the AI) unless the league's policy is 'empty'; an AI seat and an
--     unenrolled or unclaimed seat are fielded regardless. Nothing reveals
--     for those — the window will not be empty when it scores.
--   • a classic matchup has no backups: nothing reveals.
-- A window with no slate row (no kickoff) has no clock to wait for and
-- reveals at once, the same open-door answer every window gate gives.
--
-- The opponent can still fill a revealed window until it locks. Then it is
-- no longer empty, this stops listing it, the engine makes no backup of the
-- facing slots, and a sub assigned in the meantime is simply not used
-- (bestBallBackups' all-or-nothing rule). Participants only; anyone else,
-- and any error of shape, gets an empty list — never a refusal that says
-- whether the matchup exists.
create or replace function opponent_empty_windows(p_matchup_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  m matchup%rowtype; me_roster int; opp int; opp_uid uuid; opp_ctl text; opp_enrolled boolean;
  pol text; n_rows int; w record; out jsonb := '[]'::jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found or not is_matchup_participant(p_matchup_id) then return '[]'::jsonb; end if;
  if matchup_is_classic(p_matchup_id) then return '[]'::jsonb; end if;
  select lm.sleeper_roster_id into me_roster from league_membership lm
    where lm.league_id = m.league_id and lm.app_user_id = auth.uid()
      and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id) limit 1;
  opp := case when me_roster = m.home_roster_id then m.away_roster_id else m.home_roster_id end;
  select lm.app_user_id, lm.controller, lm.enrolled into opp_uid, opp_ctl, opp_enrolled
    from league_membership lm where lm.league_id = m.league_id and lm.sleeper_roster_id = opp;
  -- An unclaimed seat is fielded by the resolver; a seat agent's rows (0180)
  -- are its own and count.
  if opp_uid is null then
    select sa.agent_user_id into opp_uid from seat_agent sa where sa.league_id = m.league_id and sa.roster_id = opp;
    if opp_uid is null then return '[]'::jsonb; end if;
  elsif coalesce(opp_enrolled, false) is not true then
    return '[]'::jsonb;
  end if;
  select count(*) into n_rows from sealed_pick sp
    where sp.matchup_id = p_matchup_id and sp.app_user_id = opp_uid and sp.player_slug is not null;
  select lineup_policy into pol from league where id = m.league_id;
  if n_rows = 0 and (opp_ctl = 'ai' or coalesce(pol, 'best_lineup') <> 'empty') then return '[]'::jsonb; end if;
  for w in
    select distinct s.win from nfl_slate s
     where s.week = m.week and s.season = (select max(season) from nfl_slate where week = m.week)
     order by s.win
  loop
    if not exists (select 1 from sealed_pick sp where sp.matchup_id = p_matchup_id and sp.app_user_id = opp_uid
                     and sp.game_window = w.win and sp.player_slug is not null)
       and coalesce(now() >= window_locks_at(m.week, w.win) - interval '1 hour', true) then
      out := out || to_jsonb(w.win);
    end if;
  end loop;
  return out;
end $$;
grant execute on function opponent_empty_windows(uuid) to authenticated;
comment on function opponent_empty_windows(uuid) is
  'The windows in which the caller''s opponent has no filled pick, from an hour before the window locks (0312): the only thing about a sealed lineup that may be shown early, because it is nothing. Follows the resolver''s notion of empty. [] for non-participants and classic matchups.';
