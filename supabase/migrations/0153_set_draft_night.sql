-- 0153: OVERNIGHT PAUSE, SETTABLE — the commissioner can set (or clear) the
-- draft's quiet hours after creation, not just at birth.
--
-- The engine has spoken quiet hours since 0069 (awake_deadline: deadlines
-- count only awake ET minutes, so no 3am autopicks), but night_start_min /
-- night_end_min were creation-time parameters only. This adds the setter the
-- founder asked for ("let commish set overnight pause hours").
--
-- Mid-draft honesty: a deadline already on the books was computed under the
-- OLD hours — leave it and a pick could still expire at 3am tonight, which is
-- exactly what the commissioner just asked to prevent. So on a LIVE draft the
-- setter re-bases every running clock: remaining wall time is preserved and
-- re-run through awake_deadline under the new hours (the snake pick clock and
-- every open auction lot alike). Clearing the hours re-bases the same way —
-- remaining awake time simply becomes plain time again.

create or replace function set_draft_night(p_league_id uuid, p_start_min int default null, p_end_min int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; rem numeric; lot auction_lot%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if (p_start_min is null) <> (p_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'overnight pause needs both a start and an end');
  end if;
  if p_start_min is not null and (
       p_start_min < 0 or p_start_min > 1439
    or p_end_min < 0 or p_end_min > 1439
    or p_start_min = p_end_min) then
    return jsonb_build_object('ok', false, 'error', 'overnight hours must be two different times of day');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status = 'complete' then return jsonb_build_object('ok', false, 'error', 'draft is complete'); end if;

  update draft set night_start_min = p_start_min, night_end_min = p_end_min
    where league_id = p_league_id;

  -- Re-base running clocks under the new hours (live, unpaused only — a
  -- paused draft's remaining seconds are frozen in pause_remaining and get
  -- their deadline computed at resume, under whatever hours stand then).
  if d.status = 'live' and not d.paused then
    if d.deadline_at is not null and d.deadline_at > now() then
      rem := extract(epoch from d.deadline_at - now());
      update draft set deadline_at = awake_deadline(now(), rem::int, p_start_min, p_end_min)
        where league_id = p_league_id;
    end if;
    for lot in select * from auction_lot where league_id = p_league_id loop
      if lot.deadline > now() then
        rem := extract(epoch from lot.deadline - now());
        update auction_lot set deadline = awake_deadline(now(), rem::int, p_start_min, p_end_min)
          where id = lot.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'start_min', p_start_min, 'end_min', p_end_min);
end $$;

grant execute on function set_draft_night(uuid, int, int) to authenticated;
