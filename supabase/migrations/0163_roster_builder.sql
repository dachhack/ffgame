-- 0163 · The starting roster POSITION BUILDER (classic mode, founder's sketch).
--
-- 0161's model is COUNTS PER PREDEFINED TYPE (2×RB, 1×FLEX…): the only
-- eligibility combos a commissioner can field are the ones the catalog bakes
-- (FLEX/SFLX/WRT/IDP). The founder's builder generalizes it: an ORDERED LIST
-- of starting spots, each spot carrying its OWN eligible-position set (any
-- combination — a spot that takes QB/RB/WR/TE/K/DL/LB/DB is legal) and its own
-- best-ball flag.
--
-- Storage: settings_json.roster_slots = [{"pos": ["QB","RB"], "bb": true}, …]
-- (canonical order preserved — slot names generate engine-side as S1..Sn).
-- When roster_slots is present it WINS over roster_classic; clearing it
-- (p_slots null or []) falls back to the 0161 counts. Best ball for a
-- builder league lives per-spot ("bb"), superseding the 0159 name array.
-- Frozen once the draft starts, same as the 0161 lineup.

create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  n int; i int; seen text[]; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster builder is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the starting lineup locks once the draft starts');
  end if;
  -- CLEAR: fall back to the 0161 counts (or the default nine).
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'roster_slots'
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    return jsonb_build_object('ok', true, 'slots', null);
  end if;
  n := jsonb_array_length(p_slots);
  if n > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  for i in 0 .. n - 1 loop
    spot := p_slots -> i;
    if jsonb_typeof(spot) <> 'object' or jsonb_typeof(spot -> 'pos') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'each spot needs an eligible-position list');
    end if;
    seen := array[]::text[];
    for ps in select * from jsonb_array_elements(spot -> 'pos') loop
      p := upper(trim(both '"' from ps::text));
      if not (p = any (positions)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position: ' || p);
      end if;
      if not (p = any (seen)) then seen := seen || p; end if;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'each spot needs at least one eligible position');
    end if;
    begin bb := coalesce((spot ->> 'bb')::boolean, false); exception when others then bb := false; end;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('pos', to_jsonb(seen), 'bb', bb));
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n);
end $$;
grant execute on function set_league_classic_slots(uuid, jsonb) to authenticated;

-- ── league_game_mode v6: + roster_slots ─────────────────────────────────────
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(settings_json -> 'bestball', '[]'::jsonb),
      'scoring', coalesce(settings_json -> 'scoring_classic', '{}'::jsonb),
      'roster', coalesce(settings_json -> 'roster_classic', '{}'::jsonb),
      'slots', settings_json -> 'roster_slots',
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

-- ── enforce_slot_cap v4: a builder league's cap is its spot count ───────────
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int; wk int; sea text; mode text; ros jsonb; sl jsonb;
begin
  if new.player_slug is null then return new; end if;
  if matchup_is_practice(new.matchup_id) then
    allowed := practice_slot_cap();
  else
    select m.week, l.season, coalesce(l.settings_json ->> 'game_mode', 'drip'),
           l.settings_json -> 'roster_classic', l.settings_json -> 'roster_slots'
      into wk, sea, mode, ros, sl
      from matchup m join league l on l.id = m.league_id
     where m.id = new.matchup_id;
    if mode = 'classic' then
      allowed := coalesce(jsonb_array_length(sl),
                          (select sum((v.value)::int) from jsonb_each_text(ros) v), 9);
    else
      allowed := greatest(base_slot_count(), week_slot_count(sea, wk)) + coalesce(
        (select (payload_json->>'extra')::int from applied_state
          where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0);
    end if;
  end if;
  select count(*) into cnt from sealed_pick
    where matchup_id = new.matchup_id and app_user_id = new.app_user_id and player_slug is not null
      and not (game_window = new.game_window and roster_slot = new.roster_slot);
  if cnt + 1 > allowed then
    raise exception 'lineup is full — % slots max (buy an extra slot for more)', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
