-- 0461: A FULL IR TAKES A SWAP (v0.659.1, #1188).
--
-- A Kickoff League manager, in chat: "Trying to swap Jonah Coleman for Saquon
-- on IR for waiver add purposes and it won't let me swap/move Jonah off
-- without dropping someone." Jonah sat in the team's IR spot; Saquon
-- (hamstring, ruled Out) was on the active roster.
--
-- set_roster_spot (0440) moves one player at a time, and with IR full and the
-- active roster full both halves of a swap are refused on their own:
-- Saquon → IR is "IR is full", Jonah → active is "active roster is full —
-- stash or drop someone first". The pickers said the same ("IR is full —
-- move someone back to active first"), which with a full roster can only be
-- done by dropping somebody. Every stash place (IR, OUT, taxi, devy) had the
-- same dead end.
--
-- swap_roster_spot does both halves as ONE move: the player in the spot goes
-- back to active and the active player takes his place. The active count is
-- unchanged, so no seat is needed. Each half is still held to set_roster_spot's
-- own rules (who may be stashed, the taxi lock, the devy shelf, a college
-- player's place) by running it through set_roster_spot itself, and if either
-- half is refused the whole swap is undone and the refusal is returned.

create or replace function swap_roster_spot(p_league_id uuid, p_out_slug text, p_in_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare a native_roster; b native_roster; r jsonb;
begin
  select * into a from native_roster where league_id = p_league_id and slug = p_out_slug;
  select * into b from native_roster where league_id = p_league_id and slug = p_in_slug;
  if a.slug is null or b.slug is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  if a.roster_id <> b.roster_id then return jsonb_build_object('ok', false, 'error', 'both players must be on the same team'); end if;
  -- set_roster_spot's own door, checked BEFORE anything moves.
  if not (owns_roster(p_league_id, a.roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, a.roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if a.spot not in ('ir', 'out', 'taxi', 'devy') then
    return jsonb_build_object('ok', false, 'error', 'the first player must be in IR, OUT, the taxi squad or a devy spot');
  end if;
  if b.spot <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'the second player must be on the active roster');
  end if;
  begin
    -- 1. the player in the spot steps out (his seat is the one the other leaves)
    update native_roster set spot = 'active' where league_id = p_league_id and slug = p_out_slug;
    -- 2. the active player takes the spot, under every rule a single move obeys
    r := set_roster_spot(p_league_id, p_in_slug, a.spot);
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception '%', r ->> 'error'; end if;
    -- 3. and the one coming out must be allowed on the active roster
    --    (a college player in a devy league, say) — asked the same way
    r := set_roster_spot(p_league_id, p_out_slug, 'active');
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception '%', r ->> 'error'; end if;
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'out', p_out_slug, 'in', p_in_slug, 'spot', a.spot);
end $$;
revoke all on function swap_roster_spot(uuid, text, text) from public, anon;
grant execute on function swap_roster_spot(uuid, text, text) to authenticated;
