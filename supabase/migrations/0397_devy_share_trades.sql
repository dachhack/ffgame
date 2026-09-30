-- ═══════════════════════════════════════════════════════════════════════════
-- 0397 · DEVY SHARES TRADE — AND ROUNDS 4–7 PAY 2.
--
-- Founder: "Let's do the tweak and get trading in."
--
-- THE TWEAK. The replay's one optional tune: a round 4–7 graduate pays 2 a
-- share (was 3), which trims the free lottery a pile of price-1 stakes had
-- (every drafted one paid the full 3× cap) without touching the scout.
--
-- TRADING. Shares and devy cash are two more things a trade LEG can send,
-- beside players, picks, FAAB and cap (0322), each addressed to a seat:
--   send_shares:    [{"slug": "c-4688380", "shares": 5, "to": 3}]
--   send_devy_cash: [{"amount": 12.5, "to": 3}]
-- A deal that moves either is filed through propose_multi_trade even with two
-- teams, so a share trade gets the same clock, commissioner ruling and league
-- vote as any trade (the replay's advice: let the league catch collusion).
--   · Shares trade any time the league plays them — INCLUDING the Jan 15
--     lock, when trading is the only way they move — except during a live
--     draft, and not once the player has turned pro (his stake settles at
--     the draft). Only the lineage's current season trades them.
--   · A traded share carries its cost with it (the 3× cap rides along). A
--     WHOLE stake keeps its place in line for the right; part of a maxed
--     stake starts a new place for whoever receives it.
--   · At execution everything is re-read: the stake still held, the cash
--     still there, no stake past 20 shares, no cash past 200.
-- Bodies copied from 0322 (propose_multi_trade, _execute_multi_trade,
-- _trade_summary) and 0336 (league_trades) with only the marked changes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _devy_share_rules() returns jsonb
  language sql immutable as $$
  select '{"budget": 100, "max": 20, "max_spend": 60, "floor": 5, "min_spend": 15, "cash_cap": 200,
           "payout_cap": 3, "refund": 0.5, "quiet_days": 7,
           "round_price": {"1": 8, "2": 6, "3": 5, "4": 2, "5": 2, "6": 2, "7": 2}}'::jsonb
$$;

alter table trade_leg add column if not exists send_shares jsonb not null default '[]'::jsonb;
alter table trade_leg add column if not exists send_devy_cash jsonb not null default '[]'::jsonb;

-- Move k shares of one stake between seats, cost basis and all.
create or replace function _devy_move_shares(p_lineage text, p_from int, p_to int, p_slug text, p_k int)
  returns void language plpgsql security definer set search_path = public as $$
declare s devy_share%rowtype; r devy_share%rowtype; part numeric; whole boolean; nsh int; ncost numeric;
begin
  select * into s from devy_share where lineage = p_lineage and roster_id = p_from and slug = p_slug for update;
  if not found or s.shares < p_k then raise exception 'devy shares moved — re-propose'; end if;
  whole := p_k = s.shares;
  part := case when whole then s.cost else round(s.cost * p_k / s.shares, 2) end;
  if whole then
    delete from devy_share where lineage = p_lineage and roster_id = p_from and slug = p_slug;
  else
    update devy_share set shares = s.shares - p_k, cost = s.cost - part,
           maxed_at = case when _devy_maxed(s.shares - p_k, s.cost - part) then maxed_at end,
           qual_at = case when _devy_qualified(s.shares - p_k, s.cost - part) then qual_at end,
           updated_at = now()
     where lineage = p_lineage and roster_id = p_from and slug = p_slug;
  end if;
  select * into r from devy_share where lineage = p_lineage and roster_id = p_to and slug = p_slug for update;
  if not found then
    insert into devy_share (lineage, roster_id, slug, shares, cost, maxed_at, qual_at, created_at, updated_at)
    values (p_lineage, p_to, p_slug, p_k, part,
            case when _devy_maxed(p_k, part) then case when whole then coalesce(s.maxed_at, clock_timestamp()) else clock_timestamp() end end,
            case when _devy_qualified(p_k, part) then case when whole then coalesce(s.qual_at, clock_timestamp()) else clock_timestamp() end end,
            now(), now());
  else
    nsh := r.shares + p_k; ncost := r.cost + part;
    update devy_share set shares = nsh, cost = ncost,
           maxed_at = case when _devy_maxed(nsh, ncost) then
                        coalesce(least(r.maxed_at, case when whole then s.maxed_at end), r.maxed_at,
                                 case when whole then s.maxed_at end, clock_timestamp()) end,
           qual_at = case when _devy_qualified(nsh, ncost) then
                        coalesce(least(r.qual_at, case when whole then s.qual_at end), r.qual_at,
                                 case when whole then s.qual_at end, clock_timestamp()) end,
           updated_at = now()
     where lineage = p_lineage and roster_id = p_to and slug = p_slug;
  end if;
