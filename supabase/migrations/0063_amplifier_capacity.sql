-- 0063: AMPLIFIER CAPACITY. Momentum / Overtime / Garbage Time all multiply
-- the same drip accrual; the measured meta (findings §2/§12) is "everyone
-- stacks all three every week". Instead of a hidden stacking surcharge, the
-- limit is a PRODUCT: one amplifier per week by default, with two new
-- power-ups raising the cap — Second Amp (◎40) and Third Amp (◎60, requires
-- Second). The full stack now costs its amplifiers plus ◎100 of capacity.
-- The engine caps authoritatively (capAmplifiers in src/data/powerups.ts —
-- worker, demo and playtester all agree); these gates reject excess at arm
-- time so a player can't pay for a buff the resolver would drop.

create or replace function is_live_buff(p_buff text) returns boolean
  language sql immutable as $$
  select p_buff in (
    'overtime', 'ot-shield', 'momentum', 'garbage-time',
    'floodgates', 'counter-nuke', 'insurance', 'fg-stack',
    'amp-2', 'amp-3'
  );
$$;

create or replace function is_amplifier(p_buff text) returns boolean
  language sql immutable as $$
  select p_buff in ('momentum', 'garbage-time', 'overtime');
$$;

-- Full price list (0059 + the amp capacity unlocks). Kept in lockstep with
-- src/data/powerups.ts by scripts/check-powerup-prices.mjs.
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    -- whole-lineup buffs
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'counter-nuke' then 95 when 'insurance' then 80
    when 'amp-2' then 40 when 'amp-3' then 60
    -- metric unlocks + slot purchases
    when 'unlock-combo-drip' then 65 when 'unlock-return' then 60 when 'unlock-pass-td10' then 60
    when 'unlock-carries-wipe' then 70
    when 'extra-slot' then 80
    -- flat-bonus arms
    when 'trick-play' then 90 when 'pick-six' then 45 when 'hail-mary' then 35
    when 'turnover-boost' then 55
    -- targeted pre-kickoff plays
    when 'double-or-nothing' then 80 when 'spy' then 40 when 'bye-steal' then 55
    -- reactive / in-game
    when 'metric-swap' then 30 when 'player-swap' then 50 when 'mulligan' then 30
    when 'emp' then 65
    else 9999 end;
$$;

-- arm_buff v3 (0026 body + amplifier capacity): arming an amplifier beyond the
-- cap (1 + amp-2 + amp-3) is rejected; Third Amp requires Second Amp.
create or replace function arm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; amps int; cap int;
begin
  if not is_live_buff(p_buff) then return jsonb_build_object('ok', false, 'error', 'unknown buff'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_buff = any(cur) then return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur), 'dup', true); end if;

  if p_buff = 'amp-3' and not ('amp-2' = any(cur)) then
    return jsonb_build_object('ok', false, 'error', 'amp order', 'detail', 'Arm Second Amp before Third Amp');
  end if;
  if is_amplifier(p_buff) then
    select count(*) into amps from unnest(cur) b where is_amplifier(b);
    cap := 1 + (case when 'amp-2' = any(cur) then 1 else 0 end)
             + (case when 'amp-2' = any(cur) and 'amp-3' = any(cur) then 1 else 0 end);
    if amps >= cap then
      return jsonb_build_object('ok', false, 'error', 'amp limit', 'detail',
        'Amplifiers are limited to ' || cap || ' — arm ' || case when cap = 1 then 'Second Amp' else 'Third Amp' end || ' to run more');
    end if;
  end if;

  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_buff);
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_buff, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', sp->'balance', 'price', price);
  end if;

  cur := cur || p_buff;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', to_jsonb(cur)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur), 'charged', price);
end $$;

-- disarm_buff v2 (0026 body + capacity guard): removing Second/Third Amp while
-- the armed amplifiers still need that capacity is rejected — disarm an
-- amplifier first, so a paid buff can never be silently dropped at resolve.
create or replace function disarm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; amps int; cap int;
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
    perform credit_wallet(m.league_id, caller_roster(p_matchup_id), p_matchup_id, m.week, powerup_price(p_buff), 'refund:' || p_buff || ':' || extract(epoch from clock_timestamp())::text);
  end if;
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur));
end $$;
