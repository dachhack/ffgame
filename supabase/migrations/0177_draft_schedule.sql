-- 0177: SCHEDULED DRAFT START — set a time, the draft opens itself.
--
-- 0176 gave the commissioner every pre-draft setting except the one everybody
-- actually coordinates around: WHEN. Starting a draft has been a button
-- somebody has to be awake to press, so a league that agrees on "Sunday 8pm"
-- still waits on one person's phone.
--
-- THE SHAPE, and why it isn't the obvious one: the natural instinct is to let
-- a client start the draft when its poll notices the time has passed. That
-- fails exactly when it matters — nobody has the app open at 8pm sharp, so the
-- draft starts whenever the first person happens to look, which is worse than
-- no schedule because everyone was told 8. The worker's native sweep already
-- exists as the "keep leagues moving when nobody's watching" path (draft_tick,
-- process_waivers, auto_weekly_budget all live there), so the auto-start joins
-- it: one sweep RPC, one statement, service_role only.
--
-- That forces a refactor worth naming. start_draft's body does the ordering,
-- the deadline, the auction budgets and the waiver priorities — and the sweep
-- can't call it, because start_draft checks is_league_commish() and the worker
-- is nobody's commissioner. Copying the body into the sweep would leave two
-- copies of the rules that must never disagree. So the body moves once into
-- _start_draft_now(), and start_draft becomes the AUTHENTICATED door onto it.

alter table draft add column if not exists start_at timestamptz;

-- ── The start itself, with no opinion about who asked ───────────────────────
-- Not granted to anyone: reachable only through start_draft (which checks the
-- caller) or draft_autostart_sweep (service_role). Every precondition that was
-- in start_draft stays here, because the sweep needs them just as much — a
-- scheduled start into an unseeded pool must refuse, not half-start.
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if (select count(*) from league_pool where league_id = p_league_id) < d.rounds * n then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v
           where v.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  update draft set status = 'live', draft_order = ord, current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership set draft_budget = d.budget where league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset);
end $$;

-- ── The authenticated door (same signature and behaviour as 0176) ───────────
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return _start_draft_now(p_league_id, p_order);
end $$;

-- ── Arm / disarm the schedule ──────────────────────────────────────────────
create or replace function set_draft_start(p_league_id uuid, p_at timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the draft has already started');
  end if;

  if p_at is null then
    update draft set start_at = null where league_id = p_league_id;
    return jsonb_build_object('ok', true, 'start_at', null);
  end if;
  -- A time in the PAST is refused rather than fired immediately. A schedule is
  -- a promise to the league about when to show up; a mistyped year that
  -- launches the draft the moment it's saved breaks that promise in the one
  -- direction nobody can undo.
  if p_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'pick a time in the future');
  end if;
  if p_at > now() + interval '1 year' then
    return jsonb_build_object('ok', false, 'error', 'that is more than a year out');
  end if;

  update draft set start_at = p_at where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'start_at', p_at);
end $$;

-- ── The sweep: every armed draft whose time has come ────────────────────────
-- Worker-only. start_at is NOT cleared on success — status='live' already
-- takes the row out of scope, and keeping it means the league can still see
-- when the draft was scheduled for.
--
-- Failures RETRY on the next sweep on purpose (seed the pool five minutes late
-- and the draft still starts), but only within a 2-day window. The window is
-- the interesting part: without it, a league that scheduled a draft, failed on
-- an unseeded pool, and moved on would have the draft detonate weeks later the
-- instant somebody seeded a pool for an unrelated reason — with nobody in the
-- room. Past that window the schedule is stale and the commissioner presses
-- the button like before.
create or replace function draft_autostart_sweep()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; res jsonb; started int := 0; failed int := 0; errs jsonb := '[]'::jsonb;
begin
  for r in
    select league_id, start_at from draft
     where status = 'pending' and start_at is not null
       and start_at <= now() and start_at > now() - interval '2 days'
     order by start_at
  loop
    res := _start_draft_now(r.league_id, null);
    if coalesce((res ->> 'ok')::boolean, false) then
      started := started + 1;
    else
      failed := failed + 1;
      errs := errs || jsonb_build_object('league_id', r.league_id, 'error', res ->> 'error');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'started', started, 'failed', failed, 'errors', errs);
end $$;

-- ── draft_state v-next: 0071's body plus start_at ──────────────────────────
-- The scheduled time rides the poll every member already makes, so the
-- countdown is the same read as everything else on the screen.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select count(*)::int into open_lots from auction_lot where league_id = p_league_id;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction'
      then (case when open_lots < d.max_lots then auction_nominator(d) end)
      else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'slug', al.slug, 'bid', al.bid, 'roster_id', al.roster_id,
      'deadline_at', al.deadline,
      'my_proxy', case when my_r is not null then
        (select px.max_amount from lot_proxy px where px.lot_id = al.id and px.roster_id = my_r) end,
      'my_max', case when my_r is not null then auction_lot_max(p_league_id, my_r, d.rounds, al.id) end
    ) order by al.created_at), '[]'::jsonb)
    into lots from auction_lot al where al.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'pos_caps', league_pos_caps(p_league_id),
    'start_at', d.start_at,
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lots', lots,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'committed', auction_committed(p_league_id, m.sleeper_roster_id),
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, null))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

grant execute on function set_draft_start(uuid, timestamptz) to authenticated;
grant execute on function draft_autostart_sweep() to service_role;
