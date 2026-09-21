-- 0322: THE THREE-TEAM TRADE — the fifth item on the gap list's trade row, and
-- the last of it. Fleaflicker calls its version unlimited; Sleeper, MFL,
-- Fantrax and RSO all have one. Drip's trades have been two seats since 0072.
--
-- THE SHAPE. A multi-team deal is a trade_proposal with LEGS: one row per seat
-- in it, each naming what that seat sends and — per asset — where it goes.
-- Assets address a destination rather than a counterparty, which is what makes
-- a three-way work: A's receiver goes to B, B's back goes to C, C's pick goes
-- to A, and no pair of seats has a trade between them at all.
--
--   trade_leg(trade_id, roster_id, send, send_picks, send_faab, send_cap,
--             accepted)
--
-- The proposer's leg is accepted when it is filed; every OTHER seat answers
-- with the same respond_trade every two-seat offer uses, which now dispatches
-- on whether the trade has legs. The deal moves nothing until the LAST seat
-- says yes, and any seat declining kills the whole thing — a partial
-- three-way is not a trade, it is two teams holding an IOU.
--
-- Everything 0321 built applies unchanged: the offer's clock, the commissioner's
-- ruling, and the league vote (whose electorate is now every seat that is not
-- in the deal, however many that is).
--
-- NOT HERE, deliberately: counters (a counter to a three-way is a new
-- three-way, and a mirrored auto-counter of N seats means nothing), and
-- salary retention, whose terms name a player and the seat that keeps eating
-- him — that is a two-seat sentence and gets refused with a reason rather
-- than a half-implementation. Cap dollars and FAAB DO travel, addressed the
-- same way the players are.
--
-- The two roster columns on the proposal keep a legacy reading for anything
-- that has not learned about legs: from_roster is the proposer, to_roster the
-- next seat in. The legs are the truth; `give`/`get` stay empty on a
-- multi-team row, and every 0322-aware reader branches on `legs`.

-- ═══ 1. the legs ═════════════════════════════════════════════════════════════
create table if not exists trade_leg (
  trade_id    uuid not null references trade_proposal(id) on delete cascade,
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  -- [{"slug": "josh-allen", "to": 3}] — every asset names its destination.
  send        jsonb not null default '[]'::jsonb,
  -- [{"season": "2027", "round": 1, "orig": 2, "to": 3}]
  send_picks  jsonb not null default '[]'::jsonb,
  -- [{"to": 3, "amount": 25}] — FAAB and cap dollars, addressed the same way.
  send_faab   jsonb not null default '[]'::jsonb,
  send_cap    jsonb not null default '[]'::jsonb,
  accepted    boolean not null default false,
  accepted_at timestamptz,
  primary key (trade_id, roster_id)
);
create index if not exists trade_leg_league on trade_leg(league_id, roster_id);
alter table trade_leg enable row level security;
drop policy if exists trade_leg_read on trade_leg;
create policy trade_leg_read on trade_leg for select using (is_league_member(league_id));

-- Is this a multi-team deal, and who is in it? Every generalised check below
-- asks these two rather than reading from_roster/to_roster.
create or replace function _trade_is_multi(p_trade_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from trade_leg where trade_id = p_trade_id);
$$;
create or replace function _trade_seats(p_trade_id uuid) returns int[]
  language sql stable security definer set search_path = public as $$
  select case when _trade_is_multi(p_trade_id)
              then (select array_agg(roster_id order by roster_id) from trade_leg where trade_id = p_trade_id)
              else (select array[from_roster, to_roster] from trade_proposal where id = p_trade_id) end;
$$;
grant execute on function _trade_is_multi(uuid) to authenticated;
grant execute on function _trade_seats(uuid) to authenticated;

