-- ═══════════════════════════════════════════════════════════════════════════
-- 0445 · THE WORKER MAY CUT FOR A SEAT IT MANAGES.
--
-- Founder: "I need AI controlled teams to move guys out of IR when they need
-- to make a waiver pick up or bid. Especially on Wednesday when waivers run
-- after games."
--
-- The deadlock, as the agent-wire probes pinned it (aw10j, aw10k): a player
-- on IR whose designation has cleared cannot come back while the active
-- roster is full (0198, right), and while he sits there healed the roster is
-- illegal (0360), so every add and every claim is refused. The seat the
-- worker acts for could neither activate him nor sign anyone — it could only
-- wait for an active place, which a full roster never opens. The sweep now
-- names the cheapest body (core legalizeIrDrop) and cuts him first; this is
-- the branch that lets it: drop_player admits the worker on 0213's terms —
-- no session, and a seat agent_wire_seat says is the worker's to act for
-- (an unclaimed seat, or an AI seat nobody holds). A seat a human holds is
-- never cut over, auto-pilot included. Every other rule in the body stands:
-- the commissioner's locks, the draft, no drops after kickoff, the hold.
--
-- Body copied from 0320 with only the marked 0445 change.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare err text;
begin
  -- 0445: the worker, for a seat it manages.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0320: a drop is a wire move too. The vampire's lock and the guillotine
  -- reached it through the seat-guard trigger (a raise); the commissioner's
  -- locks answer here, the way every other refusal does.
  err := wire_block_reason(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
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
