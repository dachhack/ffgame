-- 0289: A CLAIM NEEDS A CLEARING TIME OF ITS OWN (v0.404.0).
--
-- Founder, the morning after 0288/v0.403.0 put the CLAIM button back:
-- "it looks like my bid for golden went through immediately."
--
-- It did. Matthew Golden went undrafted, so his league_pool row carries no
-- waived_until — nobody ever dropped him — and process_waivers has always
-- read a null hold as DUE NOW:
--
--   and (lp.waived_until is null or lp.waived_until <= now())
--
-- That line was written when a claim could only ever exist for a player
-- somebody had dropped, where null meant "the hold has been cleared" and due
-- was the right reading. 0288 changed the population: a player free agency
-- cannot reach right now is claimable too, and most of those have never been
-- on a hold. The team screen calls process_waivers on every refresh (every 15
-- seconds, to stay self-driving without a worker), so such a claim was won
-- within seconds of being submitted.
--
-- That is worse than the bug it came from. It is an instant add that also
-- charges FAAB, and — the real damage — it settles UNCONTESTED: nobody else
-- gets the blind-bid window the closed door is supposed to create. Whoever is
-- awake wins every unowned player for $0.
--
-- So a claim gets its own clock. clears_at is stamped at submission for
-- exactly the claims 0288 admitted, and process_waivers prefers it over the
-- pool row's hold.
--
-- WHEN? The moment free agency next opens. That is the deadline the pool
-- header already promises ("FA opens 10 AM ET — until then, claims only"),
-- and settling on it is what makes the promise true: claims resolve first,
-- then the pool goes first-come. The league's own waiver run is the wrong
-- clock here — a league that clears waivers Wednesdays at 3am would park a
-- Thursday claim for six days while the player sat freely addable at 10am
-- every morning in between.
--
-- A league with fa_mode = 'off' never opens, and there waiver_hold_until()
-- IS the only clock, which is exactly what that mode means.

-- ── the window predicate, at an arbitrary instant ──────────────────────────
-- Same body 0287 wrote, with now() lifted into an argument so "when does this
-- next become true" can be asked of it. fa_window_open() keeps its name and
-- meaning and becomes the now() case, so there is still one definition of
-- what an open window is.
create or replace function fa_window_open_at(p_league_id uuid, p_at timestamptz) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare fs int; fe int; faw jsonb; cm int; d int; atmin int; fam text;
begin
  fam := league_fa_mode(p_league_id);
  if fam = 'off' then return false; end if;      -- 0287: no free agency at all
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

create or replace function fa_window_open(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select fa_window_open_at(p_league_id, now());
$$;
grant execute on function fa_window_open(uuid) to authenticated;

-- ── when does free agency next open? ──────────────────────────────────────
-- Null when it never does ('off'). now() when it is already open, so a caller
-- can treat the answer as "the earliest instant an add is allowed" without a
-- special case. Otherwise the earliest candidate boundary at which the
-- predicate above is true: a window can only start at fa_start_min, and the
-- after-waivers rule can only release at waiver_clear_min, so those two
-- minutes across the next ten days are the whole search space. Local wall
-- times converted through the zone, so a DST weekend moves with the clocks
-- instead of drifting an hour — same idiom as waiver_hold_until().
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
    from generate_series(0, 10) i, unnest(array[fs, cm]) m
    where m is not null
  ) c where c.t > now() and fa_window_open_at(p_league_id, c.t);
  return best;
end $$;
grant execute on function fa_opens_at(uuid) to authenticated;

-- ── the column ────────────────────────────────────────────────────────────
-- Null keeps the old meaning exactly: follow the pool row's hold. Only the
-- claims 0288 admitted carry a time of their own.
alter table waiver_claim add column if not exists clears_at timestamptz;

-- ── submitting stamps the clock ───────────────────────────────────────────
-- Body is 0288's; the insert and the return carry clears_at.
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
  -- 0289: AND THIS IS WHERE IT CLEARS. Past this point free agency is shut, so
  -- a player with no live hold is one 0288 admitted, and he has no pool-row
  -- clock to inherit — process_waivers would settle him on its next sweep,
  -- fifteen seconds from now, uncontested. He clears when the door he is
  -- locked behind opens; in a league where it never opens, on the league's own
  -- waiver run, which is the only clock that mode has.
  if wu is null or wu <= now() then
    cl := coalesce(fa_opens_at(p_league_id), waiver_hold_until(p_league_id));
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
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid, clears_at)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug, bid, cl) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid, 'bid', bid,
    'clears_at', coalesce(cl, (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug)));
