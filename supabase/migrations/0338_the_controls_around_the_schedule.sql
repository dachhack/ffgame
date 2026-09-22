-- ═══════════════════════════════════════════════════════════════════════════
-- 0338 · THE CONTROLS AROUND THE SCHEDULE
--
-- 0337 stopped three day-pickers contradicting EACH OTHER. The founder, a day
-- later, looking at the same sheet on his phone: "looks like the three waiver
-- selections can conflict with the daily schedule?"
--
-- They could, because 0337 left the controls ABOVE the schedule free to
-- promise a run the schedule never holds — the same bug, one storey up:
--
--   · ROLLING 24H means there is no daily run at all; every dropped player
--     clears on his own 24-hour clock. But a WAIVERS TO FA day still asked
--     "has the run spoken yet?" and `coalesce(clear_min, 180)` answered it
--     with 3:00am — a time that appears NOWHERE in such a league's settings.
--     The door opened every morning on a run that had never happened. This is
--     precisely the bug 0337 was written to make unsayable, arriving through
--     the ROLLING chip instead of through `fa_after_waivers_dow`.
--
--   · AFTER GAMES, CLEAR <day> is a promise about a run too: "dropped players
--     stay on waivers until Wednesday's run." Nothing stopped a commissioner
--     naming a Wednesday his schedule spends as FREE AGENCY or LOCKED, and
--     then the hold expired at 3:00am Wednesday with no run having decided a
--     single claim — a hold that ends on nothing, which is the door bug read
--     backwards.
--
-- Both become impossible here rather than discouraged on a screen. The clients
-- get the same two readings out of packages/core/src/data/waiverDays.ts
-- (`normalizeWaiverDays`, `effectiveGameHoldDow`), pinned by
-- scripts/check-waiver-days.mjs, so the settings sheet and the database cannot
-- describe the same league differently — which was the whole complaint.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. the day the after-games hold can really end on ══════════════════════
-- The chosen day, rolled forward to the first one the run actually visits.
-- NULL when the schedule clears no day all week: there is then no run for the
-- rule to wait for, and each player keeps his own hold rather than being held
-- until a morning that decides nobody.
--
-- Any time of day works to ask the question — `league_waiver_day_clears` reads
-- the day of the week and nothing else — so this walks noon to noon.
create or replace function waiver_game_hold_dow_effective(p_league_id uuid) returns int
  language plpgsql stable security definer set search_path = public as $$
declare gh int; d int; today int; probe timestamptz; i int;
begin
  gh := league_waiver_game_hold_dow(p_league_id);
  if gh is null then return null; end if;
  today := extract(dow from now() at time zone 'America/New_York')::int;
  for i in 0..6 loop
    d := (gh + i) % 7;
    probe := (date_trunc('day', now() at time zone 'America/New_York')
              + make_interval(days => ((d - today) + 7) % 7, mins => 720)) at time zone 'America/New_York';
    if league_waiver_day_clears(p_league_id, probe) then return d; end if;
  end loop;
  return null;
end $$;
grant execute on function waiver_game_hold_dow_effective(uuid) to authenticated;

-- ═══ 2. the door, which may not open on a run that does not exist ═══════════
-- 0337's body, with one clause added: a league with NO daily run has no moment
-- at which "today's claims have been decided", so WAIVERS TO FA has nothing to
-- open on and reads as WAIVERS. The shut half of the pair on purpose — a door
-- that stays shut is a setting a commissioner can see and change, and a door
-- that opens on a phantom 3:00am run is the bug he reported.
create or replace function fa_window_open_at(p_league_id uuid, p_at timestamptz) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare fs int; fe int; cm int; mode text; fam text;
begin
  fam := league_fa_mode(p_league_id);
  if fam = 'off' then return false; end if;      -- 0287: no free agency at all
  mode := league_waiver_day(p_league_id, p_at);
  if mode in ('locked', 'waivers') then return false; end if;
  if mode = 'waivers_to_fa' then
    -- 0338: no run, no "after the run". The old `coalesce(cm, 180)` invented
    -- one, and 3:00am is not a time a rolling league has ever been shown.
    cm := league_waiver_clear_min(p_league_id);
    if cm is null then return false; end if;
    -- The run has to have SPOKEN. Same clock the run itself uses, so the two
    -- can never disagree about whether today's claims have been decided.
    if et_minutes(p_at) < cm then return false; end if;
  end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         nullif(settings_json ->> 'fa_end_min', '')::int
    into fs, fe from league where id = p_league_id;
  if fam = 'open' or fs is null or fe is null then return true; end if;
  return is_night_minute(et_minutes(p_at), fs, fe);
end $$;
grant execute on function fa_window_open_at(uuid, timestamptz) to authenticated;

