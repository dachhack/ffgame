-- 0146: DECIMAL POINT BONUSES (playtest ask, day one continued).
--
-- The founder: "The scoring bonus should support decimals like +0.5."
-- bonus_pts — the flat-points bonus on a flag rule (0144) and on a scoped
-- scoring rule (0145) — was stored as an integer. Now: numeric at scale 1
-- (0.5 steps in the editors), same ±10 bounds. TD bonuses stay integers —
-- they're per-event bumps on whole-point occasions, and nobody asked.
--
-- trim_scale() keeps the stored jsonb clean in both directions: 0.5 stays
-- 0.5, a whole -10 stays -10 (not -10.0). Applied to bonus_mult too, so a
-- whole ×2 stops rendering as ×2.0.

-- ── sanitize_flag_rules v3: bonus_pts at scale 1 ────────────────────────────
create or replace function sanitize_flag_rules(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; m numeric; b numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  if coalesce((p ->> 'no_trade')::boolean, false) then out := out || '{"no_trade": true}'; end if;
  if coalesce((p ->> 'no_add')::boolean, false) then out := out || '{"no_add": true}'; end if;
  if coalesce((p ->> 'no_start')::boolean, false) then out := out || '{"no_start": true}'; end if;
  if coalesce((p ->> 'no_powerups')::boolean, false) then out := out || '{"no_powerups": true}'; end if;
  if coalesce((p ->> 'immune')::boolean, false) then out := out || '{"immune": true}'; end if;
  m := trim_scale(round(least(3, greatest(0.5, coalesce((p ->> 'bonus_mult')::numeric, 1))), 1));
  if m <> 1 then out := out || jsonb_build_object('bonus_mult', m); end if;
  b := trim_scale(round(least(10, greatest(-10, coalesce((p ->> 'bonus_pts')::numeric, 0))), 1));
  if b <> 0 then out := out || jsonb_build_object('bonus_pts', b); end if;
  return out;
exception when others then return '{}'::jsonb;
end $$;

-- ── sanitize_scoped_rules v2: bonus_pts at scale 1 ──────────────────────────
create or replace function sanitize_scoped_rules(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; e jsonb; r jsonb; m numeric; b numeric; td int; arr jsonb;
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
    m := trim_scale(round(least(3, greatest(0.5, coalesce((e ->> 'bonus_mult')::numeric, 1))), 1));
    if m <> 1 then r := r || jsonb_build_object('bonus_mult', m); end if;
    b := trim_scale(round(least(10, greatest(-10, coalesce((e ->> 'bonus_pts')::numeric, 0))), 1));
    if b <> 0 then r := r || jsonb_build_object('bonus_pts', b); end if;
    td := least(6, greatest(-3, coalesce((e ->> 'td_bonus')::numeric, 0)::int));
    if td <> 0 then r := r || jsonb_build_object('td_bonus', td); end if;
    -- a rule with no VALUE does nothing — drop it
    if (r ? 'bonus_mult') or (r ? 'bonus_pts') or (r ? 'td_bonus') then out := out || jsonb_build_array(r); end if;
  end loop;
  return out;
exception when others then return '[]'::jsonb;
end $$;

-- re-sanitize stored rules so any long-scale multipliers pick up trim_scale
update player_flag set rules = sanitize_flag_rules(rules)
  where (rules ? 'bonus_mult') or (rules ? 'bonus_pts');
