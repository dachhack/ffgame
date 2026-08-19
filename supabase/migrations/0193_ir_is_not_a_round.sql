-- 0193: IR SPOTS ARE NOT DRAFT ROUNDS.
--
-- Founder: "IR spots shouldn't add rounds to your draft."
--
-- Right, and the fix is a distinction the schema already knows how to make.
-- 0182 drew it for KEEPERS: `draft.rounds` is the ROSTER — how many players a
-- team may hold — and `keeper_slots` is how many of those spots arrive already
-- filled, so the draft runs (rounds − keeper_slots) picks per team. An IR spot
-- is the same shape of thing from the other end: a spot the roster HAS and the
-- draft must not fill, because you do not draft an injured-reserve player, you
-- stash one there in November.
--
-- So `stash_slots` joins `keeper_slots`, and every place that asks "how long is
-- this draft" subtracts both. What deliberately does NOT change is capacity:
-- `roster_cap` is still `draft.rounds`, the active seats are still starters +
-- bench, and the taxi and IR caps are still their own. A team holds exactly
-- what it held yesterday; it just stops drafting into the IR spots.
--
-- THE AUCTION comes along for free, and gets a pre-existing wrinkle straightened
-- while we are here. Every auction call site passes `d.rounds` into
-- `auction_spots_left`, so the number of spots to fill was the CALLER's opinion.
-- It now derives from the draft row itself — rounds − stash_slots — which fixes
-- all seven call sites at once and cannot drift again. Keepers are NOT
-- subtracted there, and that is not an oversight: a keeper already occupies a
-- native_roster row, so the count below has him; subtracting keeper_slots too
-- would charge the seat for him twice.
--
-- PENDING drafts are backfilled from their league's shape. Live and complete
-- ones are left exactly as they are — their picks already happened, and a draft
-- whose length changed underneath it is a worse bug than the one being fixed.

alter table draft add column if not exists stash_slots int not null default 0;
alter table draft drop constraint if exists draft_stash_slots_check;
alter table draft add constraint draft_stash_slots_check check (stash_slots >= 0);


