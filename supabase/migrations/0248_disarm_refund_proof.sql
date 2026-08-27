-- 0248: A DISARM REFUND MUST PROVE THE COIN WAS PAID.
--
-- A confirmed, reproduced coin-forgery exploit (sweep finding #3). Two writers
-- put buffs into applied_state.buffs:
--   • arm_buff (0157) — CHARGES the wallet ('spend:<buff>' in coin_ledger).
--   • hero_set_buffs (0157) — the inventory model's apply sync, writes buffs
--     for FREE (coin was spent at shop-purchase; the client's own
--     consume_inventory tracks the item).
-- disarm_buff (0063) then refunded powerup_price for ANY buff present in the
-- set, with no check that a charge ever happened. So: hero_set_buffs a buff
-- for free, disarm_buff to be handed its price in coin, repeat — unlimited
-- money. (Reproduced: 5 loops minted 475 coin from a zero balance.)
--
-- The legacy charged pair arm_buff/disarm_buff is no longer called by either
-- client (both moved to the shop-inventory model — see the mobile note at
-- apps/mobile/src/screens/LivePicks.tsx), so this changes no live flow. It
-- only removes the free money.
--
-- THE FIX: disarm refunds at most the coin actually, and still, on the table
-- for THIS buff — net of prior refunds — read straight from the ledger. A
-- buff armed through hero_set_buffs has no 'spend:<buff>' row, so its net paid
-- is 0 and nothing is returned; a buff genuinely armed through arm_buff has
-- one, so a single disarm returns it once and a second finds nothing left.
-- Everything else in 0063's body — the amp-cascade order/cap guards, the
-- applied_state write — is carried across unchanged.
--
-- Practice weeks are exempt from the proof: their spends never touch
-- coin_ledger (they debit the throwaway practice_wallet), and credit_wallet
-- caps a practice refund at the week's budget, so it can only refill a purse
-- that funds nothing real — there is no coin to forge there.
create or replace function disarm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; amps int; cap int; rid int; price numeric; paid numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_buff = any(cur) then
    if p_buff in ('amp-2', 'amp-3') then
      if p_buff = 'amp-2' and 'amp-3' = any(cur) then
        return jsonb_build_object('ok', false, 'error', 'amp order', 'detail', 'Disarm Third Amp before Second Amp');
      end if;
      select count(*) into amps from unnest(cur) b where is_amplifier(b);
      cap := 1 + (case when 'amp-2' = any(cur) then 1 else 0 end)
               + (case when 'amp-2' = any(cur) and 'amp-3' = any(cur) then 1 else 0 end);
      if amps > cap - 1 then
        return jsonb_build_object('ok', false, 'error', 'amps in use', 'detail', 'Disarm an amplifier first');
      end if;
    end if;
    cur := array_remove(cur, p_buff);
    update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)), updated_at = now()
      where matchup_id = p_matchup_id and app_user_id = auth.uid();

    rid := caller_roster(p_matchup_id);
    price := powerup_price(p_buff);
    -- Net coin still owed back on this buff: what arm_buff charged
    -- ('spend:<buff>', a negative delta) minus what past disarms already
    -- returned ('refund:<buff>:<epoch>', positive), for this seat + matchup.
    select coalesce(-sum(delta) filter (where reason = 'spend:' || p_buff), 0)
         - coalesce( sum(delta) filter (where reason like 'refund:' || p_buff || ':%'), 0)
      into paid
      from coin_ledger
      where league_id = m.league_id and roster_id = rid and matchup_id = p_matchup_id;

    if is_practice_week(m.week) or coalesce(paid, 0) >= price then
      perform credit_wallet(m.league_id, rid, p_matchup_id, m.week, price,
        'refund:' || p_buff || ':' || extract(epoch from clock_timestamp())::text);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur));
end $$;
grant execute on function disarm_buff(uuid, text) to authenticated;
