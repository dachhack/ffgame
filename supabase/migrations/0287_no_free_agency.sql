-- 0287: FREE AGENCY CAN BE TURNED OFF (v0.400.0).
--
-- Founder: "how do i turn off free agency and just do faab waivers?"
--
-- He could not. FAAB was already a waiver_mode, and three knobs came close:
-- waiver_hold_days puts a DROPPED player on waivers for up to seven days,
-- fa_after_waivers_dow keeps the add market shut until the run has spoken, and
-- the fa_start_min/fa_end_min window narrows the hours. All three miss the
-- same case — a player who was NEVER ROSTERED has no waived_until, so the
-- moment the window opens he is free, for nothing, to whoever refreshes first.
-- And the window is a RANGE, not a switch: set_transaction_rules refuses a
-- start equal to its end, so "never" was not expressible at all. The nearest
-- thing was a one-minute window at 4am, which is a trick, not a setting.
--
-- fa_mode says it outright:
--   • open    — as today with no window set: the wire is always open;
--   • window  — as today WITH one: open only inside fa_start_min..fa_end_min;
--   • off     — there is no free agency. Every unowned player, drafted or not,
--               is a waiver claim.
--
-- WHY A MODE AND NOT A BOOLEAN. The window already encodes two of these three
-- states implicitly (a null range means always-open), so a bare `fa_off` flag
-- would leave two settings to disagree about the same question. The mode is
-- the one answer, and it DEFAULTS from the window so every league that exists
-- today keeps exactly the behaviour it has: a league with a window reads
-- 'window', one without reads 'open', and neither has to be migrated.
--
-- The gate lands in fa_window_open, which add_free_agent already consults and
-- which every other add path consults through it — the 0179 argument again:
-- one place, not a check copied into each caller. add_free_agent only gains a
-- clearer SENTENCE for the off case, because "free agency is closed — open
-- 4:00pm to 4:01pm" is the wrong thing to tell someone in a league that has
-- none.

create or replace function league_fa_mode(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(settings_json ->> 'fa_mode', ''),
    -- UNSET READS FROM THE WINDOW, so no league needs migrating: one with
    -- hours has always meant 'window', one without has always meant 'open'.
    case when nullif(settings_json ->> 'fa_start_min', '') is not null then 'window' else 'open' end)
  from league where id = p_league_id;
$$;
grant execute on function league_fa_mode(uuid) to authenticated;

