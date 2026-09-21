-- 0319 — FOUR SLEEPER SETTINGS (v0.435.0).
--
-- Founder, holding Sleeper's General Settings against ours: "Do we have these
-- all covered?" Four were not. "Build all four gaps."
--
--   1. MINIMUM BID.        settings_json.faab_min_bid (default 0). A FAAB claim
--                          below it is refused; the worker floors its bids.
--   2. FREE-AGENCY DAYS.   settings_json.fa_dow (0=Sun…6=Sat ET; absent = every
--                          day). Sleeper's per-day "Waivers" / "Waivers to FA":
--                          on a day outside the set every unowned player is a
--                          claim; on a day inside it the existing after-waivers
--                          gate and window hours apply. fa_window_open_at reads
--                          it, and midnight ET joins the boundaries fa_opens_at
--                          and fa_open_since walk, so a claim filed on a
--                          waivers-only day clears at LEAST(the run, the next
--                          free-agency morning) (0318) and the seat wire's
--                          first-hour courtesy starts at midnight.
--   3. TRADE DEADLINE.     settings_json.trade_deadline_week. Trades may be
--                          offered and accepted THROUGH that week; once it is
--                          final the live week moves past it and both are
--                          refused. A deal accepted in time and waiting on the
--                          commissioner may still be ruled on.
--   4. A HOLD OF NONE.     waiver_hold_days may be 0: a dropped player is a
--                          free agent at once (or, with free agency shut, a
--                          claim that clears at the next run).
--
-- set_transaction_rules grows three named parameters; the old signature is
-- dropped so PostgREST has one candidate. roster_rules reports all four (and
-- whether the deadline has passed, so a screen can say so before the offer).

-- ── readers ───────────────────────────────────────────────────────────────
create or replace function league_faab_min_bid(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'faab_min_bid', '')::int, 0) from league where id = p_league_id;
$$;
grant execute on function league_faab_min_bid(uuid) to authenticated;

create or replace function league_trade_deadline_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select nullif(settings_json ->> 'trade_deadline_week', '')::int from league where id = p_league_id;
$$;
grant execute on function league_trade_deadline_week(uuid) to authenticated;

