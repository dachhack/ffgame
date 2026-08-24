-- 0234: A CONTRACT LEAGUE'S ROOM IS AN AUCTION — NO SETTER SAYS OTHERWISE.
--
-- Founder: "contract leagues should not have snake or linear available as
-- draft options." Creation already holds the line (0218 forces mode='auction'
-- for contract/contract_dynasty before its own mode validation), but
-- set_draft_setup — the commissioner's post-creation knob — would still take
-- mode='snake' or 'linear' and quietly turn a salary market into a turn
-- order. In a contract league the bids ARE the salaries; a snake draft has no
-- bids, so every contract would land at a floor price nobody chose. Close the
-- setter.
--
-- LINEAGE: set_draft_setup patched from its CURRENT 0224 body (0176 → 0216 →
-- 0224). One addition — the contracts_on refusal, placed with the other mode
-- validation so the resolved target state is judged as a whole.

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
  -- 0234: contracts decided the format at creation; the setter can't undo it.
  if m <> 'auction' and contracts_on(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'a contract league drafts by auction — the bids are the salaries');
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
