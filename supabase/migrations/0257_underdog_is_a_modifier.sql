-- 0257: UNDERDOG IS A MODIFIER, NOT A METRIC.
--
-- Founder, seeing it listed in "Pick how he scores": "under dog isn't a
-- scoring metric." He's right about what it FEELS like — the picker sold it as
-- a pure multiplier sitting in a list of scoring styles. Now it IS one: the
-- Underdog card attaches to one of your slots (before that window's kickoff),
-- the slot KEEPS its chosen metric, and while it trails its head-to-head every
-- score it banks counts ×1.5. Engine support is resolveSlot's youUnderdog /
-- theirUnderdog opts, fed from the targeted payload's `underdog` list — the
-- legacy metricId='underdog' path stays so picks sealed before this migration
-- still score.
--
-- apply_underdog is its own RPC rather than an apply_targeted branch because
-- its rules are the 0256 card model, not 0086's ledger entitlement:
--   · consumes ONE OWNED CARD from the week's inventory (row-locked) — works
--     identically in practice weeks, where coin_ledger has no purchase rows
--     and the 0086 gate would read 0 bought;
--   · gates per WINDOW kickoff (late-swap consistent), not on week status;
--   · no clear/refund path — used is used ("No refunds").
--
-- The metric form is retired at the gates: the picker map and the arm list
-- drop 'underdog', so no new pick or arm can take the old road.

-- The metric picker's SQL gate map, minus underdog (mirrors the TS catalog —
-- scripts/check-locked-metrics.mjs pins the two together).
create or replace function locked_metric_unlock(p_metric text) returns text
  language sql immutable as $$
  select case p_metric
    when 'combodrip' then 'unlock-combo-drip'
    when 'retyd'     then 'unlock-return'
    when 'passbig'   then 'unlock-pass-td10'
    else null end;
$$;

-- unlock-underdog is no longer armable as a week unlock — it applies to a slot.
create or replace function is_live_unlock(p_unlock text) returns boolean
  language sql immutable as $$
  select p_unlock in ('unlock-combo-drip', 'unlock-return', 'unlock-pass-td10');
$$;

create or replace function apply_underdog(p_matchup_id uuid, p_win text, p_slot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; t jsonb; rid int; owned int; k text; kick timestamptz;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_win is null or p_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
  -- Usage gate: attach only before this WINDOW kicks off (a null kickoff means
  -- the slate isn't loaded — nothing has kicked, so the door is open).
  kick := window_kickoff(m.week, p_win);
  if m.status = 'final' or (kick is not null and kick <= now()) then
    return jsonb_build_object('ok', false, 'error', 'window already kicked off');
  end if;
  -- A modifier needs something to modify.
  if not exists (
    select 1 from sealed_pick sp where sp.matchup_id = p_matchup_id and sp.app_user_id = auth.uid()
      and sp.game_window = p_win and sp.roster_slot = p_slot and sp.player_slug is not null
  ) then return jsonb_build_object('ok', false, 'error', 'no pick at slot'); end if;

  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;
  k := p_win || '|' || p_slot;
  if coalesce(t->'underdog', '[]'::jsonb) @> to_jsonb(array[k]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
  if jsonb_array_length(coalesce(t->'underdog', '[]'::jsonb)) >= 6 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;

  -- Consume one owned card (0256 model; row locked so two taps can't split one).
  rid := caller_roster(p_matchup_id);
  if is_practice_week(m.week) then
    select qty into owned from practice_inventory
      where league_id = m.league_id and roster_id = rid and week = m.week and powerup_id = 'unlock-underdog' for update;
  else
    select qty into owned from team_inventory
      where league_id = m.league_id and roster_id = rid and powerup_id = 'unlock-underdog' for update;
  end if;
  if coalesce(owned, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'not owned', 'owned', 0); end if;
  if is_practice_week(m.week) then
    perform bump_practice_inventory(m.league_id, rid, m.week, 'unlock-underdog', -1);
  else
    perform bump_inventory(m.league_id, rid, 'unlock-underdog', -1);
  end if;

  t := jsonb_set(t, '{underdog}', coalesce(t->'underdog', '[]'::jsonb) || to_jsonb(k));
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('targeted', t))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{targeted}', t), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'underdog', t->'underdog');
end $$;
grant execute on function apply_underdog(uuid, text, text) to authenticated;
