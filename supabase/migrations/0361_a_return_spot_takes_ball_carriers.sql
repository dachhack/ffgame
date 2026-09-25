-- ═══════════════════════════════════════════════════════════════════════════
-- 0361 · A RETURN SPOT TAKES BALL CARRIERS
--
-- league_pos_cap asks "does any starting spot accept this position?" by
-- matching the spot's spec literally. A RET spot's spec is ["RET"], a slot
-- identity rather than a position (0171): any RB, WR, TE or FB can stand in
-- it, as core's slotEligiblePos says and every board offers. So a builder
-- league whose only home for a fullback is a RET spot capped FB at 0 on the
-- server while the client offered him. Same answer as 0195 otherwise.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function league_pos_cap(p_league_id uuid, p_pos text) returns int
  language sql stable security definer set search_path = public as $$
  select case
    -- An explicit blob is the commissioner's word, including an explicit 0.
    when jsonb_typeof(s.caps -> p_pos) = 'number' then (s.caps ->> p_pos)::int
    when s.caps is not null then null
    -- CLASSIC with a builder spec: the spec decides. A position no starting
    -- spot accepts cannot be started, so the league does not roster it.
    when s.mode = 'classic' and jsonb_typeof(s.slots) = 'array' then
      case when exists (
        select 1 from jsonb_array_elements(s.slots) sp
         where sp -> 'pos' @> to_jsonb(p_pos)
            or (p_pos in ('RB', 'WR', 'TE', 'FB') and sp -> 'pos' @> '["RET"]'::jsonb)
      ) then null else 0 end
    -- Drip, or a classic league that never touched the builder: 0071's shape.
    else case p_pos when 'QB' then 3 when 'TE' then 3 when 'K' then 1 when 'DEF' then 1 else null end
  end
  from (select settings_json -> 'pos_caps' as caps,
               settings_json -> 'roster_slots' as slots,
               coalesce(settings_json ->> 'game_mode', 'drip') as mode
          from league where id = p_league_id) s;
$$;
