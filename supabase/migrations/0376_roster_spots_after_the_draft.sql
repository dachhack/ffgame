-- ═══════════════════════════════════════════════════════════════════════════
-- 0376 · ROSTER SPOTS CAN CHANGE AFTER THE DRAFT, AND THE LEAGUE HEARS ABOUT IT.
--
-- Founder: "allow post-draft roster spot changes — but log it in the chat."
--
-- Until now the bench, the taxi squad and the devy spots locked the moment the
-- draft started; only the injured shelves (IR, OUT) could move afterwards
-- (0296, 0307). A commissioner who wanted a deeper bench in October had no
-- way to get one.
--
-- Once the draft is COMPLETE, every count can change:
--   • growing a section just opens spots, filled from free agency as usual;
--   • a league that never saved a shape keeps 0296's rule: a bench sent
--     beside an IR/OUT change is the client's default, and is ignored;
--   • shrinking one is refused while any team holds more players there than
--     the new count allows ("drop to N first"), as IR and OUT already were.
--     The bench is counted with the lineup, because 'active' players fill
--     both: a team's active players must fit starters + bench.
-- While the draft is LIVE, bench, taxi and devy stay locked: they are rounds of
-- the draft in progress. IR and OUT keep 0307's rule.
--
-- Every change after the draft, the injured shelves included, posts one line
-- to league chat in the house voice (_chat_house, 0290), e.g.
--   "Roster spots changed by the commissioner: bench 5 → 6, taxi 2 → 0."
-- Pre-draft setup posts nothing, as before: nobody has a roster yet.
--
-- Body: 0366's six-argument set_league_roster_shape, with the post-draft
-- branch rewritten. The pre-draft branch is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int, p_out int, p_devy int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; drounds int; b int; tx int; ir int; o int; r int; sh jsonb; held int; dv int;
        cur_b int; cur_tx int; cur_ir int; cur_out int; cur_dv int; st int; changes text[] := '{}';
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status, rounds into dstat, drounds from draft where league_id = p_league_id;
  sh := _roster_shape(p_league_id);
  ir := least(99, greatest(0, coalesce(p_ir, (sh ->> 'ir')::int, 0)));
  o  := least(99, greatest(0, coalesce(p_out, (sh ->> 'out')::int, 0)));
  dv := least(99, greatest(0, coalesce(p_devy, (sh ->> 'devy')::int, 0)));
  if dv > 0 and not _league_has_college((select settings_json from league where id = p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'devy spots need college players turned on for this league');
  end if;

  if dstat is not null and dstat <> 'pending' then
    -- ── AFTER THE DRAFT STARTS ───────────────────────────────────────────
    st := _classic_starters(p_league_id);
    if sh = '{}'::jsonb then
      cur_b := greatest(0, coalesce(drounds, 0) - st); cur_tx := 0; cur_ir := 0; cur_out := 0; cur_dv := 0;
    else
      cur_b := coalesce((sh ->> 'bench')::int, 0); cur_tx := coalesce((sh ->> 'taxi')::int, 0);
      cur_ir := coalesce((sh ->> 'ir')::int, 0); cur_out := coalesce((sh ->> 'out')::int, 0);
      cur_dv := coalesce((sh ->> 'devy')::int, 0);
    end if;
    b  := least(99, greatest(0, coalesce(p_bench, cur_b)));
    tx := least(99, greatest(0, coalesce(p_taxi, cur_tx)));
    -- A league that never saved a shape shows the client a made-up default
    -- bench; sent beside an IR/OUT change it is stale, not a request (0296).
    if sh = '{}'::jsonb and (ir, o) <> (cur_ir, cur_out) then b := cur_b; tx := cur_tx; end if;

    if (b, tx, ir, o, dv) = (cur_b, cur_tx, cur_ir, cur_out, cur_dv) then
      return jsonb_build_object('ok', true, 'shape', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end,
        'rounds', st + b + tx + ir + o + dv, 'draft_rounds', st + b + tx + dv);
    end if;
    -- 0376: the drafted sections move once the draft is over — not during it.
    if dstat <> 'complete' and (b, tx, dv) <> (cur_b, cur_tx, cur_dv) then
      return jsonb_build_object('ok', false, 'error',
        'the bench, taxi squad and devy spots can change once the draft is over — IR and OUT spots can change now');
    end if;

    -- Shrinking: nobody may be left holding more than the new count.
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'active' group by roster_id) c;
    if held > st + b then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players in its lineup and bench — the bench can drop to '
        || greatest(0, held - st) || ' until they''re cut or moved');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'taxi' group by roster_id) c;
    if tx < held then
      return jsonb_build_object('ok', false, 'error', 'a team has ' || held || ' players on its taxi squad — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'devy' group by roster_id) c;
    if dv < held then
      return jsonb_build_object('ok', false, 'error', 'a team has ' || held || ' players in devy spots — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'ir' group by roster_id) c;
    if ir < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on IR — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster where league_id = p_league_id and spot = 'out' group by roster_id) c;
    if o < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on OUT — they come off before the spot goes');
    end if;
    r := st + b + tx + ir + o + dv;
    if r > 99 then
      return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — starters + bench + taxi + IR + OUT came to ' || r);
    end if;
    sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('roster_shape', sh)
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    update draft set rounds = r where league_id = p_league_id;

    -- 0376: the league hears about it.
    if b <> cur_b then changes := changes || ('bench ' || cur_b || ' → ' || b); end if;
    if tx <> cur_tx then changes := changes || ('taxi ' || cur_tx || ' → ' || tx); end if;
    if dv <> cur_dv then changes := changes || ('devy ' || cur_dv || ' → ' || dv); end if;
    if ir <> cur_ir then changes := changes || ('IR ' || cur_ir || ' → ' || ir); end if;
    if o <> cur_out then changes := changes || ('OUT ' || cur_out || ' → ' || o); end if;
    perform _chat_house(p_league_id,
      'Roster spots changed by the commissioner: ' || array_to_string(changes, ', ') || '.',
      jsonb_build_object('kind', 'roster_shape',
        'from', jsonb_build_object('bench', cur_b, 'taxi', cur_tx, 'ir', cur_ir, 'out', cur_out, 'devy', cur_dv),
        'to', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o, 'devy', dv)));
    return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
  end if;

  -- ── BEFORE THE DRAFT (0366, unchanged) ───────────────────────────────────
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir + o + dv;
  if r - ir - o < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
end $$;
grant execute on function set_league_roster_shape(uuid, int, int, int, int, int) to authenticated;
