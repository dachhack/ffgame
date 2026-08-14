-- 0144: FUNCTIONAL PLAYER FLAGS — rules, not just labels (docs/flag-rules.md).
--
-- 0141's flags were informational. The founder's spec makes them BITE:
-- a flag can now carry any combination of rules —
--   no_trade / no_add / no_start / no_powerups / immune (booleans),
--   bonus_mult (0.5..3) / bonus_pts (-10..10) (scoring, engine-enforced).
--
-- ENFORCEMENT SHAPE. Roster rules bite at the DATA, not in five patched RPCs:
-- one trigger on native_roster keyed by the acquisition kind catches every
-- add/claim/trade path (including future ones) — 'fa'/'waiver' check no_add,
-- 'trade' checks no_trade, 'draft'/'commish' always pass (the commissioner's
-- override tools stay overrides, and flagging someone mid-draft shouldn't
-- explode the draft). process_waivers alone is re-declared (0126 body + one
-- check) so a flagged pending claim marks LOST with a note instead of the
-- trigger aborting the whole sweep. no_start bites sealed_pick the same way
-- the illegal-roster lockout does: manager writes only, server/admin exempt,
-- so game ops never jam. Scoring rules (bonus/immunity/no_powerups) are
-- engine-enforced — both resolvers read the same flag cache; SQL just stores.

alter table player_flag add column if not exists rules jsonb not null default '{}'::jsonb;

