-- 0190: TRADING AROUND THE DRAFT — startup slots that snake, picks that move
-- while the clock runs, and a commissioner switch for the whole idea.
--
-- Founder: "a way for players in drafts to trade draft positions and drafted
-- players. Also have mixed trade draft spots and dynasty rookie picks for
-- dynasty startup drafts. Pick trading can be turned on/off by commish."
--
-- WHAT 0183 ALREADY DID, and why this is not a rewrite of it: rookie picks are
-- already owned, tradeable assets honored on the clock. Three things stopped
-- that machinery from covering a STARTUP draft.
--
-- (1) EVERY TRADE WAITED FOR THE DRAFT. `propose_trade` opened with
--     `d.status <> 'complete' → 'wait for the draft to finish'`, which is the
--     one rule that makes in-draft trading impossible by construction. Lifted
--     here to pending + live, with the guards that absence implied (below).
--
-- (2) OWNED PICKS FORCED LINEAR ROUNDS. 0183 chose that deliberately and gave
--     the reason: a rookie pick means "round 3, Team X's slot", and snaking
--     would relabel it every other round. True for a rookie draft — and wrong
--     for a startup, which snakes and whose managers expect it to. So an asset
--     now carries a KIND, and the owner list is built by walking the snake for
--     startup picks and the linear order for rookie ones. A startup league
--     that provisions picks and trades none of them must draft EXACTLY as it
--     does today; the probes assert that byte for byte.
--
-- (3) ONLY THE FUTURE SEASON WAS TRADEABLE. `_clean_trade_picks` resolved
--     every pick against `_future_pick_season`, so a current-season startup
--     pick could not even be named in an offer. It now accepts both, which is
--     also what makes a MIXED offer work: startup slots and rookie futures are
--     rows in the same table, so one trade carries both with no new plumbing.
--
-- THE GUARDS THE OLD GATE WAS DOING FOR US. With trading open during a live
-- draft, a pick is no longer a stable thing:
--   • a pick already MADE is a player now — refuse to trade it as a pick;
--   • the pick ON THE CLOCK is being used as we speak — refuse it too, or two
--     managers own the same selection at the same moment;
--   • an executed trade must move `draft.pick_owners`, not just `pick_asset`,
--     or the clock keeps calling the previous owner. `pick_owners` is the
--     draft's frozen copy — 0183 froze it at start deliberately ("the lookup
--     belongs to draft START") — so it is now kept in step on execute.
--
-- THE COMMISSIONER SWITCH is `settings_json.pick_trading`, default ON.
-- Turning it off refuses the pick half of any offer; players still trade.

alter table pick_asset add column if not exists kind text not null default 'rookie';
do $$ begin
  alter table pick_asset add constraint pick_asset_kind_ck check (kind in ('rookie', 'startup'));
exception when duplicate_object then null; end $$;

-- A startup draft runs to the league's ROUNDS (up to 25); 0183's 1..10 was
-- sized for rookie rounds alone.
do $$ begin
  alter table pick_asset drop constraint if exists pick_asset_round_check;
  alter table pick_asset add constraint pick_asset_round_check check (round between 1 and 25);
exception when others then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The commissioner's switch
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function league_pick_trading(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'pick_trading')::boolean, true) from league where id = p_league_id;
$$;
grant execute on function league_pick_trading(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Startup pick assets: one per seat per round of THIS league's own draft.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _provision_startup_picks(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare seas text; rds int; n int;
begin
  select season into seas from league where id = p_league_id;
  select greatest(1, least(25, rounds - coalesce(keeper_slots, 0))) into rds
    from draft where league_id = p_league_id;
  if rds is null then return 0; end if;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster, kind)
  select p_league_id, seas, r, m.sleeper_roster_id, m.sleeper_roster_id, 'startup'
    from generate_series(1, rds) r
    cross join league_membership m
   where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

/** set_pick_trading(league, on) — commissioner.
 *
 *  ON provisions this league's startup picks if its draft has not started, so
 *  there is something to trade. OFF refuses the pick half of future offers, and
 *  clears startup assets ONLY when every one still sits with its original
 *  owner — a traded pick is somebody's property and a settings flip must not
 *  delete it out from under them. That is `set_rookie_rounds`' rule (0183),
 *  applied to the same question. */
