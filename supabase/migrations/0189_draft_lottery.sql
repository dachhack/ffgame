-- 0189: THE DRAFT LOTTERY — weighted shares, and a draw anybody can audit.
--
-- Founder: "set draft lottery shares, run draft lottery."
--
-- WHAT WAS ALREADY THERE. `set_draft_order` (0176) can take an explicit order
-- or shuffle a flat one, and both hosts have had ▲▼ reordering and 🎲 RANDOMIZE
-- since. What it cannot do is an UNEVEN draw — the thing a dynasty league
-- actually wants, where last year's bottom team holds more balls than the team
-- that nearly won. That is this migration.
--
-- SHARES ARE WEIGHTS, NOT PERCENTAGES. A commissioner thinks in "give the
-- worst team 250 and the champion 5", not in figures that must total 100 —
-- percentages that have to be rebalanced every time one changes are a chore
-- and a source of off-by-one arguments. Any non-negative integers work; the
-- odds are their ratio. A share of ZERO is legal and means "in the league, not
-- in the lottery" — they take the remaining slots in seat order behind
-- everyone who was drawn.
--
-- THE DRAW IS RECORDED, WHICH IS THE POINT. `lottery_result` keeps the ordered
-- sequence with each seat's share and the odds it actually had at the moment
-- it was drawn. A lottery nobody can inspect afterwards is indistinguishable
-- from a commissioner typing an order — 0176 made exactly this argument about
-- randomising early and visibly, and a weighted draw needs it more, not less,
-- because "the worst team won it again" is a sentence that costs leagues
-- members.
--
-- WITHOUT REPLACEMENT, weight-proportional at every step: draw a seat, remove
-- it, redraw from what is left. That is the standard NBA-style lottery and it
-- is what people expect when they hear the word.
--
-- PENDING-ONLY, like everything in 0176: the order locks when the draft starts.

alter table draft add column if not exists lottery_shares jsonb;  -- {"3": 250, "1": 5, …} seat → weight
alter table draft add column if not exists lottery_result jsonb;  -- the recorded draw, newest run wins

-- ─────────────────────────────────────────────────────────────────────────────
-- set_lottery_shares(league, shares) — commissioner, pending only.
-- NULL clears them (back to a flat draw).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_lottery_shares(p_league_id uuid, p_shares jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; k text; v numeric; out_j jsonb := '{}'::jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the lottery locks once the draft starts');
  end if;

  if p_shares is null then
    update draft set lottery_shares = null where league_id = p_league_id;
    return jsonb_build_object('ok', true, 'shares', null);
  end if;
  if jsonb_typeof(p_shares) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'shares must be a map of seat → weight');
  end if;

  select array_agg(sleeper_roster_id) into ids from league_membership where league_id = p_league_id;

  -- Validate every entry before writing any of it: a half-applied share table
  -- is a rigged lottery nobody meant to run.
  for k, v in select key, value::text::numeric from jsonb_each_text(p_shares) loop
    if not (k ~ '^\d+$') or not (k::int = any(ids)) then
      return jsonb_build_object('ok', false, 'error', format('no seat %s in this league', k));
    end if;
    if v < 0 or v <> floor(v) or v > 1000000 then
      return jsonb_build_object('ok', false, 'error', 'each share must be a whole number from 0 to 1000000');
    end if;
    out_j := out_j || jsonb_build_object(k, floor(v)::int);
  end loop;

  update draft set lottery_shares = out_j where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'shares', out_j);
end $$;
grant execute on function set_lottery_shares(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- run_draft_lottery(league) — commissioner, pending only. Draws the order and
-- writes it to draft_order, recording the sequence.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function run_draft_lottery(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype;
  ids int[];
  shares jsonb;
  pool int[];
  weights numeric[];
  total numeric;
  roll numeric;
  acc numeric;
  i int; hit int; seat int;
  ord jsonb := '[]'::jsonb;
  rec jsonb := '[]'::jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the order locks once the draft starts');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  if coalesce(array_length(ids, 1), 0) < 2 then
    return jsonb_build_object('ok', false, 'error', 'need at least 2 teams');
  end if;

  -- No shares set = every seat weighted 1, i.e. the flat shuffle set_draft_order
  -- already does. Running the lottery anyway is legitimate — it is the same
  -- draw, RECORDED, which is the only difference that matters to a league.
  shares := coalesce(d.lottery_shares, '{}'::jsonb);
  pool := ids;
  weights := array(select coalesce((shares ->> x::text)::numeric, 1) from unnest(ids) as x);

  while array_length(pool, 1) > 0 loop
    total := 0;
    for i in 1 .. array_length(pool, 1) loop total := total + weights[i]; end loop;

    if total <= 0 then
      -- Everyone left holds zero. They are not IN the lottery, so they fill the
      -- remaining slots in seat order rather than being drawn — a zero share
      -- means "no chance at the top", not "excluded from the draft".
      for i in 1 .. array_length(pool, 1) loop
        ord := ord || to_jsonb(pool[i]);
        rec := rec || jsonb_build_object('roster_id', pool[i], 'share', 0, 'odds', 0);
      end loop;
      exit;
    end if;

    roll := random() * total;
    acc := 0; hit := 1;
    for i in 1 .. array_length(pool, 1) loop
      acc := acc + weights[i];
      if roll < acc then hit := i; exit; end if;
    end loop;

    seat := pool[hit];
    ord := ord || to_jsonb(seat);
    -- The odds RECORDED are the ones this seat actually had on this draw, not
    -- its opening odds — that is the number people argue about afterwards.
    rec := rec || jsonb_build_object(
      'roster_id', seat,
      'share', weights[hit]::int,
      'odds', round((weights[hit] / total)::numeric, 4));

    pool := pool[1:hit-1] || pool[hit+1:array_length(pool, 1)];
    weights := weights[1:hit-1] || weights[hit+1:array_length(weights, 1)];
  end loop;

  update draft set draft_order = ord, lottery_result = rec where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'order', ord, 'result', rec);
end $$;
grant execute on function run_draft_lottery(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_lottery(league) — what was set and what was drawn, for any member.
-- Read-only: the whole value of a recorded lottery is that everyone can see it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_lottery(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  return jsonb_build_object('ok', true,
    'shares', d.lottery_shares,
    'result', d.lottery_result,
    'order', d.draft_order,
    'locked', d.status <> 'pending');
end $$;
grant execute on function draft_lottery(uuid) to authenticated;