-- Whitelist + clamp arbitrary input into a valid rules object. Identity-ish:
-- off/default values are OMITTED, so "no rules" is exactly '{}'.
create or replace function sanitize_flag_rules(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; m numeric; b int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  if coalesce((p ->> 'no_trade')::boolean, false) then out := out || '{"no_trade": true}'; end if;
  if coalesce((p ->> 'no_add')::boolean, false) then out := out || '{"no_add": true}'; end if;
  if coalesce((p ->> 'no_start')::boolean, false) then out := out || '{"no_start": true}'; end if;
  if coalesce((p ->> 'no_powerups')::boolean, false) then out := out || '{"no_powerups": true}'; end if;
  if coalesce((p ->> 'immune')::boolean, false) then out := out || '{"immune": true}'; end if;
  m := round(least(3, greatest(0.5, coalesce((p ->> 'bonus_mult')::numeric, 1))) * 10) / 10;
  if m <> 1 then out := out || jsonb_build_object('bonus_mult', m); end if;
  b := least(10, greatest(-10, coalesce((p ->> 'bonus_pts')::numeric, 0)::int));
  if b <> 0 then out := out || jsonb_build_object('bonus_pts', b); end if;
  return out;
exception when others then return '{}'::jsonb;
end $$;

-- The flag's label when RULE bites this player in this league, else null.
create or replace function flag_rule_blocks(p_league_id uuid, p_slug text, p_rule text) returns text
  language sql stable security definer set search_path = public as $$
  select f.label from player_flag f
  where f.league_id = p_league_id and f.slug = p_slug
    and coalesce((f.rules ->> p_rule)::boolean, false)
  limit 1;
$$;

-- ── the roster gate: adds and trades, every path ─────────────────────────────
create or replace function enforce_flag_roster() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lbl text;
begin
  if new.acquired in ('fa', 'waiver') then
    lbl := flag_rule_blocks(new.league_id, new.slug, 'no_add');
    if lbl is not null then
      raise exception 'the commissioner has flagged this player as not addable — %', lbl;
    end if;
  elsif new.acquired = 'trade' then
    lbl := flag_rule_blocks(new.league_id, new.slug, 'no_trade');
    if lbl is not null then
      raise exception 'the commissioner has flagged this player as not tradeable — %', lbl;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists enforce_flag_roster on native_roster;
create trigger enforce_flag_roster before insert or update on native_roster
  for each row execute function enforce_flag_roster();

-- ── no_start: sealed picks, manager writes only ──────────────────────────────
create or replace function enforce_flag_start() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; lbl text;
begin
  if auth.uid() is null or is_admin() then return new; end if;   -- server + admin tools exempt
  if new.player_slug is null then return new; end if;
  select m.league_id into lg from matchup m where m.id = new.matchup_id;
  if lg is null then return new; end if;
  lbl := flag_rule_blocks(lg, new.player_slug, 'no_start');
  if lbl is not null then
    raise exception 'the commissioner has flagged % as not startable — %', new.player_slug, lbl;
  end if;
  return new;
end $$;
drop trigger if exists enforce_flag_start on sealed_pick;
create trigger enforce_flag_start before insert or update on sealed_pick
  for each row execute function enforce_flag_start();

-- ── process_waivers: 0126 body + the flag check (LOST, not an abort) ─────────
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; cnt int; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);

  for c in
    select wc.*, m.waiver_priority,
           case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end as standings_rank
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    left join lateral (
      -- league_standings is best-first; reverse it so 0 = the worst record
      select (jsonb_array_length(league_standings(p_league_id)) - ord)::int as rank
      from jsonb_array_elements(league_standings(p_league_id)) with ordinality s(e, ord)
      where (s.e ->> 'roster_id')::int = wc.roster_id
    ) sr on mode = 'standings'
    where wc.league_id = p_league_id and wc.status = 'pending'
      and (lp.waived_until is null or lp.waived_until <= now())
    order by case when mode = 'faab' then -wc.bid else 0 end,
             case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end,
             m.waiver_priority nulls last, wc.created_at
  loop
    -- 0144: a commissioner flag set while the claim sat pending kills it with
    -- a clear note — the roster trigger would otherwise abort the whole sweep.
    if flag_rule_blocks(p_league_id, c.add_slug, 'no_add') is not null then
      update waiver_claim set status = 'lost', note = 'player flagged by the commissioner', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = case when mode = 'faab' then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = c.roster_id;
    if c.drop_slug is null and cnt >= d.rounds then
      update waiver_claim set status = 'lost', note = 'roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if roster_illegal_reason(p_league_id, c.roster_id) is not null then
      update waiver_claim set status = 'lost', note = 'roster over limits', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    err := pos_cap_error(p_league_id, c.roster_id, c.add_slug, false, c.drop_slug);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'position limit', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if mode = 'faab' and c.bid > member_faab(p_league_id, c.roster_id) then
      update waiver_claim set status = 'lost', note = 'insufficient FAAB', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
    if mode = 'faab' and c.bid > 0 then
      update league_membership set faab_budget = member_faab(p_league_id, c.roster_id) - c.bid
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    if mode <> 'standings' then
      update league_membership set waiver_priority =
          (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    won := won + 1; changed := true;
  end loop;

  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;

-- ── set_player_flag v2: + rules. Old 3-arg form dropped (PostgREST would see
--    two overloads and refuse both). Empty label still deletes the flag —
--    rules ride the flag, so deleting clears them too. ──────────────────────
drop function if exists set_player_flag(uuid, text, text);
create or replace function set_player_flag(p_league_id uuid, p_slug text, p_label text, p_rules jsonb default '{}'::jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lbl text := nullif(btrim(coalesce(p_label, '')), ''); rl jsonb := sanitize_flag_rules(p_rules);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    return jsonb_build_object('ok', false, 'error', 'which player?');
  end if;
  if lbl is null then
    delete from player_flag where league_id = p_league_id and slug = p_slug;
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  if length(lbl) > 40 then
    return jsonb_build_object('ok', false, 'error', 'keep the flag under 40 characters');
  end if;
  insert into player_flag (league_id, slug, label, rules) values (p_league_id, p_slug, lbl, rl)
    on conflict (league_id, slug) do update set label = excluded.label, rules = excluded.rules, created_at = now();
  return jsonb_build_object('ok', true, 'on', true, 'label', lbl, 'rules', rl);
end $$;

-- Bulk: one label + one rule set across many players (the FILTER lives in the
-- client editor; the server just applies and re-validates).
create or replace function set_player_flags_bulk(p_league_id uuid, p_slugs text[], p_label text, p_rules jsonb default '{}'::jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lbl text := nullif(btrim(coalesce(p_label, '')), ''); rl jsonb := sanitize_flag_rules(p_rules); n int := 0; sl text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slugs is null or array_length(p_slugs, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no players selected');
  end if;
  if array_length(p_slugs, 1) > 200 then
    return jsonb_build_object('ok', false, 'error', 'flag at most 200 players at once');
  end if;
  if lbl is not null and length(lbl) > 40 then
    return jsonb_build_object('ok', false, 'error', 'keep the flag under 40 characters');
  end if;
  foreach sl in array p_slugs loop
    if btrim(sl) = '' then continue; end if;
    if lbl is null then
      delete from player_flag where league_id = p_league_id and slug = sl;
    else
      insert into player_flag (league_id, slug, label, rules) values (p_league_id, sl, lbl, rl)
        on conflict (league_id, slug) do update set label = excluded.label, rules = excluded.rules, created_at = now();
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n, 'rules', rl);
end $$;

-- player_flags v2: + rules, so clients and the worker read one shape.
create or replace function player_flags(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'slug', f.slug, 'label', f.label, 'rules', f.rules, 'created_at', f.created_at) order by f.created_at desc)
    from player_flag f where f.league_id = p_league_id), '[]'::jsonb);
end $$;

grant execute on function set_player_flag(uuid, text, text, jsonb) to authenticated;
grant execute on function set_player_flags_bulk(uuid, text[], text, jsonb) to authenticated;
grant execute on function player_flags(uuid) to authenticated;
