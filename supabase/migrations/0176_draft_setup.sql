-- 0176: DRAFT SETUP AFTER CREATION — change the draft before it starts, and
-- set the order in advance.
--
-- v0.221.0 trimmed the create screen on the rule "anything with a setter after
-- creation doesn't need to be asked up front". That rule left four controls on
-- the create screen for one reason only: they had NO setter. This migration
-- gives them one, which is the founder's follow-up — "let's figure out how to
-- do the draft setup and changes after the creation".
--
-- Everything here is PENDING-ONLY. That isn't a limitation, it's the whole
-- safety model the rest of the league already uses: the game mode, the lineup
-- spec and the roster rules all freeze the moment the draft leaves 'pending',
-- because changing them mid-draft would silently invalidate picks already
-- made. Draft settings are the same — flip snake to auction at pick 40 and
-- there is no coherent answer for what the first 39 picks cost.
--
-- ALSO FIXED HERE: a real bug, reachable from the create screen today. The
-- create RPC validates pick_seconds up to 172800 (48h) and the UI's SLOW pace
-- offers a pick clock up to 48 hours — but draft.pick_seconds carries a CHECK
-- of 15..86400 from 0064, which predates slow drafts (0068). Choosing any pick
-- clock over 24h therefore fails at INSERT with a raw check-constraint error
-- instead of creating the league. Reproduced on a scratch database before
-- writing this. The column is widened to match the promise the RPC and the UI
-- have both been making; widening a CHECK can't invalidate an existing row.

alter table draft drop constraint if exists draft_pick_seconds_check;
alter table draft add constraint draft_pick_seconds_check
  check (pick_seconds between 15 and 172800);

-- ── Change the draft's shape while it's still pending ───────────────────────
-- NULL means "leave this alone", the same convention set_transaction_rules and
-- set_roster_rules use, so a client can send one field without restating the
-- rest. Validation deliberately MIRRORS create_native_league rather than being
-- looser: a draft you can't create shouldn't be reachable by editing either.
create or replace function set_draft_setup(
  p_league_id uuid,
  p_pick_seconds int default null,
  p_mode text default null,
  p_budget int default null,
  p_lot_seconds int default null,
  p_max_lots int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; m text; b int; ls int; ml int; ps int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'draft setup locks once the draft starts');
  end if;

  -- Resolve the target state first, THEN validate it as a whole. Validating
  -- each field against the stored row instead would let a single call land a
  -- combination neither value is wrong in isolation — e.g. switching to
  -- auction while the stored budget is smaller than the roster.
  ps := coalesce(p_pick_seconds, d.pick_seconds);
  m  := lower(btrim(coalesce(p_mode, d.mode)));
  b  := coalesce(p_budget, d.budget);
  ls := coalesce(p_lot_seconds, d.lot_seconds);
  ml := coalesce(p_max_lots, d.max_lots);

  if ps < 15 or ps > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if m not in ('snake', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake or auction');
  end if;
  if m = 'auction' then
    if b is null or b < d.rounds or b > 100000 then
      return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
    end if;
    if ls is null or ls < 10 or ls > 172800 then
      return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
    end if;
    if ml is null or ml < 1 or ml > 4 then
      return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
    end if;
  end if;

  update draft set pick_seconds = ps, mode = m, budget = b, lot_seconds = ls, max_lots = ml
    where league_id = p_league_id;

  -- settings_json.mode is what the league LISTING and preview read; leaving it
  -- behind would show joiners a snake draft that is really an auction.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('mode', m)
    where id = p_league_id;

  return jsonb_build_object('ok', true, 'pick_seconds', ps, 'mode', m,
    'budget', b, 'lot_seconds', ls, 'max_lots', ml);
end $$;

-- ── The draft order, settable (and visible) BEFORE the draft starts ─────────
-- Until now the order existed only from the instant the draft went live:
-- start_draft randomised it, or took one passed in the same call. So a
-- commissioner could not run an order reveal, honour last season's standings,
-- or let anyone see their slot before the room opened.
--
-- NULL p_order = randomise now. That's the same shuffle start_draft would have
-- done, just done EARLY and visibly, which is the point — a random order
-- nobody watched being drawn is indistinguishable from a rigged one.
create or replace function set_draft_order(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the order locks once the draft starts');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is null then
    select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
  else
    -- Same completeness check start_draft applies. "Every roster exactly once"
    -- is the only shape a snake order can have; a partial list would silently
    -- drop a team from the draft.
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  end if;

  update draft set draft_order = ord where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'order', ord);
end $$;

-- ── start_draft v-next: honour an order that was set in advance ─────────────
-- 0069's body with ONE behavioural change — the fallback when no order is
-- passed to this call. It used to always randomise, which would have thrown
-- away a set_draft_order result the moment the draft started (and told the
-- league a different order than the one they'd been shown). Now: an explicit
-- p_order still wins, a pre-set order is used when it's still valid for the
-- current seats, and randomising is the last resort. VALIDITY IS RECHECKED,
-- not assumed: teams can be added between setting the order and starting, and
-- a stale order missing a seat would drop that team from the draft entirely.
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
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
    -- a pre-set order, but only if it still covers exactly these seats
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

grant execute on function set_draft_setup(uuid, int, text, int, int, int) to authenticated;
grant execute on function set_draft_order(uuid, jsonb) to authenticated;
