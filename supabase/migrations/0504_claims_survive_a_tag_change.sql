-- 0504: A CLAIM ISN'T VOIDED BY AN INJURY TAG THAT CHANGED OVERNIGHT (#1311).
--
-- Kickoff League, Oct 14: a 1-for-1 DEF claim lost as "roster over limits".
-- The roster was legal when it was filed at 02:42 (submit_waiver_claim checks)
-- and nothing on it moved before the 08:00 run; the only rule it broke was
-- roster_illegal_reason's injury check — a player stashed on IR as Out on
-- Sunday was tagged Doubtful by Wednesday morning, and this league's IR takes
-- IR/O. Every claim the team had was thrown out by a feed update.
--
-- The run now checks the HARD limits (roster size, active seats, the shelves'
-- counts, taxi experience, devy spots, position caps) — roster_hard_limit_reason,
-- roster_illegal_reason without the injury-designation checks — and writes the
-- reason into the note. A lapsed tag still makes the roster illegal everywhere
-- else: new adds and claims refuse, and lineups say to fix it.

create or replace function roster_hard_limit_reason(p_league_id uuid, p_roster_id integer) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int; sh jsonb; seats int; mx int; dv int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  sh := _roster_shape(p_league_id);
  dv := coalesce((sh ->> 'devy')::int, 0);

  -- ── 0366: a college player outside the devy spots ──
  -- 0440: not in a mixed league, where he may be active and start.
  if dv > 0 and not league_is_mixed(p_league_id) then
    select lp.full_name into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy'
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is a college player outside the devy spots — move him to devy or drop him';
    end if;
  end if;

  mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
  if mx is not null then
    select lp.full_name, lp.exp into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'taxi' and lp.exp > mx
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is on the taxi squad with ' || rec.exp || case when rec.exp = 1 then ' year' else ' years' end || ' (the limit is ' || mx
        || ') — move him to your active roster or drop him';
    end if;
  end if;

  -- ── a shelf, or the active roster, over its size ──
  if sh <> '{}'::jsonb then
    for rec in select s.spot, s.label from (values ('taxi', 'taxi squad'), ('ir', 'IR'), ('out', 'OUT'), ('devy', 'devy squad')) s(spot, label) loop
      cap := coalesce((sh ->> rec.spot)::int, 0);
      select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = rec.spot;
      if cnt > cap then
        return 'the ' || rec.label || ' holds ' || cnt || ' (limit ' || cap || ') — move or drop ' || (cnt - cap);
      end if;
    end loop;
  end if;
  -- The active roster may run over its seats by the taxi spots still open: a
  -- draft fills the taxi's share of the roster as ACTIVE players (seat-cap
  -- probes, sc2), and they stay legal until the taxi has room they won't use.
  -- Beyond that, there's nowhere for them to be.
  seats := league_active_seats(p_league_id);
  if seats is not null and sh <> '{}'::jsonb then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'active';
    cap := seats + greatest(coalesce((sh ->> 'taxi')::int, 0)
             - (select count(*)::int from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'taxi'), 0);
    if cnt > cap then
      return 'the active roster holds ' || cnt || ' (room for ' || cap || ') — drop or stash ' || (cnt - cap);
    end if;
  end if;

  -- ── the two it always knew ──
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt > d.rounds then
    return 'roster holds ' || cnt || ' players (limit ' || d.rounds || ') — drop ' || (cnt - d.rounds);
  end if;
  for rec in
    select lp.pos, count(*)::int as n
    from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = p_league_id and nr.roster_id = p_roster_id
      and (dv = 0 or nr.spot <> 'devy') group by lp.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null and rec.n > cap then
      return 'over the ' || pos_label(rec.pos) || ' limit (' || rec.n || '/' || cap || ') — drop ' || (rec.n - cap);
    end if;
  end loop;
  return null;
end $$;
revoke all on function roster_hard_limit_reason(uuid, integer) from public, anon;
grant execute on function roster_hard_limit_reason(uuid, integer) to authenticated;

-- process_waivers: 0500's, with the hard-limit check and its reason.
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
  perform _hold_played(p_league_id);   -- 0487: stamp the week's played players before any claim is read
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
      -- 0487: AND THE PLAYER'S OWN HOLD HAS ENDED. The claim's stamp is a
      -- forecast made at filing; a hold that arrived after it (his game
      -- kicked off, or the commissioner put him on waivers) is the fact.
      and ((coalesce(wc.clears_at, lp.waived_until, now()) <= now()
            and coalesce(lp.waived_until, now()) <= now())
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
         and (coalesce(g.clears_at, gp.waived_until, now()) > now()
              or coalesce(gp.waived_until, now()) > now())
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
    err := coalesce(wire_block_reason(p_league_id, c.roster_id), add_limit_reason(p_league_id, c.roster_id));  -- 0358, restored 0497
    if err is not null then
      update waiver_claim set status = 'lost', note = err, processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if not _copy_open(p_league_id, c.add_slug, c.roster_id) then   -- 0500: every copy gone, or this seat holds one
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
    -- 0504: the HARD limits only, and the note says which. An injury tag that
    -- lapsed after the claim was filed (Out on Sunday, Doubtful by the
    -- Wednesday run) no longer voids it; it still blocks new adds, claims
    -- and lineups until the manager fixes it.
    err := roster_hard_limit_reason(p_league_id, c.roster_id);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'roster over limits — ' || err, processed_at = now() where id = c.id;
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
