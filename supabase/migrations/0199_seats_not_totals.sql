-- 0199: A TAXI PLAYER DOESN'T TAKE A BENCH SPOT.
--
-- Founder: "players on taxi don't count as a bench spot taken."
--
-- Every add path in this project has asked ONE question — "does this roster
-- hold fewer than `draft.rounds` players?" — because when 0064 wrote it there
-- was one kind of place to stand. 0164 gave a roster THREE (active / taxi / IR)
-- with three separate capacities, and taught `set_roster_spot` to respect them;
-- it never went back and taught the add paths.
--
-- So the total is doing two jobs and doing both badly. Reproduced on the
-- scratch DB, 3 starters + 2 bench + 2 taxi + 1 IR (rounds 8):
--
--   • a team with 5 active and 2 on the taxi holds 7 of 8, so it may sign a
--     free agent — who lands ACTIVE, making SIX active players in FIVE seats;
--   • and the other way round, which is the founder's sentence: STASHING a
--     player on the taxi frees nothing. He still counts against the same total
--     the bench is drawn from, so a manager who tidies his roster exactly the
--     way the league is shaped gets no room for it.
--
-- The fix is to ask the question about the SEAT the player actually takes. A
-- signing always lands active, so the add paths now check ACTIVE SEATS —
-- starters + bench, counting only `spot = 'active'`. The taxi squad and IR
-- keep their own capacities, checked where they always were, in
-- `set_roster_spot`.
--
-- A LEAGUE WITH NO ROSTER SHAPE IS UNCHANGED, exactly. No shape means no taxi
-- and no IR places at all, so its whole roster IS its active seats — the seat
-- count falls back to `draft.rounds` and every drip league scores this
-- identically to before.
--
-- `roster_illegal_reason` is deliberately NOT touched. It gates a manager out
-- of transactions entirely, and a draft legitimately fills starters + bench +
-- taxi into active seats (0193: IR is the only thing not drafted) — so every
-- team would be locked out the moment its draft ended, for the crime of not
-- having stashed yet. The add paths tell them to stash; the lockout doesn't.

-- ─────────────────────────────────────────────────────────────────────────────
-- The two readers
-- ─────────────────────────────────────────────────────────────────────────────
/** How many players may stand on the ACTIVE roster: starters + bench. A league
 *  that never set a roster shape has no stash places, so its whole roster is
 *  active seats. */
create or replace function league_active_seats(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when _roster_shape(p_league_id) = '{}'::jsonb
              then (select rounds from draft where league_id = p_league_id)
              else _classic_starters(p_league_id)
                 + coalesce((_roster_shape(p_league_id) ->> 'bench')::int, 0) end;
$$;
grant execute on function league_active_seats(uuid) to authenticated;

/** Why a NEW player can't be seated here — null when he can. A signing always
 *  lands ACTIVE, so this asks about active seats rather than the roster total.
 *  `p_drop_slug` is counted as already gone, and note that dropping a TAXI or
 *  IR player frees no bench seat: that is the same rule from the other side,
 *  and saying so is better than letting the add through and overfilling. */
create or replace function roster_seat_error(p_league_id uuid, p_roster_id int, p_drop_slug text default null)
  returns text language plpgsql stable security definer set search_path = public as $$
declare seats int; cnt int;
begin
  seats := league_active_seats(p_league_id);
  if seats is null then return null; end if;          -- no draft row: nothing to bound
  select count(*) into cnt from native_roster
    where league_id = p_league_id and roster_id = p_roster_id and spot = 'active'
      and (p_drop_slug is null or slug <> p_drop_slug);
  if cnt < seats then return null; end if;
  if _roster_shape(p_league_id) = '{}'::jsonb then
    return 'roster full — drop someone';
  end if;
  return 'your active roster is full (' || cnt || '/' || seats
       || ') — drop an active player, or move one to the taxi squad or IR';
end $$;
grant execute on function roster_seat_error(uuid, int, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- add_free_agent — 0072's body, asking about the seat instead of the total
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  if not fa_window_open(p_league_id) then
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
grant execute on function add_free_agent(uuid, int, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- submit_waiver_claim — 0072's body, same substitution
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0);
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
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
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is null then return jsonb_build_object('ok', false, 'error', 'player not in pool'); end if;
  if wu <= now() then return jsonb_build_object('ok', false, 'error', 'free agent — add directly'); end if;
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
grant execute on function submit_waiver_claim(uuid, int, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- native_team_state — 0072's body, carrying the seat count to the screens
-- ─────────────────────────────────────────────────────────────────────────────
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
        'note', c.note, 'bid', c.bid, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- OWNERSHIP % (founder: "sort by ownership % would be good too")
-- ─────────────────────────────────────────────────────────────────────────────
-- There is no external ownership feed in this project, and there doesn't need
-- to be: this platform HAS leagues, and "how many of them roster him" is the
-- number the question is asking for. Counted over native leagues whose draft
-- has finished — a pending draft's empty rosters would drag every percentage
-- toward zero and say nothing about the player.
--
-- Returned as a slug → whole-percent map so a client sorts and labels off one
-- call. League-scoped and member-gated like everything else here, though the
-- number it reports is deliberately platform-wide: an ownership percentage
-- that only counted your own twelve teams would be 0% for everyone on the
-- waiver wire, which is exactly the list you wanted to sort.
create or replace function player_ownership(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare total int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select count(*)::int into total from draft where status = 'complete';
  if coalesce(total, 0) = 0 then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(x.slug, x.pct) from (
      select nr.slug, round(count(distinct nr.league_id) * 100.0 / total)::int as pct
      from native_roster nr
      join draft dr on dr.league_id = nr.league_id and dr.status = 'complete'
      group by nr.slug
    ) x), '{}'::jsonb);
end $$;
grant execute on function player_ownership(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_waivers — 0144's body, same substitution
-- ─────────────────────────────────────────────────────────────────────────────
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
      and (lp.waived_until is null or lp.waived_until <= now())
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
