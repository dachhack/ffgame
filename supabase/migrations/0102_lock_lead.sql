-- Lock lead: lineup edits stop ONE HOUR before a window's kickoff, matching the
-- client live board (Matchup.tsx LOCK_LEAD_MS) — the first live-fire (preseason
-- 2026-08-06) showed the UI promising "locks 7:00 PM ET" while the server kept
-- accepting edits until the 8:00 kickoff. Reveal is unchanged: picks stay hidden
-- until the window actually kicks off (the worker's lock sweep flips `locked` at
-- kickoff, and RLS reads ride that flag). Only the edit gate moves earlier.
--
-- The worker mirrors this lead when writing matchup.lock_at (first kickoff − 1h,
-- server/src/config.js lockLeadMs); this trigger is the DB-side authority that
-- makes the sweep's tick cadence irrelevant to integrity (same posture as 0058).

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
  if k is not null and k - interval '1 hour' <= now() then
    raise exception 'window % is locked — lineups lock 1h before its % kickoff', new.game_window, k
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
