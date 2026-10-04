-- ═══════════════════════════════════════════════════════════════════════════
-- 0408 · SCORING BY SCHOOL TIER — a scoped rule may name a college tier or
-- conference.
--
-- Devy leagues weight college production by the competition it came against:
-- "P5, G5 and FCS". A scoped bonus now carries `conf` — tier codes (P4 / G5 /
-- IND / FBS) or conference names — and pays only college players whose school
-- matches, the same match a spot's 🎓 CONFERENCE rule makes (0383). So
-- "G5 ×0.8" is one rule. sanitize_scoped_rules is 0197's body plus the
-- marked block; nothing else about scoring changes.
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- ── THE SPOT HE IS STANDING IN (0197) ──────────────────────────────────
    -- Slot ids from the league's own lineup ("S1".."S20"), so "the FLEX scores
    -- ×1.5" is a rule about the SPOT rather than about whoever fills it.
    if jsonb_typeof(e -> 'slot') = 'array' then
      select coalesce(jsonb_agg(upper(v)), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'slot') v limit 20) s
        where v ~ '^[A-Za-z][A-Za-z0-9]{0,7}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('slot', arr); end if;
    end if;
    -- ── THE FLAG HE WEARS (0197) ───────────────────────────────────────────
    -- The commissioner's labels, free text, matched case-insensitively by the
    -- engine. Trimmed and length-bounded here; NOT uppercased, because the
    -- label is displayed as typed.
    if jsonb_typeof(e -> 'flag') = 'array' then
      select coalesce(jsonb_agg(btrim(v)), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'flag') v limit 12) s
        where btrim(v) <> '' and length(btrim(v)) <= 24;
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('flag', arr); end if;
    end if;
    -- ── THE SCHOOL'S TIER OR CONFERENCE (0408) ─────────────────────────────
    -- 'P4' / 'G5' / 'IND' / 'FBS' or a conference name ("Big Ten", "C-USA",
    -- "Mountain West"): letters, digits, spaces and hyphens, ≤16 chars, ≤12.
    -- Matched by the engine the way a spot's 🎓 CONFERENCE rule is.
    if jsonb_typeof(e -> 'conf') = 'array' then
      select coalesce(jsonb_agg(v), '[]'::jsonb) into arr
        from (select distinct btrim(x) v from jsonb_array_elements_text(e -> 'conf') x limit 12) s
        where v ~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,15}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('conf', arr); end if;
    end if;
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