-- Why a trade may not be struck right now, or NULL. "Through week N": the
-- deadline passes when week N goes final and the live week moves past it. No
-- schedule yet (pre-season) or nothing left to play (the offseason) is not a
-- deadline — trades are the point of both.
create or replace function trade_deadline_error(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when league_trade_deadline_week(p_league_id) is not null
               and league_live_week(p_league_id) > league_trade_deadline_week(p_league_id)
              then 'the trade deadline has passed (trades closed after week ' || league_trade_deadline_week(p_league_id) || ')'
         end;
$$;
grant execute on function trade_deadline_error(uuid) to authenticated;

-- ── fa_window_open_at: 0289's body, with the days ────────────────────────
create or replace function fa_window_open_at(p_league_id uuid, p_at timestamptz) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare fs int; fe int; faw jsonb; cm int; d int; atmin int; fam text; fad jsonb;
begin
  fam := league_fa_mode(p_league_id);
  if fam = 'off' then return false; end if;      -- 0287: no free agency at all
  -- 0319: FREE AGENCY HAS DAYS. Sleeper's per-day schedule — "Waivers" on a
  -- day means every unowned player is a claim that day, "Waivers to FA" means
  -- the add market opens once the run has spoken. A day not in the set is a
  -- waivers-only day; absent or empty = every day, so nothing changes for a
  -- league that never sets it. Checked before the after-waivers gate, which
  -- then governs the days that ARE in the set.
  select settings_json -> 'fa_dow' into fad from league where id = p_league_id;
  if fad is not null and jsonb_typeof(fad) = 'array' and jsonb_array_length(fad) > 0
     and not fad @> to_jsonb(extract(dow from p_at at time zone 'America/New_York')::int) then
    return false;
  end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         nullif(settings_json ->> 'fa_end_min', '')::int,
         settings_json -> 'fa_after_waivers_dow',
         coalesce(nullif(settings_json ->> 'waiver_clear_min', '')::int, 180)
    into fs, fe, faw, cm from league where id = p_league_id;
  if faw is not null and jsonb_typeof(faw) = 'array' and jsonb_array_length(faw) > 0 then
    d := extract(dow from p_at at time zone 'America/New_York')::int;
    atmin := et_minutes(p_at);
    if faw @> to_jsonb(d) and atmin < cm then
      return false;   -- the run hasn't spoken yet — the add market stays quiet
    end if;
  end if;
  if fam = 'open' or fs is null or fe is null then return true; end if;
  return is_night_minute(et_minutes(p_at), fs, fe);
end $$;

grant execute on function fa_window_open_at(uuid, timestamptz) to authenticated;

-- ── fa_opens_at: 0289's body, midnight as a boundary ─────────────────────
create or replace function fa_opens_at(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare fs int; cm int; day_local timestamp; best timestamptz;
begin
  if league_fa_mode(p_league_id) = 'off' then return null; end if;
  if fa_window_open_at(p_league_id, now()) then return now(); end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         coalesce(nullif(settings_json ->> 'waiver_clear_min', '')::int, 180)
    into fs, cm from league where id = p_league_id;
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  select min(c.t) into best from (
    select (day_local + make_interval(days => i, mins => m)) at time zone 'America/New_York' as t
    -- 0319: a free-agency DAY starts at midnight ET, so 0 joins the boundaries.
    from generate_series(0, 10) i, unnest(array[fs, cm, 0]) m
    where m is not null
  ) c where c.t > now() and fa_window_open_at(p_league_id, c.t);
  return best;
end $$;

grant execute on function fa_opens_at(uuid) to authenticated;

-- ── fa_open_since: 0309's body, midnight as a boundary ───────────────────
create or replace function fa_open_since(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare fs int; cm int; day_local timestamp; best timestamptz;
begin
  if not fa_window_open_at(p_league_id, now()) then return null; end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         coalesce(nullif(settings_json ->> 'waiver_clear_min', '')::int, 180)
    into fs, cm from league where id = p_league_id;
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  -- The latest boundary at which the door swung open: open at t, shut the
  -- minute before. Local wall minutes converted through the zone, so a DST
  -- weekend moves with the clocks, exactly as 0289 and 0291 do it.
  select max(c.t) into best from (
    select (day_local + make_interval(days => i, mins => m)) at time zone 'America/New_York' as t
    -- 0319: a free-agency DAY starts at midnight ET, so 0 joins the boundaries.
    from generate_series(-2, 0) i, unnest(array[fs, cm, 0]) m
    where m is not null
  ) c
  where c.t <= now()
    and fa_window_open_at(p_league_id, c.t)
    and not fa_window_open_at(p_league_id, c.t - interval '1 minute');
  return coalesce(best, now() - interval '2 days');
end $$;

grant execute on function fa_open_since(uuid) to authenticated;

-- ── waiver_hold_until: 0126's body, a hold of none ───────────────────────
create or replace function waiver_hold_until(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare cm int; hd int; dow jsonb; day_local timestamp; t timestamptz; base timestamptz; i int;
begin
  select nullif(settings_json ->> 'waiver_clear_min', '')::int,
         coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1),
         settings_json -> 'waiver_clear_dow'
    into cm, hd, dow from league where id = p_league_id;
  -- 0319: A HOLD OF NONE. Sleeper's "time players are on waivers after drop:
  -- none" — a dropped player is a free agent the moment he is dropped (or,
  -- with free agency shut, a claim that clears at the next run rather than a
  -- day later). Zero is stored as zero; only an unset hold reads as one day.
  if hd = 0 then return now(); end if;
  if dow is not null and jsonb_typeof(dow) = 'array' and jsonb_array_length(dow) > 0 then
    cm := coalesce(cm, 180);   -- days without a time = 3:00am ET, the Sleeper overnight run
    base := now() + make_interval(days => greatest(1, hd) - 1);
    day_local := date_trunc('day', base at time zone 'America/New_York');
    for i in 0..8 loop
      t := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
      if t > base and dow @> to_jsonb(extract(dow from t at time zone 'America/New_York')::int) then
        return t;
      end if;
    end loop;
    -- unreachable with any non-empty day set; belt and braces
    return base + interval '24 hours';
  end if;
  if cm is null then return now() + interval '24 hours'; end if;
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  t := (day_local + make_interval(mins => cm)) at time zone 'America/New_York';
  if t <= now() then
    t := (day_local + interval '1 day' + make_interval(mins => cm)) at time zone 'America/New_York';
  end if;
  return t + make_interval(days => greatest(1, hd) - 1);
end $$;


-- ── submit_waiver_claim: 0318's body, the minimum bid ────────────────────
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0); cl timestamptz;
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
  -- 0319: THE MINIMUM BID. Sleeper's floor; $0 claims exist only where the
  -- commissioner leaves it at zero. The worker's seat wire floors its own
  -- bids to the same number before it files.
  elsif bid < league_faab_min_bid(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the minimum bid is $' || league_faab_min_bid(p_league_id));
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  -- 0288: the test is whether free agency can reach him RIGHT NOW, not whether
  -- the league has free agency at all. When it can, an unheld player is an add
  -- rather than a claim, and says so.
  if fa_window_open(p_league_id) and (wu is null or wu <= now()) then
    return jsonb_build_object('ok', false, 'error', 'free agent — add him directly');
  end if;
  -- 0291: AND THIS IS WHERE IT CLEARS — the league's own waiver run, which is
  -- what "waivers clear at 2pm Thursday" has always meant everywhere else.
  -- 0289 used the free-agency door instead and left the waiver setting inert. Past this point free agency is shut, so
  -- a player with no live hold is one 0288 admitted, and he has no pool-row
  -- clock to inherit — process_waivers would settle him on its next sweep,
  -- fifteen seconds from now, uncontested. He clears when the door he is
  -- locked behind opens; in a league where it never opens, on the league's own
  -- waiver run, which is the only clock that mode has.
  if wu is null or wu <= now() then
    cl := claim_clears_at(p_league_id);
    -- 0318: THE DOOR IS A CLOCK TOO. He is unheld, so the moment free agency
    -- can reach him anyone may add him outright — a claim still waiting for
    -- a later run would be sniped at the door. Whichever comes first: the
    -- run (0291), or the door (0289). LEAST skips a null, so a league with
    -- no free agency keeps the run alone.
    cl := least(cl, fa_opens_at(p_league_id));
    -- 0316: ONE CLOCK PER PLAYER. In a league with no run time and no free
    -- agency each claim used to clear on its own 24-hour hold — so the first
    -- claim on a player settled alone, before a later, higher bid was due,
    -- and timing beat money. A claim on a player who already has a pending
    -- claim with a clock clears with the EARLIEST of them, so every claim on
    -- him competes in one run. With a league run time all claims already
    -- share it, and this changes nothing.
    select least(cl, min(c2.clears_at)) into cl from waiver_claim c2
      where c2.league_id = p_league_id and c2.add_slug = p_add_slug
        and c2.status = 'pending' and c2.clears_at is not null;
  end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  -- 0317: a man whose game has started cannot be named as the drop, even for
  -- a claim that will not clear until after the week — he is locked, the
  -- way Sleeper locks him. Name somebody else, or claim into an open seat.
  if p_drop_slug is not null then
    err := drop_lock_reason(p_league_id, p_drop_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
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
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid, clears_at)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug, bid, cl) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid, 'bid', bid,
    'clears_at', coalesce(cl, (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug)));
