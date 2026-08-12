-- 0121: a practice week's power-ups are OWNED, in a purse of their own.
--
-- Reported from the real board: "I bought a power up in turf Warriors and
-- applied it but it's now gone."
--
-- What the code did. On a practice week (> 100), wallet_buy_powerup debits the
-- practice purse and then RETURNS BEFORE bump_inventory (0115, lines 256-259):
-- coin moves, nothing is granted. consume_inventory and refund_inventory
-- return early too (0110), so arming decrements nothing. The card is therefore
-- never in team_inventory at any point — the shop charges you, the hand shows
-- whatever the client believes, and the next read from the server disagrees and
-- it disappears.
--
-- Why it was built that way, and why that reasoning was incomplete:
-- team_inventory is keyed (league_id, roster_id, powerup_id) with NO week. So
-- granting a practice purchase there would hand you the item for free in Week 1,
-- bought with throwaway coin. Skipping the grant avoids that leak — and creates
-- a worse problem, because a practice week is supposed to be where someone
-- LEARNS this loop. Buy, arm, watch it work. Instead it teaches them that
-- buying a card loses their coin and gives them nothing, which is the single
-- most alarming thing a game can teach about its shop.
--
-- The fix is the one practice_wallet already established: a parallel table with
-- a WEEK in the key. Practice coin lives in practice_wallet(league, roster,
-- week); practice cards now live in practice_inventory(league, roster, week,
-- powerup). Nothing crosses into the real season, because nothing shares a row
-- with it — the same isolation, by the same means, and no new judgement call
-- about what a practice purchase is worth.
--
-- The three RPCs stop special-casing practice by RETURNING EARLY and instead
-- special-case it by CHOOSING A TABLE. That is the actual difference between the
-- two economies, and it is the only difference.
create table if not exists practice_inventory (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  week       int  not null,
  powerup_id text not null,
  qty        int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, roster_id, week, powerup_id)
);
alter table practice_inventory enable row level security;
create policy practice_inventory_read on practice_inventory for select using (
  exists (select 1 from league_membership lm
           where lm.league_id = practice_inventory.league_id and lm.app_user_id = auth.uid())
);
grant select on practice_inventory to authenticated;

-- Mirror of bump_inventory, with the week. Clamps at 0 the same way.
create or replace function bump_practice_inventory(p_league_id uuid, p_roster_id int, p_week int, p_powerup_id text, p_delta int)
  returns int language plpgsql security definer set search_path = public as $$
declare q int;
begin
  insert into practice_inventory (league_id, roster_id, week, powerup_id, qty)
    values (p_league_id, p_roster_id, p_week, p_powerup_id, greatest(0, p_delta))
  on conflict (league_id, roster_id, week, powerup_id) do update
    set qty = greatest(0, practice_inventory.qty + p_delta), updated_at = now()
  returning qty into q;
  return q;
end $$;

-- ── The three RPCs: same shape, table chosen by the week ─────────────────────
create or replace function wallet_buy_powerup(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int; price numeric; sp jsonb; bal numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_powerup_id);
  if price >= 9999 then return jsonb_build_object('ok', false, 'error', 'unknown powerup'); end if;
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_powerup_id, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(sp->'balance', to_jsonb(0)), 'price', price);
  end if;
  bal := my_wallet(p_matchup_id);
  -- Grant either way. This is the fix: the practice branch used to return here.
  if is_practice_week(m.week) then
    perform bump_practice_inventory(m.league_id, rid, m.week, p_powerup_id, 1);
    return jsonb_build_object('ok', true, 'balance', bal, 'charged', price, 'practice', true);
  end if;
  perform bump_inventory(m.league_id, rid, p_powerup_id, 1);
  return jsonb_build_object('ok', true, 'balance', bal, 'charged', price);
end $$;

create or replace function consume_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid; wk int;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select league_id, week into lg, wk from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  if is_practice_week(wk) then
    return jsonb_build_object('ok', true, 'practice', true, 'qty', bump_practice_inventory(lg, rid, wk, p_powerup_id, -1));
  end if;
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, -1));
end $$;

create or replace function refund_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid; wk int;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select league_id, week into lg, wk from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  if is_practice_week(wk) then
    return jsonb_build_object('ok', true, 'practice', true, 'qty', bump_practice_inventory(lg, rid, wk, p_powerup_id, 1));
  end if;
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, 1));
end $$;

-- Reads the purse that matches the week, so the hand shows what you actually own
-- on the board you are looking at.
create or replace function my_inventory(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid; wk int; result jsonb;
begin
  select league_id, week into lg, wk from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  if rid is null then return '{}'::jsonb; end if;
  if is_practice_week(wk) then
    select coalesce(jsonb_object_agg(powerup_id, qty) filter (where qty > 0), '{}'::jsonb) into result
      from practice_inventory where league_id = lg and roster_id = rid and week = wk;
    return result;
  end if;
  select coalesce(jsonb_object_agg(powerup_id, qty) filter (where qty > 0), '{}'::jsonb) into result
    from team_inventory where league_id = lg and roster_id = rid;
  return result;
end $$;

grant execute on function consume_inventory(uuid, text) to authenticated;
grant execute on function refund_inventory(uuid, text) to authenticated;
grant execute on function my_inventory(uuid) to authenticated;
