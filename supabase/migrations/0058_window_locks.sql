-- 0058: per-window pick locking ("late swap"). The rulebook has always promised
-- picks are sealed "until the window locks at kickoff", but the implementation
-- sealed the WHOLE week at the first kickoff (matchup.lock_at): a MNF pick was
-- final from Thursday night. Now each window's picks stay editable until that
-- window's own first kickoff:
--   • the worker sweep (lock.js lockDueWindows) flips `locked` per window as
--     each window's first kickoff passes — reveal keeps riding the same flag
--     (sealed_select RLS unchanged), so the opponent reads a window's picks
--     exactly when it kicks off;
--   • this trigger closes the client-side hole the sweep alone leaves open:
--     RLS only checks the row's `locked` flag, so between a kickoff and the
--     next worker tick a client could still write a pick for a window already
--     underway (kickoff sniping). The DB is the authority, not the sweep.

-- First kickoff of a week's window, from the live slate (worker-written). Scoped
-- to the newest season carrying that week — nfl_slate can hold multiple seasons
-- at the same week number and a stale prior season's (past) kickoffs must never
-- lock a current week. NULL when the slate isn't loaded (trigger then allows —
-- the pre-slate state is "nothing has kicked off yet").
create or replace function window_kickoff(p_week int, p_win text) returns timestamptz
  language sql stable as $$
  select min(kickoff) from nfl_slate
  where week = p_week and win = p_win
    and season = (select max(season) from nfl_slate where week = p_week);
$$;

-- Reject a client's insert/update of a pick whose window has already kicked
-- off. Service-role writes (the worker's lock sweep, auto-lineup materialize,
-- the sim harness) carry no auth uid and pass through untouched, as do updates
-- that don't change the pick's content (the sweep's own locked=true flip).
create or replace function enforce_window_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare k timestamptz; wk int;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.player_slug  is not distinct from old.player_slug
     and new.metric_id    is not distinct from old.metric_id
     and new.game_window  is not distinct from old.game_window
     and new.roster_slot  is not distinct from old.roster_slot then
    return new;
  end if;
  select week into wk from matchup where id = new.matchup_id;
  k := window_kickoff(wk, new.game_window);
  if k is not null and k <= now() then
    raise exception 'window % is locked — it kicked off at %', new.game_window, k
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_window_lock on sealed_pick;
create trigger enforce_window_lock before insert or update on sealed_pick
  for each row execute function enforce_window_lock();