-- ─────────────────────────────────────────────────────────────────────────────
-- _sync_classic_rounds v2 — the shape now sets both numbers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _sync_classic_rounds(p_league_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare sh jsonb; r int;
begin
  sh := _roster_shape(p_league_id);
  if sh = '{}'::jsonb then return; end if; -- shape never set: creation-time rounds stand
  r := _classic_starters(p_league_id)
     + coalesce((sh ->> 'bench')::int, 0)
     + coalesce((sh ->> 'taxi')::int, 0)
     + coalesce((sh ->> 'ir')::int, 0);
  -- `rounds` is the ROSTER SIZE and still counts IR: those are spots a team may
  -- hold. `stash_slots` is how many of them the DRAFT does not fill (0193).
  update draft set rounds = r, stash_slots = coalesce((sh ->> 'ir')::int, 0)
    where league_id = p_league_id and status = 'pending';
end $$;

-- Pending classic drafts learn their IR count from the shape they already have.
update draft d set stash_slots = coalesce((
    select (l.settings_json -> 'roster_shape' ->> 'ir')::int
      from league l where l.id = d.league_id), 0)
  where d.status = 'pending'
    and coalesce((select (l.settings_json -> 'roster_shape' ->> 'ir')::int
                    from league l where l.id = d.league_id), 0) > 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- auction_spots_left v2 — the target comes from the draft, not the caller
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function auction_spots_left(p_league_id uuid, p_roster_id int, p_rounds int)
  returns int language sql stable security definer set search_path = public as $$
  -- p_rounds IS IGNORED (0193) and kept only so every caller's signature still
  -- resolves: an auction fills the roster MINUS the spots the draft doesn't
  -- fill, and the seat itself is the only place that knows how many that is.
  -- Keepers are NOT subtracted here — they already sit on native_roster and so
  -- are counted below; subtracting them too would charge for them twice.
  select coalesce((select d.rounds - d.stash_slots from draft d
                    where d.league_id = p_league_id), p_rounds)
         - (select count(*)::int from native_roster
            where league_id = p_league_id and roster_id = p_roster_id);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- native_exec_pick v6 — 0183's body, one term added
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text; total int;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;
  total := case when d.pick_owners is not null then jsonb_array_length(d.pick_owners)
                else (d.rounds - d.keeper_slots - d.stash_slots) * n end;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not p_auto then
    err := pos_cap_error(p_league_id, oc, p_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= total then
    update draft set status = 'complete', completed_at = now(), deadline_at = null,
      current_overall = d.current_overall + 1
      where league_id = p_league_id;
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc,
      'slug', p_slug, 'complete', true);
  end if;

  update draft set current_overall = d.current_overall + 1,
    deadline_at = draft_deadline(d, d.pick_seconds)
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc, 'slug', p_slug);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_state v-next — 0183's body: reports the drafted rounds, and the stash
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int; eff_rounds int;
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
  eff_rounds := case
    when d.pick_owners is not null and jsonb_array_length(coalesce(d.draft_order, '[]'::jsonb)) > 0
      then (jsonb_array_length(d.pick_owners) + jsonb_array_length(d.draft_order) - 1)
           / jsonb_array_length(d.draft_order)
    -- pending on a rolled dynasty league: preview the asset-derived rounds
    -- the start will build, not rounds − keepers
    when d.status = 'pending' and d.mode = 'snake' then coalesce(
      (select max(pa.round) from pick_asset pa join league l on l.id = p_league_id
        where pa.league_id = p_league_id and pa.season = l.season),
      d.rounds - d.keeper_slots - d.stash_slots)
    else d.rounds - d.keeper_slots - d.stash_slots end;
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
    'status', d.status, 'mode', d.mode, 'rounds', eff_rounds,
    'keeper_slots', d.keeper_slots, 'roster_size', d.rounds, 'stash_slots', d.stash_slots,
    'pick_owners', d.pick_owners,
    'pick_seconds', d.pick_seconds,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- _start_draft_now v6 — 0192's body, three terms added
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots - d.stash_slots < 1 then
    return jsonb_build_object('ok', false, 'error',
      'no rounds left to draft — keepers and IR spots fill the whole roster');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

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

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots - d.stash_slots) * n;
  end if;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  select count(*) into pool_n from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr
                      where nr.league_id = lp.league_id and nr.slug = lp.slug);
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, d.rounds - d.keeper_slots - d.stash_slots, n, pool_n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
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

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- _provision_startup_picks v3 — startup slots stop at the drafted rounds
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _provision_startup_picks(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare seas text; rds int; n int;
begin
  select season into seas from league where id = p_league_id;
  select greatest(1, least(99, rounds - coalesce(keeper_slots, 0) - coalesce(stash_slots, 0))) into rds
    from draft where league_id = p_league_id;
  if rds is null then return 0; end if;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster, kind)
  select p_league_id, seas, r, m.sleeper_roster_id, m.sleeper_roster_id, 'startup'
    from generate_series(1, rds) r
    cross join league_membership m
   where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_league_roster_shape — says both numbers, and keeps a draft to run
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; b int; tx int; ir int; r int; sh jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape locks once the draft starts');
  end if;
  -- Per-field ceilings were 20 / 8 / 8; the TOTAL is the only real rule, so
  -- each field is now bounded only by it (0192).
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  ir := least(99, greatest(0, coalesce(p_ir, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir;
  -- IR spots are not drafted (0193), so a shape that is ALL stash leaves the
  -- draft with nothing to do.
  if r - ir < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  -- Two numbers, because they stopped being one in 0193: `rounds` is the
  -- roster (what a team may hold) and `draft_rounds` is what gets drafted.
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir);
end $$;

grant execute on function set_league_roster_shape(uuid, int, int, int) to authenticated;
