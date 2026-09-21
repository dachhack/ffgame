-- 0323: CONDITIONAL WAIVER CLAIMS — "if I miss on him, take the other one."
--
-- The gap list's second waiver row: Fleaflicker, Fantrax, MFL, Yahoo and FFPC
-- all have contingency groups; Drip settled every claim alone. That is the
-- Wednesday-morning problem every league knows — you want ONE running back,
-- you file on three, and you wake up with all three and a hole where your
-- bench was, or you file on one and get nothing.
--
-- THE SHAPE. A group is an ordered list of a seat's own pending claims with a
-- ceiling on how many may land (one, normally):
--
--   waiver_claim.group_id   — the claims filed or linked together
--   waiver_claim.group_seq  — the manager's preference order inside it
--   waiver_claim.group_max  — how many of them may win (default 1)
--
-- The run needs no new pass for this. Claims are still ordered by the league's
-- own rules — bid, standings, priority — with the manager's preference as the
-- tiebreaker between two of his own; and the moment a group reaches its
-- ceiling the rest of it settle as losses with the reason. So a $40 bid on the
-- back you want and a $12 fallback still compete against the league at their
-- own prices, and you cannot end up with both.
--
-- Everything already true of a claim stays true: a group member can still lose
-- to a higher bid, to a full roster, to a position cap, to a commissioner's
-- flag. The group only ever takes claims OFF the table — it never wins one
-- that would not have won by itself.

-- ═══ 1. the columns ══════════════════════════════════════════════════════════
alter table waiver_claim add column if not exists group_id  uuid;
alter table waiver_claim add column if not exists group_seq int;
alter table waiver_claim add column if not exists group_max int;
create index if not exists waiver_claim_group on waiver_claim(group_id) where group_id is not null;

