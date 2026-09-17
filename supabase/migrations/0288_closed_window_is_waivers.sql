-- 0288: A CLOSED WINDOW IS WHAT WAIVERS ARE FOR (v0.402.0).
--
-- Founder, at 11pm ET, looking at a league whose free-agency window opens at
-- 10am: "all the waivers are closed."
--
-- They were. Reproduced before touching anything, in a league shaped exactly
-- like his — FAAB, a 10:00–11:00 window, the clock outside it:
--
--   ADD   a never-dropped player -> free agency is closed — open 10 AM ET…
--   CLAIM the same player        -> player not in pool
--
-- Both doors shut on the same man, and there are seven hundred of him: every
-- player who went undrafted has a null waived_until, because only a DROP sets
-- one. So for the twenty-three hours a day the window is closed, most of the
-- pool could be neither added nor bid on.
--
-- This is the hole 0287 found and closed one size too small. That migration
-- asked "does this league have free agency at all?" and exempted only the
-- 'off' mode. The right question is whether free agency can reach the player
-- RIGHT NOW — which fa_window_open() already answers, and which subsumes
-- 'off' (a league with none is never open). A closed window is precisely the
-- state waivers exist to cover.
--
-- Body is 0287's, with that one condition rewritten.

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
  -- 0288: THE TEST IS WHETHER FREE AGENCY CAN REACH HIM RIGHT NOW, not whether
  -- the league has free agency at all. 0287 scoped this to fa_mode = 'off' and
  -- left the identical hole open for every WINDOW league outside its hours:
  -- a player nobody ever dropped has no waived_until, so add_free_agent
  -- refused him ("free agency is closed — open 10 AM ET…") and this refused
  -- him too ("player not in pool"). Unobtainable by any route, for most of the
  -- day, for most of the pool — which is what "all the waivers are closed"
  -- looks like from the outside. Founder, at 11pm ET, on a league whose window
  -- opens at 10am.
  --
  -- fa_window_open() answers the real question and subsumes 'off', which can
  -- never be open. When free agency IS open, an unheld player is still an add
  -- rather than a claim — and now says so, instead of the old "player not in
  -- pool", which was never true: 0287 already refuses a slug that genuinely
  -- is not in the pool, a few lines above.
  if fa_window_open(p_league_id) and (wu is null or wu <= now()) then
    return jsonb_build_object('ok', false, 'error', 'free agent — add him directly');
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
