-- 0119: a REGULAR week's cap covers the slots its own board renders.
--
-- Reported from the real board: "looks like issues saving my lineup", with
-- every autosave failing on 2026 Week 1.
--
-- 0118 fixed exactly this shape for practice weeks and said the rule out loud:
-- "If the board offers a slot, the server must accept it." It only ever widened
-- weeks above PRESEASON_BASE, so the regular season kept `base_slot_count() = 8`
-- — a number that mirrors TOTAL_SLOTS, the sum of the STATIC five windows
-- (TNF / SUN 1PM ×3 / SUN 4PM ×2 / SNF / MNF).
--
-- But a week's windows are DERIVED from its real kickoffs, not taken from that
-- static list. 2026 Week 1 opens on a WEDNESDAY, which clusters into its own
-- window and takes the board to NINE slots:
--
--   wed 1 · tnf 1 · early 3 · late 2 · snf 1 · mnf 1  = 9
--
-- So the board renders 9, the autosave upserts 9 rows as one batch, the trigger
-- rejects at 9 > 8, and — because enforce_slot_cap fires per row inside a single
-- statement — the WHOLE lineup fails to save. Not the ninth pick: all nine.
-- Which is why it presented as "I can't save at all" rather than "one pick
-- didn't take".
--
-- THE CAP IS NOW DERIVED PER WEEK, from nfl_slate, and equals what the board
-- renders. Extra slots still add on top at full price, so this fixes the bug
-- WITHOUT quietly handing every manager free slots — which is what a generous
-- constant (0118's choice for practice) would have done in a week that moves
-- real coin.
--
-- The clustering is NOT re-derived here: nfl_slate.win already holds the derived
-- window id (migration 0100 exists to make that true, and the worker writes the
-- same ids live). Only the slots-per-window rule is expressed in SQL:
--
--   regular season:  slots = least(3, ceil(games / 3.0))
--
-- which is nflSlate.ts's own rule for a non-preseason week. That IS a second
-- copy and it is the thing 0118 warned about, so: THESE TWO MUST BE CHANGED
-- TOGETHER, the same convention base_slot_count() already has with TOTAL_SLOTS.
-- Verified against the real 2026 Week 1 slate — this expression returns 9, the
-- same number windowsForWeek(1) puts on the board.
--
-- DEPENDS ON nfl_slate.win HOLDING DERIVED IDS. The preloaded 2026 rows (0051)
-- were written with the old fixed-five bucketing — both Week 1 openers as 'tnf'
-- — and grouped that way this returns 8, not 9, and the bug survives. The weekly
-- sync rewrites them: syncWeek → buildSlate → slateFromGames → the shared
-- windowIdsFromKickoffs, the same function the client derives with. So a week
-- must have been sync'd at least once for its cap to be right. That is the same
-- precondition 0100 existed to satisfy for preseason, and it is checkable:
--
--   select win, count(*) from nfl_slate where season='2026' and week=1 group by win;
--
-- 'wed' present → derived, cap is 9. Only 'tnf' → stale, re-run the sync.
--
-- Falls back to base_slot_count() when a week has no slate rows loaded, so a
-- league whose slate hasn't synced behaves exactly as it did before.
create or replace function week_slot_count(p_season text, p_week int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sum(least(3, ceil(count(*)::numeric / 3)))::int
       from nfl_slate where season = p_season and week = p_week
      group by win),
    base_slot_count())
$$;
grant execute on function week_slot_count(text, int) to authenticated;

create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int; wk int; sea text;
begin
  if new.player_slug is null then return new; end if;
  if matchup_is_practice(new.matchup_id) then
    allowed := practice_slot_cap();
  else
    select m.week, l.season into wk, sea
      from matchup m join league l on l.id = m.league_id
     where m.id = new.matchup_id;
    -- The board's own slot count for this week, never fewer than the historic
    -- base — a week whose slate is thin must not shrink a lineup someone has
    -- already filled.
    allowed := greatest(base_slot_count(), week_slot_count(sea, wk)) + coalesce(
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