end $$;

grant execute on function submit_waiver_claim(uuid, int, text, text, int) to authenticated;

-- ── propose_trade: 0219's body, the deadline ─────────────────────────────
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null,
  p_retain jsonb default null, p_cap_dollars int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text; el jsonb;
        rt jsonb := '[]'::jsonb; rslug text; ramt int; rtr int; c contract%rowtype; already int;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  -- 0319: THE TRADE DEADLINE. Asked at the offer and again at the acceptance
  -- (respond_trade); a deal already accepted and waiting on the commissioner
  -- was struck in time and may still be ruled on.
  err := trade_deadline_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  begin
    gp := _clean_trade_picks(p_league_id, p_give_picks);
    tp := _clean_trade_picks(p_league_id, p_get_picks);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  -- The commissioner's switch, checked once for both halves.
  if (jsonb_array_length(gp) > 0 or jsonb_array_length(tp) > 0)
     and not league_pick_trading(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
  end if;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(gp) > 10 or jsonb_array_length(tp) > 10
     or (jsonb_array_length(p_give) + jsonb_array_length(p_get)
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1 and coalesce(p_cap_dollars, 0) = 0) then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players or picks each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
  end if;
  if (select count(distinct value) from jsonb_array_elements(gp || tp))
     <> jsonb_array_length(gp) + jsonb_array_length(tp) then
    return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only offer your own players');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only ask for their players');
  end if;
  err := _pick_ownership_error(p_league_id, p_from_roster, gp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only offer picks you own — ' || err); end if;
  err := _pick_ownership_error(p_league_id, p_to_roster, tp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only ask for picks they own — ' || err); end if;
  -- MID-DRAFT: a pick already used is a player now, and the pick on the clock
  -- is being spent as we speak. Neither is a thing to put in an offer.
  for el in select * from jsonb_array_elements(gp || tp) loop
    err := _pick_locked_error(p_league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;
  -- Salary retention (0219): the sender eats part of a traded deal. Each term
  -- names a player IN the trade; the retainer is whichever side holds him now.
  if p_retain is not null and jsonb_array_length(coalesce(p_retain, '[]'::jsonb)) > 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'salary retention needs a contract league');
    end if;
    if not salary_retention_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has salary retention turned off');
    end if;
    for el in select * from jsonb_array_elements(p_retain) loop
      rslug := el ->> 'slug'; ramt := coalesce((el ->> 'amount')::int, 0);
      if p_give ? rslug then rtr := p_from_roster;
      elsif p_get ? rslug then rtr := p_to_roster;
      else return jsonb_build_object('ok', false, 'error', 'retention only applies to players in this trade');
      end if;
      select * into c from contract where league_id = p_league_id and slug = rslug;
      if not found then return jsonb_build_object('ok', false, 'error', 'no contract to retain on ' || rslug); end if;
      select coalesce(sum(amount), 0) into already from salary_retention
        where league_id = p_league_id and slug = rslug;
      if ramt < 1 or already + ramt > c.salary - 1 then
        return jsonb_build_object('ok', false, 'error',
          'retention on ' || rslug || ' must be $1–$' || (c.salary - 1 - already) || ' — the receiver pays at least $1');
      end if;
      rt := rt || jsonb_build_object('slug', rslug, 'amount', ramt, 'roster', rtr);
    end loop;
  end if;
  -- Raw cap-space trading (0219): dollars as an asset. Positive = the proposer
  -- sends cap room; negative asks for it. Behind the commissioner's switch.
  if coalesce(p_cap_dollars, 0) <> 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'cap-space trading needs a contract league');
    end if;
    if not cap_trading_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has cap-space trading turned off');
    end if;
    if abs(p_cap_dollars) > 100000 then
      return jsonb_build_object('ok', false, 'error', 'cap dollars must be within $100000');
    end if;
  end if;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by, retain, cap_dollars)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
            case when jsonb_array_length(rt) > 0 then rt else null end, nullif(coalesce(p_cap_dollars, 0), 0))
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;

grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb, jsonb, int) to authenticated;

-- ── respond_trade: 0072's body, the deadline ─────────────────────────────
create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb; err text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;   -- re-read under the lock
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  -- 0319: an offer made before the deadline cannot be accepted after it.
  err := trade_deadline_error(t.league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if league_trade_review(t.league_id) = 'commish' then
    update trade_proposal set status = 'accepted', responded_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'awaiting', 'commissioner approval');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;   -- stays pending, error surfaced
  update trade_proposal set responded_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;

grant execute on function respond_trade(uuid, boolean) to authenticated;

-- ── add_free_agent: 0318's body, a shut door says when it opens ──────────
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
    -- 0319: SAY WHEN IT OPENS. The old sentence quoted the window's hours,
    -- and a league shut by its DAYS (or an open league behind the
    -- after-waivers gate) has no hours — the client got an error with no
    -- text. The next opening is one answer for every reason the door is
    -- shut; the hours are implied by it.
    return jsonb_build_object('ok', false, 'error', 'free agency is closed — '
      || coalesce('opens ' || to_char(fa_opens_at(p_league_id) at time zone 'America/New_York', 'Dy FMHH12:MI AM') || ' ET',
                  'put in a claim for the next run'));
  end if;
  -- 0289: DUE CLAIMS SETTLE BEFORE THE DOOR DOES. A claim on a player free
  -- agency could not reach clears the moment it can (fa_opens_at), and the
  -- sweep that settles it runs from the team screen — every fifteen seconds,
  -- but not necessarily in the same second the window opens. A screen that was
  -- already open renders a live ADD on stale state, and without this the first
  -- person to click it beats a claim that was due before they arrived, which
  -- is exactly the sniping the closed window exists to prevent. We hold the
  -- same advisory lock process_waivers takes, so settling here is ordered, not
  -- racing; the 'already rostered' check below then reports the honest result.
  -- 0318: not only the DUE claims — ANY pending claim on him. We are past
  -- fa_window_open, so if he is unheld the run below treats every claim on
  -- him as due (the door is open); if he is held, the 'on waivers' refusal
  -- below answers and the run settles nothing. Either way the claims that
  -- were filed behind a shut door get him before the first hand at the open one.
  if exists (select 1 from waiver_claim wc
              where wc.league_id = p_league_id and wc.add_slug = p_add_slug and wc.status = 'pending') then
    perform process_waivers(p_league_id);
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
  -- 0317: THE DROP MAY NOT HAVE KICKED OFF. Asked here rather than left to
  -- the classic trigger so a drip league is held to the same rule and an
  -- agent seat (the worker, exempt from the trigger) cannot cut a man mid-game.
  if p_drop_slug is not null then
    err := drop_lock_reason(p_league_id, p_drop_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;
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
  -- 0290: ONE LINE FOR ONE MOVE. An add that carries a drop is a single
  -- decision and reads as one; the row trigger behind the register sees two
  -- and cannot know they belong together.
  perform _chat_house(p_league_id,
    '🟢 ' || _txn_team(p_league_id, p_roster_id) || ' added ' || _txn_player(p_league_id, p_add_slug)
      || case when p_drop_slug is null then ''
              else ' · dropped ' || _txn_player(p_league_id, p_drop_slug) end,
    jsonb_build_object('kind', 'add', 'roster_id', p_roster_id,
                       'add', p_add_slug, 'drop', p_drop_slug));
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function add_free_agent(uuid, int, text, text) to authenticated;

-- ── set_transaction_rules: 0318's body, three more knobs ─────────────────
drop function if exists set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text);
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
  p_trade_deadline_week int default null      -- 0319: -1 clears (= no deadline)
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

grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text, int, jsonb, int) to authenticated;

-- ── roster_rules: 0307's body, reporting them ────────────────────────────
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
    'trade_deadline_week', league_trade_deadline_week(p_league_id),
    'trade_deadline_passed', trade_deadline_error(p_league_id) is not null);
end $$;

grant execute on function roster_rules(uuid) to authenticated;
