-- ═══════════════════════════════════════════════════════════════════════════
-- 0442 · WHAT A LEAGUE'S SEASONS ALLOW.
--
-- Founder: "Devy spots and the devy market don't make sense for redraft
-- leagues. Nor does taxi. Dynasty leagues can't do vampire or guillotine
-- modes either."
--
--   · A REDRAFT league starts over every season, so there is nothing to
--     develop or stash: no devy spots, no devy market, no taxi squad.
--     College lineup spots score this season and stay open to it.
--   · A DYNASTY league (dynasty, contract dynasty) carries its rosters
--     over; guillotine and vampire tear them apart. Head-to-head only.
--
-- Enforced where the choice is made, with the reason: commish_setup_college
-- (devy spots / the market at creation), set_league_roster_shape (a new
-- taxi squad or devy shelf), set_league_format (into guillotine or vampire),
-- set_league_continuity (to redraft with a shelf, or to dynasty under one of
-- those formats). _league_seasons_rule names the violation from a settings
-- blob, and the league backstop raises it for every other writer
-- (commish_setup_devy, set_league_devy_mode, a copied blueprint).
--
-- ONLY A NEW VIOLATION IS REFUSED. Leagues already running a taxi squad in
-- a redraft season, or vampire in a dynasty, keep working untouched — the
-- rules bite on the way in, never on a league that is already there.
-- Bodies copied from 0376 (set_league_roster_shape), 0433 (set_league_format,
-- set_league_continuity) and 0440 (commish_setup_college, the backstop) with
-- only the marked 0442 changes.
-- ═══════════════════════════════════════════════════════════════════════════

-- league_continuity's reading, from a settings blob (for a row not yet written).
create or replace function _league_continuity_of(p_settings jsonb) returns text
  language sql immutable as $$
  select case
    when p_settings ->> 'continuity' in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty')
      then p_settings ->> 'continuity'
    when coalesce((p_settings ->> 'rookie_rounds')::int, 0) > 0
      or coalesce((p_settings ->> 'dynasty')::boolean, false) then 'dynasty'
    when coalesce((p_settings ->> 'keeper_count')::int, 0) > 0 then 'keeper'
    else 'redraft' end
$$;

-- The violation, or null.
create or replace function _league_seasons_rule(p_settings jsonb) returns text
  language sql immutable as $$
  select case
    when _league_continuity_of(p_settings) = 'redraft'
     and (coalesce((p_settings -> 'roster_shape' ->> 'devy')::int, 0) > 0
          or coalesce((p_settings -> 'roster_shape' ->> 'taxi')::int, 0) > 0
          or coalesce(p_settings ->> 'devy_mode', 'spots') = 'shares')
      then 'a redraft league starts over every season — devy spots, the devy market and the taxi squad are for keeper and dynasty leagues (0442)'
    when _league_continuity_of(p_settings) in ('dynasty', 'contract_dynasty')
     and coalesce(p_settings ->> 'format', 'standard') in ('guillotine', 'vampire')
      then 'a dynasty league plays head-to-head — guillotine and vampire tear apart rosters that are meant to carry over (0442)'
    else null end
$$;
revoke all on function _league_continuity_of(jsonb) from public, anon, authenticated;
revoke all on function _league_seasons_rule(jsonb) from public, anon, authenticated;

