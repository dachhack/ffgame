-- 0472: THE COACH SCORING PRESET (v0.670.1). Founder: "add the coach scoring
-- preset."
--
-- Every head-coach knob in the default catalog is 0, so a HEAD COACH spot
-- banked nothing until a commissioner found the knobs — and the Kickoff
-- League, with a coach spot, had never set them. This installs a preset
-- wherever HC is unlocked and no coach value was ever set:
--
--   win 10 · tie 5 · loss 0 · 0.1 per point scored
--   win by 1–4 +1 · 5–9 +2 · 10–14 +3 · 15–19 +4 · 20–24 +5 · 25+ +6
--   loss margins, downs and two-point conversions 0 (the downs barely
--   belong to the coach — projTeamRoles2026.ts)
--
-- A projected .640 coach at home then runs about 10–11 a week; the matchup-
-- aware weekly projection (v0.667.2) prices him under exactly these knobs.
-- Applied by set_league_position_access when HC is switched on, and once
-- here to the contest leagues already carrying HC with no coach scoring.
-- A catalog with ANY coach value set is the commissioner's and is untouched.

create or replace function _hc_scoring_preset() returns jsonb
  language sql immutable as $$
  select jsonb_build_object('hcWin', 10, 'hcTie', 5, 'hcLoss', 0, 'hcPts', 0.1,
                            'hcWm1', 1, 'hcWm5', 2, 'hcWm10', 3, 'hcWm15', 4, 'hcWm20', 5, 'hcWm25', 6);
$$;

-- True when no coach knob in the catalog is set to anything but 0.
create or replace function _hc_scoring_unset(sc jsonb) returns boolean
  language sql immutable as $$
  select not exists (
    select 1 from jsonb_each_text(coalesce(sc, '{}'::jsonb)) kv
     where kv.key like 'hc%' and coalesce(nullif(kv.value, '')::numeric, 0) <> 0);
$$;

create or replace function set_league_position_access(p_league_id uuid, p_positions jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['HC','P','IDP','FB','RET','COLLEGE']; cleaned jsonb := '[]'::jsonb; ps jsonb; v text;
        was boolean; added int := 0; removed int := 0; preset boolean := false;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_positions is not null and jsonb_typeof(p_positions) = 'array' then
    for ps in select * from jsonb_array_elements(p_positions) loop
      v := upper(trim(both '"' from ps::text));
      if not (v = any (allowed)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position group: ' || v);
      end if;
      if not cleaned @> to_jsonb(array[v]) then cleaned := cleaned || to_jsonb(array[v]); end if;
    end loop;
  end if;
  -- 0365: college players are classic only.
  if cleaned @> '["COLLEGE"]'::jsonb and coalesce((select settings_json ->> 'game_mode'
      from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'college players need a classic league');
  end if;
  was := _league_has_college((select settings_json from league where id = p_league_id));
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'positions_extra')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('positions_extra', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- 0472: THE COACH SCORES SOMETHING. Unlocking HC on a league whose catalog
  -- has never priced a coach installs the preset, so a coach spot pays from
  -- the first week rather than banking zeros until somebody finds the knobs.
  -- A catalog with any coach value set is the commissioner's and is left alone.
  if cleaned @> '["HC"]'::jsonb then
    update league set settings_json = settings_json
        || jsonb_build_object('scoring_classic', coalesce(settings_json -> 'scoring_classic', '{}'::jsonb) || _hc_scoring_preset())
      where id = p_league_id and _hc_scoring_unset(settings_json -> 'scoring_classic');
    preset := found;
  end if;
  -- 0438: the pool follows the switch. ON fills it from the directory;
  -- OFF drops the college players nobody holds, as a re-seed would.
  if cleaned @> '["COLLEGE"]'::jsonb and not coalesce(was, false) then
    added := _league_pool_add_college(p_league_id);
  elsif coalesce(was, false) and not (cleaned @> '["COLLEGE"]'::jsonb) then
    delete from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'college'
       and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
       and not exists (select 1 from college_custom cc where 'c-' || cc.espn_id = lp.slug);
    get diagnostics removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'positions', cleaned, 'college_added', added, 'college_removed', removed, 'hc_preset', preset);
end $$;

-- ── the leagues already playing a coach spot with no coach scoring ──────────
update league set settings_json = settings_json
    || jsonb_build_object('scoring_classic', coalesce(settings_json -> 'scoring_classic', '{}'::jsonb) || _hc_scoring_preset())
 where kind in ('dfs', 'bullseye')
   and coalesce(settings_json -> 'positions_extra', '[]'::jsonb) @> '["HC"]'::jsonb
   and _hc_scoring_unset(settings_json -> 'scoring_classic');

revoke all on function _hc_scoring_preset(), _hc_scoring_unset(jsonb) from public, anon, authenticated;