end $$;
revoke all on function _devy_move_shares(text, int, int, text, int) from public, anon, authenticated;

create or replace function propose_multi_trade(
  p_league_id uuid, p_legs jsonb, p_note text default null, p_expires_hours int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; leg jsonb; el jsonb; err text; exp timestamptz;
        seats int[] := '{}'; touched int[] := '{}'; mine int; rid int; dest int;
        slugs text[] := '{}'; pkeys text[] := '{}'; amt int; legsum int;
        assets int := 0; cleaned jsonb; second_seat int;
        has_devy boolean; lin text; held int; cash_sum numeric; camt numeric; skeys text[] := '{}';
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  -- 0397: DEVY SHARES travel on legs, so a two-team deal that moves shares
  -- or devy cash is filed here too (the two-seat offer knows nothing of them).
  has_devy := exists (select 1 from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb)) l
                       where jsonb_array_length(coalesce(l -> 'send_shares', '[]'::jsonb)) > 0
                          or jsonb_array_length(coalesce(l -> 'send_devy_cash', '[]'::jsonb)) > 0);
  if p_legs is null or jsonb_typeof(p_legs) <> 'array'
     or jsonb_array_length(p_legs) < (case when has_devy then 2 else 3 end) or jsonb_array_length(p_legs) > 8 then
    return jsonb_build_object('ok', false, 'error', 'a multi-team trade has 3–8 teams (two teams is an ordinary offer)');
  end if;
  if has_devy then
    if not _devy_shares_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'this league doesn''t play devy shares');
    end if;
    if not _devy_is_current(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'that''s last season''s league — trade shares in the current season');
    end if;
    if d.status = 'live' then
      return jsonb_build_object('ok', false, 'error', 'devy shares don''t trade during the draft');
    end if;
    lin := _lineage(p_league_id);
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  -- THE SEATS, first: every later check needs to know who is in the room.
  for leg in select * from jsonb_array_elements(p_legs) loop
    begin rid := (leg ->> 'roster')::int; exception when others then rid := null; end;
    if rid is null then return jsonb_build_object('ok', false, 'error', 'each leg names a team'); end if;
    if rid = any (seats) then return jsonb_build_object('ok', false, 'error', 'a team can only appear once'); end if;
    if not exists (select 1 from league_membership m where m.league_id = p_league_id
                    and m.sleeper_roster_id = rid and m.enrolled) then
      return jsonb_build_object('ok', false, 'error', 'Team ' || rid || ' is not in this league');
    end if;
    seats := seats || rid;
  end loop;
  -- The proposer is one of them. An admin files on the first seat's behalf.
  mine := null;
  foreach rid in array seats loop
    if owns_roster(p_league_id, rid) then mine := rid; exit; end if;
  end loop;
  if mine is null then
    if is_admin() then mine := seats[1];
    else return jsonb_build_object('ok', false, 'error', 'not your seat — you must be in the trade to offer it'); end if;
  end if;
  err := trade_deadline_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  foreach rid in array seats loop
    err := team_lock_reason(p_league_id, rid);
    if err is not null then
      return jsonb_build_object('ok', false, 'error', _txn_team(p_league_id, rid) || ': ' || err);
    end if;
  end loop;

  -- THE ASSETS, leg by leg.
  for leg in select * from jsonb_array_elements(p_legs) loop
    rid := (leg ->> 'roster')::int;
    if jsonb_typeof(coalesce(leg -> 'retain', '[]'::jsonb)) = 'array'
       and jsonb_array_length(coalesce(leg -> 'retain', '[]'::jsonb)) > 0 then
      return jsonb_build_object('ok', false, 'error',
        'salary retention is a two-team term — leave it off a multi-team trade');
    end if;
    -- players
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; exception when others then dest := null; end;
      if dest is null or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'every player must be sent to another team in the trade');
      end if;
      if not exists (select 1 from native_roster nr where nr.league_id = p_league_id
                      and nr.roster_id = rid and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, rid) || ' does not hold ' || coalesce(el ->> 'slug', '—'));
      end if;
      if (el ->> 'slug') = any (slugs) then
        return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
      end if;
      slugs := slugs || (el ->> 'slug'); touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- picks: cleaned one at a time so each keeps its own destination
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_picks', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; exception when others then dest := null; end;
      if dest is null or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'every pick must be sent to another team in the trade');
      end if;
      if not league_pick_trading(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
      end if;
      begin cleaned := _clean_trade_picks(p_league_id, jsonb_build_array(el)) -> 0;
      exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
      err := _pick_ownership_error(p_league_id, rid, jsonb_build_array(cleaned));
      if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
      err := _pick_locked_error(p_league_id, cleaned ->> 'season', (cleaned ->> 'round')::int, (cleaned ->> 'orig')::int);
      if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
      if ((cleaned ->> 'season') || '/' || (cleaned ->> 'round') || '/' || (cleaned ->> 'orig')) = any (pkeys) then
        return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
      end if;
      pkeys := pkeys || ((cleaned ->> 'season') || '/' || (cleaned ->> 'round') || '/' || (cleaned ->> 'orig'));
      touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- FAAB dollars
    legsum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_faab', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'FAAB must be a positive amount sent to another team in the trade');
      end if;
      if league_waiver_mode(p_league_id) <> 'faab' then
        return jsonb_build_object('ok', false, 'error', 'FAAB dollars only move in a FAAB league');
      end if;
      if not league_faab_trading(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has FAAB trading turned off');
      end if;
      legsum := legsum + amt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if legsum > 0 and legsum > member_faab(p_league_id, rid) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' has $' || member_faab(p_league_id, rid) || ' of FAAB left');
    end if;
    -- cap dollars
    legsum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_cap', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'cap room must be a positive amount sent to another team in the trade');
      end if;
      if not contracts_on(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'cap-space trading needs a contract league');
      end if;
      if not cap_trading_on(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has cap-space trading turned off');
      end if;
      legsum := legsum + amt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if legsum > 100000 then
      return jsonb_build_object('ok', false, 'error', 'cap dollars must be within $100000');
    end if;
    -- 0397: devy shares — a number of one stake, each to another seat
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_shares', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'shares')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'shares must be a positive number sent to another team in the trade');
      end if;
      if coalesce(el ->> 'slug', '') !~ '^c-[0-9]+$' then
        return jsonb_build_object('ok', false, 'error', 'shares are in college players');
      end if;
      if exists (select 1 from player_alias a where a.old_slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error', 'shares in a player who turned pro settle at the draft — they don''t trade');
      end if;
      if (rid || ':' || (el ->> 'slug')) = any (skeys) then
        return jsonb_build_object('ok', false, 'error', 'a stake can only appear once per team');
      end if;
      select shares into held from devy_share where lineage = lin and roster_id = rid and slug = el ->> 'slug';
      if coalesce(held, 0) < amt then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, rid) || ' holds ' || coalesce(held, 0) || ' shares of ' || coalesce((select full_name from college_player where espn_id = substr(el ->> 'slug', 3)), el ->> 'slug'));
      end if;
      skeys := skeys || (rid || ':' || (el ->> 'slug'));
      touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- 0397: devy cash
    cash_sum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_devy_cash', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; camt := round((el ->> 'amount')::numeric, 2); exception when others then dest := null; end;
      if dest is null or camt is null or camt <= 0 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'devy cash must be a positive amount sent to another team in the trade');
      end if;
      cash_sum := cash_sum + camt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if cash_sum > 0 and cash_sum > _devy_cash(lin, rid) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' has ' || trim(to_char(_devy_cash(lin, rid), 'FM999990.##')) || ' devy cash');
    end if;
  end loop;
  if assets < 1 then
    return jsonb_build_object('ok', false, 'error', 'a trade moves something');
  end if;
  -- A seat nobody sends to and that sends nothing is in the room for nothing.
  foreach rid in array seats loop
    if not (rid = any (touched)) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' neither sends nor receives anything');
    end if;
  end loop;

  if p_expires_hours is not null and p_expires_hours <> -1
     and (p_expires_hours < 1 or p_expires_hours > 720) then
    return jsonb_build_object('ok', false, 'error', 'an offer expires in 1–720 hours');
  end if;
  exp := case when p_expires_hours = -1 then null
              when p_expires_hours is not null then now() + make_interval(hours => p_expires_hours)
              when league_trade_offer_days(p_league_id) > 0
                then now() + make_interval(days => league_trade_offer_days(p_league_id))
         end;
  -- The legacy pair: the proposer, and the next seat along (see the header).
  select min(s) into second_seat from unnest(seats) s where s <> mine;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, note, created_by, expires_at)
    values (p_league_id, mine, second_seat, '[]'::jsonb, '[]'::jsonb,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), exp)
    returning id into tid;
  for leg in select * from jsonb_array_elements(p_legs) loop
    rid := (leg ->> 'roster')::int;
    cleaned := '[]'::jsonb;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_picks', '[]'::jsonb)) loop
      cleaned := cleaned || jsonb_build_array(
        (_clean_trade_picks(p_league_id, jsonb_build_array(el)) -> 0)
          || jsonb_build_object('to', (el ->> 'to')::int));
    end loop;
    insert into trade_leg (trade_id, league_id, roster_id, send, send_picks, send_faab, send_cap, send_shares, send_devy_cash, accepted, accepted_at)
      values (tid, p_league_id, rid,
              coalesce(leg -> 'send', '[]'::jsonb), cleaned,
              coalesce(leg -> 'send_faab', '[]'::jsonb), coalesce(leg -> 'send_cap', '[]'::jsonb),
              -- 0397
              coalesce((select jsonb_agg(jsonb_build_object('slug', e ->> 'slug', 'shares', (e ->> 'shares')::int, 'to', (e ->> 'to')::int))
                          from jsonb_array_elements(coalesce(leg -> 'send_shares', '[]'::jsonb)) e), '[]'::jsonb),
              coalesce((select jsonb_agg(jsonb_build_object('amount', round((e ->> 'amount')::numeric, 2), 'to', (e ->> 'to')::int))
                          from jsonb_array_elements(coalesce(leg -> 'send_devy_cash', '[]'::jsonb)) e), '[]'::jsonb),
              rid = mine, case when rid = mine then now() end);
  end loop;
  return jsonb_build_object('ok', true, 'trade_id', tid, 'teams', array_length(seats, 1), 'expires_at', exp);
