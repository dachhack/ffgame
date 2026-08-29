-- 0262: the opponent's pick reveals at KICKOFF, not at lock (founder: "The
-- app just revealed the opposing pick, but that shouldn't happen until kick
-- off").
--
-- Since 0260 every window's pick clock LOCKS at kickoff − 1h, and the
-- worker's seal sweep flips sealed_pick.locked on that same clock — but
-- `locked` was ALSO the reveal flag in the sealed_select policy. v0.341.1
-- coupled them deliberately: back then the seal ran at kickoff while edits
-- froze at lock, and the hour-long vacuum rendered a fully set opponent as
-- "NOT MATCHED UP". Under 0260 the same coupling flips the failure around:
-- the seal (and so the reveal) now runs an hour BEFORE kickoff, handing each
-- side the other's lineup with a whole hour still on the clock.
--
-- Split the clocks. `locked` stays the edit seal (kickoff − 1h, one clock
-- with enforce_window_lock and the card gates); the opponent's read waits
-- for the window's real kickoff. No blind hour comes back: both boards
-- already render a locked-but-unrevealed window as SEALED card backs (the
-- app's Duel deals `sealedBacks`; the web board treats an un-kicked window's
-- opponent as invisible by design and gates its unopposed logic on the
-- window being live).
--
-- A NULL kickoff (no slate row: a synthetic sim/probe window, an unsynced
-- week) falls back to reveal-at-lock — exactly the pre-0262 behavior, and
-- the same "no slate = open door" answer every other window gate gives.

create or replace function window_revealed(p_matchup uuid, p_win text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(now() >= window_kickoff(m.week, p_win), true)
    from matchup m where m.id = p_matchup;
$$;
comment on function window_revealed(uuid, text) is
  'True once the window''s first kickoff has passed — the moment a locked sealed_pick opens to the opponent (0262). NULL kickoff (no slate) = true: reveal at lock, the pre-0262 rule.';

drop policy if exists sealed_select on sealed_pick;
create policy sealed_select on sealed_pick
  for select using (
    app_user_id = auth.uid()
    -- locked = edits sealed (kickoff − 1h, 0260). The opponent reads the row
    -- only from the window's KICKOFF (0262) — locked alone is not revealed.
    or (locked and is_matchup_participant(matchup_id)
        and coalesce(window_revealed(matchup_id, game_window), false))
    -- 0178: a classic league's lineups are public to its own members, sealed
    -- or not. Still LEAGUE-scoped — this is "normal fantasy", not "the world".
    or (matchup_is_classic(matchup_id) and is_league_member_of_matchup(matchup_id))
  );
