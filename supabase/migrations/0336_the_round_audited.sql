-- 0336 — the round, audited (v0.456.0)
--
-- Six audits of v0.437.0–v0.455.1 — wiring, conflicts, journeys, edges —
-- and this file is the server's share of what they found. Nothing here is a
-- feature; every function below is one already shipped, re-emitted with the
-- one thing it got wrong put right. In the order a manager would meet them:
--
--   execute_trade         the FAAB wallet was re-checked AFTER the rosters
--                         moved, and refused with a `return` — which rolls
--                         nothing back. Half a trade committed. Checked first.
--   _trade_route_accepted the veto bar could exceed a multi-team trade's
--   _settle_trade_review  electorate, settling the vote at the first ballot;
--   league_trades         capped at the room. A raise inside the execute is
--                         caught and settled, not retried every sweep.
--   commish_rule_trade    a commissioner's veto tells the league.
--   process_waivers       a linked group runs on its slowest clock.
--   league_history        a badge pinned on a seat multiplied its record;
--                         a private season stayed readable through last year's.
--   award_week            any signed-in account could run it against any
--   award_sweep           league, and a re-run paid the wallet twice; the
--                         sweep would have flooded every old season's chat,
--                         and never backfilled an award added mid-season.
--   api_trades            a reversed trade vanished; an expired OFFER showed.
--   api_league            `scoring` read {"error":"forbidden"} for everyone.
--   league_is_superflex   three superflex rules; now this one, its spec-less
--   _league_adp_format    branch matched to the client's.
--   league_market         the dynasty format is the league's, not the ADP
--                         fallback's; the season map keys by id when the
--                         slug is missing — it was empty for every league.

-- ═══ 1. the trade, executed in the right order ═══════════════════════════════
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
  -- FAAB dollars (0321): the budget is re-checked at EXECUTE, not just at the
  -- offer — a review window is a day long and a waiver run inside it can
  -- spend the money twice over. CHECKED HERE, BEFORE THE FIRST MOVE (0336):
  -- 0322 asked this after the rosters, picks and cap had already been
  -- rewritten, and answered with a plain `return`, which in plpgsql rolls
  -- nothing back. The players had swapped, the proposal still said pending,
  -- and a second accept read "players moved since the deal was struck". A
  -- refusal now refuses a deal nothing has touched.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    if abs(t.faab_dollars) > member_faab(t.league_id, sender) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(t.league_id, sender) || ' no longer has $' || abs(t.faab_dollars)
          || ' of FAAB — re-propose');
    end if;
  end if;

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
  -- FAAB dollars (0321) — the wallet was re-checked above the first move.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    taker  := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
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

-- ═══ 2. the vote's bar is never higher than the room ═════════════════════════
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
    -- THE BAR IS NEVER HIGHER THAN THE ROOM (0336). The league's veto count
    -- is set for a two-seat deal; a three-team trade in a small league can
    -- leave fewer outside seats than that, and a bar the electorate cannot
    -- reach settled the vote at the first ballot — a veto included.
    need := least(league_trade_veto_votes(t.league_id), _trade_electorate(p_trade_id));
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

create or replace function _settle_trade_review(p_trade_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; need int; vetoes int; cast_ int; seats int; r jsonb; err text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found or t.status <> 'review' then
    return jsonb_build_object('ok', true, 'status', coalesce(t.status, 'gone'));
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select count(*) filter (where veto), count(*) into vetoes, cast_ from trade_vote where trade_id = p_trade_id;
  seats := _trade_electorate(p_trade_id);
  need := least(league_trade_veto_votes(t.league_id), greatest(seats, 1));   -- 0336: never above the room
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
  if err is not null then
    r := jsonb_build_object('ok', false, 'error', err);
  else
    -- A RAISE INSIDE THE EXECUTE IS A REFUSAL TOO (0336). The roster trigger
    -- raises for a player flagged no-trade and the cap check raises when a
    -- deal breaks it; caught here the sub-transaction rolls back and the
    -- deal settles like any other refused one — the sweep used to count it
    -- "stuck" and retry it every tick, and the voter's own ballot was thrown
    -- away with the error.
    begin
      r := execute_trade(p_trade_id);
    exception when others then
      r := jsonb_build_object('ok', false, 'error', sqlerrm);
    end;
  end if;
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
                 'send_faab', l.send_faab, 'send_cap', l.send_cap, 'accepted', l.accepted)
                 order by l.roster_id)
                 from trade_leg l where l.trade_id = t.id))
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;
grant execute on function league_trades(uuid, int) to authenticated;

