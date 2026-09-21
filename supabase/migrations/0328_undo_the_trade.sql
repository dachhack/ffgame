-- 0328: UNDO THE TRADE — the commissioner's last resort, and the last of the
-- gap list's trade row that is ours to build.
--
-- Sleeper and Fantrax both let a commissioner reverse a COMPLETED trade.
-- Drip has had a veto since 0072 and a league vote since 0321, but both of
-- those happen BEFORE the deal lands. What every league actually hits is the
-- other case: a trade goes through, and then somebody's account turns out to
-- have been compromised, or the two managers agree they misread the terms, or
-- a collusion complaint lands on the Monday. The only tool for that was
-- moving players back one at a time with commish_move_player, which loses the
-- picks, the dollars and the record.
--
-- WHAT A REVERSAL IS. Every leg of the original, run backwards, in one
-- transaction: players home, picks home, FAAB home, cap room home, retained
-- salary un-retained. The trade is stamped 'reversed' rather than deleted —
-- it happened, and a record that edits itself is not a record.
--
-- WHEN IT REFUSES, and why each refusal is better than a half-undo:
--   · A PIECE HAS MOVED ON. If a traded player was since dropped, claimed or
--     traded again, there is nothing to take back; the reversal names him and
--     stops. A commissioner who wants him anyway has commish_move_player.
--   · THE UNDO WOULD BREAK A ROSTER. Putting three players back on a team
--     that has since filled its bench would leave it illegal, so the same
--     trade_cap_error every trade passes is asked in the reverse direction.
--   · A WALLET CANNOT PAY IT BACK. FAAB that has since been spent cannot be
--     returned, so the reversal says so rather than handing out dollars that
--     were not there.
-- Nothing here is silent: the league hears about a reversal the same way it
-- heard about the trade.

alter table trade_proposal drop constraint if exists trade_proposal_status_check;
alter table trade_proposal add constraint trade_proposal_status_check
  check (status in ('pending', 'accepted', 'review', 'executed', 'rejected',
                    'cancelled', 'vetoed', 'expired', 'countered', 'reversed'));

