-- 0224: THE REGISTER KEEPS THE SETUP HISTORY.
--
-- Founder: "Changing draft settings and order should show up in the league
-- register." Both setters now write a 'commish' register row naming what
-- changed — the room's shape and the order are league-visible decisions, and
-- a manager who checks the register the morning after should find them there,
-- not discover them on the clock.
--
-- LINEAGE: set_draft_setup patched from its CURRENT 0216 body,
-- set_draft_order from its only body (0176). roster_id 0 = "the league
-- itself" (these rows are about no seat); league_register's joins are LEFT
-- joins, so a seatless row prints with a null team, and the note carries the
-- story.

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
  if m not in ('snake', 'linear', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake, linear or auction');
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
  -- the register keeps setup history (v0.351.0, founder: "changing draft
  -- settings and order should show up in the league register")
  insert into league_txn (league_id, kind, roster_id, slug, actor, note)
  values (p_league_id, 'commish', 0, '',
          auth.uid(), 'draft settings changed — ' || m || case when m = 'auction'
            then ', $' || b || ' budget, ' || ps || 's nominations, ' || ls || 's bell, ' || ml || ' lot(s)'
            else ', ' || ps || 's picks' end);

  -- settings_json.mode is what the league LISTING and preview read; leaving it
  -- behind would show joiners a snake draft that is really an auction.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('mode', m)
    where id = p_league_id;

  return jsonb_build_object('ok', true, 'pick_seconds', ps, 'mode', m,
    'budget', b, 'lot_seconds', ls, 'max_lots', ml);
end $$;

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
  insert into league_txn (league_id, kind, roster_id, slug, actor, note)
  values (p_league_id, 'commish', 0, '',
          auth.uid(), case when p_order is null then 'draft order randomized'
                           else 'draft order set — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(ord) v) end);
  return jsonb_build_object('ok', true, 'order', ord);
end $$;