create or replace function set_pick_trading(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare seas text; moved int; made int := 0; st text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select season into seas from league where id = p_league_id;
  select status into st from draft where league_id = p_league_id;

  if p_on then
    if st = 'pending' then made := _provision_startup_picks(p_league_id); end if;
  else
    select count(*) into moved from pick_asset
      where league_id = p_league_id and season = seas and kind = 'startup'
        and owner_roster <> original_roster;
    if moved > 0 then
      return jsonb_build_object('ok', false, 'error',
        format('%s startup pick%s already changed hands — undo those trades first',
               moved, case when moved = 1 then '' else 's' end));
    end if;
    delete from pick_asset where league_id = p_league_id and season = seas and kind = 'startup';
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
    || jsonb_build_object('pick_trading', p_on) where id = p_league_id;
  return jsonb_build_object('ok', true, 'pick_trading', p_on, 'startup_picks', made);
end $$;
grant execute on function set_pick_trading(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Where a pick sits in the running order
-- ─────────────────────────────────────────────────────────────────────────────

/** The 1-based overall a (round, original seat) pick occupies, or null when the
 *  draft has no order yet. SNAKE for startup picks — the whole point of the
 *  kind — LINEAR for rookie ones, which is 0183's rule unchanged. */
create or replace function _pick_overall(p_league_id uuid, p_round int, p_orig int, p_snake boolean)
  returns int language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; n int; i int; idx int := null;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.draft_order is null then return null; end if;
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  for i in 0..(n - 1) loop
    if (d.draft_order ->> i)::int = p_orig then idx := i; exit; end if;
  end loop;
  if idx is null then return null; end if;
  -- On an even round of a snake the order reverses, so the seat that picks
  -- FIRST is the one that picked last.
  if p_snake and p_round % 2 = 0 then idx := n - 1 - idx; end if;
  return (p_round - 1) * n + idx + 1;
end $$;

/** Why this pick cannot be traded right now, or null. Only meaningful mid-draft;
 *  a pending draft has nothing on the clock and a finished one has no picks
 *  left to move. */
create or replace function _pick_locked_error(p_league_id uuid, p_season text, p_round int, p_orig int)
  returns text language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; lseas text; ov int; knd text;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return null; end if;
  select season into lseas from league where id = p_league_id;
  -- A FUTURE pick is untouched by the draft running now.
  if p_season is distinct from lseas then return null; end if;
  select kind into knd from pick_asset where league_id = p_league_id
    and season = p_season and round = p_round and original_roster = p_orig;
  ov := _pick_overall(p_league_id, p_round, p_orig, coalesce(knd, 'startup') = 'startup');
  if ov is null then return null; end if;
  if ov < d.current_overall then
    return format('round-%s pick (Team %s original) has already been used', p_round, p_orig);
  end if;
  if ov = d.current_overall then
    return format('round-%s pick (Team %s original) is on the clock right now', p_round, p_orig);
  end if;
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- _clean_trade_picks v2: the CURRENT season is tradeable too.
-- ─────────────────────────────────────────────────────────────────────────────
-- 0183 resolved every pick against `_future_pick_season`, which is right while
-- the only assets are rookie futures and wrong the moment a startup draft has
-- picks of its own. Both are now accepted, and the row itself says which season
-- it belongs to — so a MIXED offer (a startup slot AND a rookie future) needs
-- no new plumbing at all: they are rows in one table, and this returns both.
create or replace function _clean_trade_picks(p_league_id uuid, p_picks jsonb)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare fut text; cur text; el jsonb; rnd int; orig int; seas text; cleaned jsonb := '[]'::jsonb;
begin
  if p_picks is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_picks) <> 'array' then
    raise exception 'picks must be a list';
  end if;
  fut := _future_pick_season(p_league_id);
  select season into cur from league where id = p_league_id;
  for el in select * from jsonb_array_elements(p_picks) loop
    begin rnd := (el ->> 'round')::int; orig := (el ->> 'orig')::int;
    exception when others then rnd := null; orig := null; end;
    if rnd is null or orig is null then raise exception 'each pick needs round and orig'; end if;
    -- An explicit season wins; without one, prefer the CURRENT season's pick
    -- (the draft in front of you) and fall back to the future's.
    seas := nullif(btrim(coalesce(el ->> 'season', '')), '');
    if seas is null then
      if exists (select 1 from pick_asset pa where pa.league_id = p_league_id
                 and pa.season = cur and pa.round = rnd and pa.original_roster = orig)
      then seas := cur; else seas := fut; end if;
    end if;
    if not exists (select 1 from pick_asset pa where pa.league_id = p_league_id
                   and pa.season = seas and pa.round = rnd and pa.original_roster = orig) then
      raise exception 'no such pick: % round %', seas, rnd;
    end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('season', seas, 'round', rnd, 'orig', orig));
  end loop;
  return cleaned;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- propose_trade v3: open before and during the draft.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text; el jsonb;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  begin
    gp := _clean_trade_picks(p_league_id, p_give_picks);
    tp := _clean_trade_picks(p_league_id, p_get_picks);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  -- The commissioner's switch, checked once for both halves.
  if (jsonb_array_length(gp) > 0 or jsonb_array_length(tp) > 0)
     and not league_pick_trading(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
  end if;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(gp) > 10 or jsonb_array_length(tp) > 10
     or jsonb_array_length(p_give) + jsonb_array_length(p_get)
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1 then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players or picks each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
  end if;
  if (select count(distinct value) from jsonb_array_elements(gp || tp))
     <> jsonb_array_length(gp) + jsonb_array_length(tp) then
    return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only offer your own players');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only ask for their players');
  end if;
  err := _pick_ownership_error(p_league_id, p_from_roster, gp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only offer picks you own — ' || err); end if;
  err := _pick_ownership_error(p_league_id, p_to_roster, tp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only ask for picks they own — ' || err); end if;
  -- MID-DRAFT: a pick already used is a player now, and the pick on the clock
  -- is being spent as we speak. Neither is a thing to put in an offer.
  for el in select * from jsonb_array_elements(gp || tp) loop
    err := _pick_locked_error(p_league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- execute_trade v3: move the DRAFT'S copy of ownership too.
-- ─────────────────────────────────────────────────────────────────────────────
-- `pick_owners` is the frozen per-overall owner list `_start_draft_now` builds,
-- and `draft_on_clock` reads it in preference to the snake arithmetic. Moving
-- `pick_asset` alone would therefore change who OWNS a pick without changing
-- who gets CALLED for it — the trade would look done and do nothing.
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  if _pick_ownership_error(t.league_id, t.from_roster, t.give_picks) is not null
     or _pick_ownership_error(t.league_id, t.to_roster, t.get_picks) is not null then
    return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
  end if;
  -- Re-checked at EXECUTE, not just at propose: an offer made three picks ago
  -- can be accepted after the clock has passed the very pick it moves.
  for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
    err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
  end loop;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  for el in select * from jsonb_array_elements(t.give_picks) loop
    update pick_asset set owner_roster = t.to_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  for el in select * from jsonb_array_elements(t.get_picks) loop
    update pick_asset set owner_roster = t.from_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;

  -- Keep the running draft's own copy in step.
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
      if (el ->> 'season') = lseas then
        select kind into knd from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text],
            to_jsonb((select owner_roster from pick_asset where league_id = t.league_id
                      and season = el ->> 'season' and round = (el ->> 'round')::int
                      and original_roster = (el ->> 'orig')::int)));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- _start_draft_now v4: the owner list snakes for startup picks
-- ─────────────────────────────────────────────────────────────────────────────
-- _start_draft_now v4 (0190): 0183's body, with the owner walk taught to
-- snake for startup picks. Everything else is verbatim.
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots < 1 then
    return jsonb_build_object('ok', false, 'error', 'keepers fill the whole roster — no rounds left to draft');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v
           where v.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots) * n;
  end if;

  if (select count(*) from league_pool lp
      where lp.league_id = p_league_id
        and not exists (select 1 from native_roster nr
                        where nr.league_id = lp.league_id and nr.slug = lp.slug))
     < total_picks then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership set draft_budget = d.budget where league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- pick_assets v2: the kind, and the switch
-- ─────────────────────────────────────────────────────────────────────────────
-- 0183's shape plus two fields a client now needs: `kind` (a startup SLOT in
-- the draft in front of you reads differently from a rookie FUTURE, and only
-- one of them can be on the clock), and `pick_trading`, so the trade screen can
-- say "the commissioner has this off" instead of offering picks that will be
-- refused on submit.
create or replace function pick_assets(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cur text;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select season into cur from league where id = p_league_id;
  return jsonb_build_object(
    'ok', true,
    'rookie_rounds', coalesce((select (settings_json ->> 'rookie_rounds')::int from league where id = p_league_id), 0),
    'future_season', _future_pick_season(p_league_id),
    'current_season', cur,
    'pick_trading', league_pick_trading(p_league_id),
    'picks', coalesce((select jsonb_agg(jsonb_build_object(
        'season', pa.season, 'round', pa.round, 'kind', pa.kind,
        'orig', pa.original_roster, 'owner', pa.owner_roster)
        order by pa.season, pa.round, pa.original_roster)
      from pick_asset pa where pa.league_id = p_league_id), '[]'::jsonb));
end $$;