-- ═══ 3. the commissioner's veto is news ══════════════════════════════════════
create or replace function commish_rule_trade(p_trade_id uuid, p_approve boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (is_admin() or is_league_commish(t.league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if not p_approve then
    if t.status not in ('pending', 'accepted', 'review') then
      return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status);
    end if;
    update trade_proposal set status = 'vetoed', resolved_at = now() where id = p_trade_id;
    -- 0336: the league hears a commissioner's veto the way it hears its own.
    perform _chat_house(t.league_id,
      '⚑ Trade vetoed by the commissioner — ' || _trade_teams_text(p_trade_id) || '.',
      jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'vetoed', true, 'commish', true));
    return jsonb_build_object('ok', true, 'status', 'vetoed');
  end if;
  if t.status not in ('accepted', 'review') then
    return jsonb_build_object('ok', false, 'error', 'both managers must agree first');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;
grant execute on function commish_rule_trade(uuid, boolean) to authenticated;

-- ═══ 4. a linked group runs together ═════════════════════════════════════════
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
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
    err := wire_block_reason(p_league_id, c.roster_id);
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
end $$;

grant execute on function process_waivers(uuid) to authenticated;

-- ═══ 5. the history, counted once and read where it is public ════════════════
create or replace function league_history(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; out_ jsonb; mine boolean;
begin
  if not _may_read_history(p_league_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  ids := _lineage_ids(p_league_id);
  -- WHOSE HISTORY IS THIS. Asked once, here, before any of it is built: the
  -- answer decides only whether the account ids survive the last statement.
  mine := is_admin() or exists (
    select 1 from unnest(ids) x(id) where is_league_member(x.id) or is_league_commish(x.id));
  -- …and since 0336 WHICH SEASONS ARE IN IT. A reader who is here only
  -- because this season is public sees the lineage's other seasons only
  -- where they are public too: making this year private used to hide
  -- nothing, because last year's row was still open and carried this
  -- year's table, champion and managers with it.
  if not mine then
    ids := array(select x.id from unnest(ids) x(id) where coalesce(league_public_api(x.id), false));
  end if;

  with seasons as (
    select l.id, l.season, l.name, l.settings_json,
           nullif(l.settings_json ->> 'playoff_champion', '')::int as champ
    from league l where l.id = any (ids)
  ),
  -- Every final game as two rows, one per side: the shape every record below
  -- wants. Preseason (101+) never counts.
  sides as (
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.home_roster_id as roster_id, m.away_roster_id as opp,
           m.home_final::numeric as pts, m.away_final::numeric as opp_pts
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
    union all
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.away_roster_id, m.home_roster_id, m.away_final::numeric, m.home_final::numeric
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
  ),
  -- A seat's regular season, per season.
  reg as (
    select s.league_id, s.roster_id,
           count(*) filter (where s.pts > s.opp_pts)::int as w,
           count(*) filter (where s.pts < s.opp_pts)::int as l,
           count(*) filter (where s.pts = s.opp_pts)::int as t,
           round(sum(s.pts), 2) as pf, round(sum(s.opp_pts), 2) as pa
      from sides s where not s.is_playoff
     group by s.league_id, s.roster_id
  ),
  -- The title game: the deepest non-consolation playoff round that finished.
  finals as (
    select distinct on (m.league_id) m.league_id, m.home_roster_id, m.away_roster_id,
           m.home_final::numeric as hf, m.away_final::numeric as af
      from matchup m
     where m.league_id = any (ids) and m.is_playoff and not m.is_consolation
       and m.status = 'final' and m.home_final is not null and m.away_final is not null
     order by m.league_id, m.playoff_round desc nulls last, m.week desc
  ),
  -- Who held each seat, per season, and what they called themselves.
  seats as (
    select mm.league_id, mm.sleeper_roster_id as roster_id, mm.team_name, mm.app_user_id, mm.avatar_url,
           coalesce(mm.app_user_id::text, 'seat:' || mm.sleeper_roster_id) as mgr
      from league_membership mm where mm.league_id = any (ids)
  )
  select jsonb_build_object(
    'ok', true,
    'league_id', p_league_id,
    'seasons_count', (select count(*) from seasons),
    -- ── the seasons, newest first ──
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'league_id', s.id, 'season', s.season, 'name', s.name,
        'current', s.id = p_league_id,
        'champion', case when s.champ is not null then jsonb_build_object(
            'roster_id', s.champ,
            'team', (select st.team_name from seats st where st.league_id = s.id and st.roster_id = s.champ),
            'avatar', (select st.avatar_url from seats st where st.league_id = s.id and st.roster_id = s.champ)) end,
        'runner_up', (select case when f.hf is null then null else
             jsonb_build_object('roster_id', case when f.hf > f.af then f.away_roster_id else f.home_roster_id end,
                                'team', (select st.team_name from seats st where st.league_id = s.id
                                          and st.roster_id = case when f.hf > f.af then f.away_roster_id else f.home_roster_id end))
           end from finals f where f.league_id = s.id),
        -- the regular-season table, best first
        'table', coalesce((
          select jsonb_agg(jsonb_build_object(
              'roster_id', r.roster_id,
              'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id),
              'w', r.w, 'l', r.l, 't', r.t, 'pf', r.pf, 'pa', r.pa)
            order by r.w desc, r.pf desc)
          from reg r where r.league_id = s.id), '[]'::jsonb),
        -- the season's own high-water mark
        'high_week', (select jsonb_build_object('week', x.week, 'roster_id', x.roster_id, 'points', round(x.pts, 2),
                               'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id))
                        from sides x where x.league_id = s.id order by x.pts desc limit 1))
        order by s.season desc)
      from seasons s), '[]'::jsonb),
    -- ── the record book, all-time across the lineage ──
    'records', jsonb_build_object(
      'top_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'playoff', x.is_playoff, 'points', round(x.pts, 2),
                   'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'opp_points', round(x.opp_pts, 2),
                   'opp', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp)) as e
            from sides x order by x.pts desc limit 10) q), '[]'::jsonb),
      'low_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'points', round(x.pts, 2), 'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id)) as e
            from sides x order by x.pts limit 5) q), '[]'::jsonb),
      'blowouts', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts desc limit 5) q), '[]'::jsonb),
      'nailbiters', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts limit 5) q), '[]'::jsonb),
      'top_seasons', coalesce((select jsonb_agg(e order by (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'pf', r.pf, 'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r order by r.pf desc limit 5) q), '[]'::jsonb),
      'best_records', coalesce((select jsonb_agg(e order by (e ->> 'pct')::numeric desc, (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'pct', round((r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0), 3),
                   'pf', r.pf, 'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r where r.w + r.l + r.t >= 4 order by (r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0) desc, r.pf desc limit 5) q), '[]'::jsonb)),
    -- ── the managers, all-time ──
    -- Ordered by titles, then wins: a champions-first table, which is the one
    -- argument this screen exists to settle.
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'manager', g.mgr, 'team', g.team, 'app_user_id', g.uid,
          'seasons', g.seasons, 'w', g.w, 'l', g.l, 't', g.t, 'pf', g.pf,
          'titles', g.titles, 'finals', g.finals,
          'awards', g.awards, 'badges', g.badges)
        order by g.titles desc, g.w desc, g.pf desc)
      from (
        select st.mgr,
               max(st.app_user_id::text)::uuid as uid,
               -- the name they go by now: the latest season's team name
               (array_agg(st.team_name order by (select se.season from seasons se where se.id = st.league_id) desc))[1] as team,
               count(distinct st.league_id)::int as seasons,
               coalesce(sum(r.w), 0)::int as w, coalesce(sum(r.l), 0)::int as l,
               coalesce(sum(r.t), 0)::int as t, coalesce(round(sum(r.pf), 2), 0) as pf,
               count(*) filter (where exists (select 1 from seasons se
                  where se.id = st.league_id and se.champ = st.roster_id))::int as titles,
               count(*) filter (where exists (select 1 from finals f
                  where f.league_id = st.league_id
                    and st.roster_id in (f.home_roster_id, f.away_roster_id)))::int as finals,
               -- 0325: the trophy case. Weekly awards won across every season
               -- this manager held a seat in, and the badges pinned on them.
               coalesce(sum((select count(*) from league_award_win aw
                  where aw.league_id = st.league_id and aw.roster_id = st.roster_id)), 0)::int as awards,
               -- ITS OWN QUERY (0336), not a lateral join on the seat row:
               -- joined, every grant multiplied the seat's wins, points and
               -- titles by the number of badges pinned on it.
               (select coalesce(jsonb_agg(distinct jsonb_build_object(
                          'icon', b.icon, 'name', b.name, 'season', g.season)), '[]'::jsonb)
                  from league_badge_grant g
                  join league_badge b on b.league_id = g.league_id and b.key = g.key
                  join seats s2 on s2.league_id = g.league_id and s2.roster_id = g.roster_id
                 where s2.mgr = st.mgr) as badges
          from seats st
          left join reg r on r.league_id = st.league_id and r.roster_id = st.roster_id
         group by st.mgr
      ) g), '[]'::jsonb))
  into out_;
  -- THE REDACTION. A reader who is here only because the league is public
  -- gets the history without the accounts behind it. Same shape, same rows,
  -- same ordering — one key dropped and one key hashed, so a tool written
  -- against the public API and one written against the app see the same
  -- document apart from an identifier neither of them should be using.
  if not mine and out_ ? 'managers' then
    out_ := jsonb_set(out_, '{managers}', coalesce((
      select jsonb_agg((m - 'app_user_id') || jsonb_build_object(
               'manager', substr(md5(coalesce(m ->> 'manager', '')), 1, 12)))
        from jsonb_array_elements(out_ -> 'managers') m), '[]'::jsonb));
    out_ := out_ || jsonb_build_object('redacted', true);
  end if;
  return out_;
end $$;
grant execute on function league_history(uuid) to authenticated;

-- ═══ 6. the awards, handed out by the right hands, paid once ═════════════════
create or replace function award_week(p_league_id uuid, p_week int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; total int := 0; lines text[]; seas text; newly int[];
begin
  -- 0336: the worker (no session) or the league's commissioner. It was open
  -- to every signed-in account against every league, and it posts to chat.
  if auth.uid() is not null and not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_week is null or p_week >= 100 then   -- preseason (101+) hands out nothing
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'preseason');
  end if;
  if not exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week) then
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'no such week');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week
              and (m.status <> 'final' or m.home_final is null or m.away_final is null)) then
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'week not final');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':awards'));
  select season into seas from league where id = p_league_id;

  for a in select * from _league_award_defs(p_league_id) loop
    -- Every team's week as one row: its score, what it gave up, its margin,
    -- and the game's total. `only` filters to winners or losers first, so
    -- "highest score in a loss" is one rule rather than a special case.
    with sides as (
      select m.home_roster_id as roster_id, m.home_final::numeric as pts, m.away_final::numeric as opp
        from matchup m where m.league_id = p_league_id and m.week = p_week
      union all
      select m.away_roster_id, m.away_final::numeric, m.home_final::numeric
        from matchup m where m.league_id = p_league_id and m.week = p_week
    ), scored as (
      select s.roster_id,
             case a.metric when 'points' then s.pts
                           when 'points_against' then s.opp
                           when 'margin' then s.pts - s.opp
                           else s.pts + s.opp end as v
        from sides s
       where a.only_result = 'any'
          or (a.only_result = 'win' and s.pts > s.opp)
          or (a.only_result = 'loss' and s.pts < s.opp)
    ), best as (
      select case when a.direction = 'high' then max(v) else min(v) end as v from scored
    ), ins as (
      insert into league_award_win (league_id, week, key, roster_id, value, name, icon)
      select p_league_id, p_week, a.key, sc.roster_id, round(sc.v, 2), a.name, a.icon
        from scored sc, best b where sc.v = b.v
      on conflict do nothing
      returning roster_id
    )
    select coalesce(array_agg(roster_id), '{}') into newly from ins;
    n := coalesce(array_length(newly, 1), 0);
    total := total + n;
    if n > 0 then
      -- The coin prize, if the award carries one — TO THE NEW WINNERS ONLY
      -- (0336). The ledger line was idempotent, but the wallet credit ran
      -- for every winner of the week, so a re-run after a score correction
      -- paid last time's winner a second time against a ledger that said once.
      if a.coin <> 0 then
        insert into coin_ledger (league_id, roster_id, week, delta, reason, idem_key)
        select p_league_id, w.roster_id, p_week, a.coin, 'award:' || a.key,
               'award:' || p_league_id::text || ':' || p_week || ':' || a.key || ':' || w.roster_id
          from league_award_win w
         where w.league_id = p_league_id and w.week = p_week and w.key = a.key
           and w.roster_id = any (newly)
        on conflict (idem_key) do nothing;
        insert into team_wallet (league_id, roster_id, coins)
        select p_league_id, w.roster_id, a.coin from league_award_win w
         where w.league_id = p_league_id and w.week = p_week and w.key = a.key
           and w.roster_id = any (newly)
        on conflict (league_id, roster_id) do update set coins = team_wallet.coins + a.coin, updated_at = now();
      end if;
      lines := coalesce(lines, '{}') || (
        select a.icon || ' ' || a.name || ' — ' || string_agg(_txn_team(p_league_id, w.roster_id), ' & ')
          || ' (' || trim(trailing '.' from trim(trailing '0' from to_char(max(w.value), 'FM999999.00'))) || ')'
          || case when a.coin <> 0 then ' · ' || a.coin || ' coin' else '' end
        from league_award_win w
        where w.league_id = p_league_id and w.week = p_week and w.key = a.key);
    end if;
  end loop;

  if total > 0 then
    perform _chat_house(p_league_id,
      '🏅 Week ' || p_week || ' awards — ' || array_to_string(lines, ' · '),
      jsonb_build_object('kind', 'award', 'week', p_week, 'awarded', total));
  end if;
  return jsonb_build_object('ok', true, 'awarded', total, 'week', p_week, 'season', seas);
