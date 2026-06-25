-- 0027: extra slots (M4c) — a buyable power-up that adds lineup slots beyond the
-- base 8, capped at 2 per team for the pilot. Unlike a buff or a metric unlock,
-- an extra slot is a COUNT, stored in applied_state.payload_json.extra (0..cap).
-- It's bought/sold against the team wallet like any power-up (M4a economy), and a
-- cap trigger on sealed_pick enforces "base + extra" filled picks — the gate must
-- live in a trigger because clients write sealed_pick directly under RLS (same
-- reasoning as 0024's enforce_locked_metric). The resolver already pairs picks by
-- (window, slot) from the union of both sides' slots, so an unmatched extra slot
-- routes to the best-ball backup path with no resolver change.

-- The base lineup size = sum(WINDOWS[].slots) = 1(TNF)+3(early)+2(late)+1(SNF)+
-- 1(MNF) = 8, and the pilot extra-slot cap. SQL can't read the TS catalog, so
-- these mirror src/data/metrics.ts (TOTAL_SLOTS) + the M4c cap; bump together.
create or replace function base_slot_count() returns int language sql immutable as $$ select 8 $$;
create or replace function extra_slot_cap() returns int language sql immutable as $$ select 2 $$;

-- The caller's purchased extra-slot count for a matchup (0..cap). Drives the UI.
create or replace function my_extra(p_matchup_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((select (payload_json->>'extra')::int from applied_state
                   where matchup_id = p_matchup_id and app_user_id = auth.uid()), 0);
$$;

-- Buy one extra slot: charge the wallet, bump applied_state.payload_json.extra,
-- reject past the cap. Pre-lock, participant-only — same gate as the arm RPCs.
create or replace function buy_extra_slot(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int; cur int; price numeric; sp jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  cur := my_extra(p_matchup_id);
  if cur >= extra_slot_cap() then return jsonb_build_object('ok', false, 'error', 'cap', 'extra', cur); end if;

  rid := caller_roster(p_matchup_id);
  price := powerup_price('extra-slot');
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:extra-slot', null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', sp->'balance', 'price', price);
  end if;

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('extra', cur + 1))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{extra}', to_jsonb(cur + 1)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'extra', cur + 1, 'charged', price);
end $$;

-- Sell one extra slot: refund + decrement, then drop any of the caller's extra
-- sealed picks (roster_slot 'x<n>') now beyond the new cap so a pick can't
-- outlive its slot (mirrors disarm_unlock dropping dependent picks).
create or replace function sell_extra_slot(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int; cur int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  cur := my_extra(p_matchup_id);
  if cur <= 0 then return jsonb_build_object('ok', true, 'extra', 0); end if;

  update applied_state
    set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{extra}', to_jsonb(cur - 1)), updated_at = now()
    where matchup_id = p_matchup_id and app_user_id = auth.uid();
  rid := caller_roster(p_matchup_id);
  perform credit_wallet(m.league_id, rid, p_matchup_id, m.week, powerup_price('extra-slot'),
                        'refund:extra-slot:' || extract(epoch from clock_timestamp())::text);
  -- Extra slots are named 'x0','x1',… — drop those whose index is now out of range.
  delete from sealed_pick
    where matchup_id = p_matchup_id and app_user_id = auth.uid()
      and roster_slot ~ '^x[0-9]+$'
      and substring(roster_slot from 2)::int >= cur - 1;
  return jsonb_build_object('ok', true, 'extra', cur - 1);
end $$;

-- Cap enforcement: a user may field at most base_slot_count() + their purchased
-- extra filled picks in a matchup. Only filled picks count; an empty/cleared slot
-- is free. Excludes the row being written so an in-place edit of an existing slot
-- never trips the cap.
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int;
begin
  if new.player_slug is null then return new; end if;
  allowed := base_slot_count() + coalesce(
    (select (payload_json->>'extra')::int from applied_state
      where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0);
  select count(*) into cnt from sealed_pick
    where matchup_id = new.matchup_id and app_user_id = new.app_user_id and player_slug is not null
      and not (game_window = new.game_window and roster_slot = new.roster_slot);
  if cnt + 1 > allowed then
    raise exception 'lineup is full — % slots max (buy an extra slot for more)', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_slot_cap on sealed_pick;
create trigger enforce_slot_cap before insert or update on sealed_pick
  for each row execute function enforce_slot_cap();

-- Extend the admin force-resolve payload with each side's owned unlocks + extra
-- count, so the founder's preview builds an AI/auto side's lineup with exactly the
-- loadout the live worker will (combodrip picks + extra slots), not just buffs.
create or replace function admin_matchup_picks(p_matchup_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; hu uuid; au uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'no matchup'); end if;
  select app_user_id into hu from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id;
  select app_user_id into au from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id;
  return jsonb_build_object(
    'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id, 'home_app_user', hu, 'away_app_user', au,
    'picks', (select coalesce(jsonb_agg(jsonb_build_object('app_user_id', app_user_id, 'game_window', game_window, 'roster_slot', roster_slot, 'player_slug', player_slug, 'metric_id', metric_id)), '[]'::jsonb) from sealed_pick where matchup_id = p_matchup_id),
    'home_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.home_roster_id),
    'away_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.away_roster_id),
    'home_buffs', (select coalesce(payload_json->'buffs', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = hu),
    'away_buffs', (select coalesce(payload_json->'buffs', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = au),
    'home_unlocks', (select coalesce(payload_json->'unlocks', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = hu),
    'away_unlocks', (select coalesce(payload_json->'unlocks', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = au),
    'home_extra', coalesce((select (payload_json->>'extra')::int from applied_state where matchup_id = p_matchup_id and app_user_id = hu), 0),
    'away_extra', coalesce((select (payload_json->>'extra')::int from applied_state where matchup_id = p_matchup_id and app_user_id = au), 0)
  );
end $$;

grant execute on function base_slot_count() to authenticated;
grant execute on function extra_slot_cap() to authenticated;
grant execute on function my_extra(uuid) to authenticated;
grant execute on function buy_extra_slot(uuid) to authenticated;
grant execute on function sell_extra_slot(uuid) to authenticated;