create or replace function commish_reverse_trade(p_trade_id uuid, p_note text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; lseas text; err text;
        leg record; el jsonb; sl text; seats int[]; seat int; dest int; amt int;
        v_out jsonb; v_in jsonb; ov int; knd text; owner int; moved text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (is_admin() or is_league_commish(t.league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if t.status <> 'executed' then
    return jsonb_build_object('ok', false, 'error', 'only a completed trade can be reversed — this one is ' || t.status);
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  seats := _trade_seats(p_trade_id);

  -- ── 1. IS EVERY PIECE STILL WHERE THE TRADE PUT IT? ──
  if _trade_is_multi(p_trade_id) then
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send) loop
        if not exists (select 1 from native_roster nr where nr.league_id = t.league_id
                        and nr.roster_id = (el ->> 'to')::int and nr.slug = el ->> 'slug') then
          moved := coalesce(moved, _txn_player(t.league_id, el ->> 'slug'));
        end if;
      end loop;
      for el in select * from jsonb_array_elements(leg.send_picks) loop
        if _pick_ownership_error(t.league_id, (el ->> 'to')::int, jsonb_build_array(el - 'to')) is not null then
          moved := coalesce(moved, (el ->> 'season') || ' R' || (el ->> 'round'));
        end if;
      end loop;
    end loop;
  else
    -- A text loop variable, because these two lists are slugs rather than
    -- objects — the multi-team legs above are the ones carrying a destination.
    for sl in select value from jsonb_array_elements_text(t.give) loop
      if not exists (select 1 from native_roster nr where nr.league_id = t.league_id
                      and nr.roster_id = t.to_roster and nr.slug = sl) then
        moved := coalesce(moved, _txn_player(t.league_id, sl));
      end if;
    end loop;
    for sl in select value from jsonb_array_elements_text(t.get) loop
      if not exists (select 1 from native_roster nr where nr.league_id = t.league_id
                      and nr.roster_id = t.from_roster and nr.slug = sl) then
        moved := coalesce(moved, _txn_player(t.league_id, sl));
      end if;
    end loop;
    if _pick_ownership_error(t.league_id, t.to_roster, coalesce(t.give_picks, '[]'::jsonb)) is not null
       or _pick_ownership_error(t.league_id, t.from_roster, coalesce(t.get_picks, '[]'::jsonb)) is not null then
      moved := coalesce(moved, 'a pick');
    end if;
  end if;
  if moved is not null then
    return jsonb_build_object('ok', false, 'error',
      moved || ' has moved on since the trade — there is nothing to take back. Move him by hand if you still want to.');
  end if;

  -- ── 2. WOULD THE UNDO LEAVE ANYBODY ILLEGAL? Same question every trade
  --       answers, asked in the other direction.
  if _trade_is_multi(p_trade_id) then
    foreach seat in array seats loop
      -- coming back: what this seat SENT. going out: what was sent TO it.
      select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_in
        from trade_leg l, jsonb_array_elements(l.send) e
       where l.trade_id = p_trade_id and l.roster_id = seat;
      select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_out
        from trade_leg l, jsonb_array_elements(l.send) e
       where l.trade_id = p_trade_id and (e ->> 'to')::int = seat;
      err := trade_cap_error(t.league_id, seat, v_out, v_in);
      if err is not null then return jsonb_build_object('ok', false, 'error', 'the undo would not fit — ' || err); end if;
    end loop;
  else
    err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.get, t.give),
                    trade_cap_error(t.league_id, t.to_roster, t.give, t.get));
    if err is not null then return jsonb_build_object('ok', false, 'error', 'the undo would not fit — ' || err); end if;
  end if;

  -- ── 3. CAN THE DOLLARS GO BACK? ──
  if _trade_is_multi(p_trade_id) then
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send_faab) loop
        if (el ->> 'amount')::int > member_faab(t.league_id, (el ->> 'to')::int) then
          return jsonb_build_object('ok', false, 'error',
            _txn_team(t.league_id, (el ->> 'to')::int) || ' has already spent the $' || (el ->> 'amount')
              || ' of FAAB this trade paid them');
        end if;
      end loop;
    end loop;
  elsif coalesce(t.faab_dollars, 0) <> 0 then
    dest := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
    if abs(t.faab_dollars) > member_faab(t.league_id, dest) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(t.league_id, dest) || ' has already spent the $' || abs(t.faab_dollars) || ' of FAAB this trade paid them');
    end if;
  end if;

  -- ── 4. RUN IT BACKWARDS ──
  if _trade_is_multi(p_trade_id) then
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send) loop
        update native_roster nr set roster_id = leg.roster_id, acquired = 'commish'
          where nr.league_id = t.league_id and nr.roster_id = (el ->> 'to')::int and nr.slug = el ->> 'slug';
      end loop;
      for el in select * from jsonb_array_elements(leg.send_picks) loop
        update pick_asset set owner_roster = leg.roster_id
          where league_id = t.league_id and season = el ->> 'season'
            and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
      end loop;
      for el in select * from jsonb_array_elements(leg.send_faab) loop
        dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
        update league_membership set faab_budget = member_faab(t.league_id, dest) - amt
          where league_id = t.league_id and sleeper_roster_id = dest;
        update league_membership set faab_budget = member_faab(t.league_id, leg.roster_id) + amt
          where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      end loop;
      for el in select * from jsonb_array_elements(leg.send_cap) loop
        dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
        update league_membership set cap_adjust = cap_adjust - amt
          where league_id = t.league_id and sleeper_roster_id = dest;
        update league_membership set cap_adjust = cap_adjust + amt
          where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      end loop;
    end loop;
  else
    update native_roster nr set roster_id = t.from_roster, acquired = 'commish'
      where nr.league_id = t.league_id and nr.roster_id = t.to_roster
        and nr.slug in (select value from jsonb_array_elements_text(t.give));
    update native_roster nr set roster_id = t.to_roster, acquired = 'commish'
      where nr.league_id = t.league_id and nr.roster_id = t.from_roster
        and nr.slug in (select value from jsonb_array_elements_text(t.get));
    for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb)) loop
      update pick_asset set owner_roster = t.from_roster
        where league_id = t.league_id and season = el ->> 'season'
          and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
    end loop;
    for el in select * from jsonb_array_elements(coalesce(t.get_picks, '[]'::jsonb)) loop
      update pick_asset set owner_roster = t.to_roster
        where league_id = t.league_id and season = el ->> 'season'
          and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
    end loop;
    if coalesce(t.cap_dollars, 0) <> 0 then
      update league_membership set cap_adjust = cap_adjust + t.cap_dollars
        where league_id = t.league_id and sleeper_roster_id = t.from_roster;
      update league_membership set cap_adjust = cap_adjust - t.cap_dollars
        where league_id = t.league_id and sleeper_roster_id = t.to_roster;
    end if;
    if coalesce(t.faab_dollars, 0) <> 0 then
      dest := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
      seat := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
      update league_membership set faab_budget = member_faab(t.league_id, dest) - abs(t.faab_dollars)
        where league_id = t.league_id and sleeper_roster_id = dest;
      update league_membership set faab_budget = member_faab(t.league_id, seat) + abs(t.faab_dollars)
        where league_id = t.league_id and sleeper_roster_id = seat;
    end if;
    -- Retention (0219): the ghost lines this trade wrote come off the books.
    for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
      update salary_retention set amount = amount - (el ->> 'amount')::int
        where league_id = t.league_id and slug = el ->> 'slug' and roster_id = (el ->> 'roster')::int;
      delete from salary_retention where league_id = t.league_id and slug = el ->> 'slug'
        and roster_id = (el ->> 'roster')::int and amount <= 0;
    end loop;
  end if;

  -- The running draft's copy of pick ownership follows, exactly as it did on
  -- the way out (0190).
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select e from (
        select e from trade_leg l, jsonb_array_elements(l.send_picks) e where l.trade_id = p_trade_id
        union all
        select e from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) e
      ) q loop
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

  update trade_proposal set status = 'reversed', resolved_at = now() where id = p_trade_id;
  insert into league_txn (league_id, kind, roster_id, slug, note, actor)
  values (t.league_id, 'commish', t.from_roster, '',
          'trade reversed by the commissioner'
            || case when nullif(btrim(coalesce(p_note, '')), '') is not null then ' — ' || btrim(p_note) else '' end,
          auth.uid());
  perform _chat_house(t.league_id,
    '↩️ Trade reversed by the commissioner — ' || _trade_teams_text(p_trade_id)
      || case when nullif(btrim(coalesce(p_note, '')), '') is not null then ' — ' || btrim(p_note) else '' end,
    jsonb_build_object('kind', 'trade', 'reversed', true, 'trade_id', p_trade_id));
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'status', 'reversed', 'teams', array_length(seats, 1));
end $$;
grant execute on function commish_reverse_trade(uuid, text) to authenticated;
