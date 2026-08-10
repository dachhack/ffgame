-- 0118: a practice week's cap covers the slots its own board renders.
--
-- Reported from the real board: "the second preseason week only keeps 8 of the
-- picks I made." Exactly what the code did, and the fault is a bad call in 0116.
--
-- The preseason slot rule (2 slots at 3+ games, 3 at 5+) puts 10-11 slots on a
-- practice board — PRE 2: 10, PRE 3: 11, PRE 4: 11 — while enforce_slot_cap kept
-- the regular season's base 8. I shipped that mismatch deliberately, reasoning
-- that choosing which windows to contest WAS the practice exercise. It isn't: the
-- board renders every slot as fillable, the autosave sends the whole lineup as one
-- upsert, and the trigger rejects the entire batch. So a manager builds an 11-slot
-- lineup, sees it on screen, and silently keeps whatever the last 8-pick save
-- held. That's not a design tension, it's losing someone's work.
--
-- If the board offers a slot, the server must accept it. Practice weeks therefore
-- cap at practice_slot_cap() = 12: above the 11 the current preseason derives,
-- with headroom for a busier future slate. Deliberately a FIXED number rather than
-- derived — SQL can't read the TS window derivation (nflSlate deriveWeek), and
-- migration 0100 exists precisely because a second, drifting copy of that
-- derivation caused a live bug. Better a generous constant than a lie in two
-- dialects.
--
-- The REGULAR season is untouched: base_slot_count() + what you bought, extra
-- slots at full price, exactly as 0116 restored it. This only ever widens weeks
-- above PRESEASON_BASE, which move no real coin and keep no record.
create or replace function practice_slot_cap() returns int language sql immutable as $$ select 12 $$;
grant execute on function practice_slot_cap() to authenticated;

create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int;
begin
  if new.player_slug is null then return new; end if;
  if matchup_is_practice(new.matchup_id) then
    allowed := practice_slot_cap();
  else
    allowed := base_slot_count() + coalesce(
      (select (payload_json->>'extra')::int from applied_state
        where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0);
  end if;
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
