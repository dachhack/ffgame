-- 0026: coin SPEND (M4) — the spend half of the economy. Power-ups now cost coin
-- for everyone: the buffs (M1) and metric unlocks (M2) that were free this season
-- are charged against the team wallet, with insufficient-balance guards and a
-- refund on disarm. AI spends the same wallet via the worker (M4 budget pass).
--
-- All mutation goes through adjust_wallet (atomic ledger row + balance bump), so
-- the invariant sum(coin_ledger.delta) per team == team_wallet.coins always holds.

-- Server-authoritative price list (mirrors src/data/powerups.ts). Anything not
-- listed is effectively unbuyable (9999).
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'counter-nuke' then 95 when 'insurance' then 80
    when 'unlock-combo-drip' then 65 when 'unlock-return' then 60 when 'unlock-pass-td10' then 60
    when 'extra-slot' then 80
    else 9999 end;
$$;

-- Low-level wallet mutation: append a ledger row (idempotent when p_idem is given
-- — a duplicate idem_key is a no-op) and move the balance by the same delta, in
-- one transaction. Returns true iff it applied (false on a duplicate idem).
create or replace function adjust_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text, p_idem text)
  returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into coin_ledger (league_id, roster_id, matchup_id, week, delta, reason, idem_key)
    values (p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, p_idem)
    on conflict (idem_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  insert into team_wallet (league_id, roster_id, coins) values (p_league_id, p_roster_id, p_delta)
    on conflict (league_id, roster_id) do update set coins = team_wallet.coins + p_delta, updated_at = now();
  return true;
end $$;

-- Redefine credit_wallet (earn/seed/refund) to delegate to adjust_wallet. A null
-- matchup (season seed) keys idempotency off the league instead.
create or replace function credit_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text default 'earn')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare key text; applied boolean;
begin
  if p_delta is null then return jsonb_build_object('ok', false, 'error', 'null delta'); end if;
  key := coalesce(p_matchup_id::text, p_league_id::text) || ':' || p_reason || ':' || p_roster_id;
  applied := adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, key);
  return jsonb_build_object('ok', true, 'credited', applied);
end $$;

-- Atomic debit with a balance guard. Locks the wallet row, refuses if the balance
-- can't cover the price, else records a negative ledger row + decrements. p_idem
-- null = always applies (interactive); set it for idempotent worker spends.
create or replace function spend_from_wallet(p_league_id uuid, p_roster_id int, p_price numeric, p_matchup_id uuid, p_week int, p_reason text, p_idem text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if p_price is null or p_price <= 0 then return jsonb_build_object('ok', true, 'charged', 0); end if;
  select coins into bal from team_wallet where league_id = p_league_id and roster_id = p_roster_id for update;
  if coalesce(bal, 0) < p_price then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(bal, 0), 'price', p_price);
  end if;
  if not adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, -p_price, p_reason, p_idem) then
    return jsonb_build_object('ok', true, 'charged', 0, 'dup', true);
  end if;
  return jsonb_build_object('ok', true, 'charged', p_price);
end $$;

-- The caller's own roster id in a matchup's league (for charging the right wallet).
create or replace function caller_roster(p_matchup_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select lm.sleeper_roster_id from league_membership lm join matchup m on m.id = p_matchup_id
   where lm.league_id = m.league_id and lm.app_user_id = auth.uid() limit 1;
$$;

-- The caller's team coin balance for a matchup (drives the shop / arming UI).
create or replace function my_wallet(p_matchup_id uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce((select w.coins from team_wallet w
                    where w.league_id = m.league_id and w.roster_id = caller_roster(p_matchup_id)), 0)
  from matchup m where m.id = p_matchup_id;
$$;

-- ── arm/disarm now CHARGE / REFUND coin ──────────────────────────────────────────
-- Re-arming an already-armed item is a free no-op; the charge happens only on the
-- unarmed→armed transition, the refund only on armed→unarmed.

create or replace function arm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric;
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

create or replace function disarm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_buff = any(cur) then  -- refund only if it was actually armed
    cur := array_remove(cur, p_buff);
    update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)), updated_at = now()
      where matchup_id = p_matchup_id and app_user_id = auth.uid();
    perform credit_wallet(m.league_id, caller_roster(p_matchup_id), p_matchup_id, m.week, powerup_price(p_buff), 'refund:' || p_buff || ':' || extract(epoch from clock_timestamp())::text);
  end if;
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur));
end $$;

create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric;
begin
  if not is_live_unlock(p_unlock) then return jsonb_build_object('ok', false, 'error', 'unknown unlock'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_unlock = any(cur) then return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'dup', true); end if;

  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_unlock);
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_unlock, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', sp->'balance', 'price', price);
  end if;

  cur := cur || p_unlock;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('unlocks', to_jsonb(cur)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{unlocks}', to_jsonb(cur)), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'charged', price);
end $$;

create or replace function disarm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_unlock = any(cur) then
    cur := array_remove(cur, p_unlock);
    update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{unlocks}', to_jsonb(cur)), updated_at = now()
      where matchup_id = p_matchup_id and app_user_id = auth.uid();
    perform credit_wallet(m.league_id, caller_roster(p_matchup_id), p_matchup_id, m.week, powerup_price(p_unlock), 'refund:' || p_unlock || ':' || extract(epoch from clock_timestamp())::text);
  end if;
  -- Drop dependent picks so none survives without its unlock.
  update sealed_pick set metric_id = null
    where matchup_id = p_matchup_id and app_user_id = auth.uid()
      and locked_metric_unlock(metric_id) = p_unlock;
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur));
end $$;

-- Worker-only spend/adjust (mint-capable). Revoke PUBLIC default, grant service_role.
revoke all on function adjust_wallet(uuid, int, uuid, int, numeric, text, text) from public;
revoke all on function spend_from_wallet(uuid, int, numeric, uuid, int, text, text) from public;
grant execute on function adjust_wallet(uuid, int, uuid, int, numeric, text, text) to service_role;
grant execute on function spend_from_wallet(uuid, int, numeric, uuid, int, text, text) to service_role;
-- Season starting balance, so the economy is live from week 1 (before anyone has
-- earned). Centralized so the worker's AI budget pass seeds the same amount.
create or replace function wallet_seed() returns numeric language sql immutable as $$ select 150::numeric $$;

-- Lazily grant the caller's team its one-time starting balance (idempotent forever
-- via the 'seed' idem_key) and return the balance. LivePicks calls this on load so
-- a human has coin to spend before lock. AI teams are seeded by the worker.
create or replace function ensure_wallet(p_matchup_id uuid) returns numeric
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found or not is_matchup_participant(p_matchup_id) then return 0; end if;
  rid := caller_roster(p_matchup_id);
  if rid is null then return 0; end if;
  perform credit_wallet(m.league_id, rid, null, null, wallet_seed(), 'seed');
  return my_wallet(p_matchup_id);
end $$;

grant execute on function powerup_price(text) to authenticated;
grant execute on function my_wallet(uuid) to authenticated;
grant execute on function caller_roster(uuid) to authenticated;
grant execute on function wallet_seed() to authenticated;
grant execute on function ensure_wallet(uuid) to authenticated;
