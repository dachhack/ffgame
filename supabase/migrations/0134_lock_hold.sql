-- 0134: EMERGENCY — reopen practice week 102's picks and hold every lock off
-- until an admin releases it by hand (2026-08-13, the preseason practice slate).
--
-- Founder's call, mid-slate-evening: all week-102 picks re-open NOW and nothing
-- locks again until manually locked. Two mechanisms enforce locking and both
-- must stand down:
--
--   1. The WORKER locks matchups whose lock_at has passed (status → 'live',
--      picks sealed) and sweeps kicked-off windows on live matchups. Setting
--      week 102 back to status='scheduled' with lock_at far-future stops both:
--      lockDueMatchups selects on lock_at <= now, lockDueWindows only touches
--      live/final matchups, and backfillLockAt only fills NULLs — so the 2099
--      stamp can't be clobbered by the next tick.
--   2. The DB TRIGGER enforce_window_lock (0058/0102) refuses pick edits from
--      one hour before each window's kickoff, computed FROM THE SLATE — it
--      would re-engage on its own tonight minutes before kickoff no matter
--      what the rows say. It now honors `lock_hold`: a held week's picks stay
--      editable, kickoff or not.
--
-- The hold is a table rather than a column so the release is one visible,
-- deliberate row delete — scripts/db/relock-102.sql is the matching release
-- (delete the hold + set lock_at = now; the worker seals within a tick).
-- This migration carries DATA CHANGES (the reopen) because migrate.yml on main
-- is the only write path to production this session has, and the reopen is the
-- emergency; on a scratch DB the updates touch zero rows and are harmless.

create table if not exists lock_hold (
  week       int primary key,          -- board week (102 = practice week 2)
  note       text,
  created_at timestamptz not null default now()
);
-- RLS on with no policies: invisible and untouchable through the API. Only the
-- SECURITY DEFINER trigger below (and admin SQL) ever reads or writes it.
alter table lock_hold enable row level security;

-- 0102's body verbatim, plus the hold check once the week is known.
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
  -- An admin hold on the week suspends the kickoff gate entirely (0134): picks
  -- stay editable until the hold row is deleted, however far the slate has run.
  if exists (select 1 from lock_hold where week = wk) then return new; end if;
  k := window_kickoff(wk, new.game_window);
  if k is not null and k - interval '1 hour' <= now() then
    raise exception 'window % is locked — lineups lock 1h before its % kickoff', new.game_window, k
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── the emergency itself: hold week 102 and reopen it ────────────────────────
insert into lock_hold (week, note)
  values (102, 'EMERGENCY 2026-08-13: practice slate reopened; admin locks manually (relock-102.sql)')
  on conflict (week) do nothing;

do $$
declare n_m int; n_p int;
begin
  -- 'final' deliberately excluded: a matchup that already finished scoring is
  -- history, not something to silently reanimate mid-evening.
  update matchup set status = 'scheduled', lock_at = '2099-01-01T00:00:00Z'
    where week = 102 and status in ('scheduled', 'live');
  get diagnostics n_m = row_count;
  update sealed_pick set locked = false, revealed_at = null
    where locked and matchup_id in (select id from matchup where week = 102);
  get diagnostics n_p = row_count;
  raise notice 'lock_hold 102: % matchups reopened, % picks unsealed', n_m, n_p;
end $$;