end $$;
grant execute on function propose_multi_trade(uuid, jsonb, text, int) to authenticated;

create or replace function _trade_summary(p_trade_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select string_agg(line, ' · ' order by roster_id)
  from (
    select l.roster_id,
      _txn_team(l.league_id, l.roster_id) || ' sends '
      || coalesce(
           nullif(concat_ws(', ',
             nullif((select string_agg(_txn_player(l.league_id, e ->> 'slug') || ' → ' || _txn_team(l.league_id, (e ->> 'to')::int), ', ')
                       from jsonb_array_elements(l.send) e), ''),
             case when jsonb_array_length(l.send_picks) > 0
                  then jsonb_array_length(l.send_picks) || ' pick' || case when jsonb_array_length(l.send_picks) = 1 then '' else 's' end end,
             case when jsonb_array_length(l.send_faab) > 0
                  then '$' || (select sum((e ->> 'amount')::int) from jsonb_array_elements(l.send_faab) e) || ' FAAB' end,
             case when jsonb_array_length(l.send_cap) > 0
                  then '$' || (select sum((e ->> 'amount')::int) from jsonb_array_elements(l.send_cap) e) || ' cap' end,
             -- 0397
             nullif((select string_agg((e ->> 'shares') || ' shares of '
                       || coalesce((select full_name from college_player where espn_id = substr(e ->> 'slug', 3)), e ->> 'slug')
                       || ' → ' || _txn_team(l.league_id, (e ->> 'to')::int), ', ')
                       from jsonb_array_elements(l.send_shares) e), ''),
             case when jsonb_array_length(l.send_devy_cash) > 0
                  then trim(to_char((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(l.send_devy_cash) e), 'FM999990.##')) || ' devy cash' end
           ), ''), 'nothing') as line
    from trade_leg l where l.trade_id = p_trade_id
  ) s;
$$;

create or replace function _execute_multi_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; lseas text; err text;
        leg record; el jsonb; seats int[]; seat int; dest int; amt int;
        v_out jsonb; v_in jsonb; ov int; knd text; owner int;
        lin text; held int; incash numeric; outcash numeric; recv int; camt numeric;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  seats := _trade_seats(p_trade_id);

  -- 1. IS EVERY PIECE STILL WHERE THE DEAL SAID IT WAS? A multi-team offer
  --    can sit through a waiver run and a week of drops like any other.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send) loop
      if not exists (select 1 from native_roster nr where nr.league_id = t.league_id
                      and nr.roster_id = leg.roster_id and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
      end if;
    end loop;
    if _pick_ownership_error(t.league_id, leg.roster_id, leg.send_picks) is not null then
      return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
    end if;
    for el in select * from jsonb_array_elements(leg.send_picks) loop
      err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
      if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
    end loop;
    -- the wallet, re-read at execution the way 0321 re-reads a two-seat one
    if jsonb_array_length(leg.send_faab) > 0 then
      select sum((e ->> 'amount')::int) into amt from jsonb_array_elements(leg.send_faab) e;
      if amt > member_faab(t.league_id, leg.roster_id) then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, leg.roster_id) || ' no longer has $' || amt || ' of FAAB — re-propose');
      end if;
    end if;
  end loop;

  -- 1b. 0397: DEVY SHARES AND CASH, re-read at execution.
  if exists (select 1 from trade_leg where trade_id = p_trade_id
              and (jsonb_array_length(send_shares) > 0 or jsonb_array_length(send_devy_cash) > 0)) then
    if not _devy_shares_on(t.league_id) then
      return jsonb_build_object('ok', false, 'error', 'the league isn''t playing devy shares any more — re-propose');
    end if;
    if exists (select 1 from draft where league_id = t.league_id and status = 'live') then
      return jsonb_build_object('ok', false, 'error', 'devy shares don''t trade during the draft — accept it after');
    end if;
    lin := _lineage(t.league_id);
    perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send_shares) loop
        select shares into held from devy_share where lineage = lin and roster_id = leg.roster_id and slug = el ->> 'slug';
        if coalesce(held, 0) < (el ->> 'shares')::int then
          return jsonb_build_object('ok', false, 'error', 'devy shares moved since the deal was struck — re-propose');
        end if;
        if exists (select 1 from player_alias a where a.old_slug = el ->> 'slug') then
          return jsonb_build_object('ok', false, 'error', 'a player in the deal turned pro — his shares settle at the draft');
        end if;
      end loop;
    end loop;
    -- every receiving stake stays within 20 shares; every seat's cash within 200 and above 0
    for recv, el in select (e ->> 'to')::int, e from trade_leg l, jsonb_array_elements(l.send_shares) e where l.trade_id = p_trade_id loop
      if coalesce((select shares from devy_share where lineage = lin and roster_id = recv and slug = el ->> 'slug'), 0)
         + (select coalesce(sum((x ->> 'shares')::int), 0) from trade_leg l2, jsonb_array_elements(l2.send_shares) x
             where l2.trade_id = p_trade_id and (x ->> 'to')::int = recv and x ->> 'slug' = el ->> 'slug')
         > (_devy_share_rules() ->> 'max')::int then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, recv) || ' would hold more than ' || (_devy_share_rules() ->> 'max') || ' shares of one player');
      end if;
    end loop;
    foreach seat in array seats loop
      select coalesce(sum((e ->> 'amount')::numeric), 0) into outcash from trade_leg l, jsonb_array_elements(l.send_devy_cash) e
       where l.trade_id = p_trade_id and l.roster_id = seat;
      select coalesce(sum((e ->> 'amount')::numeric), 0) into incash from trade_leg l, jsonb_array_elements(l.send_devy_cash) e
       where l.trade_id = p_trade_id and (e ->> 'to')::int = seat;
      if outcash > _devy_cash(lin, seat) then
        return jsonb_build_object('ok', false, 'error', _txn_team(t.league_id, seat) || ' no longer has that devy cash — re-propose');
      end if;
      if incash > 0 and _devy_cash(lin, seat) - outcash + incash > (_devy_share_rules() ->> 'cash_cap')::numeric then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, seat) || ' would pass ' || (_devy_share_rules() ->> 'cash_cap') || ' devy cash');
      end if;
    end loop;
  end if;

  -- 2. EVERY seat has to land legal, not just the two ends of a swap.
  foreach seat in array seats loop
    select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_out
      from trade_leg l, jsonb_array_elements(l.send) e
     where l.trade_id = p_trade_id and l.roster_id = seat;
    select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_in
      from trade_leg l, jsonb_array_elements(l.send) e
     where l.trade_id = p_trade_id and (e ->> 'to')::int = seat;
    err := trade_cap_error(t.league_id, seat, v_out, v_in);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;

  -- 3. THE MOVES. Players first, each to the seat its own line named.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send) loop
      update native_roster nr set roster_id = (el ->> 'to')::int, acquired = 'trade'
        where nr.league_id = t.league_id and nr.roster_id = leg.roster_id and nr.slug = el ->> 'slug';
    end loop;
    for el in select * from jsonb_array_elements(leg.send_picks) loop
      update pick_asset set owner_roster = (el ->> 'to')::int
        where league_id = t.league_id and season = el ->> 'season'
          and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
    end loop;
  end loop;

  -- Keep the running draft's own copy of ownership in step (0190).
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select e from trade_leg l, jsonb_array_elements(l.send_picks) e where l.trade_id = p_trade_id loop
      if (el ->> 'season') = lseas then
        select kind, owner_roster into knd, owner from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text], to_jsonb(owner));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  -- 4. THE DOLLARS, addressed like everything else.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send_faab) loop
      dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
      update league_membership set faab_budget = member_faab(t.league_id, leg.roster_id) - amt
        where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      update league_membership set faab_budget = member_faab(t.league_id, dest) + amt
        where league_id = t.league_id and sleeper_roster_id = dest;
      insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
      values (t.league_id, 'faab', dest, '', leg.roster_id, '$' || amt || ' of FAAB traded');
    end loop;
    for el in select * from jsonb_array_elements(leg.send_cap) loop
      dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
      update league_membership set cap_adjust = cap_adjust - amt
        where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      update league_membership set cap_adjust = cap_adjust + amt
        where league_id = t.league_id and sleeper_roster_id = dest;
      insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
      values (t.league_id, 'cap', dest, '', leg.roster_id, '$' || amt || ' of cap room traded');
    end loop;
  end loop;
  -- 4b. 0397: the shares (with their cost, and a whole stake's place in line) and the devy cash.
  if lin is not null then
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send_shares) loop
        perform _devy_move_shares(lin, leg.roster_id, (el ->> 'to')::int, el ->> 'slug', (el ->> 'shares')::int);
      end loop;
      for el in select * from jsonb_array_elements(leg.send_devy_cash) loop
        camt := (el ->> 'amount')::numeric;
        perform _devy_cash_add(lin, leg.roster_id, -camt);
        perform _devy_cash_add(lin, (el ->> 'to')::int, camt);
      end loop;
    end loop;
  end if;
  if contracts_on(t.league_id) then
    foreach seat in array seats loop
      if team_payroll(t.league_id, seat) > team_cap(t.league_id, seat) then
        raise exception 'salary cap exceeded — team % at $% of $%', seat,
          team_payroll(t.league_id, seat), team_cap(t.league_id, seat);
      end if;
    end loop;
  end if;

  perform _chat_house(t.league_id,
    '🤝 ' || array_length(seats, 1) || '-team trade — ' || coalesce(_trade_summary(p_trade_id), ''),
    jsonb_build_object('kind', 'trade', 'multi', true, 'trade_id', p_trade_id,
                       'seats', to_jsonb(seats)));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true, 'teams', array_length(seats, 1));