-- Why this trade may not move right now because a seat is locked (0320), or
-- NULL. Asked of EVERY seat, which is the whole point of having this.
create or replace function _trade_lock_reason(p_trade_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select team_lock_reason(t.league_id, s.seat)
  from trade_proposal t, unnest(_trade_seats(p_trade_id)) s(seat)
  where t.id = p_trade_id and team_lock_reason(t.league_id, s.seat) is not null
  limit 1;
$$;
grant execute on function _trade_lock_reason(uuid) to authenticated;

-- ── _trade_electorate: 0321's body, counting legs ────────────────────────
-- Every enrolled seat that is not IN the trade — two seats out of it in a
-- two-team deal, three or more in a multi.
create or replace function _trade_electorate(p_trade_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from league_membership m
   join trade_proposal t on t.league_id = m.league_id
   where t.id = p_trade_id and m.enrolled
     and not (m.sleeper_roster_id = any (_trade_seats(p_trade_id)));
$$;
grant execute on function _trade_electorate(uuid) to authenticated;

-- ═══ 2. the offer ════════════════════════════════════════════════════════════
-- p_legs: [{"roster": 1,
--           "send":       [{"slug": "x", "to": 2}],
--           "send_picks": [{"season": "2027", "round": 1, "orig": 1, "to": 3}],
--           "send_faab":  [{"to": 2, "amount": 25}],
--           "send_cap":   [{"to": 2, "amount": 10}]}, …]
-- Everything propose_trade checks, checked per leg — and two things it cannot
-- have: every asset's destination must be another seat IN the deal, and every
-- seat must be touched by it (a team that neither sends nor receives is in the
-- room for nothing).
create or replace function propose_multi_trade(
  p_league_id uuid, p_legs jsonb, p_note text default null, p_expires_hours int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; leg jsonb; el jsonb; err text; exp timestamptz;
        seats int[] := '{}'; touched int[] := '{}'; mine int; rid int; dest int;
        slugs text[] := '{}'; pkeys text[] := '{}'; amt int; legsum int;
        assets int := 0; cleaned jsonb; second_seat int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if p_legs is null or jsonb_typeof(p_legs) <> 'array'
     or jsonb_array_length(p_legs) < 3 or jsonb_array_length(p_legs) > 8 then
    return jsonb_build_object('ok', false, 'error', 'a multi-team trade has 3–8 teams (two teams is an ordinary offer)');
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
    insert into trade_leg (trade_id, league_id, roster_id, send, send_picks, send_faab, send_cap, accepted, accepted_at)
      values (tid, p_league_id, rid,
              coalesce(leg -> 'send', '[]'::jsonb), cleaned,
              coalesce(leg -> 'send_faab', '[]'::jsonb), coalesce(leg -> 'send_cap', '[]'::jsonb),
              rid = mine, case when rid = mine then now() end);
  end loop;
  return jsonb_build_object('ok', true, 'trade_id', tid, 'teams', array_length(seats, 1), 'expires_at', exp);
end $$;
grant execute on function propose_multi_trade(uuid, jsonb, text, int) to authenticated;

-- ═══ 3. reading it back in a sentence ════════════════════════════════════════
-- "A sends Josh Allen to B · B sends CMC to C · C sends a 2027 R1 to A" —
-- chat's version of a deal with no two sides. Picks and dollars are counted
-- the way 0290 counts them; the register has the full terms.
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
                  then '$' || (select sum((e ->> 'amount')::int) from jsonb_array_elements(l.send_cap) e) || ' cap' end
           ), ''), 'nothing') as line
    from trade_leg l where l.trade_id = p_trade_id
  ) s;
$$;
grant execute on function _trade_summary(uuid) to authenticated;

-- ═══ 4. execution, with no two sides ═════════════════════════════════════════
create or replace function _execute_multi_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; lseas text; err text;
        leg record; el jsonb; seats int[]; seat int; dest int; amt int;
        v_out jsonb; v_in jsonb; ov int; knd text; owner int;
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

