-- 0116: drop 0111's free extra-slot grant — the extra slot costs what it costs,
-- in practice as in the season.
--
-- 0111 granted extra_slot_cap() free on a practice week because preseason boards
-- derived MORE windows than the base 8 slots could cover (week 103: 9 windows, 10
-- slots), so a manager couldn't field one player per window and handed the
-- opponent an unopposed window-win bonus. The grant papered over that.
--
-- The board's own slot rule has since changed instead: preseason windows are
-- allocated 2 slots at 3+ games and 3 at 5+ (nflSlate deriveWeek), so the loaded
-- 2026 preseason derives 10-11 slots across its weeks. There are now deliberately
-- MORE slots on the board than the 8 a manager can fill, and choosing which
-- windows to contest — and whether to spend 80 of the 120-coin practice budget
-- (0115) on a 9th slot — IS the exercise. A free grant would decide that for them,
-- and would teach a purchase that costs real coin in Week 1 as if it were free.
--
-- So enforce_slot_cap goes back to 0027's rule verbatim: base + what you bought.
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int;
begin
  if new.player_slug is null then return new; end if;
  allowed := base_slot_count() + coalesce(
    (select (payload_json->>'extra')::int from applied_state
      where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0);
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
