-- 0136: the emergency grows up — a per-league, per-week admin lock switch.
--
-- 0134 was built mid-fire and scoped by WEEK GLOBALLY: holding practice week
-- 102 held it for every league at once, and the reopen itself was SQL in a
-- migration. The founder wants the real control: a super-admin UNLOCK / LOCK
-- per league that the boards follow. Same two levers as 0134, now behind an
-- RPC and scoped to (league, week):
--
--   UNLOCK (p_locked=false): record the hold, put the week's matchups back to
--   'scheduled' with lock_at far-future (the worker's lock sweeps select on
--   lock_at and only touch live/final, so they stand down), and unseal the
--   week's picks. 'final' matchups are never reanimated.
--
--   LOCK (p_locked=true): delete the hold and set lock_at = NULL on the week's
--   scheduled matchups. That is deliberately not "lock now": backfillLockAt
--   fills a NULL with the week's natural lock time (first kickoff − 1h) on the
--   next tick, so a week relocked BEFORE its natural time locks at the natural
--   time, and a week relocked mid-slate locks immediately because the natural
--   time has passed. Manual lock restores nature; it doesn't invent a new rule.
--
-- The active 102 hold from tonight is converted, not dropped: every league
-- whose week-102 matchups carry the 0134 far-future stamp gets its own
-- (league, 102) hold, so nothing visibly changes for the leagues mid-hold.

create table if not exists week_lock_hold (
  league_id  uuid not null references league(id) on delete cascade,
  week       int  not null,
  note       text,
  created_at timestamptz not null default now(),
  primary key (league_id, week)
);
alter table week_lock_hold enable row level security; -- dark; peephole below

-- Convert the 0134 global hold, then retire it (table + its insert are 0134's).
insert into week_lock_hold (league_id, week, note)
  select distinct m.league_id, h.week, coalesce(h.note, '0134 converted')
  from lock_hold h join matchup m on m.week = h.week
  where m.lock_at >= '2098-01-01'
  on conflict do nothing;
drop table if exists lock_hold;

-- Trigger: the hold check becomes league-scoped. Otherwise 0102's body.
create or replace function enforce_window_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare k timestamptz; wk int; lg uuid;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.player_slug  is not distinct from old.player_slug
     and new.metric_id    is not distinct from old.metric_id
     and new.game_window  is not distinct from old.game_window
     and new.roster_slot  is not distinct from old.roster_slot then
    return new;
  end if;
  select week, league_id into wk, lg from matchup where id = new.matchup_id;
  if exists (select 1 from week_lock_hold where league_id = lg and week = wk) then return new; end if;
  k := window_kickoff(wk, new.game_window);
  if k is not null and k - interval '1 hour' <= now() then
    raise exception 'window % is locked — lineups lock 1h before its % kickoff', new.game_window, k
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Peephole, reshaped: the held (league, week) pairs. Ids are opaque; a member
-- of a held league needs this to render the open board, and it leaks nothing
-- an enrolled member doesn't already know.
drop function if exists lock_holds();
create or replace function lock_holds() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('league_id', league_id, 'week', week)), '[]'::jsonb)
  from week_lock_hold;
$$;
grant execute on function lock_holds() to authenticated;

-- The button. Super-admin only — this overrides competitive integrity for a
-- week, which is a founder call, not a commissioner one.
create or replace function admin_set_week_lock(p_league_id uuid, p_week int, p_locked boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n_m int := 0; n_p int := 0;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from league where id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'no such league');
  end if;
  if p_locked then
    delete from week_lock_hold where league_id = p_league_id and week = p_week;
    update matchup set lock_at = null
      where league_id = p_league_id and week = p_week and status = 'scheduled';
    get diagnostics n_m = row_count;
    return jsonb_build_object('ok', true, 'locked', true, 'matchups', n_m);
  end if;
  insert into week_lock_hold (league_id, week, note)
    values (p_league_id, p_week, 'admin unlock ' || now()::date)
    on conflict (league_id, week) do nothing;
  update matchup set status = 'scheduled', lock_at = '2099-01-01T00:00:00Z'
    where league_id = p_league_id and week = p_week and status in ('scheduled', 'live');
  get diagnostics n_m = row_count;
  update sealed_pick set locked = false, revealed_at = null
    where locked and matchup_id in
      (select id from matchup where league_id = p_league_id and week = p_week and status = 'scheduled');
  get diagnostics n_p = row_count;
  return jsonb_build_object('ok', true, 'locked', false, 'matchups', n_m, 'picks', n_p);
end $$;
grant execute on function admin_set_week_lock(uuid, int, boolean) to authenticated;