-- How many of this group have already landed, and its ceiling. Read inside the
-- run after every win.
create or replace function _group_is_full(p_group_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(count(*) filter (where status = 'won'), 0)
         >= coalesce(max(group_max), 1)
  from waiver_claim where group_id = p_group_id;
$$;

-- A group of one is not a group. Called after anything that could empty one,
-- so a leftover claim goes back to standing on its own rather than carrying a
-- group id nothing else shares.
create or replace function _tidy_waiver_group(p_group_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_group_id is null then return; end if;
  select count(*) into n from waiver_claim where group_id = p_group_id and status = 'pending';
  if n < 2 then
    update waiver_claim set group_id = null, group_seq = null, group_max = null
     where group_id = p_group_id and status = 'pending';
  end if;
end $$;
revoke all on function _tidy_waiver_group(uuid) from public, anon, authenticated;

-- ═══ 2. filing and linking ═══════════════════════════════════════════════════
-- Link claims that already exist — the shape the claims list uses: tick them
-- in the order you want them tried, say how many may land. Every claim must be
-- yours, pending, and in the same league and seat.
create or replace function group_waiver_claims(p_claim_ids uuid[], p_max_wins int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c waiver_claim%rowtype; gid uuid := gen_random_uuid(); i int := 0; n int;
        lid uuid; rid int; old_groups uuid[] := '{}'; cid uuid;
begin
  n := coalesce(array_length(p_claim_ids, 1), 0);
  if n < 2 or n > 10 then
    return jsonb_build_object('ok', false, 'error', 'link 2–10 claims');
  end if;
  if (select count(distinct x) from unnest(p_claim_ids) x) <> n then
    return jsonb_build_object('ok', false, 'error', 'a claim can only appear once');
  end if;
  if coalesce(p_max_wins, 1) < 1 or coalesce(p_max_wins, 1) > n - 1 then
    return jsonb_build_object('ok', false, 'error', 'a group lands 1–' || (n - 1) || ' of its claims — otherwise it is not a group');
  end if;
  foreach cid in array p_claim_ids loop
    select * into c from waiver_claim where id = cid;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such claim'); end if;
    if lid is null then lid := c.league_id; rid := c.roster_id; end if;
    if c.league_id <> lid or c.roster_id <> rid then
      return jsonb_build_object('ok', false, 'error', 'claims must all be the same team''s');
    end if;
    if c.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'that claim has already settled');
    end if;
    if not (owns_roster(c.league_id, c.roster_id) or is_league_commish(c.league_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    if c.group_id is not null and not (c.group_id = any (old_groups)) then old_groups := old_groups || c.group_id; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext(lid::text));
  foreach cid in array p_claim_ids loop
    i := i + 1;
    update waiver_claim set group_id = gid, group_seq = i, group_max = coalesce(p_max_wins, 1)
     where id = cid and status = 'pending';
  end loop;
  -- A claim pulled out of an older group can leave one member behind.
  foreach cid in array old_groups loop perform _tidy_waiver_group(cid); end loop;
  return jsonb_build_object('ok', true, 'group_id', gid, 'claims', n, 'max_wins', coalesce(p_max_wins, 1));
end $$;
grant execute on function group_waiver_claims(uuid[], int) to authenticated;

-- Break a group up; the claims stand on their own again, unchanged otherwise.
create or replace function ungroup_waiver_claims(p_group_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lid uuid; rid int; n int;
begin
  select league_id, roster_id into lid, rid from waiver_claim where group_id = p_group_id limit 1;
  if lid is null then return jsonb_build_object('ok', false, 'error', 'no such group'); end if;
  if not (owns_roster(lid, rid) or is_league_commish(lid) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update waiver_claim set group_id = null, group_seq = null, group_max = null
   where group_id = p_group_id and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'claims', n);
end $$;
grant execute on function ungroup_waiver_claims(uuid) to authenticated;

-- Withdraw the whole group in one go.
create or replace function cancel_waiver_group(p_group_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lid uuid; rid int; n int;
begin
  select league_id, roster_id into lid, rid from waiver_claim where group_id = p_group_id limit 1;
  if lid is null then return jsonb_build_object('ok', false, 'error', 'no such group'); end if;
  if not (owns_roster(lid, rid) or is_league_commish(lid) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update waiver_claim set status = 'cancelled', processed_at = now()
   where group_id = p_group_id and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cancelled', n);
end $$;
grant execute on function cancel_waiver_group(uuid) to authenticated;

-- File a whole contingency list in one call — the claims in preference order,
-- validated by the same submit_waiver_claim every single claim goes through.
-- ALL OR NOTHING: a list whose third claim is refused files none of them, so
-- nobody ends up holding half a contingency plan without noticing.
create or replace function submit_waiver_group(
  p_league_id uuid, p_roster_id int, p_claims jsonb, p_max_wins int default 1
) returns jsonb language plpgsql security definer set search_path = public as $$
declare el jsonb; r jsonb; ids uuid[] := '{}'; n int; gid uuid := gen_random_uuid(); i int := 0;
begin
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'the claims are a list');
  end if;
  n := jsonb_array_length(p_claims);
  if n < 2 or n > 10 then
    return jsonb_build_object('ok', false, 'error', 'a conditional list is 2–10 claims');
  end if;
  if coalesce(p_max_wins, 1) < 1 or coalesce(p_max_wins, 1) > n - 1 then
    return jsonb_build_object('ok', false, 'error', 'a group lands 1–' || (n - 1) || ' of its claims — otherwise it is not a group');
  end if;
  for el in select * from jsonb_array_elements(p_claims) loop
    r := submit_waiver_claim(p_league_id, p_roster_id, el ->> 'add',
                             nullif(el ->> 'drop', ''), coalesce((el ->> 'bid')::int, 0));
    if not coalesce((r ->> 'ok')::boolean, false) then
      -- Undo the ones already filed. They are this statement's own rows, so
      -- deleting them takes nothing else with it.
      delete from waiver_claim where id = any (ids);
      return jsonb_build_object('ok', false, 'error', coalesce(r ->> 'error', 'could not file the list'),
                                'failed_on', el ->> 'add');
    end if;
    i := i + 1;
    ids := ids || (r ->> 'claim_id')::uuid;
    update waiver_claim set group_id = gid, group_seq = i, group_max = coalesce(p_max_wins, 1)
     where id = (r ->> 'claim_id')::uuid;
  end loop;
  return jsonb_build_object('ok', true, 'group_id', gid, 'claims', n,
                            'max_wins', coalesce(p_max_wins, 1), 'claim_ids', to_jsonb(ids));
end $$;
grant execute on function submit_waiver_group(uuid, int, jsonb, int) to authenticated;


-- ═══ 3. the run ══════════════════════════════════════════════════════════════
-- 0318's body with three changes, none of which touch who beats whom:
--   · the manager's own preference breaks a tie between two of his claims;
--   · every claim's status is re-read before it is settled, because the
--     cursor is a snapshot and a group can take rows off the table mid-run;
--   · a win that fills its group settles the rest of that group as losses.
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


-- ═══ 4. what the team screen reads ═══════════════════════════════════════════
-- _native_team_state_for: 0321's body, with the group on each pending claim.
create or replace function _native_team_state_for(p_league_id uuid, p_uid uuid, p_commish boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype; mode text;
begin
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = p_uid and enrolled
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
    'is_commish', p_commish,
    -- 0320: why the wire is shut for this seat (a commissioner's lock, the
    -- format's), so the team screen can say so instead of failing an add.
    'wire_block', case when my_roster is not null then wire_block_reason(p_league_id, my_roster) end,
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
    -- 0321: what the trade screen needs to draw an offer before it is sent —
    -- the vote's window and bar, the default life of an offer, and whether
    -- FAAB may ride one at all.
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', mode = 'faab' and league_faab_trading(p_league_id),
    'my_faab', case when mode = 'faab' and my_roster is not null then member_faab(p_league_id, my_roster) end,
    'roster_issue', case when my_roster is not null then roster_illegal_reason(p_league_id, my_roster) end,
    'fa_open', fa_window_open(p_league_id),
    'fa_start_min', (select nullif(l.settings_json ->> 'fa_start_min', '')::int from league l where l.id = p_league_id),
    'fa_end_min', (select nullif(l.settings_json ->> 'fa_end_min', '')::int from league l where l.id = p_league_id),
    'waiver_clear_min', (select nullif(l.settings_json ->> 'waiver_clear_min', '')::int from league l where l.id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(l.settings_json ->> 'waiver_hold_days', '')::int, 1) from league l where l.id = p_league_id),
    'next_waiver_run', next_waiver_run(p_league_id),   -- 0291
    'waiver_clear_dow', (select l.settings_json -> 'waiver_clear_dow' from league l where l.id = p_league_id),
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
        -- 0323: the contingency group this claim belongs to, its place in the
        -- manager's order, and how many of the group may land. Null on a
        -- claim that stands alone, which is how a screen tells them apart.
        'group_id', c.group_id, 'group_seq', c.group_seq, 'group_max', c.group_max,
        -- 0289: when this row settles — its own clock if 0288 admitted it,
        -- else the pool hold it is queued behind.
        'clears_at', coalesce(c.clears_at, (select lp.waived_until from league_pool lp
           where lp.league_id = c.league_id and lp.slug = c.add_slug))) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;