-- 0127's body, with the mode in front of it.
create or replace function fa_window_open(p_league_id uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare fs int; fe int; faw jsonb; cm int; today int; nowmin int; fam text;
begin
  fam := league_fa_mode(p_league_id);
  if fam = 'off' then return false; end if;      -- 0287: no free agency at all
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         nullif(settings_json ->> 'fa_end_min', '')::int,
         settings_json -> 'fa_after_waivers_dow',
         coalesce(nullif(settings_json ->> 'waiver_clear_min', '')::int, 180)
    into fs, fe, faw, cm from league where id = p_league_id;
  if faw is not null and jsonb_typeof(faw) = 'array' and jsonb_array_length(faw) > 0 then
    today := extract(dow from now() at time zone 'America/New_York')::int;
    nowmin := et_minutes(now());
    if faw @> to_jsonb(today) and nowmin < cm then
      return false;   -- the run hasn't spoken yet — the add market stays quiet
    end if;
  end if;
  -- 'open' ignores the hours even if a stale range is still stored; the mode
  -- is the answer, and a setting that half-applies is how two knobs start
  -- disagreeing.
  if fam = 'open' or fs is null or fe is null then return true; end if;
  return is_night_minute(et_minutes(now()), fs, fe);
end $$;

drop function if exists set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean);
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null,       -- 0213: agent seats may transact
  p_fa_mode text default null                 -- 0287: open | window | off
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
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
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 1 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 1–7 days');
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
    where id = p_league_id;
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  return jsonb_build_object('ok', true,
    'fa_mode', league_fa_mode(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;

-- 0272's body, with one sentence added.
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0272: THE REFUSAL ANSWERS, IT DOES NOT THROW. A dead guillotine seat and
  -- a locked vampire wire were both enforced ONLY by the seat-guard trigger,
  -- which RAISES — so the client got a thrown error where every other refusal
  -- hands back {ok:false, error}. Same rules, said the same way as the rest.
  -- The trigger stays as the last line of defence for every other path.
  err := wire_block_reason(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  if not fa_window_open(p_league_id) then
    -- 0287: SAY WHICH CLOSED IT. "open 4:00pm to 4:01pm" is the wrong thing to
    -- tell somebody in a league that has no free agency at all, and it is the
    -- sentence that would send them looking for the window to wait for.
    if league_fa_mode(p_league_id) = 'off' then
      return jsonb_build_object('ok', false, 'error',
        'this league has no free agency — put in a waiver claim instead');
    end if;
    return jsonb_build_object('ok', false, 'error', 'free agency is closed — open '
      || fmt_et_min((select (settings_json ->> 'fa_start_min')::int from league where id = p_league_id)) || ' to '
      || fmt_et_min((select (settings_json ->> 'fa_end_min')::int from league where id = p_league_id)));
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is not null and wu > now() then
    return jsonb_build_object('ok', false, 'error', 'on waivers — submit a claim instead');
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  -- THE SEAT, NOT THE TOTAL (0199). Asked BEFORE the drop executes, with the
  -- drop discounted, so a refusal leaves the roster exactly as it was.
  err := roster_seat_error(p_league_id, p_roster_id, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = waiver_hold_until(p_league_id)
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- 0272's body, with the hold checks scoped to leagues that HAVE free agency.
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0);
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0272: THE REFUSAL ANSWERS, IT DOES NOT THROW. A dead guillotine seat and
  -- a locked vampire wire were both enforced ONLY by the seat-guard trigger,
  -- which RAISES — so the client got a thrown error where every other refusal
  -- hands back {ok:false, error}. Same rules, said the same way as the rest.
  -- The trigger stays as the last line of defence for every other path.
  err := wire_block_reason(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  mode := league_waiver_mode(p_league_id);
  if mode <> 'faab' then bid := 0;
  elsif bid < 0 or bid > member_faab(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'bid exceeds your FAAB balance of $' || member_faab(p_league_id, p_roster_id));
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  -- 0287: BOTH OF THESE ASSUME A FREE-AGENT MARKET EXISTS. They refuse a
  -- player who is not on a hold, because until now the answer was always "go
  -- and add him directly" — and with free agency OFF there is no directly. An
  -- undrafted player has never been waived, so he would have been refused by
  -- add_free_agent for having no free agency and by this for having no hold:
  -- unobtainable by any route, which is half the pool frozen. The probe that
  -- claims one is what caught it.
  --
  -- So in an 'off' league every unowned player IS the waiver market, exactly
  -- as that mode promises. Everywhere else the two checks stand unchanged.
  if league_fa_mode(p_league_id) <> 'off' then
    if wu is null then return jsonb_build_object('ok', false, 'error', 'player not in pool'); end if;
    if wu <= now() then return jsonb_build_object('ok', false, 'error', 'free agent — add directly'); end if;
  end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  -- THE SEAT, NOT THE TOTAL (0199): a won claim lands ACTIVE, so a roster with
  -- taxi/IR places still open is not thereby free to take another bench player.
  if p_drop_slug is null then
    err := roster_seat_error(p_league_id, p_roster_id, null);
    if err is not null then
      return jsonb_build_object('ok', false, 'error', err || ' — or include a drop');
    end if;
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if exists (select 1 from waiver_claim c where c.league_id = p_league_id and c.roster_id = p_roster_id
             and c.add_slug = p_add_slug and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'claim already pending');
  end if;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug, bid) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid, 'bid', bid,
    'clears_at', (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug));
end $$;

-- 0213's body, reporting the mode so a settings screen can show it.
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
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;