end $$;
grant execute on function award_week(uuid, int) to authenticated;

create or replace function award_sweep() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; res jsonb; weeks int := 0; given int := 0;
begin
  for r in
    select m.league_id, m.week
      from matchup m
      join league l on l.id = m.league_id
     where m.week < 100 and l.provider = 'native' and coalesce(l.kind, 'league') = 'league'
       and not coalesce(l.is_mock, false)
       -- 0336: THIS SEASON'S rows. The first sweep after 0325 would have
       -- awarded every final week of every past season's league row — one
       -- house message per league-week, into chats nobody reads any more.
       and coalesce(nullif(regexp_replace(l.season, '\D', '', 'g'), '')::int, 0)
           >= extract(year from now())::int - case when extract(month from now()) < 3 then 1 else 0 end
     group by m.league_id, m.week
    having count(*) filter (where m.status <> 'final' or m.home_final is null or m.away_final is null) = 0
       -- 0336: a week is due while ANY active award has not been handed out
       -- for it — so an award added in week 9 is handed out for weeks 1–8 on
       -- the next sweep, as 0325's own header promised. A week that has every
       -- award costs one index probe per award.
       and exists (select 1 from _league_award_defs(m.league_id) a
                    where not exists (select 1 from league_award_win w
                                       where w.league_id = m.league_id and w.week = m.week and w.key = a.key))
  loop
    begin
      res := award_week(r.league_id, r.week);
      if coalesce((res ->> 'awarded')::int, 0) > 0 then weeks := weeks + 1; given := given + (res ->> 'awarded')::int; end if;
    exception when others then null;   -- one league's bad week never stops the sweep
    end;
  end loop;
  return jsonb_build_object('ok', true, 'weeks', weeks, 'awards', given);