end $$;
revoke all on function _execute_multi_trade(uuid) from public, anon, authenticated;

create or replace function league_trades(p_league_id uuid, p_limit int default 30)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare need int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  need := league_trade_veto_votes(p_league_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'from_roster', t.from_roster, 'to_roster', t.to_roster,
      'give', t.give, 'get', t.get,
      'give_picks', t.give_picks, 'get_picks', t.get_picks,
      'retain', t.retain, 'cap_dollars', t.cap_dollars,
      'faab_dollars', t.faab_dollars,
      'status', t.status, 'note', t.note,
      'created_at', t.created_at, 'resolved_at', t.resolved_at,
      'expires_at', t.expires_at, 'review_until', t.review_until,
      'counters', t.counters,
      'veto_need', least(need, greatest(_trade_electorate(t.id), 1)),   -- 0336: never above the room
      'votes', coalesce((select jsonb_agg(jsonb_build_object('roster_id', v.roster_id, 'veto', v.veto)
                                  order by v.created_at)
                           from trade_vote v where v.trade_id = t.id), '[]'::jsonb),
      -- 0322: the legs of a multi-team deal, each with its own acceptance.
      -- Absent (null) on an ordinary two-seat offer, which is how a screen
      -- tells the two shapes apart.
      'legs', (select jsonb_agg(jsonb_build_object(
                 'roster_id', l.roster_id, 'send', l.send, 'send_picks', l.send_picks,
                 'send_faab', l.send_faab, 'send_cap', l.send_cap,
                 -- 0397: shares, with the college player's name for the screen
                 'send_shares', coalesce((select jsonb_agg(e || jsonb_build_object('name',
                     (select full_name from college_player where espn_id = substr(e ->> 'slug', 3))))
                     from jsonb_array_elements(l.send_shares) e), '[]'::jsonb),
                 'send_devy_cash', l.send_devy_cash,
                 'accepted', l.accepted)
                 order by l.roster_id)
                 from trade_leg l where l.trade_id = t.id))
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;
grant execute on function league_trades(uuid, int) to authenticated;

