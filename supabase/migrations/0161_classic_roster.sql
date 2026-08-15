-- 0161: THE COMMISSIONER SHAPES THE WHOLE GAME — custom starting lineups +
-- the full Sleeper/ESPN-style scoring catalog for classic (normie) leagues.
--
-- The founder: "a full section for customizing starting roster spots so
-- Commissioners can create any combinations of starting roster spot types"
-- and "customize all the scoring settings like in sleeper and ESPN fantasy."
--
-- LINEUP: settings_json.roster_classic — counts per slot TYPE (QB RB WR TE
-- FLEX SFLX WRT K DEF DL LB DB IDP). Slot NAMES generate in the engine
-- (classicSlots): TYPE when count is 1, TYPE+index otherwise — the default
-- config reproduces the original nine names exactly, so pre-0161 rows keep
-- meaning what they meant. Frozen once the draft starts (a lineup's shape is
-- structural, like the mode itself). The slot-cap trigger now admits exactly
-- the configured starter count.
--
-- SCORING: set_league_classic_scoring's whitelist widens to the full catalog
-- (~36 knobs: the 5-bracket FG ladder, return yards, TE catch premium, the
-- IDP line, and the stacking 300/400 passing + 100/200 rushing/receiving
-- game bonuses). Same contract as 0160: SQL knows keys + clamps, the engine
-- alone knows defaults. NOTE: fg0's meaning narrows from "<40" to "0-19"
-- (fg20/fg30 join it) — acceptable now because no live league carries FG
-- overrides yet; after launch this would have needed a data migration.
--
-- BEST BALL: slot-name validation loosens from the fixed nine to the
-- generated-name pattern — the engine only ever fills names present in the
-- league's configured lineup, so a stale name is inert, not dangerous.

-- ── The lineup setter ───────────────────────────────────────────────────────
create or replace function set_league_classic_roster(p_league_id uuid, p_roster jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare types text[] := array['QB','RB','WR','TE','FLEX','SFLX','WRT','K','DEF','DL','LB','DB','IDP'];
declare cleaned jsonb := '{}'::jsonb; t text; v int; total int := 0; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the starting lineup is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the starting lineup locks once the draft starts');
  end if;
  foreach t in array types loop
    begin v := least(6, greatest(0, floor((p_roster ->> t)::numeric)::int)); exception when others then v := 0; end;
    if v > 0 then cleaned := cleaned || jsonb_build_object(t, v); total := total + v; end if;
  end loop;
  if total < 1 then return jsonb_build_object('ok', false, 'error', 'the lineup needs at least one starter'); end if;
  if total > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_classic', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'roster', cleaned, 'starters', total);
end $$;

-- ── Scoring whitelist widens to the full catalog ────────────────────────────
create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd'];
  event_keys text[] := array['passTd', 'int', 'pass300', 'pass400',
                             'rushTd', 'rush100', 'rush200',
                             'recTd', 'teRec', 'rec100', 'rec200',
                             'fumble', 'retTd',
                             'fg0', 'fg20', 'fg30', 'fg40', 'fg50', 'fgMiss', 'xp', 'xpMiss',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety',
                             'idpTackle', 'idpSack', 'idpInt', 'idpFr', 'idpTd', 'idpSafety'];
  cleaned jsonb := '{}'::jsonb; k text; v numeric;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'classic scoring is a classic-league setting');
  end if;
  foreach k in array yard_keys loop
    begin v := (p_scoring ->> k)::numeric; exception when others then v := null; end;
    if v is not null then
      cleaned := cleaned || jsonb_build_object(k, round(least(1, greatest(0, v)) * 1000) / 1000);
    end if;
  end loop;
  foreach k in array event_keys loop
    begin v := (p_scoring ->> k)::numeric; exception when others then v := null; end;
    if v is not null then
      cleaned := cleaned || jsonb_build_object(k, round(least(20, greatest(-10, v)) * 10) / 10);
    end if;
  end loop;
  update league set settings_json =
      case when cleaned = '{}'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'scoring_classic')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('scoring_classic', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'scoring', cleaned);
end $$;

-- ── Best ball accepts generated slot names ──────────────────────────────────
create or replace function set_league_bestball(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare cleaned jsonb; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'best ball is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'best ball locks once the draft starts');
  end if;
  -- Generated-name pattern, deduped, input order preserved. The engine fills
  -- only names present in the configured lineup, so extras are inert.
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb) into cleaned from (
    select min(e.ordinality) as ord, to_jsonb(e.value) as v
      from jsonb_array_elements_text(coalesce(p_slots, '[]'::jsonb)) with ordinality e
     where e.value ~ '^(QB|RB|WR|TE|FLEX|SFLX|WRT|K|DEF|DL|LB|DB|IDP)[0-9]*$'
     group by e.value) s;
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'bestball')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('bestball', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'bestball', cleaned);
end $$;

-- ── Slot cap = the configured starter count ─────────────────────────────────
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int; wk int; sea text; mode text; ros jsonb;
begin
  if new.player_slug is null then return new; end if;
  if matchup_is_practice(new.matchup_id) then
    allowed := practice_slot_cap();
  else
    select m.week, l.season, coalesce(l.settings_json ->> 'game_mode', 'drip'), l.settings_json -> 'roster_classic'
      into wk, sea, mode, ros
      from matchup m join league l on l.id = m.league_id
     where m.id = new.matchup_id;
    if mode = 'classic' then
      allowed := coalesce((select sum((v.value)::int) from jsonb_each_text(ros) v), 9);
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

-- ── league_game_mode v5: the boards need the lineup config ──────────────────
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
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

-- ── league_preview v4: browsers see the lineup shape too ────────────────────
create or replace function league_preview(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype; listed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into l from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  listed := exists (select 1 from league_listing li where li.league_id = p_league_id and li.open);
  if not (listed or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not open for browsing');
  end if;
  select * into d from draft where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
    'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
    'blurb', (select li.blurb from league_listing li where li.league_id = p_league_id),
    'seats_total', (select count(*) from league_membership m where m.league_id = p_league_id),
    'seats_open',  (select count(*) from league_membership m
                     where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled),
    'draft', case when d.league_id is null then null else jsonb_build_object(
      'status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'pick_seconds', d.pick_seconds,
      'budget', case when d.mode = 'auction' then d.budget end,
      'night', case when d.night_start_min is not null then jsonb_build_object(
        'start_min', d.night_start_min, 'end_min', d.night_end_min) end) end,
    'rules', jsonb_build_object(
      'waiver_mode', coalesce(l.settings_json ->> 'waiver_mode', 'rolling'),
      'faab_budget', l.settings_json -> 'faab_budget',
      'trade_review', coalesce(l.settings_json ->> 'trade_review', 'none'),
      'pos_caps', l.settings_json -> 'pos_caps',
      'live_buffs', not league_powerups_off(p_league_id)),
    'scoring', l.settings_json -> 'scoring',
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'taken', m.app_user_id is not null and m.enrolled)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;

grant execute on function set_league_classic_roster(uuid, jsonb) to authenticated;