end $$;
grant execute on function submit_waiver_claim(uuid, int, text, text, int) to authenticated;

-- ── processing reads the claim's clock first ──────────────────────────────
-- Body is 0199's with one line changed: coalesce(claim, pool, now()). A claim
-- with neither is due now, which is the pre-0288 reading of a null hold and
-- keeps every claim written before this migration behaving as it did.
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text;
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
    -- 0144: a commissioner flag set while the claim sat pending kills it with
    -- a clear note — the roster trigger would otherwise abort the whole sweep.
    if flag_rule_blocks(p_league_id, c.add_slug, 'no_add') is not null then
      update waiver_claim set status = 'lost', note = 'player flagged by the commissioner', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = case when mode = 'faab' then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
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
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
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

  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;
grant execute on function process_waivers(uuid) to authenticated;

-- 0287's body, with the due-claim sweep 0289 added.
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
grant execute on function add_free_agent(uuid, int, text, text) to authenticated;

-- ── the screen shows the clock ────────────────────────────────────────────
-- my_claims carries the time the row will settle: the claim's own when it has
-- one, else the pool hold it is waiting on. "Why is this still pending" and
-- "why did that one go straight through" are the same question, and this is
-- the answer to both.
create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype; mode text;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  mode := league_waiver_mode(p_league_id);
  return jsonb_build_object(
    'my_roster_id', my_roster,
    -- 0272: the week the guillotine took THIS seat (null while it lives) —
    -- the team desk's own copy, so the wire can say why it is closed.
    'eliminated', (select eliminated_week from league_membership
      where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', is_league_commish(p_league_id) or is_admin(),
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    -- ACTIVE SEATS (0199): what an ADD is actually bounded by. `roster_cap` is
    -- still the whole roster, stash places included, because that is what the
    -- "MY ROSTER (n/m)" line counts.
    'active_seats', league_active_seats(p_league_id),
    'active_held', case when my_roster is not null then
        (select count(*) from native_roster nr where nr.league_id = p_league_id
           and nr.roster_id = my_roster and nr.spot = 'active') end,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', mode,
    'trade_review', league_trade_review(p_league_id),
    'my_faab', case when mode = 'faab' and my_roster is not null then member_faab(p_league_id, my_roster) end,
    'roster_issue', case when my_roster is not null then roster_illegal_reason(p_league_id, my_roster) end,
    'fa_open', fa_window_open(p_league_id),
    'fa_start_min', (select nullif(l.settings_json ->> 'fa_start_min', '')::int from league l where l.id = p_league_id),
    'fa_end_min', (select nullif(l.settings_json ->> 'fa_end_min', '')::int from league l where l.id = p_league_id),
    'waiver_clear_min', (select nullif(l.settings_json ->> 'waiver_clear_min', '')::int from league l where l.id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(l.settings_json ->> 'waiver_hold_days', '')::int, 1) from league l where l.id = p_league_id),
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url,
        'faab', case when mode = 'faab' then member_faab(p_league_id, m.sleeper_roster_id) end)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'bid', c.bid, 'created_at', c.created_at,
        -- 0289: when this row settles — its own clock if 0288 admitted it,
        -- else the pool hold it is queued behind.
        'clears_at', coalesce(c.clears_at, (select lp.waived_until from league_pool lp
           where lp.league_id = c.league_id and lp.slug = c.add_slug))) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;
grant execute on function native_team_state(uuid) to authenticated;

-- ── the ones already in flight ────────────────────────────────────────────
-- Every claim 0288 admitted before this migration is sitting pending with no
-- clock, which means the next sweep settles it — the founder's league has one
-- such row open right now. Give them the same deadline they would have been
-- given at submission. Claims queued behind a live pool hold are left alone:
-- that hold is their clock and always was.
update waiver_claim c
   set clears_at = coalesce(fa_opens_at(c.league_id), waiver_hold_until(c.league_id))
 where c.status = 'pending' and c.clears_at is null
   and not exists (select 1 from league_pool lp
                    where lp.league_id = c.league_id and lp.slug = c.add_slug
                      and lp.waived_until > now());
