-- 0296: IR SPOTS CAN BE ADDED AFTER THE DRAFT.
--
-- Founder, week 2: "Michael Pittman is out. Can we make sure his injury
-- status is correct and that players can move him to IR in the classic
-- leagues?"
--
-- The status was right (the worker's ESPN poll had him O, and O has been on
-- the default IR list since 0164). What stood in the way was the SHAPE: a
-- classic league that drafted without IR spots had none, and
-- set_league_roster_shape refused to add any — "the roster shape locks once
-- the draft starts" — so the team screen never showed an IR place at all,
-- and set_roster_spot would have said "IR is full — 0 spots" if it had.
--
-- The lock exists for the BENCH and the TAXI SQUAD, and it is right for them:
-- they are drafted rounds, and changing a drafted count after the draft
-- means either a round that never happened or a player with no seat. IR is
-- neither. Since 0193 an IR spot is not a round — nobody drafts into it, it is
-- extra room a manager stashes an injured player in — so adding one in
-- September takes nothing from anyone and removing one only needs every
-- team to have room for whoever is on it.
--
-- So after the draft the setter takes the IR number and holds bench and taxi
-- where they are. A league that never set a shape at all (`{}`) — which is
-- what an untouched classic league is — has its bench DERIVED as rounds minus
-- starters, because 0199 defines that league's whole roster as active seats;
-- writing that down as the shape keeps league_active_seats exactly where it
-- was. draft.rounds moves by the IR delta, because roster_illegal_reason
-- (0072) still bounds a team's total holdings by it, and a team that stashes
-- a player and signs his replacement holds one more than it drafted.

create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; drounds int; b int; tx int; ir int; r int; sh jsonb; cur_ir int; held int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status, rounds into dstat, drounds from draft where league_id = p_league_id;
  ir := least(99, greatest(0, coalesce(p_ir, 0)));

  if dstat is not null and dstat <> 'pending' then
    -- ── AFTER THE DRAFT: IR ONLY ─────────────────────────────────────────
    sh := _roster_shape(p_league_id);
    if sh = '{}'::jsonb then
      -- Never shaped: the whole roster is active seats (0199), so the bench
      -- is whatever the rounds left after the starters.
      b := greatest(0, coalesce(drounds, 0) - _classic_starters(p_league_id)); tx := 0; cur_ir := 0;
    else
      b := coalesce((sh ->> 'bench')::int, 0); tx := coalesce((sh ->> 'taxi')::int, 0); cur_ir := coalesce((sh ->> 'ir')::int, 0);
    end if;
    if ir = cur_ir then
      -- No IR change asked for, so the tap was on bench or taxi: say why not,
      -- and what still can move. (A no-op call reads back the shape.)
      if coalesce(p_bench, b) <> b or coalesce(p_taxi, tx) <> tx then
        return jsonb_build_object('ok', false, 'error',
          'the bench and taxi squad lock once the draft starts — IR spots can still be added or removed');
      end if;
      return jsonb_build_object('ok', true, 'shape', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir),
        'rounds', _classic_starters(p_league_id) + b + tx + ir,
        'draft_rounds', _classic_starters(p_league_id) + b + tx);
    end if;
    -- Removing a spot someone is standing in would strand him: the roster
    -- would be over its IR cap with no move that fixes it except a drop.
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster
       where league_id = p_league_id and spot = 'ir' group by roster_id) c;
    if ir < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on IR — they come off before the spot goes');
    end if;
    r := _classic_starters(p_league_id) + b + tx + ir;
    if r > 99 then
      return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — starters + bench + taxi + IR came to ' || r);
    end if;
    sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir);
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('roster_shape', sh)
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    -- The roster total moves with the IR count: rounds is what a team may
    -- HOLD (0193), and roster_illegal_reason still reads it as the limit.
    update draft set rounds = r where league_id = p_league_id;
    return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir);
  end if;

  -- ── BEFORE THE DRAFT: 0193's body, unchanged ─────────────────────────────
  -- Per-field ceilings were 20 / 8 / 8; the TOTAL is the only real rule, so
  -- each field is now bounded only by it (0192).
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir;
  -- IR spots are not drafted (0193), so a shape that is ALL stash leaves the
  -- draft with nothing to do.
  if r - ir < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  -- Two numbers, because they stopped being one in 0193: `rounds` is the
  -- roster (what a team may hold) and `draft_rounds` is what gets drafted.
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir);
end $$;

grant execute on function set_league_roster_shape(uuid, int, int, int) to authenticated;