-- ── devy_shares_state — 0396's, plus the league's teams ──
create or replace function devy_shares_state(p_league_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lin as (select _lineage(p_league_id) as l),
  rights as (select * from devy_share_rights((select l from lin))),
  held as (
    select s.slug, jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'shares', s.shares, 'maxed_at', s.maxed_at,
             'cost', s.cost, 'value', _devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost),
             'maxed', _devy_maxed(s.shares, s.cost), 'qualified', _devy_qualified(s.shares, s.cost),
             'team', coalesce(m.team_name, 'Team ' || s.roster_id)) order by s.shares desc, s.maxed_at nulls last, s.roster_id) as holders
      from devy_share s
      left join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = s.roster_id
     where s.lineage = (select l from lin)
     group by s.slug),
  teams as (
    select m.sleeper_roster_id as roster_id,
           _devy_cash((select l from lin), m.sleeper_roster_id) as cash,
           coalesce((select sum(s.shares) from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as shares,
           coalesce((select sum(_devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost))
                       from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as value
      from league_membership m where m.league_id = p_league_id)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then jsonb_build_object('ok', false, 'error', 'forbidden')
    else jsonb_build_object('ok', true,
      'on', _devy_shares_on(p_league_id),
      'current', _devy_is_current(p_league_id),
      'locked', _devy_shares_locked(p_league_id),
      'lock_at', devy_shares_lock_at(),
      'frozen', _college_prices_frozen(),
      'rules', _devy_share_rules(),
      -- 0397: every seat, for the share-trade screen
      'teams', coalesce((select jsonb_agg(jsonb_build_object('roster_id', m.sleeper_roster_id,
                 'team', coalesce(m.team_name, 'Team ' || m.sleeper_roster_id)) order by m.sleeper_roster_id)
                 from league_membership m where m.league_id = p_league_id), '[]'::jsonb),
      'start_cash', coalesce((select nullif(settings_json ->> 'devy_start_cash', '')::numeric from league where id = p_league_id), 100),
      'used', coalesce((select jsonb_object_agg(t.roster_id::text, t.shares) from teams t), '{}'::jsonb),
      'cash', coalesce((select jsonb_object_agg(t.roster_id::text, t.cash) from teams t), '{}'::jsonb),
      'value', coalesce((select jsonb_object_agg(t.roster_id::text, t.value) from teams t), '{}'::jsonb),
      'prices_as_of', (select max(as_of) from college_price),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'slug', h.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr, 'class_year', cp.class_year,
          'active', coalesce(cp.active, false),
          'graduated_to', (select a.new_slug from player_alias a where a.old_slug = h.slug),
          'price', _devy_price((select l from lin), h.slug),
          'rank', (select p.rank from college_price p where p.espn_id = substr(h.slug, 3)),
          'holders', h.holders,
          'right', (select jsonb_build_object('roster_id', r.roster_id, 'via', r.via) from rights r where r.slug = h.slug))
          order by cp.full_name)
        from held h left join college_player cp on cp.espn_id = substr(h.slug, 3)), '[]'::jsonb),
      'reserved', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'roster_id', r.roster_id, 'college_slug', r.college_slug))
        from devy_reserved(p_league_id) r), '[]'::jsonb))
  end
$$;