-- ═══ 5. one acceptance path for both shapes ══════════════════════════════════
-- "A and B" / "A, B and C" — the deal's teams, for a sentence.
create or replace function _trade_teams_text(p_trade_id uuid) returns text
  language plpgsql stable security definer set search_path = public as $$
declare names text[]; lid uuid;
begin
  select league_id into lid from trade_proposal where id = p_trade_id;
  select array_agg(_txn_team(lid, s) order by s) into names from unnest(_trade_seats(p_trade_id)) s;
  if names is null then return ''; end if;
  if array_length(names, 1) = 1 then return names[1]; end if;
  return array_to_string(names[1:array_length(names, 1) - 1], ', ') || ' and ' || names[array_length(names, 1)];
end $$;
grant execute on function _trade_teams_text(uuid) to authenticated;

-- What happens once EVERY seat has said yes: the deadline and the locks once
-- more, then the league's review mode decides — the commissioner's desk, the
-- floor, or straight through. Shared by both shapes so a three-team deal can
-- never take a different route from a two-team one.
create or replace function _trade_route_accepted(p_trade_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; err text; mode text; until timestamptz; need int; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  err := trade_deadline_error(t.league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := _trade_lock_reason(p_trade_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  mode := league_trade_review(t.league_id);
  if mode = 'commish' then
    update trade_proposal set status = 'accepted', responded_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'awaiting', 'commissioner approval');
  end if;
  if mode = 'league' and _trade_electorate(p_trade_id) > 0 then
    until := now() + make_interval(hours => league_trade_review_hours(t.league_id));
    need := league_trade_veto_votes(t.league_id);
    update trade_proposal set status = 'review', responded_at = now(), review_until = until where id = p_trade_id;
    perform _chat_house(t.league_id,
      '🗳 Trade to the floor — ' || _trade_teams_text(p_trade_id) || ' have a deal. ' || need
        || ' veto' || case when need = 1 then '' else 's' end || ' block'
        || case when need = 1 then 's' else '' end || ' it; the vote closes in '
        || league_trade_review_hours(t.league_id) || 'h.',
      jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id,
                         'seats', to_jsonb(_trade_seats(p_trade_id)), 'need', need));
    return jsonb_build_object('ok', true, 'status', 'review', 'awaiting', 'the league vote',
                              'review_until', until, 'veto_votes', need);
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;   -- stays pending, error surfaced
  update trade_proposal set responded_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;
revoke all on function _trade_route_accepted(uuid) from public, anon, authenticated;

-- One seat's answer to a multi-team offer. Nothing moves until the LAST seat
-- says yes; anyone in it saying no kills the whole deal, because a three-way
-- minus one team is not a smaller trade, it is no trade.
create or replace function _respond_multi_trade(p_trade_id uuid, p_accept boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; rid int; seat int; waiting text[];
begin
  select * into t from trade_proposal where id = p_trade_id;
  rid := null;
  foreach seat in array _trade_seats(p_trade_id) loop
    if owns_roster(t.league_id, seat) then rid := seat; exit; end if;
  end loop;
  if rid is null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  if t.expires_at is not null and t.expires_at <= now() then
    update trade_proposal set status = 'expired', resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', false, 'error', 'this offer expired');
  end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  update trade_leg set accepted = true, accepted_at = now()
   where trade_id = p_trade_id and roster_id = coalesce(rid, roster_id);
  select array_agg(_txn_team(t.league_id, roster_id) order by roster_id) into waiting
    from trade_leg where trade_id = p_trade_id and not accepted;
  if waiting is not null then
    return jsonb_build_object('ok', true, 'status', 'pending', 'awaiting', array_to_string(waiting, ', '),
                              'waiting_on', to_jsonb(waiting));
  end if;
  return _trade_route_accepted(p_trade_id);
end $$;
revoke all on function _respond_multi_trade(uuid, boolean) from public, anon, authenticated;

-- ── respond_trade: 0321's body, dispatching on the shape ─────────────────
create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  -- 0322: a multi-team deal collects one answer per seat; the routing after
  -- the last of them is the same for both shapes (_trade_route_accepted).
  if _trade_is_multi(p_trade_id) then return _respond_multi_trade(p_trade_id, p_accept); end if;
  select * into t from trade_proposal where id = p_trade_id;   -- re-read under the lock
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  -- 0321: an offer that ran out is marked here, so the list says what happened
  -- the moment somebody tries to take it.
  if t.expires_at is not null and t.expires_at <= now() then
    update trade_proposal set status = 'expired', resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', false, 'error', 'this offer expired');
  end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  return _trade_route_accepted(p_trade_id);
end $$;
grant execute on function respond_trade(uuid, boolean) to authenticated;


-- ═══ 6. the old executor learns to step aside ════════════════════════════════
-- 0321's body with one branch at the top. Re-emitted rather than wrapped: the
-- dispatch has to happen before the first give/get read, and every caller
-- (respond_trade, the commissioner's ruling, the vote's settle, the sweep)
-- goes through this one name.
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
        sender int; taker int;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  -- 0322: a deal with legs has no two sides to swap — everything below reads
  -- give/get, so the multi-team executor takes it from here.
  if _trade_is_multi(p_trade_id) then return _execute_multi_trade(p_trade_id); end if;
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  if _pick_ownership_error(t.league_id, t.from_roster, t.give_picks) is not null
     or _pick_ownership_error(t.league_id, t.to_roster, t.get_picks) is not null then
    return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
  end if;
  -- Re-checked at EXECUTE, not just at propose: an offer made three picks ago
  -- can be accepted after the clock has passed the very pick it moves.
  for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
    err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
  end loop;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  for el in select * from jsonb_array_elements(t.give_picks) loop
    update pick_asset set owner_roster = t.to_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  for el in select * from jsonb_array_elements(t.get_picks) loop
    update pick_asset set owner_roster = t.from_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;

  -- Keep the running draft's own copy in step.
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
      if (el ->> 'season') = lseas then
        select kind into knd from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text],
            to_jsonb((select owner_roster from pick_asset where league_id = t.league_id
                      and season = el ->> 'season' and round = (el ->> 'round')::int
                      and original_roster = (el ->> 'orig')::int)));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  -- Retention lands as ghost lines on the retainer's books (0219).
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into salary_retention (league_id, slug, roster_id, amount)
      values (t.league_id, el ->> 'slug', (el ->> 'roster')::int, (el ->> 'amount')::int)
      on conflict (league_id, slug, roster_id) do update
        set amount = salary_retention.amount + excluded.amount;
  end loop;
  -- Cap dollars move like a pick (0219). Judged immediately below, so a pure
  -- cash deal cannot slip past the contract trigger (which only watches
  -- contract rows).
  if coalesce(t.cap_dollars, 0) <> 0 then
    update league_membership set cap_adjust = cap_adjust - t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.from_roster;
    update league_membership set cap_adjust = cap_adjust + t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.to_roster;
  end if;
  -- FAAB dollars (0321). The budget is re-checked HERE, not just at the offer:
  -- a review window is a day long and a waiver run inside it can spend the
  -- money twice over. A wallet that went short refuses the trade rather than
  -- handing out dollars nobody has.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    taker  := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
    if abs(t.faab_dollars) > member_faab(t.league_id, sender) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(t.league_id, sender) || ' no longer has $' || abs(t.faab_dollars)
          || ' of FAAB — re-propose');
    end if;
    update league_membership set faab_budget = member_faab(t.league_id, sender) - abs(t.faab_dollars)
      where league_id = t.league_id and sleeper_roster_id = sender;
    update league_membership set faab_budget = member_faab(t.league_id, taker) + abs(t.faab_dollars)
      where league_id = t.league_id and sleeper_roster_id = taker;
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (t.league_id, 'faab', taker, '', sender,
            '$' || abs(t.faab_dollars) || ' of FAAB traded');
  end if;
  if contracts_on(t.league_id) then
    if team_payroll(t.league_id, t.from_roster) > team_cap(t.league_id, t.from_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.from_roster,
        team_payroll(t.league_id, t.from_roster), team_cap(t.league_id, t.from_roster);
    end if;
    if team_payroll(t.league_id, t.to_roster) > team_cap(t.league_id, t.to_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.to_roster,
        team_payroll(t.league_id, t.to_roster), team_cap(t.league_id, t.to_roster);
    end if;
  end if;
  -- the register keeps the money terms (0222): who eats what, and cap moved
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (t.league_id, 'retained', (el ->> 'roster')::int, el ->> 'slug',
            '$' || (el ->> 'amount') || ' retained in trade');
  end loop;
  if coalesce(t.cap_dollars, 0) <> 0 then
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (t.league_id, 'cap',
            case when t.cap_dollars > 0 then t.to_roster else t.from_roster end, '',
            case when t.cap_dollars > 0 then t.from_roster else t.to_roster end,
            '$' || abs(t.cap_dollars) || ' of cap room traded');
  end if;
  -- 0290, founder: "a trade report when it happens". One sentence for a deal
  -- that is four roster updates, two pick sweeps and a cap adjustment
  -- underneath. Picks and cash are counted rather than listed — the register
  -- has the full terms, and chat wants the news.
  perform _chat_house(t.league_id,
    '🤝 Trade — ' || _txn_team(t.league_id, t.from_roster)
      || ' sends ' || _txn_players(t.league_id, t.give)
      || ' to ' || _txn_team(t.league_id, t.to_roster)
      || ' for ' || _txn_players(t.league_id, t.get)
      || case when jsonb_array_length(coalesce(t.give_picks, '[]'::jsonb))
                 + jsonb_array_length(coalesce(t.get_picks, '[]'::jsonb)) > 0
              then ' · picks included' else '' end
      || case when coalesce(t.cap_dollars, 0) <> 0
              then ' · $' || abs(t.cap_dollars) || ' cap' else '' end
      || case when coalesce(t.faab_dollars, 0) <> 0
              then ' · $' || abs(t.faab_dollars) || ' FAAB' else '' end,
    jsonb_build_object('kind', 'trade', 'from_roster', t.from_roster, 'to_roster', t.to_roster,
                       'give', t.give, 'get', t.get));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;
grant execute on function execute_trade(uuid) to authenticated;

-- ═══ 7. the floor, with more than two seats out of it ════════════════════════
-- cast_trade_vote: 0321's body, asking the legs who is in the deal.
create or replace function cast_trade_vote(p_trade_id uuid, p_veto boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; rid int; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  select sleeper_roster_id into rid from league_membership
   where league_id = t.league_id and app_user_id = auth.uid() and enrolled
   order by sleeper_roster_id limit 1;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you have no seat in this league'); end if;
  if rid = any (_trade_seats(p_trade_id)) then
    return jsonb_build_object('ok', false, 'error', 'a team in the trade does not vote on it');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if t.status <> 'review' then return jsonb_build_object('ok', false, 'error', 'this trade is not out for a vote'); end if;
  if t.review_until is not null and t.review_until <= now() then
    return jsonb_build_object('ok', false, 'error', 'the vote has closed');
  end if;
  insert into trade_vote (trade_id, league_id, roster_id, veto)
    values (p_trade_id, t.league_id, rid, coalesce(p_veto, false))
    on conflict (trade_id, roster_id) do update set veto = excluded.veto, created_at = now();
  r := _settle_trade_review(p_trade_id);
  return jsonb_build_object('ok', true, 'veto', coalesce(p_veto, false)) || coalesce(r - 'ok', '{}'::jsonb);
end $$;
grant execute on function cast_trade_vote(uuid, boolean) to authenticated;

-- _settle_trade_review: 0321's body, with every seat's lock asked and the
-- ruling line naming however many teams are in the deal.
create or replace function _settle_trade_review(p_trade_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; need int; vetoes int; cast_ int; seats int; r jsonb; err text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found or t.status <> 'review' then
    return jsonb_build_object('ok', true, 'status', coalesce(t.status, 'gone'));
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  need := league_trade_veto_votes(t.league_id);
  select count(*) filter (where veto), count(*) into vetoes, cast_ from trade_vote where trade_id = p_trade_id;
  seats := _trade_electorate(p_trade_id);
  if vetoes >= need then
    update trade_proposal set status = 'vetoed', resolved_at = now() where id = p_trade_id;
    perform _chat_house(t.league_id,
      '🗳 Trade vetoed by the league — ' || vetoes || ' of ' || seats || ' voted it down ('
        || _trade_teams_text(p_trade_id) || ').',
      jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'vetoed', true,
                         'vetoes', vetoes, 'need', need));
    return jsonb_build_object('ok', true, 'status', 'vetoed', 'vetoes', vetoes, 'need', need);
  end if;
  -- Not yet: the window is open AND enough unvoted seats remain to still reach
  -- the bar. Either failing settles it now — a vote whose outcome is
  -- arithmetic has already happened.
  if now() < coalesce(t.review_until, now()) and (seats - cast_) + vetoes >= need then
    return jsonb_build_object('ok', true, 'status', 'review', 'vetoes', vetoes, 'need', need,
                              'voted', cast_, 'seats', seats);
  end if;
  -- 0320's locks, asked again here and of EVERY seat: a commissioner who locks
  -- a team while the vote runs has shut its roster moves, and this is one.
  err := _trade_lock_reason(p_trade_id);
  r := coalesce(case when err is not null then jsonb_build_object('ok', false, 'error', err) end,
                execute_trade(p_trade_id));
  if not coalesce((r ->> 'ok')::boolean, false) then
    -- The deal no longer applies (a player moved, a cap broke). Leave it while
    -- the window is open — the managers can still re-propose — and close it
    -- once the clock is past, rather than retrying forever every sweep.
    if now() >= coalesce(t.review_until, now()) then
      update trade_proposal set status = 'expired', resolved_at = now() where id = p_trade_id;
      perform _chat_house(t.league_id,
        '🗳 Trade could not be completed — ' || coalesce(r ->> 'error', 'the rosters moved') || '.',
        jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'failed', true));
    end if;
    return r;
  end if;
  return jsonb_build_object('ok', true, 'status', 'executed', 'vetoes', vetoes, 'need', need);
end $$;
revoke all on function _settle_trade_review(uuid) from public, anon, authenticated;

-- ═══ 8. what the screens read ════════════════════════════════════════════════
-- league_trades v5: 0321's row, plus the legs and who has said yes so far.
-- `give`/`get` stay empty on a multi-team row — a client that has not learned
-- about legs shows the status and the note rather than a wrong sentence.
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
      'veto_need', need,
      'votes', coalesce((select jsonb_agg(jsonb_build_object('roster_id', v.roster_id, 'veto', v.veto)
                                  order by v.created_at)
                           from trade_vote v where v.trade_id = t.id), '[]'::jsonb),
      -- 0322: the legs of a multi-team deal, each with its own acceptance.
      -- Absent (null) on an ordinary two-seat offer, which is how a screen
      -- tells the two shapes apart.
      'legs', (select jsonb_agg(jsonb_build_object(
                 'roster_id', l.roster_id, 'send', l.send, 'send_picks', l.send_picks,
                 'send_faab', l.send_faab, 'send_cap', l.send_cap, 'accepted', l.accepted)
                 order by l.roster_id)
                 from trade_leg l where l.trade_id = t.id))
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;
grant execute on function league_trades(uuid, int) to authenticated;
