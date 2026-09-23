-- ═══════════════════════════════════════════════════════════════════════════
-- 0358 · THE LEAGUE COUNTS ITS MOVES
--
-- Item 6 of the commissioner list: transaction limits, like ESPN's "acquisition
-- limits". Three optional caps, each off until the commissioner sets it:
--   • adds per team per WEEK, where the week turns at the league's own turnover
--     (league_week_turnover, the after-games waiver run, Wed 3:00 AM ET by
--     default), so the count resets when the week does;
--   • adds per team per SEASON;
--   • trades per team per SEASON.
--
-- ── WHAT COUNTS ────────────────────────────────────────────────────────────
-- The register (league_txn) counts, so the limit and the record can't
-- disagree:
--   • an ADD is a free-agent pickup or a waiver win on the team's own line
--     ('add', 'waiver'); a commissioner's move ('commish') is not the
--     manager's, and doesn't count;
--   • a TRADE is one trade the team was part of: its rows share an instant
--     (league_txn.at is the transaction's), so distinct instants are trades;
--   • a move the commissioner undid (0354) gives its add back.
--
-- ── WHERE IT BITES ─────────────────────────────────────────────────────────
-- Adds: add_free_agent, submit_waiver_claim and process_waivers already ask
-- wire_block_reason before anything moves. Each now asks add_limit_reason
-- beside it (their bodies are otherwise exactly as they were). A claim over
-- the limit when the run reaches it is settled as a loss with the reason,
-- which is how a team with one add left and three claims in gets its best
-- one. Drops never count and are never blocked.
-- Trades: _trade_lock_reason, which every acceptance and every multi-team
-- ballot asks, so a deal is refused at the moment it would count.
-- ═══════════════════════════════════════════════════════════════════════════

-- The start of the league's current transaction week: the most recent
-- turnover (dow, minute, America/New_York) at or before now.
create or replace function league_txn_week_start(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare t jsonb := league_week_turnover(p_league_id); loc timestamp := now() at time zone 'America/New_York'; c timestamp;
begin
  c := date_trunc('day', loc)
       - make_interval(days => ((extract(dow from loc)::int - (t ->> 'dow')::int + 7) % 7))
       + make_interval(mins => (t ->> 'minute')::int);
  if c > loc then c := c - interval '7 days'; end if;
  return c at time zone 'America/New_York';
end $$;
grant execute on function league_txn_week_start(uuid) to authenticated;

create or replace function _txn_limit(p_league_id uuid, p_key text) returns int
  language sql stable security definer set search_path = public as $$
  select nullif(greatest(coalesce((settings_json ->> p_key)::int, 0), 0), 0) from league where id = p_league_id;
$$;
revoke all on function _txn_limit(uuid, text) from public, anon, authenticated;

-- What a team has used: {week, season, trades}.
create or replace function _txn_usage(p_league_id uuid, p_roster_id int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'week', (select count(*) from league_txn t where t.league_id = p_league_id and t.roster_id = p_roster_id
              and t.kind in ('add', 'waiver') and t.undone_at is null and t.undo_of is null
              and t.at >= league_txn_week_start(p_league_id)),
    'season', (select count(*) from league_txn t where t.league_id = p_league_id and t.roster_id = p_roster_id
              and t.kind in ('add', 'waiver') and t.undone_at is null and t.undo_of is null),
    'trades', (select count(distinct t.at) from league_txn t where t.league_id = p_league_id and t.kind = 'trade'
              and p_roster_id in (t.roster_id, t.from_roster) and t.undone_at is null and t.undo_of is null));
$$;
revoke all on function _txn_usage(uuid, int) from public, anon, authenticated;

-- Why this team can't add another player, or null.
create or replace function add_limit_reason(p_league_id uuid, p_roster_id int) returns text
  language plpgsql stable security definer set search_path = public as $$
declare wk int := _txn_limit(p_league_id, 'max_adds_week'); sn int := _txn_limit(p_league_id, 'max_adds_season'); u jsonb;
begin
  if wk is null and sn is null then return null; end if;
  u := _txn_usage(p_league_id, p_roster_id);
  if sn is not null and (u ->> 'season')::int >= sn then
    return 'this team has used all ' || sn || ' of its adds for the season';
  end if;
  if wk is not null and (u ->> 'week')::int >= wk then
    return 'this team has used all ' || wk || ' of its adds this week — they reset '
      || to_char(league_txn_week_start(p_league_id) at time zone 'America/New_York' + interval '7 days', 'Dy FMHH12:MI AM') || ' ET';
  end if;
  return null;
end $$;
grant execute on function add_limit_reason(uuid, int) to authenticated;

create or replace function trade_limit_reason(p_league_id uuid, p_roster_id int) returns text
  language plpgsql stable security definer set search_path = public as $$
declare tr int := _txn_limit(p_league_id, 'max_trades_season');
begin
  if tr is null then return null; end if;
  if (_txn_usage(p_league_id, p_roster_id) ->> 'trades')::int >= tr then
    return _txn_team(p_league_id, p_roster_id) || ' has made all ' || tr || ' of its trades for the season';
  end if;
  return null;
end $$;
grant execute on function trade_limit_reason(uuid, int) to authenticated;

-- Every acceptance asks this (0320); the trade limit rides with the locks.
create or replace function _trade_lock_reason(p_trade_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select team_lock_reason(t.league_id, s.seat)
       from trade_proposal t, unnest(_trade_seats(p_trade_id)) s(seat)
      where t.id = p_trade_id and team_lock_reason(t.league_id, s.seat) is not null limit 1),
    (select trade_limit_reason(t.league_id, s.seat)
       from trade_proposal t, unnest(_trade_seats(p_trade_id)) s(seat)
      where t.id = p_trade_id and trade_limit_reason(t.league_id, s.seat) is not null limit 1));
$$;

-- The limits, and (for a seat) what it has used. League members read it.
create or replace function league_txn_limits(p_league_id uuid, p_roster_id int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'max_adds_week', _txn_limit(p_league_id, 'max_adds_week'),
    'max_adds_season', _txn_limit(p_league_id, 'max_adds_season'),
    'max_trades_season', _txn_limit(p_league_id, 'max_trades_season'),
    'week_start', league_txn_week_start(p_league_id),
    'used', case when p_roster_id is not null then _txn_usage(p_league_id, p_roster_id) end);
end $$;
grant execute on function league_txn_limits(uuid, int) to authenticated;

-- 0 or null turns a limit off.
create or replace function commish_set_txn_limits(p_league_id uuid, p_adds_week int, p_adds_season int, p_trades_season int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare w int := nullif(greatest(coalesce(p_adds_week, 0), 0), 0); s int := nullif(greatest(coalesce(p_adds_season, 0), 0), 0);
        t int := nullif(greatest(coalesce(p_trades_season, 0), 0), 0); line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce(w, 0) > 50 or coalesce(s, 0) > 500 or coalesce(t, 0) > 100 then
    return jsonb_build_object('ok', false, 'error', 'a limit that high is no limit — leave it off');
  end if;
  if w is not null and s is not null and w > s then
    return jsonb_build_object('ok', false, 'error', 'the weekly limit can''t be more than the season''s');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('max_adds_week', w, 'max_adds_season', s, 'max_trades_season', t)
   where id = p_league_id;
  line := '📏 The commissioner set transaction limits: '
    || concat_ws(', ',
         coalesce(w || ' add' || case when w = 1 then '' else 's' end || ' a week', 'no weekly add limit'),
         coalesce(s || ' add' || case when s = 1 then '' else 's' end || ' a season', 'no season add limit'),
         coalesce(t || ' trade' || case when t = 1 then '' else 's' end || ' a season', 'no trade limit'));
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'txn_limits'));
  return jsonb_build_object('ok', true, 'note', line);