-- ── the backstop — 0440's, plus the seasons rule ──
create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  -- 0371: the college calendar needs college players, and has no devy spots
  -- (devy is an NFL league's shelf).
  if coalesce(new.settings_json ->> 'calendar', 'nfl') = 'college' then
    if not _league_has_college(new.settings_json) then
      raise exception 'a college-calendar league needs college players turned on (0371)';
    end if;
    if coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      raise exception 'a college-calendar league has no devy spots (0371)';
    end if;
  end if;
  -- 0372/0440: a spot with a level belongs to a league where college players
  -- score on the NFL calendar. The college calendar or COLLEGE off would
  -- leave it meaningless; devy spots no longer would.
  if jsonb_path_exists(coalesce(new.settings_json -> 'roster_slots', '[]'::jsonb), '$[*] ? (exists(@.level))')
     and not (_league_has_college(new.settings_json)
              and coalesce(new.settings_json ->> 'calendar', 'nfl') = 'nfl') then
    raise exception 'NFL/college spots need college players on and the NFL calendar (0372)';
  end if;
  -- 0442: the seasons rule, as a backstop for every writer. Only a NEW
  -- violation raises — a league already in the state keeps working.
  if _league_seasons_rule(new.settings_json) is not null
     and (tg_op = 'INSERT' or _league_seasons_rule(old.settings_json) is null) then
    raise exception '%', _league_seasons_rule(new.settings_json);
  end if;
  return new;
end $$;

-- ── set_league_roster_shape — 0376's body, a new shelf refused on a redraft league ──
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int, p_out int, p_devy int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; drounds int; b int; tx int; ir int; o int; r int; sh jsonb; held int; dv int;
        cur_b int; cur_tx int; cur_ir int; cur_out int; cur_dv int; st int; changes text[] := '{}';
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status, rounds into dstat, drounds from draft where league_id = p_league_id;
  sh := _roster_shape(p_league_id);
  ir := least(99, greatest(0, coalesce(p_ir, (sh ->> 'ir')::int, 0)));
  o  := least(99, greatest(0, coalesce(p_out, (sh ->> 'out')::int, 0)));
  dv := least(99, greatest(0, coalesce(p_devy, (sh ->> 'devy')::int, 0)));
  if dv > 0 and not _league_has_college((select settings_json from league where id = p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'devy spots need college players turned on for this league');
  end if;
  -- 0442: a redraft league starts over every season — nothing to develop.
  -- Only a NEW shelf is refused: a league that already has one keeps it.
  if _league_continuity_of((select settings_json from league where id = p_league_id)) = 'redraft' then
    if dv > coalesce((sh ->> 'devy')::int, 0) then
      return jsonb_build_object('ok', false, 'error', 'devy spots are for keeper and dynasty leagues — a redraft league starts over every season, so there is nothing to develop');
    end if;
    if least(99, greatest(0, coalesce(p_taxi, (sh ->> 'taxi')::int, 0))) > coalesce((sh ->> 'taxi')::int, 0) then
      return jsonb_build_object('ok', false, 'error', 'the taxi squad is for keeper and dynasty leagues — a redraft league starts over every season, so there is nothing to stash');
    end if;
  end if;

  if dstat is not null and dstat <> 'pending' then
    -- ── AFTER THE DRAFT STARTS ───────────────────────────────────────────
    st := _classic_starters(p_league_id);
    if sh = '{}'::jsonb then
      cur_b := greatest(0, coalesce(drounds, 0) - st); cur_tx := 0; cur_ir := 0; cur_out := 0; cur_dv := 0;
    else
      cur_b := coalesce((sh ->> 'bench')::int, 0); cur_tx := coalesce((sh ->> 'taxi')::int, 0);
      cur_ir := coalesce((sh ->> 'ir')::int, 0); cur_out := coalesce((sh ->> 'out')::int, 0);
      cur_dv := coalesce((sh ->> 'devy')::int, 0);
    end if;
    b  := least(99, greatest(0, coalesce(p_bench, cur_b)));
    tx := least(99, greatest(0, coalesce(p_taxi, cur_tx)));
    -- A league that never saved a shape shows the client a made-up default
    -- bench; sent beside an IR/OUT change it is stale, not a request (0296).
    if sh = '{}'::jsonb and (ir, o) <> (cur_ir, cur_out) then b := cur_b; tx := cur_tx; end if;

    if (b, tx, ir, o, dv) = (cur_b, cur_tx, cur_ir, cur_out, cur_dv) then
      return jsonb_build_object('ok', true, 'shape', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end,
        'rounds', st + b + tx + ir + o + dv, 'draft_rounds', st + b + tx + dv);
    end if;
    -- 0376: the drafted sections move once the draft is over — not during it.
    if dstat <> 'complete' and (b, tx, dv) <> (cur_b, cur_tx, cur_dv) then
      return jsonb_build_object('ok', false, 'error',
        'the bench, taxi squad and devy spots can change once the draft is over — IR and OUT spots can change now');
    end if;

    -- Shrinking: nobody may be left holding more than the new count.
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'active' group by roster_id) c;
    if held > st + b then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players in its lineup and bench — the bench can drop to '
        || greatest(0, held - st) || ' until they''re cut or moved');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'taxi' group by roster_id) c;
    if tx < held then
      return jsonb_build_object('ok', false, 'error', 'a team has ' || held || ' players on its taxi squad — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'devy' group by roster_id) c;
    if dv < held then
      return jsonb_build_object('ok', false, 'error', 'a team has ' || held || ' players in devy spots — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'ir' group by roster_id) c;
    if ir < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on IR — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'out' group by roster_id) c;
    if o < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on OUT — they come off before the spot goes');
    end if;
    r := st + b + tx + ir + o + dv;
    if r > 99 then
      return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — starters + bench + taxi + IR + OUT came to ' || r);
    end if;
    sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('roster_shape', sh)
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    update draft set rounds = r where league_id = p_league_id;

    -- 0376: the league hears about it.
    if b <> cur_b then changes := changes || ('bench ' || cur_b || ' → ' || b); end if;
    if tx <> cur_tx then changes := changes || ('taxi ' || cur_tx || ' → ' || tx); end if;
    if dv <> cur_dv then changes := changes || ('devy ' || cur_dv || ' → ' || dv); end if;
    if ir <> cur_ir then changes := changes || ('IR ' || cur_ir || ' → ' || ir); end if;
    if o <> cur_out then changes := changes || ('OUT ' || cur_out || ' → ' || o); end if;
    perform _chat_house(p_league_id,
      'Roster spots changed by the commissioner: ' || array_to_string(changes, ', ') || '.',
      jsonb_build_object('kind', 'roster_shape',
        'from', jsonb_build_object('bench', cur_b, 'taxi', cur_tx, 'ir', cur_ir, 'out', cur_out, 'devy', cur_dv),
        'to', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o, 'devy', dv)));
    return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
  end if;

  -- ── BEFORE THE DRAFT (0366, unchanged) ───────────────────────────────────
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir + o + dv;
  if r - ir - o < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
