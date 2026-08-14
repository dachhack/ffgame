-- 0145: SCOPED SCORING BONUSES + bulk-flag polish (playtest findings, day one).
--
-- The founder's ask, verbatim: "The scoring bonus needs more filters — team,
-- position, tenure." 0143's league knobs were league-wide; this adds SCOPED
-- bonus rules that apply only to players matching a filter:
--   scoring.scoped = [ { pos?: ["QB",...], team?: ["DAL",...],
--                        tenure?: 'rookie'|'y2_3'|'vet4',
--                        bonus_mult?, bonus_pts?, td_bonus? }, ... ]  (max 12)
-- A player matches a rule when EVERY given filter matches (missing filter =
-- matches all); rules stack (multipliers multiply, points sum). Tenure and
-- team resolve client/worker-side from the directory bake + live overrides —
-- the engine is the enforcement, SQL just stores and gates (same split as
-- 0143/0144).
--
-- Also, from live-fire of the bulk flag editor:
--   • bulk cap 200 → 500 ("flag every rookie" overflows 200);
--   • sanitize_flag_rules stores bonus_mult at scale 1 (round(v,1)) instead
--     of the 1.3000000000000000 the numeric division left behind — cosmetic
--     in effect (clients Number() it), ugly in the stored jsonb.

-- ── sanitize v2: clean numeric scale ────────────────────────────────────────
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
  m := round(least(3, greatest(0.5, coalesce((p ->> 'bonus_mult')::numeric, 1))), 1);
  if m <> 1 then out := out || jsonb_build_object('bonus_mult', m); end if;
  b := least(10, greatest(-10, coalesce((p ->> 'bonus_pts')::numeric, 0)::int));
  if b <> 0 then out := out || jsonb_build_object('bonus_pts', b); end if;
  return out;
exception when others then return '{}'::jsonb;
end $$;

-- one-time cleanup of already-stored long-scale multipliers
update player_flag set rules = sanitize_flag_rules(rules)
  where rules ? 'bonus_mult';

-- ── bulk cap 500 ────────────────────────────────────────────────────────────
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
  if array_length(p_slugs, 1) > 500 then
    return jsonb_build_object('ok', false, 'error', 'flag at most 500 players at once');
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

-- ── scoped scoring rules ────────────────────────────────────────────────────
create or replace function sanitize_scoped_rules(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; e jsonb; r jsonb; m numeric; b int; td int; arr jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  for e in select * from jsonb_array_elements(p) loop
    exit when jsonb_array_length(out) >= 12;
    if jsonb_typeof(e) <> 'object' then continue; end if;
    r := '{}'::jsonb;
    -- filters: short uppercase code lists, bounded
    if jsonb_typeof(e -> 'pos') = 'array' then
      select coalesce(jsonb_agg(upper(left(v, 3))), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'pos') v limit 8) s where v ~ '^[A-Za-z]{1,3}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('pos', arr); end if;
    end if;
    if jsonb_typeof(e -> 'team') = 'array' then
      select coalesce(jsonb_agg(upper(left(v, 3))), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'team') v limit 32) s where v ~ '^[A-Za-z]{2,3}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('team', arr); end if;
    end if;
    if e ->> 'tenure' in ('rookie', 'y2_3', 'vet4') then r := r || jsonb_build_object('tenure', e ->> 'tenure'); end if;
    -- values
    m := round(least(3, greatest(0.5, coalesce((e ->> 'bonus_mult')::numeric, 1))), 1);
    if m <> 1 then r := r || jsonb_build_object('bonus_mult', m); end if;
    b := least(10, greatest(-10, coalesce((e ->> 'bonus_pts')::numeric, 0)::int));
    if b <> 0 then r := r || jsonb_build_object('bonus_pts', b); end if;
    td := least(6, greatest(-3, coalesce((e ->> 'td_bonus')::numeric, 0)::int));
    if td <> 0 then r := r || jsonb_build_object('td_bonus', td); end if;
    -- a rule with no VALUE does nothing — drop it
    if (r ? 'bonus_mult') or (r ? 'bonus_pts') or (r ? 'td_bonus') then out := out || jsonb_build_array(r); end if;
  end loop;
  return out;
exception when others then return '[]'::jsonb;
end $$;

-- set_league_scoring v2: + scoped rules. Old 4-arg dropped (overloads break
-- PostgREST resolution). All-default AND no scoped rules stores nothing.
drop function if exists set_league_scoring(uuid, int, numeric, int);
create or replace function set_league_scoring(
  p_league_id uuid, p_td_bonus int, p_yd_mult numeric, p_to_penalty int, p_scoped jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ym numeric := round(coalesce(p_yd_mult, 1)::numeric, 1);
        tb int := coalesce(p_td_bonus, 0);
        tp int := coalesce(p_to_penalty, 0);
        sc jsonb := sanitize_scoped_rules(p_scoped);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if tb < -3 or tb > 6 then
    return jsonb_build_object('ok', false, 'error', 'TD bonus must be between -3 and +6');
  end if;
  if ym < 0.5 or ym > 2 then
    return jsonb_build_object('ok', false, 'error', 'yardage multiplier must be between 0.5 and 2');
  end if;
  if tp < 0 or tp > 5 then
    return jsonb_build_object('ok', false, 'error', 'turnover penalty must be between 0 and 5');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when tb = 0 and ym = 1 and tp = 0 and jsonb_array_length(sc) = 0
              then jsonb_build_object('scoring', null)
              else jsonb_build_object('scoring', jsonb_build_object(
                     'td_bonus', tb, 'yd_mult', ym, 'to_penalty', tp, 'scoped', sc)) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'td_bonus', tb, 'yd_mult', ym, 'to_penalty', tp, 'scoped', sc);
end $$;

-- league_scoring v2: + scoped
create or replace function league_scoring(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sc jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select settings_json -> 'scoring' into sc from league where id = p_league_id;
  return jsonb_build_object('ok', true,
    'td_bonus',   coalesce((sc ->> 'td_bonus')::int, 0),
    'yd_mult',    coalesce((sc ->> 'yd_mult')::numeric, 1),
    'to_penalty', coalesce((sc ->> 'to_penalty')::int, 0),
    'scoped',     coalesce(sc -> 'scoped', '[]'::jsonb),
    'can_edit', is_admin() or is_league_commish(p_league_id));
end $$;

grant execute on function set_league_scoring(uuid, int, numeric, int, jsonb) to authenticated;
grant execute on function league_scoring(uuid) to authenticated;
grant execute on function set_player_flags_bulk(uuid, text[], text, jsonb) to authenticated;
