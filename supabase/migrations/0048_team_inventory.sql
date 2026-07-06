-- 0048: server-backed owned inventory for live leagues, so power-ups you've bought
-- (but not yet armed) persist across devices. Purchases are recorded on a paid
-- wallet_buy_powerup; arming/applying consumes, disarming/backing-out refunds.
-- Keyed by TEAM (league_id, roster_id) so it carries across weeks like the demo.
create table if not exists team_inventory (
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  powerup_id  text not null,
  qty         int  not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (league_id, roster_id, powerup_id)
);
alter table team_inventory enable row level security;
create policy team_inventory_read on team_inventory for select using (
  exists (select 1 from league_membership lm where lm.league_id = team_inventory.league_id and lm.app_user_id = auth.uid())
);
grant select on team_inventory to authenticated;

-- Server-authoritative qty bump (internal; clamps at 0). Only reached through the
-- SECURITY DEFINER functions below, never granted to clients directly.
create or replace function bump_inventory(p_league_id uuid, p_roster_id int, p_powerup_id text, p_delta int)
  returns int language plpgsql security definer set search_path = public as $$
declare q int;
begin
  insert into team_inventory (league_id, roster_id, powerup_id, qty)
    values (p_league_id, p_roster_id, p_powerup_id, greatest(0, p_delta))
  on conflict (league_id, roster_id, powerup_id) do update
    set qty = greatest(0, team_inventory.qty + p_delta), updated_at = now()
  returning qty into q;
  return q;
end $$;

-- wallet_buy_powerup (0047) now also RECORDS the owned item on a successful charge.
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
  perform bump_inventory(m.league_id, rid, p_powerup_id, 1);
  select coins into bal from team_wallet where league_id = m.league_id and roster_id = rid;
  return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0), 'charged', price);
end $$;

create or replace function consume_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select league_id into lg from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, -1));
end $$;

create or replace function refund_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select league_id into lg from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, 1));
end $$;

-- The caller's owned inventory in a matchup's league → { powerup_id: qty }.
create or replace function my_inventory(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid; result jsonb;
begin
  select league_id into lg from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  if rid is null then return '{}'::jsonb; end if;
  select coalesce(jsonb_object_agg(powerup_id, qty) filter (where qty > 0), '{}'::jsonb) into result
    from team_inventory where league_id = lg and roster_id = rid;
  return result;
end $$;

grant execute on function consume_inventory(uuid, text) to authenticated;
grant execute on function refund_inventory(uuid, text) to authenticated;
grant execute on function my_inventory(uuid) to authenticated;
