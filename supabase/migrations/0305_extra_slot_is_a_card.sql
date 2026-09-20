-- 0305: EXTRA SLOT IS A CARD YOU PLAY ON A WINDOW (v0.431.0).
--
-- Founder, on the app: "I don't see the extra slot I added."
--
-- WHAT WAS THERE. Two halves that never met. buy_extra_slot (0027) charges
-- COIN and bumps applied_state.payload_json.extra — the number enforce_slot_cap
-- reads — but no host has called it since the shop (0047/0048) started
-- selling Extra Slot as a CARD into team_inventory like every other power-up.
-- The web plays that card by writing hero_applied.payload_json.extraSlots
-- (its own working blob) and consuming the card — so the board draws the
-- slot, but `extra` never moves and the ninth pick is refused at save. The
-- app had no extra-slot path at all: its hand offered the card with ARM,
-- which filed 'extra-slot' into the BUFF list (nothing reads it) and ate the
-- card. That is the slot the founder could not see.
--
-- THE ONE PATH. apply_extra_slot(matchup, window): before the week's first
-- lock (SCOPE 1, 0260: it reshapes windows for both sides, so it closes with
-- the week and never returns), consume ONE OWNED CARD (0256 model, practice
-- purse on a practice week, row locked so two taps cannot split one), refuse
-- past extra_slot_cap(), then record it where each reader looks:
--   · applied_state.payload_json.extra      — the cap (enforce_slot_cap) and
--                                             the worker's AI fill;
--   · applied_state.payload_json.extraSlots — WHICH window, {win: n}, for
--                                             the app (my_targeted's row);
--   · hero_applied.payload_json.extraSlots  — the same map, for the web board,
--                                             which reads and rewrites that
--                                             blob and would otherwise draw
--                                             eight.
-- The window must be one of the week's when the slate is loaded (a season
-- with no slate rows takes any id — the fixture case, and a week the sync
-- has not reached). No refunds, no sell: "if you use a power up you can't
-- take it back." buy_extra_slot / sell_extra_slot are left as they are for
-- an old build; nothing new calls them.

create or replace function apply_extra_slot(p_matchup_id uuid, p_win text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; sea text; rid int; cur int; owned int; xs jsonb; n int; hb jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_win is null or btrim(p_win) = '' then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
  -- Scope 1: a before-first-lock play. matchup.status leaves 'scheduled' at
  -- the week's first lock (the worker writes lock_at at first kickoff − 1h).
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  select season into sea from league where id = m.league_id;
  if exists (select 1 from nfl_slate s where s.season = sea and s.week = m.week)
     and not exists (select 1 from nfl_slate s where s.season = sea and s.week = m.week and s.win = p_win) then
    return jsonb_build_object('ok', false, 'error', 'no such window');
  end if;
  cur := my_extra(p_matchup_id);
  if cur >= extra_slot_cap() then return jsonb_build_object('ok', false, 'error', 'cap', 'extra', cur); end if;

  -- Consume one owned card (0256 model; row locked so two taps can't split one).
  rid := caller_roster(p_matchup_id);
  if is_practice_week(m.week) then
    select qty into owned from practice_inventory
      where league_id = m.league_id and roster_id = rid and week = m.week and powerup_id = 'extra-slot' for update;
  else
    select qty into owned from team_inventory
      where league_id = m.league_id and roster_id = rid and powerup_id = 'extra-slot' for update;
  end if;
  if coalesce(owned, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'not owned', 'owned', 0); end if;
  if is_practice_week(m.week) then
    perform bump_practice_inventory(m.league_id, rid, m.week, 'extra-slot', -1);
  else
    perform bump_inventory(m.league_id, rid, 'extra-slot', -1);
  end if;

  select coalesce(payload_json -> 'extraSlots', '{}'::jsonb) into xs
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if xs is null or jsonb_typeof(xs) <> 'object' then xs := '{}'::jsonb; end if;
  n := coalesce((xs ->> p_win)::int, 0) + 1;
  xs := jsonb_set(xs, array[p_win], to_jsonb(n));
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('extra', cur + 1, 'extraSlots', xs))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = coalesce(applied_state.payload_json, '{}'::jsonb)
                       || jsonb_build_object('extra', cur + 1, 'extraSlots', xs),
        week = m.week, updated_at = now();

  -- The web board's working blob carries the same map, so it draws the slot
  -- the moment it reloads — and keeps drawing it, since it writes that blob
  -- back from what it read.
  select coalesce(payload_json, '{}'::jsonb) into hb
    from hero_applied where matchup_id = p_matchup_id and app_user_id = auth.uid();
  hb := jsonb_set(coalesce(hb, '{}'::jsonb), '{extraSlots}', xs);
  insert into hero_applied (matchup_id, app_user_id, payload_json)
    values (p_matchup_id, auth.uid(), hb)
  on conflict (matchup_id, app_user_id) do update set payload_json = hb, updated_at = now();

  return jsonb_build_object('ok', true, 'extra', cur + 1, 'extraSlots', xs, 'win', p_win);
end $$;
grant execute on function apply_extra_slot(uuid, text) to authenticated;