-- ═══ 3. the hold, ending on a run that happens ══════════════════════════════
-- 0337's body, with the after-games day read through
-- `waiver_game_hold_dow_effective` instead of straight off the setting. When
-- the schedule visits the chosen morning — the ordinary case, and every league
-- on the default week — the two are the same value and nothing changes.
create or replace function waiver_hold_until(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare cm int; hd int; day_local timestamp; t timestamptz; base timestamptz; i int;
        gh int; seas text; kicked timestamptz; last_clear timestamptz; gt timestamptz;
begin
  cm := league_waiver_clear_min(p_league_id);
  select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1), season
    into hd, seas from league where id = p_league_id;

  -- 0319: A HOLD OF NONE — a dropped player is a free agent the moment he is
  -- dropped. Zero is stored as zero; only an unset hold reads as one day.
  -- The after-games rule below can still hold him: that is its whole job.
  -- Rolling: a flat 24 hours from the drop, whatever the hold days say —
  -- 0126's rule, unchanged. (The hold days are how many RUNS a claim waits
  -- for; with no run there is nothing for them to count, which is why the
  -- consoles stopped offering 2 and 3 in this mode — 0338.)
  if cm is null then
    t := case when hd = 0 then now() else now() + interval '24 hours' end;
  else
    -- THE NEXT DAY THE RUN VISITS, at the run's time, once the hold has run.
    base := case when hd = 0 then now() else now() + make_interval(days => greatest(1, hd) - 1) end;
    day_local := date_trunc('day', base at time zone 'America/New_York');
    t := null;
    for i in 0..8 loop
      gt := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
      if gt > base and league_waiver_day_clears(p_league_id, gt) then t := gt; exit; end if;
    end loop;
    -- A schedule with no clearing day at all (every day fa or locked) has no
    -- run to wait for; the hold is then plain days, the same expression the
    -- no-daily-run branch above uses — including a hold of NONE meaning NOW,
    -- which a `base + 1 day` fallback would have quietly overruled.
    if t is null then
      t := case when hd = 0 then now() else base + interval '24 hours' end;
    end if;
  end if;

  -- AFTER GAMES WAIVERS CLEAR (0337). From the week's first kickoff until the
  -- chosen morning's run, a dropped player is not a free agent whatever his
  -- own hold says — the rule that stops the fastest phone winning every
  -- injury. Null = NONE.
  --
  -- 0338: the EFFECTIVE morning. A hold that ends at a run the schedule never
  -- makes is a hold that ends on nothing, so the chosen day rolls forward to
  -- the next one the run visits; a week with no run at all leaves the rule
  -- inapplicable and each player keeps his own hold.
  gh := waiver_game_hold_dow_effective(p_league_id);
  if gh is not null then
    cm := coalesce(cm, 180);
    -- the most recent run on the hold day, at or before now
    day_local := date_trunc('day', now() at time zone 'America/New_York');
    last_clear := null;
    for i in 0..7 loop
      gt := (day_local - make_interval(days => i) + make_interval(mins => cm)) at time zone 'America/New_York';
      if gt <= now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
        last_clear := gt; exit;
      end if;
    end loop;
    -- has a game kicked off since then?
    select max(s.kickoff) into kicked from nfl_slate s
     where s.season = coalesce(seas, s.season) and s.kickoff <= now()
       and (last_clear is null or s.kickoff > last_clear);
    if kicked is not null then
      for i in 0..7 loop
        gt := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
        if gt > now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
          t := greatest(t, gt); exit;
        end if;
      end loop;
    end if;
  end if;
  return t;
end $$;
grant execute on function waiver_hold_until(uuid) to authenticated;

-- ═══ 4. what the consoles read ══════════════════════════════════════════════
-- 0337's body plus `waiver_game_hold_dow_effective`, so a screen showing the
-- after-games day can show the morning it really lands on without recomputing
-- the roll-forward — and so the public API and the weekly report agree with
-- the settings sheet about it.
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id),
    'fa_mode', league_fa_mode(p_league_id),   -- 0287
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id),
    -- Which designations qualify for an IR spot (0198), so a screen can gate
    -- the button instead of discovering the rule from a red error.
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)),
    -- …and for an OUT spot (0307), the week-to-week sibling.
    'out_tags', to_jsonb(league_out_tags(p_league_id)),
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id),
    -- 0319: the per-league wire knobs.
    'faab_min_bid', league_faab_min_bid(p_league_id),
    'fa_dow', (select settings_json -> 'fa_dow' from league where id = p_league_id),
    -- 0337: THE SCHEDULE the consoles now edit, and the two settings that ride
    -- with it. `waiver_days` is always seven entries — derived or defaulted —
    -- so a console never has to guess what an unset league is doing.
    'waiver_days', league_waiver_days(p_league_id),
    'waiver_days_set', (select jsonb_typeof(settings_json -> 'waiver_days') = 'array' from league where id = p_league_id),
    'waiver_game_hold_dow', league_waiver_game_hold_dow(p_league_id),
    -- 0338: …and the morning that hold really ends on, once the chosen day has
    -- been rolled forward to one the run visits. Equal to the setting for any
    -- league whose schedule clears the day it named; null when nothing clears.
    'waiver_game_hold_dow_effective', waiver_game_hold_dow_effective(p_league_id),
    'waiver_clear_min_effective', league_waiver_clear_min(p_league_id),
    'trade_deadline_week', league_trade_deadline_week(p_league_id),
    'trade_deadline_passed', trade_deadline_error(p_league_id) is not null,
    -- 0320: the commissioner's desk.
    'wire_lock', league_wire_lock(p_league_id),
    'locked_rosters', (select coalesce(jsonb_agg(sleeper_roster_id order by sleeper_roster_id), '[]'::jsonb)
                         from league_membership where league_id = p_league_id and wire_locked),
    'median_game', league_median_game(p_league_id),
    'dues_amount', (select nullif(settings_json ->> 'dues_amount', '')::int from league where id = p_league_id),
    'dues_note', (select settings_json ->> 'dues_note' from league where id = p_league_id),
    -- 0321: the trade floor. veto_votes is the EFFECTIVE bar (the stored
    -- number, or the majority it falls back to), and veto_votes_set says
    -- which of the two the console is looking at.
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_veto_votes_set', (select nullif(settings_json ->> 'trade_veto_votes', '')::int from league where id = p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', league_faab_trading(p_league_id),
    -- 0326: is this league served by the anonymous public read API?
    'public_api', coalesce(league_public_api(p_league_id), false));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
