-- 0317 — NO DROPS AFTER KICKOFF (v0.434.7).
--
-- Founder, on the audit's open question: "block drops after kickoff too."
--
-- Until now a manager could drop a player whose game had already started —
-- in a drip league outright (0179's kickoff lock is classic-only), and in a
-- classic league through the waiver run and the agent wire, both of which
-- act as the server and pass the trigger. The sealed pick still scored and
-- the pickup could not play this week, so nothing was won by it; but it is
-- the rule every other platform has, and a roster that changes under a
-- lineup mid-game is the kind of thing a league argues about.
--
-- THE RULE, one function: `drop_lock_reason(league, slug)` — his game in the
-- league's live week has kicked off, and the week is not yet final. It reads
-- the same league_pool → nfl_slate join 0179 built (`classic_kickoff_for`,
-- classic only by name), and `league_live_week`, so a player unlocks the
-- moment the week goes final, exactly when 0179's lock lets go.
--
-- WHERE IT IS ASKED — every manager-facing drop, as an answer, not a throw:
--   • drop_player            — refused;
--   • add_free_agent         — refused when the drop has kicked off;
--   • submit_waiver_claim    — refused: he cannot be NAMED as the drop, even
--                              for a claim that clears after the week;
--   • process_waivers        — a claim filed before he kicked off and settled
--                              after: he stays, and the claim goes through
--                              only where the seat had room without him
--                              (0316's drop-as-means shape), else it loses
--                              with the reason.
-- The classic trigger (0179/0279) is untouched and still the last line for
-- classic; it is not widened to drip because guillotine_tick runs from the
-- team screen with a manager's uid and a raise there would jam the blade.

-- ── the rule ──────────────────────────────────────────────────────────────
create or replace function drop_lock_reason(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select case when coalesce(classic_kickoff_for(p_league_id, league_live_week(p_league_id), p_slug) <= now(), false)
              then _txn_player(p_league_id, p_slug) || '''s game has started — he can''t be dropped until the week ends'
         end;
$$;
comment on function drop_lock_reason(uuid, text) is
  'Every format: why this player cannot be dropped right now (his game in the live week has kicked off), or NULL. 0317.';
grant execute on function drop_lock_reason(uuid, text) to authenticated;

-- ── drop_player: 0290's body, with the rule ───────────────────────────────
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0317: NOT ONCE HIS GAME HAS STARTED. Answered, not thrown (0272), and
  -- for every format — the classic trigger still raises behind this.
  err := drop_lock_reason(p_league_id, p_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'player not on this roster'); end if;
  update league_pool set waived_until = waiver_hold_until(p_league_id)
    where league_id = p_league_id and slug = p_slug;
  -- 0290: and the league hears about it. Named from league_pool, which still
  -- holds him now that the roster does not.
  perform _chat_house(p_league_id,
    '🔻 ' || _txn_team(p_league_id, p_roster_id) || ' dropped ' || _txn_player(p_league_id, p_slug),
    jsonb_build_object('kind', 'drop', 'roster_id', p_roster_id, 'drop', p_slug));
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function drop_player(uuid, int, text) to authenticated;

-- ── add_free_agent: 0290's body, with the rule ────────────────────────────
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
  -- 0289: DUE CLAIMS SETTLE BEFORE THE DOOR DOES. A claim on a player free
  -- agency could not reach clears the moment it can (fa_opens_at), and the
  -- sweep that settles it runs from the team screen — every fifteen seconds,
  -- but not necessarily in the same second the window opens. A screen that was
  -- already open renders a live ADD on stale state, and without this the first
  -- person to click it beats a claim that was due before they arrived, which
  -- is exactly the sniping the closed window exists to prevent. We hold the
  -- same advisory lock process_waivers takes, so settling here is ordered, not
  -- racing; the 'already rostered' check below then reports the honest result.
  if exists (select 1 from waiver_claim wc
               left join league_pool lp2 on lp2.league_id = wc.league_id and lp2.slug = wc.add_slug
              where wc.league_id = p_league_id and wc.add_slug = p_add_slug and wc.status = 'pending'
                and coalesce(wc.clears_at, lp2.waived_until, now()) <= now()) then
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

-- ── submit_waiver_claim: 0316's body, with the rule ───────────────────────
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

-- ── process_waivers: 0316's body, with the rule ───────────────────────────
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text; took text[]; missed text[]; dnote text;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);

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
      and coalesce(wc.clears_at, lp.waived_until, now()) <= now()
    order by case when mode = 'faab' then -wc.bid else 0 end,
             case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end,
             m.waiver_priority nulls last, wc.created_at
  loop
    dnote := null;
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
