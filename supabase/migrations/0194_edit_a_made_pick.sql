-- 0194: EDIT A PICK THAT WAS ALREADY MADE.
--
-- Founder: "I need to be able to click on a pick that was made and remove it or
-- replace it with another available player."
--
-- What existed was `commish_undo_pick` (0067), which unwinds the LAST pick and
-- reopens the clock on it. That is the right tool for "the room got ahead of
-- itself" and the wrong one for "round 3, pick 5 went to the wrong player" —
-- fixing that with undo means unwinding every pick made since, in order, and
-- then re-making them all by hand.
--
-- So: address a pick BY ITS OVERALL and either clear it or swap it.
--
--   • REMOVE leaves the cell EMPTY and hands the player back to the pool. It
--     does not renumber anything and it does not move the clock: the picks
--     around it belong to the teams that made them, and a draft that shuffled
--     up to close a gap would take somebody else's player away to do it. The
--     seat is simply one player short, which is exactly what the commissioner
--     asked for and is fixable by any of the normal doors (free agency, a
--     forced pick, this function again with a slug).
--
--   • REPLACE swaps the player in place — same seat, same overall, same round.
--     The new player must be in the pool and unrostered, and the seat's POSITION
--     LIMITS are re-checked, because a commissioner fixing one mistake should
--     not be handed a roster that can't field a legal lineup. The old player
--     goes back to the pool.
--
-- Both work on a LIVE draft and on a COMPLETE one — most of these are noticed
-- after the room empties — and neither touches `current_overall`, so a live
-- draft carries on from wherever it was.
--
-- KEEPERS AND EVERYTHING ELSE ARE SAFE: only rows this draft created are
-- touched, matched on (roster, slug) with acquired = 'draft'.
create or replace function commish_edit_pick(p_league_id uuid, p_overall int, p_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; pk draft_pick%rowtype; err text; old_slug text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status not in ('live', 'complete') then
    return jsonb_build_object('ok', false, 'error', 'the draft has not started');
  end if;

  select * into pk from draft_pick where league_id = p_league_id and overall = p_overall;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pick at that overall'); end if;
  old_slug := pk.slug;

  -- ── REMOVE ────────────────────────────────────────────────────────────────
  if p_slug is null then
    delete from draft_pick where league_id = p_league_id and overall = p_overall;
    delete from native_roster
      where league_id = p_league_id and roster_id = pk.roster_id and slug = old_slug and acquired = 'draft';
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'action', 'removed', 'overall', p_overall,
      'roster_id', pk.roster_id, 'slug', old_slug);
  end if;

  -- ── REPLACE ───────────────────────────────────────────────────────────────
  if p_slug = old_slug then
    return jsonb_build_object('ok', false, 'error', 'that is already the pick');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'that player is already on a roster');
  end if;

  -- The cap check has to see the seat as it WILL be, or swapping a QB for a QB
  -- would fail on a league with a QB limit. `pos_cap_error` already takes the
  -- player being replaced (0071's p_exclude_slug), so nothing has to be deleted
  -- and put back to ask the question — and a refused edit changes nothing.
  err := pos_cap_error(p_league_id, pk.roster_id, p_slug, false, old_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  delete from native_roster
    where league_id = p_league_id and roster_id = pk.roster_id and slug = old_slug and acquired = 'draft';
  insert into native_roster (league_id, roster_id, slug, acquired)
    values (p_league_id, pk.roster_id, p_slug, 'draft');
  update draft_pick set slug = p_slug, auto = false
    where league_id = p_league_id and overall = p_overall;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'action', 'replaced', 'overall', p_overall,
    'roster_id', pk.roster_id, 'slug', p_slug, 'was', old_slug);
end $$;
grant execute on function commish_edit_pick(uuid, int, text) to authenticated;