end $$;
revoke all on function award_sweep() from public, anon, authenticated;
grant execute on function award_sweep() to service_role;

-- ═══ 7. the public API ═══════════════════════════════════════════════════════
-- The league's scoring for a reader with no session: `league_scoring` refuses
-- anyone who is not a member, and the edge function is nobody. Same fields,
-- minus the editor's flag, which a reader with no session does not have.
create or replace function _api_scoring(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'td_bonus',   coalesce((sc ->> 'td_bonus')::int, 0),
    'yd_mult',    coalesce((sc ->> 'yd_mult')::numeric, 1),
    'to_penalty', coalesce((sc ->> 'to_penalty')::int, 0),
    'scoped',     coalesce(sc -> 'scoped', '[]'::jsonb))
  from (select settings_json -> 'scoring' as sc from league where id = p_league_id) t;
$$;
revoke all on function _api_scoring(uuid) from public, anon, authenticated;
grant execute on function _api_scoring(uuid) to service_role;

create or replace function api_league(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; l league%rowtype;
begin
  if not _api_open(p_league_id) then return null; end if;
  select * into l from league where id = p_league_id;
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object(
    'league_id', l.id, 'name', l.name, 'season', l.season,
    'kind', coalesce(l.kind, 'league'), 'provider', l.provider,
    'format', league_format(p_league_id), 'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'continuity', league_continuity(p_league_id),
    'teams', (select count(*)::int from league_membership where league_id = p_league_id),
    'current_week', league_live_week(p_league_id),
    'draft_status', coalesce(d.status, 'none'), 'roster_size', d.rounds,
    'scoring', _api_scoring(p_league_id),   -- 0336: league_scoring refuses a reader with no session
    'rules', jsonb_build_object(
      'waiver_mode', league_waiver_mode(p_league_id),
      'faab_budget', league_faab_budget(p_league_id),
      'trade_review', league_trade_review(p_league_id),
      'trade_deadline_week', league_trade_deadline_week(p_league_id),
      'median_game', league_median_game(p_league_id),
      'playoff_teams', (select nullif(l.settings_json ->> 'playoff_teams', '')::int),
      'pos_caps', league_pos_caps(p_league_id)),
    'champion', (select nullif(l.settings_json ->> 'playoff_champion', '')::int),
    'updated_at', l.synced_at);
end $$;

create or replace function api_trades(p_league_id uuid, p_limit int default 50) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'trades', coalesce((select jsonb_agg(jsonb_build_object(
        'trade_id', t.id, 'status', t.status, 'at', coalesce(t.resolved_at, t.created_at),
        'from', jsonb_build_object('roster_id', t.from_roster, 'team', _txn_team(p_league_id, t.from_roster),
                                   'sends', t.give, 'picks', t.give_picks),
        'to', jsonb_build_object('roster_id', t.to_roster, 'team', _txn_team(p_league_id, t.to_roster),
                                 'sends', t.get, 'picks', t.get_picks),
        'cap_dollars', t.cap_dollars, 'faab_dollars', t.faab_dollars,
        'legs', (select jsonb_agg(jsonb_build_object(
                   'roster_id', l.roster_id, 'team', _txn_team(p_league_id, l.roster_id),
                   'send', l.send, 'send_picks', l.send_picks,
                   'send_faab', l.send_faab, 'send_cap', l.send_cap) order by l.roster_id)
                 from trade_leg l where l.trade_id = t.id),
        'vote', (select jsonb_build_object('vetoes', count(*) filter (where v.veto),
                          'allows', count(*) filter (where not v.veto))
                   from trade_vote v where v.trade_id = t.id having count(*) > 0))
        order by coalesce(t.resolved_at, t.created_at) desc)
      from (select * from trade_proposal
             where league_id = p_league_id and status in ('executed', 'vetoed', 'reversed')   -- 0336
             order by coalesce(resolved_at, created_at) desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb));
end $$;

-- ═══ 8. one superflex rule, and a season map that answers ════════════════════
-- league_is_superflex (0237), with its last branch corrected. It claimed to
-- mirror the client's "no lineup spec reads superflex" — but the client only
-- takes that branch when it has NO roster object at all, and `league_game_mode`
-- always hands it one (empty for the default nine). A spec-less CLASSIC league
-- is the default nine on every screen, one quarterback, priced 1QB; only a
-- drip lineup, where any position starts anywhere, reads superflex without a
-- spec. Now that this function decides the ADP column and the dynasty board
-- for every league (below), the two rules had to be the same rule.
create or replace function league_is_superflex(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when coalesce(sj ->> 'game_mode', 'drip') <> 'classic' then true
    when sj -> 'roster_slots' is not null then coalesce((
      select count(*) filter (where slot -> 'pos' ? 'QB') >= 2
             or bool_or((slot -> 'pos' ? 'QB') and jsonb_array_length(slot -> 'pos') > 1)
      from jsonb_array_elements(sj -> 'roster_slots') slot), false)
    when sj -> 'roster_classic' is not null then
         coalesce((sj -> 'roster_classic' ->> 'SFLX')::int, 0) >= 1
      or coalesce((sj -> 'roster_classic' ->> 'QB')::int, 0) >= 2
    else false   -- 0336: a spec-less classic league is the default nine — one QB
  end
  from (select settings_json as sj from league where id = p_league_id) t;
$$;
grant execute on function league_is_superflex(uuid) to authenticated;

create or replace function _league_adp_format(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  with l as (select settings_json as s from league where id = p_league_id)
  select case
    -- 0336: `league_is_superflex` (0237) is THE rule, the server mirror of
    -- the client's — a lone SFLX spot, the 0161 roster counts and a drip
    -- lineup all read superflex there, and read 1QB here.
    when league_is_superflex(p_league_id) then '2qb'
    when coalesce((select (s ->> 'ppr')::numeric from l), 1) >= 0.75 then 'ppr'
    when coalesce((select (s ->> 'ppr')::numeric from l), 1) >= 0.25 then 'half'
    else 'std' end;
$$;
grant execute on function _league_adp_format(uuid) to authenticated;

create or replace function league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare fresh boolean; board boolean; fmt text; adp jsonb;
        dynb boolean; projb boolean; dfmt text;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  fresh := market_is_fresh();
  board := adp_board_is_fresh();
  fmt := _league_adp_format(p_league_id);
  -- A FORMAT THE MARKET BARELY PRICES IS NOT A MARKET. Sleeper's rooms are
  -- overwhelmingly PPR and half: the live board prices ~2,260 players in PPR
  -- and ~240 in standard. Serving those 240 and letting everybody else fall
  -- through to ESPN would put two scales in one column, ordered against each
  -- other — worse than one honest scale. A draft board is about 300 picks
  -- deep, so a format that cannot fill one cannot order one, and the league
  -- reads PPR instead. `adp_format` then reports what actually answered,
  -- because a label that names a market nobody looked at is the bug.
  if board and fmt <> 'ppr' then
    if (select count(*) from adp_board b where b.slug is not null
          and (case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                        else b.adp_std end) is not null) < 300 then
      fmt := 'ppr';
    end if;
  end if;
  dynb := dyn_board_is_fresh();
  projb := proj_board_is_fresh();
  -- 0336: asked of the league, not of the ADP format — which the thin-board
  -- fallback above may just have downgraded to PPR for a reason that has
  -- nothing to do with how the league prices quarterbacks.
  dfmt := case when league_is_superflex(p_league_id) then 'sf' else '1qb' end;

  select coalesce(jsonb_object_agg(slug, v), '{}'::jsonb) into adp from (
    select b.slug,
           round(case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                          when 'std' then b.adp_std else b.adp_ppr end, 1) as v
      from adp_board b
     where board and b.slug is not null
       and (case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                     when 'std' then b.adp_std else b.adp_ppr end) is not null
    union all
    select m.slug, m.adp from player_market m
     where fresh and m.adp is not null
       and not exists (
         select 1 from adp_board b2 where b2.slug = m.slug
          and board and (case fmt when '2qb' then b2.adp_2qb when 'half' then b2.adp_half
                                  when 'std' then b2.adp_std else b2.adp_ppr end) is not null)
  ) x;

  return jsonb_build_object(
    'ok', true,
    'fresh', fresh,
    'as_of', (select max(updated_at) from player_market),
    'source', (select source from player_market order by updated_at desc limit 1),
    'adp_source', case when board then 'sleeper' when fresh then 'espn' else null end,
    'adp_format', case when board then fmt else null end,
    'adp_as_of', (select max(fetched_at) from adp_board),
    'adp', adp,
    'own', case when fresh then coalesce(
      (select jsonb_object_agg(slug, owned_pct) from player_market where owned_pct is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- 0335: the dynasty market, in this league's format.
    'dyn_format', case when dynb then dfmt else null end,
    'dyn_as_of', (select max(fetched_at) from dyn_board),
    'dyn', case when dynb then coalesce((select jsonb_object_agg(slug, round(
        case when dfmt = 'sf' then vsf else v1qb end)) from dyn_board
       where kind = 'player' and slug is not null
         and (case when dfmt = 'sf' then vsf else v1qb end) is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- …and what a rookie pick trades for, keyed by the market's own label.
    'picks', case when dynb then coalesce((select jsonb_object_agg(label, round(
        case when dfmt = 'sf' then vsf else v1qb end)) from dyn_board
       where kind = 'pick' and label is not null
         and (case when dfmt = 'sf' then vsf else v1qb end) is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- THE SEASON RATE, in PPR, for the client to take a ratio against its own
    -- baked PPR rate — never a replacement for the league-scored number.
    'proj_as_of', (select max(fetched_at) from proj_board),
    -- Keyed by our slug, else by the sleeper id — the client reads both
    -- (0336; the worker carries the slug now, but a board without one should
    -- still answer rather than serve the empty map every league got).
    'proj', case when projb then coalesce((select jsonb_object_agg(coalesce(slug, sleeper_id), round(per_week, 3))
        from proj_board where per_week is not null), '{}'::jsonb)
      else '{}'::jsonb end);
end $$;
grant execute on function league_market(uuid) to authenticated;