end $$;
grant execute on function commish_set_txn_limits(uuid, int, int, int) to authenticated;

-- ═══ the three add paths, each with add_limit_reason beside its wire check ══
CREATE OR REPLACE FUNCTION public.add_free_agent(p_league_id uuid, p_roster_id integer, p_add_slug text, p_drop_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  err := coalesce(wire_block_reason(p_league_id, p_roster_id), add_limit_reason(p_league_id, p_roster_id));  -- 0358
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
end $function$;

CREATE OR REPLACE FUNCTION public.submit_waiver_claim(p_league_id uuid, p_roster_id integer, p_add_slug text, p_drop_slug text DEFAULT NULL::text, p_bid integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  err := coalesce(wire_block_reason(p_league_id, p_roster_id), add_limit_reason(p_league_id, p_roster_id));  -- 0358
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
end $function$;

CREATE OR REPLACE FUNCTION public.process_waivers(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record; d draft%rowtype; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text; took text[]; missed text[]; dnote text; door boolean;
  st text; skipped int;   -- 0323: the group's doing
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);
  -- 0318: is the add market open this minute? Read once for the run.
  door := fa_window_open(p_league_id);

  for c in
    select wc.*, m.waiver_priority,
           case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end as standings_rank
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    left join lateral (
      -- league_standings is best-first; reverse it so 0 = the worst record
      select (jsonb_array_length(league_standings(p_league_id)) - ord)::int as rank
      from jsonb_array_elements(league_standings(p_league_id)) with ordinality s(e, ord)
      where (s.e ->> 'roster_id')::int = wc.roster_id
    ) sr on mode = 'standings'
    where wc.league_id = p_league_id and wc.status = 'pending'
      and (coalesce(wc.clears_at, lp.waived_until, now()) <= now()
           -- 0318: AN OPEN DOOR MAKES EVERY CLAIM ON AN UNHELD PLAYER DUE,
           -- whatever its stamp says. The stamp is a forecast made at
           -- filing; the commissioner opening free agency (or a window
           -- arriving, or a data fix flipping the mode) is the fact. Held
           -- players are untouched: the door cannot reach them until their
           -- hold ends, and that hold is on the run's schedule (0292).
           or (door and (lp.waived_until is null or lp.waived_until <= now())))
      -- 0336: A LINKED GROUP RUNS TOGETHER, ON ITS SLOWEST CLOCK. "One of
      -- these, in this order" is decided in one run or it is not a list:
      -- with a rolling 24h hold per drop, a fallback dropped on Monday
      -- morning came due before the first choice dropped that afternoon,
      -- landed, and marked the first choice lost five hours before its own
      -- clock. While any pending member is not yet due, none of them is.
      and not exists (
        select 1 from waiver_claim g
        join league_pool gp on gp.league_id = g.league_id and gp.slug = g.add_slug
       where g.group_id = wc.group_id and g.status = 'pending' and g.id <> wc.id
         and coalesce(g.clears_at, gp.waived_until, now()) > now()
         and not (door and (gp.waived_until is null or gp.waived_until <= now())))
    -- 0323: group_seq sits AFTER every league rule and before the filing
    -- time, so a contingency list changes nothing about who beats whom — it
    -- only decides which of a seat's OWN tied claims is tried first.
    order by case when mode = 'faab' then -wc.bid else 0 end,
             case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end,
             m.waiver_priority nulls last, wc.group_seq nulls last, wc.created_at
  loop
    dnote := null;
    -- 0323: THE CURSOR IS A SNAPSHOT. A claim this very run has already taken
    -- off the table (its group filled below) is still in the result set, so
    -- ask the row what it is now before doing anything to it. Costs one index
    -- read per claim and makes every future "settle these too" rule safe.
    select status into st from waiver_claim where id = c.id;
    if st is distinct from 'pending' then continue; end if;
    -- 0144: a commissioner flag set while the claim sat pending kills it with
    -- a clear note — the roster trigger would otherwise abort the whole sweep.
    if flag_rule_blocks(p_league_id, c.add_slug, 'no_add') is not null then
      update waiver_claim set status = 'lost', note = 'player flagged by the commissioner', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    -- 0316: A SEAT THE FORMAT HAS SHUT OUT LOSES, IT DOES NOT ABORT THE RUN.
    -- The seat guard on native_roster RAISES for a seat under the vampire's
    -- wire lock (0268), and a claim filed before the commissioner flipped
    -- the lock would hit it here — aborting the whole run, every sweep,
    -- until somebody cancelled that one claim. Ask the same question the
    -- submit asks and settle it as a loss with the reason.
    err := coalesce(wire_block_reason(p_league_id, c.roster_id), add_limit_reason(p_league_id, c.roster_id));  -- 0358
    if err is not null then
      update waiver_claim set status = 'lost', note = err, processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      -- 0316: "outbid" only when a claim in THIS run took him; a man signed
      -- off free agency while the claim sat was simply taken.
      update waiver_claim set status = 'lost',
        note = case when mode = 'faab' and exists (select 1 from waiver_claim w2
                      where w2.league_id = p_league_id and w2.add_slug = c.add_slug
                        and w2.status = 'won' and w2.processed_at = now())
                    then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    -- 0316: THE DROP IS A MEANS, NOT A CONDITION. A claim whose drop already
    -- left the roster — an earlier claim of the same seat spent him, or a
    -- trade moved him — still goes through when the seat has a place open;
    -- it loses only when it would need the drop to make room.
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      if roster_seat_error(p_league_id, c.roster_id, null) is not null then
        update waiver_claim set status = 'lost', note = 'drop player no longer on roster and the active roster is full', processed_at = now() where id = c.id;
        lost := lost + 1; continue;
      end if;
      c.drop_slug := null; dnote := 'drop had already left the roster';
    end if;
    -- 0317: A DROP WHOSE GAME HAS STARTED IS NO DROP. The claim was filed
    -- before he kicked off; the run came after. He stays (his sealed pick
    -- still scores), and the claim goes through only where it did not need
    -- him for room — the same shape as the drop that already left.
    if c.drop_slug is not null and drop_lock_reason(p_league_id, c.drop_slug) is not null then
      if roster_seat_error(p_league_id, c.roster_id, null) is not null then
        update waiver_claim set status = 'lost', note = 'drop player''s game has started and the active roster is full', processed_at = now() where id = c.id;
        lost := lost + 1; continue;
      end if;
      c.drop_slug := null; dnote := 'drop player''s game had started — kept';
    end if;
    -- THE SEAT, NOT THE TOTAL (0199): a won claim lands ACTIVE, so a roster
    -- with taxi/IR places still open is not thereby free to take another
    -- bench player.
    if c.drop_slug is null and roster_seat_error(p_league_id, c.roster_id, null) is not null then
      update waiver_claim set status = 'lost', note = 'active roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if roster_illegal_reason(p_league_id, c.roster_id) is not null then
      update waiver_claim set status = 'lost', note = 'roster over limits', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    err := pos_cap_error(p_league_id, c.roster_id, c.add_slug, false, c.drop_slug);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'position limit', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if mode = 'faab' and c.bid > member_faab(p_league_id, c.roster_id) then
      update waiver_claim set status = 'lost', note = 'insufficient FAAB', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now(),
      note = coalesce(dnote, note),
      drop_slug = c.drop_slug where id = c.id;
    if mode = 'faab' and c.bid > 0 then
      update league_membership set faab_budget = member_faab(p_league_id, c.roster_id) - c.bid
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    if mode <> 'standings' then
      update league_membership set waiver_priority =
          (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    won := won + 1; changed := true;
    -- 0323: THE CONDITION. The seat wanted ONE of these (or its own ceiling of
    -- them); it has them. The rest settle as losses with the reason, so the
    -- run's report says why they went quiet instead of leaving a manager to
    -- work out that his fallback was never going to fire.
    if c.group_id is not null and _group_is_full(c.group_id) then
      update waiver_claim set status = 'lost', processed_at = now(),
        note = 'conditional — already landed ' || _txn_player(p_league_id, c.add_slug)
       where group_id = c.group_id and status = 'pending' and id <> c.id;
      get diagnostics skipped = row_count;
      lost := lost + skipped;
    end if;
  end loop;

  -- 0290: ONE REPORT FOR THE RUN, founder: "a waiver report when it runs".
  -- Five settled claims are one thing that happened, and five chat lines would
  -- bury the league's actual conversation under the plumbing. Silence when the
  -- sweep settled nothing, which is almost every sweep — the team screen calls
  -- this every fifteen seconds to stay self-driving without a worker, and a
  -- league whose chat filled with "waivers ran, nothing happened" would be a
  -- worse feature than no feature.
  --
  -- Read back from the claims rather than accumulated in the loop above: every
  -- branch stamps processed_at = now(), now() is fixed for the transaction, so
  -- this picks up exactly the rows THIS run settled — including the seven
  -- different ways a claim can lose, none of which had to be touched.
  if won > 0 or lost > 0 then
    select array_agg(_txn_team(p_league_id, wc.roster_id) || ' won ' || _txn_player(p_league_id, wc.add_slug)
             || case when mode = 'faab' then ' ($' || wc.bid || ')' else '' end
             || case when wc.drop_slug is not null
                     then ', dropping ' || _txn_player(p_league_id, wc.drop_slug) else '' end
             order by wc.id)
      into took from waiver_claim wc
     where wc.league_id = p_league_id and wc.status = 'won' and wc.processed_at = now();
    select array_agg(_txn_team(p_league_id, wc.roster_id) || ' on ' || _txn_player(p_league_id, wc.add_slug)
             || ' (' || coalesce(nullif(wc.note, ''), 'lost') || ')' order by wc.id)
      into missed from waiver_claim wc
     where wc.league_id = p_league_id and wc.status = 'lost' and wc.processed_at = now();
    perform _chat_house(p_league_id,
      '📋 Waivers ran — ' || coalesce(array_to_string(took, '; '), 'nothing claimed')
        || case when missed is null then '' else ' · Missed: ' || array_to_string(missed, '; ') end,
      jsonb_build_object('kind', 'waiver', 'won', won, 'lost', lost));
  end if;
  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $function$;
