-- ═══════════════════════════════════════════════════════════════════════════
-- 0532 · LEAGUE-MATES CAN WATCH A MATCHUP (v0.739.0)
--
-- Founder, on the Drip board: "I think we need a way for players to browse to
-- other matchups happening in the league this week." Asked how much a member
-- should see of a matchup he is not in: "Full board after kickoff."
--
-- The classic board has walked the week's pairs since v0.424.0 (its lineups
-- are open to the league, 0178). A drip league could not: matchup_state — the
-- worker's published window rows, the score and who scored it — was readable
-- by the matchup's two seats (and an admin) only, so a third member got the
-- league page's totals (0341) and nothing else.
--
-- This opens matchup_state to every member of the matchup's league. It is the
-- only widening, and it shows nothing that is still sealed: the worker
-- publishes a window's rows only once that window has KICKED OFF (resolve.js
-- `started(win)`; an un-kicked window publishes neither slot rows nor a
-- total, v0.388.8), which is the moment the opponent reads them too (0262).
-- sealed_pick and applied_state are untouched — a pick before its kickoff,
-- and a power-up nobody has played, stay with their owner.
--
-- NOT a sealed league (0462, dfs_bullseye): its squads are secret from the
-- league itself, and its 'wk' row would hand them over. Those stay as they
-- were.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function matchup_state_open_to_league(p_matchup uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matchup m
     where m.id = p_matchup
       and is_league_member(m.league_id)
       and not _league_sealed(m.league_id)
  );
$$;
grant execute on function matchup_state_open_to_league(uuid) to authenticated;

drop policy if exists matchup_state_read on matchup_state;
create policy matchup_state_read on matchup_state
  for select using (
    is_matchup_participant(matchup_id)
    or is_admin()
    or matchup_state_open_to_league(matchup_id)
  );
