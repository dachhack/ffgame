-- 0337 — one waiver schedule, Sleeper's
--
-- Founder, holding Sleeper's own settings screen up next to ours: "I think
-- we've got conflicting logic in waivers."
--
-- He was right, and the conflict was structural. "Can I add this player
-- today?" was answered by THREE independent day-pickers, in two consoles,
-- composing in an order nobody had written down:
--
--   · waiver_clear_dow       — the days the run happens
--   · fa_dow                 — the days free agency may open at all
--   · fa_after_waivers_dow   — the days adds wait for the run
--
-- Which let a commissioner build states the game cannot honour:
--
--   1. A day in `fa_after_waivers_dow` but NOT in `waiver_clear_dow`: the door
--      was held shut "until the run" and then opened at the clear time on a
--      day with no run. Sleeper's WAIVERS TO FA promises players clear waivers
--      ONCE and then become free agents; ours opened on a promise it had not
--      kept, having cleared nobody.
--   2. A day in neither: no adds, no run, claims sitting — Sleeper's LOCKED,
--      arrived at by accident from two unrelated pickers, with nothing in
--      either console saying so.
--   3. `fa_mode = 'window'` on top of both, so a "waits for the run" day with
--      a 10am window opened at 10am, not at the clear time the copy named.
--   4. And no per-day LOCKED at all: `fa_mode = 'off'` is the whole league.
--
-- SO THE THREE PICKERS BECOME ONE, with Sleeper's four values:
--
--   'fa'            — free agents all day.
--   'waivers'       — every unowned player is a claim. The run clears once.
--   'waivers_to_fa' — the run clears once, then free agents for the rest.
--   'locked'        — nothing moves: no adds, and no run.
--
-- The run days ARE the schedule now: a day clears if and only if its mode is
-- `waivers` or `waivers_to_fa`. Conflicts 1 and 2 cannot be expressed any
-- more, because the day that promises a run is the day the run happens.
--
-- WHAT EXISTING LEAGUES GET (the founder's call: "sleeper defaults"):
--   · a league that configured ANY of the old keys keeps exactly what it had,
--     derived day by day — nothing changes under anyone who made a choice;
--   · a league that never said anything gets SLEEPER'S OWN SCHEDULE: waivers
--     every day, Sunday clearing to free agency at the 3am run so the
--     morning's streamers can be had after it. That IS a change for those
--     leagues, and it is the point: unset used to read "open", which made the
--     wire a race and the FAAB budget decoration.
--
-- Plus the setting that rule needs, which we never had — Sleeper's AFTER GAMES
-- WAIVERS CLEAR, the orange line on his screenshot: a player dropped once the
-- week's games have started stays on waivers until that morning's run, rather
-- than being re-added by whoever is watching the injury feed. Default
-- Wednesday, like Sleeper's.

-- ═══ 1. the schedule ════════════════════════════════════════════════════════

-- Sunday first, matching extract(dow), matching Sleeper's own list order.
create or replace function _default_waiver_days() returns jsonb
  language sql immutable as $$
  select '["waivers_to_fa","waivers","waivers","waivers","waivers","waivers","waivers"]'::jsonb;
$$;
grant execute on function _default_waiver_days() to authenticated;

-- THE CLEAR TIME. Absent means 3:00am ET — Sleeper's overnight run, and the
-- time every other function here already coalesced to. A key PRESENT and NULL
-- is a league that deliberately turned the daily run off (set_transaction_rules
-- writes that on -1), and keeps the old rolling behaviour: each drop clears
-- its own 24 hours later.
create or replace function league_waiver_clear_min(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when settings_json ? 'waiver_clear_min'
              then nullif(settings_json ->> 'waiver_clear_min', '')::int
              else 180 end
    from league where id = p_league_id;
$$;
grant execute on function league_waiver_clear_min(uuid) to authenticated;

-- AFTER GAMES WAIVERS CLEAR. 0=Sun…6=Sat, null = none. Default Wednesday.
create or replace function league_waiver_game_hold_dow(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when settings_json ? 'waiver_game_hold_dow'
              then nullif(settings_json ->> 'waiver_game_hold_dow', '')::int
              else 3 end
    from league where id = p_league_id;
$$;
grant execute on function league_waiver_game_hold_dow(uuid) to authenticated;

-- The seven days, always. Explicit if the league has set one; else derived
-- from whichever old keys it did set; else Sleeper's.
create or replace function league_waiver_days(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare sj jsonb; wd jsonb; fam text; fad jsonb; faw jsonb; cdow jsonb;
        out_ jsonb := '[]'::jsonb; d int; fa_ok boolean; runs boolean; waits boolean;
begin
  select settings_json into sj from league where id = p_league_id;
  if sj is null then return _default_waiver_days(); end if;
  wd := sj -> 'waiver_days';
  if wd is not null and jsonb_typeof(wd) = 'array' and jsonb_array_length(wd) = 7 then
    return wd;
  end if;
  -- NOTHING SAID, SLEEPER'S ANSWER.
  if not (sj ? 'fa_mode' or sj ? 'fa_dow' or sj ? 'fa_after_waivers_dow' or sj ? 'waiver_clear_dow') then
    return _default_waiver_days();
  end if;
  -- SOMETHING SAID — keep it, day by day. `fa_mode = 'off'` is every day a
  -- waivers day; a day free agency may open is `fa`, unless it waits for the
  -- run, in which case it is exactly Sleeper's waivers_to_fa; a day free
  -- agency may NOT open is a waivers day if the run visits it and locked if
  -- it does not, which is what "no adds and no clear" already meant.
  fam := league_fa_mode(p_league_id);
  fad := sj -> 'fa_dow';
  faw := sj -> 'fa_after_waivers_dow';
  cdow := sj -> 'waiver_clear_dow';
  for d in 0..6 loop
    fa_ok := fam <> 'off'
      and (fad is null or jsonb_typeof(fad) <> 'array' or jsonb_array_length(fad) = 0
           or fad @> to_jsonb(d));
    waits := faw is not null and jsonb_typeof(faw) = 'array' and faw @> to_jsonb(d);
    runs := cdow is null or jsonb_typeof(cdow) <> 'array' or jsonb_array_length(cdow) = 0
            or cdow @> to_jsonb(d);
    out_ := out_ || to_jsonb(
      case when fa_ok and waits then 'waivers_to_fa'
           when fa_ok then 'fa'
           when runs then 'waivers'
           else 'locked' end);
  end loop;
  return out_;
end $$;
grant execute on function league_waiver_days(uuid) to authenticated;

/** The mode in force at an instant, by Eastern day-of-week. */
create or replace function league_waiver_day(p_league_id uuid, p_at timestamptz) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    league_waiver_days(p_league_id) ->> extract(dow from p_at at time zone 'America/New_York')::int,
    'waivers');
$$;
grant execute on function league_waiver_day(uuid, timestamptz) to authenticated;

/** Does the run visit this day at all?
 *
 *  A league with an EXPLICIT schedule is read by the schedule: a day clears if
 *  and only if it is `waivers` or `waivers_to_fa`. That is the rule that makes
 *  the old conflicts unsayable — the day that promises a run is the day the
 *  run happens.
 *
 *  A league that has NOT set one keeps the run days it already had, which the
 *  four modes cannot always express: `fa` means "free agents all day", and
 *  Sleeper has no free-agency day that also clears waivers, but an old league
 *  could have one — open wire all week, dropped players clearing Wednesday.
 *  Those leagues would otherwise lose the only clock their holds have. The
 *  legacy rule is the pre-0337 one exactly: the day is in `waiver_clear_dow`,
 *  or there is no `waiver_clear_dow` and the run visits every day. For a
 *  league with nothing set at all the two readings agree, because the default
 *  schedule clears every day too.
 */
create or replace function league_waiver_day_clears(p_league_id uuid, p_at timestamptz) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    -- `jsonb_typeof = 'array'`, not `is not null`: clearing the schedule writes
    -- the key with a JSON null in it, and a JSON null is not SQL NULL — so
    -- `is not null` read a CLEARED schedule as an explicit one.
    when (select jsonb_typeof(l.settings_json -> 'waiver_days') = 'array' from league l where l.id = p_league_id)
      then league_waiver_day(p_league_id, p_at) in ('waivers', 'waivers_to_fa')
    else (select jsonb_typeof(l.settings_json -> 'waiver_clear_dow') <> 'array'
                 or jsonb_array_length(l.settings_json -> 'waiver_clear_dow') = 0
                 or l.settings_json -> 'waiver_clear_dow'
                    @> to_jsonb(extract(dow from p_at at time zone 'America/New_York')::int)
            from league l where l.id = p_league_id)
  end;
$$;
grant execute on function league_waiver_day_clears(uuid, timestamptz) to authenticated;

-- ═══ 2. the door, in terms of the schedule ══════════════════════════════════
-- 0289's body and 0319's days, reduced to one question asked once. `fa_mode`
-- survives as the league-wide kill switch (0287) and as the optional hours a
-- league with a window keeps — narrowing an `fa` day, never widening one.
create or replace function fa_window_open_at(p_league_id uuid, p_at timestamptz) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare fs int; fe int; cm int; mode text; fam text;
begin
  fam := league_fa_mode(p_league_id);
  if fam = 'off' then return false; end if;      -- 0287: no free agency at all
  mode := league_waiver_day(p_league_id, p_at);
  if mode in ('locked', 'waivers') then return false; end if;
  if mode = 'waivers_to_fa' then
    -- The run has to have SPOKEN. Same clock the run itself uses, so the two
    -- can never disagree about whether today's claims have been decided.
    cm := coalesce(league_waiver_clear_min(p_league_id), 180);
    if et_minutes(p_at) < cm then return false; end if;
  end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         nullif(settings_json ->> 'fa_end_min', '')::int
    into fs, fe from league where id = p_league_id;
  if fam = 'open' or fs is null or fe is null then return true; end if;
  return is_night_minute(et_minutes(p_at), fs, fe);
end $$;
grant execute on function fa_window_open_at(uuid, timestamptz) to authenticated;

-- ═══ 3. the hold, with Sleeper's after-games rule ═══════════════════════════
-- 0319's body, reading run days off the schedule, plus the rule his screenshot
-- puts in orange: "Players stay on waivers after games until Wed 3am."
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
  -- for; with no run there is nothing for them to count.)
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
  -- injury. Null = Sleeper's NONE.
  gh := league_waiver_game_hold_dow(p_league_id);
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

-- ═══ 4. the commissioner's setter ═══════════════════════════════════════════
-- THE OLD SIGNATURE GOES. Two overloads differing only in trailing defaults
-- make every named-argument call ambiguous — "could not choose a best
-- candidate function" — which is PostgREST's every call and the probes' too.
drop function if exists set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text, int, jsonb, int);

create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null,       -- 0213: agent seats may transact
  p_fa_mode text default null,                -- 0287: open | window | off
  p_faab_min_bid int default null,            -- 0319: -1 clears (= $0)
  p_fa_dow jsonb default null,                -- 0319: days free agency may open; [] clears (= every day)
  p_trade_deadline_week int default null,     -- 0319: -1 clears (= no deadline)
  p_waiver_days jsonb default null,           -- 0337: the seven days, Sun→Sat; [] clears (= the default schedule)
  p_waiver_game_hold_dow int default null     -- 0337: -1 clears (= no after-games hold)
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_waiver_mode is not null and p_waiver_mode not in ('rolling', 'standings', 'faab') then
    return jsonb_build_object('ok', false, 'error', 'waiver mode must be rolling, standings, or faab');
  end if;
  if p_faab_budget is not null and (p_faab_budget < 1 or p_faab_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'FAAB budget must be $1–$100000');
  end if;
  if p_fa_mode is not null and p_fa_mode not in ('open', 'window', 'off') then
    return jsonb_build_object('ok', false, 'error', 'free agency must be open, window or off');
  end if;
  if p_trade_review is not null and p_trade_review not in ('none', 'commish') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none or commish');
  end if;
  if p_waiver_clear_min is not null and (p_waiver_clear_min < -1 or p_waiver_clear_min > 1439) then
    return jsonb_build_object('ok', false, 'error', 'waiver clear time must be a time of day');
  end if;
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 0 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 0–7 days');
  end if;
  if p_faab_min_bid is not null and (p_faab_min_bid < -1 or p_faab_min_bid > 100000) then
    return jsonb_build_object('ok', false, 'error', 'the minimum bid must be $0–$100000');
  end if;
  if p_trade_deadline_week is not null and (p_trade_deadline_week < -1 or p_trade_deadline_week = 0 or p_trade_deadline_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'the trade deadline is a week, 1–18');
  end if;
  if p_fa_dow is not null then
    if jsonb_typeof(p_fa_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'free-agency days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'free-agency days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  -- 0337: THE SCHEDULE. Seven entries, Sunday first, each one of the four
  -- modes — the shape Sleeper's own day list has, and the shape every gate
  -- below now reads. An empty list clears back to the default schedule.
  if p_waiver_days is not null and jsonb_array_length(p_waiver_days) > 0 then
    if jsonb_typeof(p_waiver_days) <> 'array' or jsonb_array_length(p_waiver_days) <> 7 then
      return jsonb_build_object('ok', false, 'error', 'the waiver schedule is seven days, Sunday first');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_days) loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('fa', 'waivers', 'waivers_to_fa', 'locked') then
        return jsonb_build_object('ok', false, 'error',
          'each day is fa, waivers, waivers_to_fa or locked');
      end if;
    end loop;
  end if;
  if p_waiver_game_hold_dow is not null
     and (p_waiver_game_hold_dow < -1 or p_waiver_game_hold_dow > 6) then
    return jsonb_build_object('ok', false, 'error', 'the after-games hold is a day, 0 (Sunday) through 6 (Saturday)');
  end if;
  if (p_fa_start_min is null) <> (p_fa_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'the free-agency window needs both a start and an end');
  end if;
  if p_fa_start_min is not null and p_fa_start_min <> -1 and (
       p_fa_start_min < 0 or p_fa_start_min > 1439
    or p_fa_end_min < 0 or p_fa_end_min > 1439
    or p_fa_start_min = p_fa_end_min) then
    return jsonb_build_object('ok', false, 'error', 'free-agency hours must be two different times of day');
  end if;
  if p_waiver_clear_dow is not null then
    if jsonb_typeof(p_waiver_clear_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'clear days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_clear_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'clear days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  if p_fa_after_waivers_dow is not null then
    if jsonb_typeof(p_fa_after_waivers_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_after_waivers_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_waiver_mode is not null then jsonb_build_object('waiver_mode', p_waiver_mode) else '{}'::jsonb end
      || case when p_faab_budget is not null then jsonb_build_object('faab_budget', p_faab_budget) else '{}'::jsonb end
      || case when p_trade_review is not null then jsonb_build_object('trade_review', p_trade_review) else '{}'::jsonb end
      || case when p_waiver_clear_min is null then '{}'::jsonb
              when p_waiver_clear_min = -1 then jsonb_build_object('waiver_clear_min', null)
              else jsonb_build_object('waiver_clear_min', p_waiver_clear_min) end
      || case when p_waiver_hold_days is not null then jsonb_build_object('waiver_hold_days', p_waiver_hold_days) else '{}'::jsonb end
      || case when p_fa_mode is not null then jsonb_build_object('fa_mode', p_fa_mode) else '{}'::jsonb end
      || case when p_fa_start_min is null then '{}'::jsonb
              when p_fa_start_min = -1 then jsonb_build_object('fa_start_min', null, 'fa_end_min', null)
              else jsonb_build_object('fa_start_min', p_fa_start_min, 'fa_end_min', p_fa_end_min) end
      || case when p_waiver_clear_dow is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_clear_dow) = 0 then jsonb_build_object('waiver_clear_dow', null)
              else jsonb_build_object('waiver_clear_dow', p_waiver_clear_dow) end
      || case when p_fa_after_waivers_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_after_waivers_dow) = 0 then jsonb_build_object('fa_after_waivers_dow', null)
              else jsonb_build_object('fa_after_waivers_dow', p_fa_after_waivers_dow) end
      || case when p_agent_waivers is not null then jsonb_build_object('agent_waivers', p_agent_waivers) else '{}'::jsonb end
      || case when p_faab_min_bid is null then '{}'::jsonb
              when p_faab_min_bid = -1 then jsonb_build_object('faab_min_bid', null)
              else jsonb_build_object('faab_min_bid', p_faab_min_bid) end
      || case when p_fa_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_dow) = 0 then jsonb_build_object('fa_dow', null)
              else jsonb_build_object('fa_dow', p_fa_dow) end
      || case when p_trade_deadline_week is null then '{}'::jsonb
              when p_trade_deadline_week = -1 then jsonb_build_object('trade_deadline_week', null)
              else jsonb_build_object('trade_deadline_week', p_trade_deadline_week) end
      || case when p_waiver_days is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_days) = 0 then jsonb_build_object('waiver_days', null)
              else jsonb_build_object('waiver_days', p_waiver_days) end
      || case when p_waiver_game_hold_dow is null then '{}'::jsonb
              when p_waiver_game_hold_dow = -1 then jsonb_build_object('waiver_game_hold_dow', null)
              else jsonb_build_object('waiver_game_hold_dow', p_waiver_game_hold_dow) end
    where id = p_league_id;
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  -- 0291/0292: A DEADLINE THE COMMISSIONER MOVED HAS TO MOVE — BOTH OF THEM.
  -- There are two stamps: a claim's own clears_at, and the waived_until a DROP
  -- puts on the pool row. 0291 moved the first and left the second, so the
  -- founder's league switched to 2pm Thursday while a queue of dropped players
  -- went on clearing at 4am, taking the claims behind them along. One call
  -- now, so the two can never again disagree about what day it is.
  perform _restamp_waiver_clocks(p_league_id);
  -- 0318: THE BOTS STAND DOWN WHEN TOLD TO. Turning agent waivers off stops
  -- the worker filing, but the claims it had already filed would still win
  -- at the run — the opposite of what the switch says. Cancel them; a human
  -- seat's claims are its own.
  if p_agent_waivers is false then
    update waiver_claim c set status = 'cancelled', note = 'agent waivers turned off', processed_at = now()
     where c.league_id = p_league_id and c.status = 'pending' and agent_wire_seat(p_league_id, c.roster_id);
  end if;
  -- 0318: AND WHAT THE CHANGE MADE DUE SETTLES NOW, in the same transaction
  -- as the change — opening free agency makes every claim on an unheld
  -- player due (process_waivers, this migration), and the run is the only
  -- thing that should hand him out. Idempotent; a save that made nothing
  -- due settles nothing and says nothing.
  perform process_waivers(p_league_id);
  return jsonb_build_object('ok', true,
    'fa_mode', league_fa_mode(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;

grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text, int, jsonb, int, jsonb, int) to authenticated;
-- ═══ 5. what the console and the rulebook read ══════════════════════════════
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
    -- 0319: the Sleeper parity knobs.
    'faab_min_bid', league_faab_min_bid(p_league_id),
    'fa_dow', (select settings_json -> 'fa_dow' from league where id = p_league_id),
    -- 0337: THE SCHEDULE the consoles now edit, and the two settings that ride
    -- with it. `waiver_days` is always seven entries — derived or defaulted —
    -- so a console never has to guess what an unset league is doing.
    'waiver_days', league_waiver_days(p_league_id),
    'waiver_days_set', (select jsonb_typeof(settings_json -> 'waiver_days') = 'array' from league where id = p_league_id),
    'waiver_game_hold_dow', league_waiver_game_hold_dow(p_league_id),
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