end $$;
grant execute on function set_league_roster_shape(uuid, int, int, int, int, int) to authenticated;

-- ── set_league_format — 0433's body, guillotine and vampire refused on a dynasty league ──
create or replace function set_league_format(p_league_id uuid, p_format text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; f text; wks int; want int; sched jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' and lower(btrim(coalesce(p_format, 'standard'))) <> 'standard' then
    return jsonb_build_object('ok', false, 'error', 'a daily-sport league plays head-to-head (points, categories or roto under SCORING)');
  end if;
  f := lower(btrim(coalesce(p_format, 'standard')));
  if f not in ('standard', 'guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'format must be standard, guillotine or vampire');
  end if;
  -- 0442: a dynasty league's rosters carry over; guillotine and vampire tear
  -- them apart. Refused on the way IN; a league already playing one keeps it.
  if f in ('guillotine', 'vampire') and league_format(p_league_id) <> f
     and _league_continuity_of((select settings_json from league where id = p_league_id)) in ('dynasty', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'a dynasty league plays head-to-head — guillotine and vampire tear apart rosters that are meant to carry over');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if f = 'guillotine' and d.status <> 'pending'
     and league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', false, 'error', 'guillotine must be chosen before the draft — it changes how the season scores');
  end if;
  if exists (select 1 from league_membership where league_id = p_league_id and eliminated_week is not null) then
    return jsonb_build_object('ok', false, 'error', 'the blade has already fallen — the format is locked for the season');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('format', f)
      || case when f = 'guillotine'
           then jsonb_build_object('waiver_mode', 'faab',
                  'faab_budget', coalesce(nullif(settings_json ->> 'faab_budget', '')::int, 1000),
                  -- 0246: the survivor IS the result, and the season runs
                  -- through week 17 — there is no room for a bracket and
                  -- nothing for it to decide.
                  'playoff_teams', 0)
           else '{}'::jsonb end
    where id = p_league_id;
  if f = 'guillotine' then
    delete from matchup where league_id = p_league_id and is_playoff and status = 'scheduled';
  end if;

  -- 0245: the season's length follows the format. Only re-cuts a schedule that
  -- already exists; at creation the client makes it at the right length.
  if exists (select 1 from matchup where league_id = p_league_id) then
    wks := (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff);
    want := case when f = 'guillotine' then 17 else 14 end;
    if wks <> want then
      sched := native_generate_schedule(p_league_id, want);
      if not coalesce((sched ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', true, 'format', f,
          'schedule_error', sched ->> 'error', 'weeks', wks);
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'format', f,
    'weeks', (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff));
end $$;
grant execute on function set_league_format(uuid, text) to authenticated;

-- ── set_league_continuity — 0433's body, what the league plays has to fit ──
create or replace function set_league_continuity(p_league_id uuid, p_mode text, p_n int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' and lower(btrim(coalesce(p_mode, ''))) in ('contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'contracts are not built for a daily sport yet — redraft, keeper or dynasty');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if lg.is_mock or lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'continuity belongs to full leagues');
  end if;
  if _rollover_target(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'this season already rolled over');
  end if;
  -- 0442: what the league already plays has to fit the seasons it will have.
  if lower(btrim(coalesce(p_mode, ''))) = 'redraft'
     and (coalesce((lg.settings_json -> 'roster_shape' ->> 'taxi')::int, 0) > 0
          or coalesce((lg.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0
          or coalesce(lg.settings_json ->> 'devy_mode', 'spots') = 'shares') then
    return jsonb_build_object('ok', false, 'error', 'a redraft league has no taxi squad, devy spots or devy market — set those to 0 and leave the market first');
  end if;
  if lower(btrim(coalesce(p_mode, ''))) in ('dynasty', 'contract_dynasty')
     and coalesce(lg.settings_json ->> 'format', 'standard') in ('guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'a dynasty league plays head-to-head — switch the format off ' || (lg.settings_json ->> 'format') || ' first');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  return _apply_continuity(p_league_id, lower(btrim(coalesce(p_mode, ''))), p_n);
end $$;
grant execute on function set_league_continuity(uuid, text, int) to authenticated;

-- ── commish_setup_college — 0440's body, devy spots and the market need seasons ──
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
  -- 0442: a redraft league starts over every season — devy spots and the
  -- market are for keeper and dynasty leagues. College lineup spots score
  -- this season, so they stay open to it.
  if (dspots > 0 or market) and _league_continuity_of(lg.settings_json) = 'redraft' then
    return jsonb_build_object('ok', false, 'error', 'devy spots and the devy market are for keeper and dynasty leagues — a redraft league starts over every season, so there is nothing to develop');
  end if;
  -- THE COMBINATIONS THE ENGINE CAN'T HONOUR YET — refused before any write.
  -- (0440: college lineup spots + devy spots now combine.)
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
