-- 0111: practice weeks grant the extra slots for free.
--
-- The lineup cap (0027) is a hard `base_slot_count() = 8` plus whatever extra
-- slots you bought — a number that mirrors the REGULAR season's fixed five-window
-- board (1 TNF + 3 early + 2 late + 1 SNF + 1 MNF). Preseason boards are derived
-- from the real slate instead (nflSlate deriveWeek: one window per kickoff
-- cluster, `min(3, ceil(games/3))` slots each), and they are shaped nothing like
-- that. The loaded 2026 preseason:
--
--     wk 101 —  1 game  ·  1 window  ·   1 slot
--     wk 102 — 16 games ·  6 windows ·   7 slots
--     wk 103 — 16 games ·  9 windows ·  10 slots   ← more slots than the cap
--
-- So at preseason week 3 the board renders ten slots and the trigger refuses the
-- ninth. Worse, there are NINE windows against eight base slots, so a player
-- can't even put one player in every window — and an empty window isn't neutral,
-- the opponent takes it and collects the +5 window-win bonus unopposed. The
-- extra-slot power-up stops being an upgrade and becomes mandatory just to show
-- up everywhere.
--
-- Practice weeks therefore grant `extra_slot_cap()` slots outright: the same
-- ceiling a paying team could reach in the regular season, free, with nothing to
-- buy and nothing to place. The grant is ADDITIVE to anything bought (buying is
-- already free in practice under 0110), so placing extra slots on top still
-- works and stays bounded — buy_extra_slot caps purchases at extra_slot_cap()
-- itself, making the practice ceiling base + 2 + 2.
--
-- Deliberately NOT derived from the week's real window count: SQL can't read the
-- TS window derivation (the note in 0027 says as much, and 0100 exists precisely
-- because a second, drifting copy of that derivation caused a live bug). A fixed
-- grant needs no second copy. If some future preseason week derives more than
-- base + 2 slots, the cap bites exactly as it would in the regular season.
--
-- The grant lives ONLY here, in the cap. my_extra() still reports what the team
-- actually BOUGHT: it drives the shop's owned-count and buy_extra_slot's own cap
-- check, and folding the grant into it would read as "you already own 2" and
-- block placing any.
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int;
begin
  if new.player_slug is null then return new; end if;
  allowed := base_slot_count() + coalesce(
    (select (payload_json->>'extra')::int from applied_state
      where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0)
    + case when matchup_is_practice(new.matchup_id) then extra_slot_cap() else 0 end;
  select count(*) into cnt from sealed_pick
    where matchup_id = new.matchup_id and app_user_id = new.app_user_id and player_slug is not null
      and not (game_window = new.game_window and roster_slot = new.roster_slot);
  if cnt + 1 > allowed then
    raise exception 'lineup is full — % slots max (buy an extra slot for more)', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_slot_cap on sealed_pick;
create trigger enforce_slot_cap before insert or update on sealed_pick
  for each row execute function enforce_slot_cap();
