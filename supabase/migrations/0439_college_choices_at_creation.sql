-- ═══════════════════════════════════════════════════════════════════════════
-- 0439 · THE COLLEGE CHOICES, MADE CLEAR — THREE QUESTIONS, NOT ONE.
--
-- Founder, holding the DEVY step: "Let's make the devy choices clear:
--   College player roster spots: mixed with NFL, or just college players
--     with no NFL.
--   Devy spots: not starting roster spots. Just like taxi slots where you
--     hold guys.
--   Devy market: the investment market.
--   These are all mix and matchable."
--
-- 0398's step asked ONE question (NO DEVY / DEVY SPOTS / DEVY MARKET) and
-- left the two league types the engine already plays — MIXED (0372: college
-- players start beside NFL ones) and COLLEGE ONLY (0371: the college
-- calendar) — to an admin switch found later. commish_setup_college asks
-- the founder's three:
--
--   · p_lineup: 'none' (NFL only), 'mixed' (p_college_spots college-only
--     starting spots added to the lineup, drafted like any other spot), or
--     'college' (the college calendar — every player is a college player;
--     the lineup becomes the college default when it held K or D/ST).
--   · p_devy_spots: holding spots, like taxi (0366): college players sit
--     there, never start, and move to the NFL roster when they graduate.
--   · p_market: the devy market (0387), shares that reserve rookie-draft
--     rights.
--
-- MIX AND MATCH, AS FAR AS THE ENGINE GOES TODAY. The combinations the
-- engine cannot honour yet are refused up front, with the reason, before
-- anything is written, so a league is never half set up:
--   · college lineup spots + devy spots: 0366 lands every college player
--     in a devy spot and keeps him there (he never starts), which is the
--     opposite of a college starting spot. Lifting that is engine work
--     across the landing trigger, set_roster_spot, the caps and the
--     illegal-roster rule — not a setting.
--   · the market + devy spots, or + college lineup spots: shares reserve a
--     player's draft rights; a league that also drafts him into a roster
--     spot makes the shares worthless (0387: "shares replace them", and
--     the market empties the pool of college players).
--   · the market + the college calendar: 0387, NFL schedule only.
--   · the college calendar + devy spots: 0371 — every spot already takes
--     college players; the taxi squad holds prospects there.
--
-- set_league_calendar keeps its admin gate; its body moves to
-- _league_calendar_apply so the setup can switch a new league's calendar
-- for its own commissioner, before the draft, as 0398 did for COLLEGE.
-- commish_setup_devy (0398) stands for older clients.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the league's starting spots as a spec, stored or implied ───────────────
-- roster_slots when the builder saved one; else the 0161 counts (roster_
-- classic) or the nine-spot default, in the builder's catalog order.
create or replace function _classic_slot_spec(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare sj jsonb; counts jsonb; out jsonb := '[]'::jsonb; t record; n int; i int;
begin
  select settings_json into sj from league where id = p_league_id;
  if jsonb_typeof(sj -> 'roster_slots') = 'array' and jsonb_array_length(sj -> 'roster_slots') > 0 then
    return sj -> 'roster_slots';
  end if;
  counts := coalesce(sj -> 'roster_classic', '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DEF":1}'::jsonb);
  for t in select * from (values
      ('QB', '["QB"]'::jsonb), ('RB', '["RB"]'), ('WR', '["WR"]'), ('TE', '["TE"]'),
      ('FLEX', '["RB","WR","TE"]'), ('SFLX', '["QB","RB","WR","TE"]'), ('WRT', '["WR","TE"]'),
      ('K', '["K"]'), ('DEF', '["DEF"]'), ('DL', '["DL"]'), ('LB', '["LB"]'), ('DB', '["DB"]')) as v(typ, pos)
  loop
    n := least(6, greatest(0, coalesce((counts ->> t.typ)::int, 0)));
    for i in 1 .. n loop out := out || jsonb_build_array(jsonb_build_object('pos', t.pos)); end loop;
  end loop;
  return out;
end $$;
revoke all on function _classic_slot_spec(uuid) from public, anon, authenticated;

-- ── the calendar switch, for the admin page and for the setup ──────────────
-- 0374's set_league_calendar body, minus its admin gate.
create or replace function _league_calendar_apply(p_league_id uuid, p_calendar text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; dstat text; weeks int; sched jsonb;
begin
  if p_calendar not in ('nfl', 'college') then
    return jsonb_build_object('ok', false, 'error', 'calendar must be nfl or college');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the calendar locks once the draft starts');
  end if;
  if p_calendar = 'college' then
    if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
      return jsonb_build_object('ok', false, 'error', 'the college calendar is for classic leagues');
    end if;
    if not _league_has_college(lg.settings_json) then
      return jsonb_build_object('ok', false, 'error', 'turn on college players (COLLEGE) first');
    end if;
    if coalesce((lg.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      return jsonb_build_object('ok', false, 'error', 'devy spots are for NFL leagues — set them to 0 first');
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('calendar', 'college')
        -- 0374: an NFL playoff week means nothing here; the college default
        -- (Week 13) applies until the commissioner picks one.
        - 'playoff_start_week'
        || jsonb_build_object('pool_filter', coalesce(settings_json -> 'pool_filter', '{}'::jsonb) || '{"level":"college"}'::jsonb)
      where id = p_league_id;
    -- College pools hold no kickers or team defenses, so a lineup that wants
    -- them can never be legal: give such a league (or one with no spec) the
    -- college default — QB, 2 RB, 3 WR, TE, FLEX.
    if coalesce(jsonb_path_exists(lg.settings_json -> 'roster_slots', '$[*].pos[*] ? (@ == "K" || @ == "DEF")'), true) then
      perform set_league_classic_slots(p_league_id,
        '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["RB","WR","TE"]}]'::jsonb);
    end if;
  else
    update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'calendar' - 'playoff_start_week')
        || case when settings_json -> 'pool_filter' is null then '{}'::jsonb
                else jsonb_build_object('pool_filter', (settings_json -> 'pool_filter') - 'level') end
      where id = p_league_id;
  end if;
  -- Re-lay the schedule on the new calendar, same length, while nothing is
  -- played. A league with no schedule yet keeps none.
  select count(distinct week) into weeks from matchup where league_id = p_league_id and not is_playoff;
  if weeks > 0 then
    sched := native_generate_schedule(p_league_id, least(weeks, 15));
  end if;
  return jsonb_build_object('ok', true, 'calendar', p_calendar, 'schedule', sched);
end $$;
revoke all on function _league_calendar_apply(uuid, text) from public, anon, authenticated;

create or replace function set_league_calendar(p_league_id uuid, p_calendar text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  return _league_calendar_apply(p_league_id, p_calendar);
end $$;
grant execute on function set_league_calendar(uuid, text) to authenticated;

-- ── the three questions ────────────────────────────────────────────────────
create or replace function commish_setup_college(p_league_id uuid, p_lineup text default 'none',
    p_college_spots int default 1, p_devy_spots int default 0, p_market boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; r jsonb; sh jsonb; st int; drounds int; dstat text; dmode text; spec jsonb; i int;
        lineup text := coalesce(nullif(lower(btrim(p_lineup)), ''), 'none');
        cspots int := least(6, greatest(1, coalesce(p_college_spots, 1)));
        dspots int := least(10, greatest(0, coalesce(p_devy_spots, 0)));
        market boolean := coalesce(p_market, false);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if lineup not in ('none', 'mixed', 'college') then
    return jsonb_build_object('ok', false, 'error', 'the lineup is none, mixed or college');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'college players have no place in a daily sport''s pool');
  end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'college players need a classic league');
  end if;
  select status, mode, rounds into dstat, dmode, drounds from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'college players are set up before the draft — after it, ask an admin');
  end if;
  -- Nothing chosen: an NFL-only league, untouched.
  if lineup = 'none' and dspots = 0 and not market then
    return jsonb_build_object('ok', true, 'lineup', 'none', 'college_spots', 0, 'devy_spots', 0, 'market', false);
  end if;
  -- THE COMBINATIONS THE ENGINE CAN'T HONOUR YET — refused before any write.
  if lineup = 'mixed' and dspots > 0 then
    return jsonb_build_object('ok', false, 'error', 'college lineup spots and devy spots can''t combine yet — in a devy league a college player is held in a devy spot and never starts. Pick one for now.');
  end if;
  if lineup = 'college' and dspots > 0 then
    return jsonb_build_object('ok', false, 'error', 'a college-only league has no devy spots — every spot already takes college players; hold prospects on the taxi squad');
  end if;
  if market and dspots > 0 then
    return jsonb_build_object('ok', false, 'error', 'the devy market and devy spots can''t combine — shares reserve a player''s rookie-draft rights, and a league that also drafts him into a devy spot makes the shares worthless');
  end if;
  if market and lineup = 'mixed' then
    return jsonb_build_object('ok', false, 'error', 'the devy market keeps college players out of the draft pool, and college lineup spots need them in it — they can''t combine yet');
  end if;
  if market and lineup = 'college' then
    return jsonb_build_object('ok', false, 'error', 'the devy market is for leagues on the NFL schedule');
  end if;
  if market and dmode = 'auction' then
    return jsonb_build_object('ok', false, 'error', 'the devy market needs a snake or linear draft — an auction can''t honour a reserved player');
  end if;

  -- COLLEGE on (0365), as 0398 did.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('positions_extra',
           (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(settings_json -> 'positions_extra', '[]'::jsonb) || '["COLLEGE"]'::jsonb) v))
   where id = p_league_id;

  -- The shape a league that never saved one implies — its draft rounds less
  -- the starters — materialised first, so added spots grow the rounds
  -- (0398's rule for devy spots, the same for college starting spots).
  sh := _roster_shape(p_league_id); st := _classic_starters(p_league_id);
  if sh = '{}'::jsonb then
    r := set_league_roster_shape(p_league_id, greatest(0, coalesce(drounds, 0) - st), 0, 0, 0, 0);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if lineup = 'mixed' then
    -- College-only starting spots (0372 levels), a flex each, after the
    -- lineup the league already has. The commissioner can reshape them in
    -- the roster builder like any other spot.
    spec := _classic_slot_spec(p_league_id);
    for i in 1 .. cspots loop
      spec := spec || jsonb_build_array(jsonb_build_object('pos', '["RB","WR","TE"]'::jsonb, 'level', 'college', 'label', 'COLLEGE'));
    end loop;
    r := set_league_classic_slots(p_league_id, spec);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  elsif lineup = 'college' then
    r := _league_calendar_apply(p_league_id, 'college');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if dspots > 0 then
    sh := _roster_shape(p_league_id);
    r := set_league_roster_shape(p_league_id, coalesce((sh ->> 'bench')::int, 0),
      coalesce((sh ->> 'taxi')::int, 0), coalesce((sh ->> 'ir')::int, 0), coalesce((sh ->> 'out')::int, 0), dspots);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if market then
    r := set_league_devy_mode(p_league_id, 'shares');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  return jsonb_build_object('ok', true, 'lineup', lineup,
    'college_spots', case when lineup = 'mixed' then cspots else 0 end,
    'devy_spots', dspots, 'market', market,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
grant execute on function commish_setup_college(uuid, text, int, int, boolean) to authenticated;
