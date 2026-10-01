-- ═══════════════════════════════════════════════════════════════════════════
-- 0411 · THE DEVY DRAFT — devy rounds at the end of the draft, and devy picks
-- that trade.
--
-- Until now a devy league restocked from college free agency: the yearly
-- draft counted the devy spots as pre-filled (0368) and was NFL-only, so an
-- open spot went to whoever got to the wire first. A devy league's real loop
-- is a DEVY DRAFT: a few rounds of college players every year, its picks
-- traded like rookie picks.
--
-- THE SETTING. settings_json.devy_rounds, 0–5 and at most the devy spots
-- (set_devy_rounds, commissioner). Spots leagues only; an auction ignores it.
--
-- THE DRAFT. The draft runs its main rounds, then the DEVY BLOCK: devy_rounds
-- more rounds where every pick is a college player — and the main rounds take
-- none (native_exec_pick, the queue and autopick all honor it). In the yearly
-- draft the devy spots are already counted as filled (0368), so the block is
-- extra picks; a team whose shelf is full drafts past it and drops one, the
-- over-limit rule a team that traded for extra picks already lives with. In a
-- STARTUP draft the devy spots come out of the main rounds and the block fills
-- them — the "8.01 is Devy 1.01" format.
--
-- THE PICKS. In a league with rookie pick assets, devy round k is asset round
-- 100 + k (rookie rounds are 1–10, startup slots ≤ 99), so it never collides
-- with either and every trade path that moves a pick by (season, round, slot)
-- moves it unchanged. _provision_pick_assets keeps a season's devy picks in
-- step with the setting wherever it provisions rookie picks (the commissioner,
-- the rollover). The block runs linear, like the rookie rounds.
-- ═══════════════════════════════════════════════════════════════════════════

-- Devy picks are rounds 101–105 (0192 allowed 1–99).
alter table pick_asset drop constraint if exists pick_asset_round_check;
alter table pick_asset add constraint pick_asset_round_check check (round between 1 and 99 or round between 101 and 105);

alter table draft add column if not exists devy_from int;          -- first overall pick of the devy block
alter table draft add column if not exists devy_rounds int not null default 0;

-- How many devy rounds this league runs (0 when it can't).
create or replace function _devy_rounds(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select settings_json ->> 'devy_mode' from league where id = p_league_id), 'spots') = 'shares' then 0
    else least(greatest(coalesce((select (settings_json ->> 'devy_rounds')::int from league where id = p_league_id), 0), 0),
               _devy_slots(p_league_id), 5) end
$$;

-- Is this league a season rolled from an earlier one (its devy spots carried)?
create or replace function _is_rollover_child(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league l join league p on p.sleeper_league_id = l.sleeper_league_id
    where l.id = p_league_id and l.season ~ '^\d{4}$' and p.season = ((l.season)::int - 1)::text and p.provider = 'native')
$$;

-- What a draft runs: its main rounds and its devy block. The yearly draft's
-- keeper_slots already count the devy spots (0368); a startup's don't, so
-- there the block takes the devy spots out of the main rounds.
create or replace function _draft_plan(p_league_id uuid, out main int, out devy int)
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  select * into d from draft where league_id = p_league_id;
  devy := case when d.mode = 'auction' then 0 else _devy_rounds(p_league_id) end;
  main := d.rounds - d.keeper_slots - d.stash_slots
          - case when devy > 0 and not _is_rollover_child(p_league_id) then _devy_slots(p_league_id) else 0 end;
end $$;

-- Devy pick assets for one season: rounds 101..100+n on every seat. Rounds
-- above it go, unless a trade has moved one.
create or replace function _provision_devy_assets(p_league_id uuid, p_season text, p_n int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare made int; gone int;
begin
  if exists (select 1 from pick_asset pa
             where pa.league_id = p_league_id and pa.season = p_season
               and pa.round > 100 + greatest(p_n, 0) and pa.owner_roster <> pa.original_roster) then
    return jsonb_build_object('ok', false, 'error',
      'trades already moved devy picks in the rounds being removed — undo those first');
  end if;
  delete from pick_asset where league_id = p_league_id and season = p_season and round > 100 + greatest(p_n, 0);
  get diagnostics gone = row_count;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster, kind)
  select p_league_id, p_season, 100 + k, m.sleeper_roster_id, m.sleeper_roster_id, 'rookie'
    from league_membership m, generate_series(1, greatest(p_n, 0)) k
   where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics made = row_count;
  return jsonb_build_object('ok', true, 'created', made, 'removed', gone);
end $$;

-- Commissioner: how many devy rounds the draft runs.
create or replace function set_devy_rounds(p_league_id uuid, p_rounds int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; dv int; n int; seas text; r jsonb; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if coalesce(lg.settings_json ->> 'devy_mode', 'spots') = 'shares' then
    return jsonb_build_object('ok', false, 'error', 'a devy market league reserves players through shares, not devy rounds');
  end if;
  dv := _devy_slots(p_league_id);
  if dv < 1 then return jsonb_build_object('ok', false, 'error', 'devy rounds need devy spots on the roster'); end if;
  n := coalesce(p_rounds, 0);
  if n < 0 or n > least(dv, 5) then
    return jsonb_build_object('ok', false, 'error', format('devy rounds run 0–%s (no more than the devy spots)', least(dv, 5)));
  end if;
  select status into dstat from draft where league_id = p_league_id;
  -- Devy picks follow, for every season that holds rookie picks — this
  -- season's only while its draft is still to run.
  for seas in select distinct pa.season from pick_asset pa
      where pa.league_id = p_league_id and pa.round < 100
        and (pa.season > lg.season or (pa.season = lg.season and coalesce(dstat, 'pending') = 'pending')) loop
    r := _provision_devy_assets(p_league_id, seas, n);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_rounds', n)
   where id = p_league_id;
  return jsonb_build_object('ok', true, 'devy_rounds', n);
end $$;
grant execute on function set_devy_rounds(uuid, int) to authenticated;

-- ── _provision_pick_assets — 0183's body: rookie rounds only, devy in step ──
create or replace function _provision_pick_assets(p_league_id uuid, p_season text, p_rounds int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare made int; gone int;
begin
  if p_season is null then return jsonb_build_object('ok', false, 'error', 'league season is not a year'); end if;
  if exists (select 1 from pick_asset pa
             where pa.league_id = p_league_id and pa.season = p_season
               and pa.round > p_rounds and pa.round < 100 and pa.owner_roster <> pa.original_roster) then
    return jsonb_build_object('ok', false, 'error',
      'trades already moved picks in the rounds being removed — undo those first');
  end if;
  delete from pick_asset
    where league_id = p_league_id and season = p_season and round > p_rounds and round < 100;
  get diagnostics gone = row_count;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select p_league_id, p_season, r, m.sleeper_roster_id, m.sleeper_roster_id
  from league_membership m, generate_series(1, greatest(p_rounds, 0)) r
  where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics made = row_count;
  -- 0411: a season with rookie picks carries the league's devy picks too;
  -- one with none carries none (a traded devy pick stays, as a traded rookie
  -- pick would).
  if _devy_rounds(p_league_id) > 0 or exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = p_season and pa.round > 100) then
    perform _provision_devy_assets(p_league_id, p_season,
      case when p_rounds > 0 then _devy_rounds(p_league_id) else 0 end);
  end if;
  return jsonb_build_object('ok', true, 'created', made, 'removed', gone);
end $$;

-- ── _start_draft_now — 0268's body, plus the devy block ──
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int; vamps int[]; v int;
  dvr int; mainr int; dfrom int;   -- 0411
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  -- 0411: THE DEVY ROUNDS. What this draft runs: its main rounds, then the
  -- devy block (none in an auction).
  select pl.main, pl.devy into mainr, dvr from _draft_plan(p_league_id) pl;
  if mainr < 1 and dvr < 1 then
    return jsonb_build_object('ok', false, 'error',
      'no rounds left to draft — keepers and IR spots fill the whole roster');
  end if;

  -- 0268: vampires appointed before the draft never enter it — they build
  -- from what the drafting teams leave in the pool.
  vamps := case when league_format(p_league_id) = 'vampire'
                then coalesce(vampire_seats(p_league_id), '{}') else '{}'::int[] end;
  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id
      and not (sleeper_roster_id = any(vamps));
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v2.x) from (select (jsonb_array_elements_text(p_order))::int as x) v2
        where v2.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v2.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v2
           where v2.x = any(ids)) = n
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
      where pa.league_id = p_league_id and pa.season = lseas and pa.round < 100) then
    -- 0411: the ROOKIE rounds are the assets under 100; devy rounds live at
    -- 101+ and run after them, below.
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas and round < 100;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas and round < 100;
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
    mainr := maxr;
    -- 0411: the devy block — linear like the rookie rounds, each pick its
    -- asset's owner (round 100 + k), or the slot's own team without one.
    for r in 1..dvr loop
      for i in 0..(n - 1) loop
        orig := (ord ->> (case when coalesce(snake_kind, false) and (maxr + r) % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = 100 + r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  elsif dvr > 0 then
    -- 0411: no assets, but a devy block: the plain order, written out, so the
    -- draft's length and the block's start are explicit.
    owners := '[]'::jsonb;
    for r in 1..(greatest(mainr, 0) + dvr) loop
      for i in 0..(n - 1) loop
        orig := (ord ->> (case when d.mode <> 'linear' and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(orig);
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots - d.stash_slots) * n;
  end if;
  dfrom := case when dvr > 0 then greatest(mainr, 0) * n + 1 end;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  select count(*) into pool_n from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr
                      where nr.league_id = lp.league_id and nr.slug = lp.slug);
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, total_picks / n, n, pool_n));
  end if;
  -- 0411: the devy block needs college players to take
  if dvr > 0 and (select count(*) from league_pool lp where lp.league_id = p_league_id and lp.level = 'college'
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)) < dvr * n then
    return jsonb_build_object('ok', false, 'error',
      format('the devy rounds need %s college players and the pool has fewer — re-seed with college players on', dvr * n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    devy_from = dfrom, devy_rounds = dvr,   -- 0411
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership m set draft_budget = case
      -- a contract league's carried payroll (rolled-over deals, dead money)
      -- already spent part of this seat's money — the room only gets the rest
      when contracts_on(p_league_id)
        then greatest(1, d.budget - team_payroll(p_league_id, m.sleeper_roster_id))
      else d.budget end
    where m.league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;
  -- The coven queues behind the drafting teams — deterministic, and only
  -- meaningful when the wire is unlocked for everyone anyway.
  i := n;
  foreach v in array vamps loop
    i := i + 1;
    update league_membership set waiver_priority = i
      where league_id = p_league_id and sleeper_roster_id = v;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null, 'devy_rounds', dvr, 'devy_from', dfrom, 'vampires_excluded', coalesce(array_length(vamps, 1), 0));
end $$;

-- ── native_exec_pick — 0387's body, plus the devy block ──
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text; total int; resv int; in_devy boolean;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;
  total := case when d.pick_owners is not null then jsonb_array_length(d.pick_owners)
                else (d.rounds - d.keeper_slots - d.stash_slots) * n end;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  -- 0411: THE DEVY BLOCK. Its picks are college players and only college
  -- players; the rounds before it are NFL rounds. A devy pick may land past a
  -- full devy shelf — the same over-limit rule a team that traded for extra
  -- picks lives with: it drops one before its moves unfreeze.
  in_devy := d.devy_from is not null and d.current_overall >= d.devy_from;
  if d.devy_from is not null then
    if in_devy and p_slug !~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'this is a devy round — pick a college player');
    end if;
    if not in_devy and p_slug ~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error',
        'college players go in the devy rounds — they start at pick ' || d.devy_from);
    end if;
  end if;
  if not p_auto and not in_devy then
    err := pos_cap_error(p_league_id, oc, p_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;
  -- 0387: DEVY SHARES. A reserved player is his right-holder's alone, and a
  -- holder whose picks left equal his untaken reservations must take them.
  if d.mode <> 'auction' and _devy_shares_on(p_league_id) then
    select r.roster_id into resv from devy_reserved(p_league_id) r where r.slug = p_slug;
    if resv is not null and resv <> oc then
      return jsonb_build_object('ok', false, 'error',
        'reserved: ' || coalesce((select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = resv), 'Team ' || resv)
        || ' holds his devy rights');
    end if;
    if resv is null and _devy_pick_forced(p_league_id, oc) then
      return jsonb_build_object('ok', false, 'error',
        'your remaining picks go to your reserved players: ' || coalesce((select string_agg(lp.full_name, ', ' order by lp.rank)
          from devy_reserved(p_league_id) r join league_pool lp on lp.league_id = p_league_id and lp.slug = r.slug
          where r.roster_id = oc), ''));
    end if;
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= total then
    update draft set status = 'complete', completed_at = now(), deadline_at = null,
      current_overall = d.current_overall + 1
      where league_id = p_league_id;
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc,
      'slug', p_slug, 'complete', true);
  end if;

  update draft set current_overall = d.current_overall + 1,
    deadline_at = draft_deadline(d, d.pick_seconds)
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc, 'slug', p_slug);
end $$;

-- ── _pick_overall — 0190's, plus devy rounds: round 100 + k is the k-th
-- round of the devy block, so a mid-draft trade locks a used devy pick and
-- moves the running draft's owner list like any other ──
create or replace function _pick_overall(p_league_id uuid, p_round int, p_orig int, p_snake boolean)
  returns int language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; n int; i int; idx int := null; rnd int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.draft_order is null then return null; end if;
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  for i in 0..(n - 1) loop
    if (d.draft_order ->> i)::int = p_orig then idx := i; exit; end if;
  end loop;
  if idx is null then return null; end if;
  rnd := p_round;
  if p_round > 100 then
    if d.devy_from is null then return null; end if;   -- no block in this draft
    rnd := (d.devy_from - 1) / n + (p_round - 100);
  end if;
  -- On an even round of a snake the order reverses, so the seat that picks
  -- FIRST is the one that picked last.
  if p_snake and rnd % 2 = 0 then idx := n - 1 - idx; end if;
  return (rnd - 1) * n + idx + 1;
end $$;

-- ── the queue and autopick take what the pick on the clock may take ──
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_queue_pick_0387') then
    alter function native_queue_pick(uuid, int) rename to _queue_pick_0387;
  end if;
  if not exists (select 1 from pg_proc where proname = '_autopick_slug_0387') then
    alter function native_autopick_slug(uuid, int, int) rename to _autopick_slug_0387;
  end if;
  if not exists (select 1 from pg_proc where proname = '_draft_state_0269') then
    alter function draft_state(uuid) rename to _draft_state_0269;
  end if;
  if not exists (select 1 from pg_proc where proname = '_rollover_league_0368') then
    alter function rollover_league(uuid, int, boolean) rename to _rollover_league_0368;
  end if;
end $$;

-- Which level the pick on the clock takes: 'college' in the devy block,
-- 'nfl' before it, null in a draft without one.
create or replace function _draft_pick_level(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when d.devy_from is null or d.status <> 'live' then null
              when d.current_overall >= d.devy_from then 'college' else 'nfl' end
    from draft d where d.league_id = p_league_id
$$;

create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; lvl text;
begin
  pick := _queue_pick_0387(p_league_id, p_roster_id);
  lvl := _draft_pick_level(p_league_id);
  -- 0411: a queued player this pick can't take is skipped; autopick answers.
  if pick is not null and lvl is not null and (pick ~ '^c-[0-9]+$') <> (lvl = 'college') then
    select q.slug into pick from draft_queue q
      join league_pool lp on lp.league_id = q.league_id and lp.slug = q.slug
     where q.league_id = p_league_id and q.roster_id = p_roster_id and lp.level = lvl
       and not exists (select 1 from native_roster nr where nr.league_id = q.league_id and nr.slug = q.slug)
       and (lvl = 'college' or pos_cap_error(p_league_id, p_roster_id, q.slug) is null)
     order by q.pos limit 1;
  end if;
  return pick;
end $$;

create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; lvl text := _draft_pick_level(p_league_id);
begin
  -- 0411: in the devy block, the best college player left.
  if lvl = 'college' then
    select lp.slug into pick from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'college'
       and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
     order by lp.rank, lp.slug limit 1;
    return pick;
  end if;
  pick := _autopick_slug_0387(p_league_id, p_roster_id, p_rounds);
  -- before it, never a college player (the shelf fills in the block)
  if lvl = 'nfl' and pick ~ '^c-[0-9]+$' then
    select lp.slug into pick from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'nfl'
       and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
       and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
     order by lp.rank, lp.slug limit 1;
  end if;
  return pick;
end $$;

-- draft_state: 0269's, plus the devy block (and a pending preview that
-- counts rounds, not the highest asset round).
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; d draft%rowtype; pl record; nrook int; lseas text;
begin
  r := _draft_state_0269(p_league_id);
  if r ? 'error' then return r; end if;
  select * into d from draft where league_id = p_league_id;
  if d.status = 'pending' then
    select * into pl from _draft_plan(p_league_id);
    select season into lseas from league where id = p_league_id;
    select count(distinct pa.round) into nrook from pick_asset pa
     where pa.league_id = p_league_id and pa.season = lseas and pa.round < 100;
    r := r || jsonb_build_object('devy_rounds', pl.devy,
      'rounds', case when d.mode = 'snake' and nrook > 0 then to_jsonb(nrook + pl.devy)
                     when pl.devy > 0 then to_jsonb(greatest(pl.main, 0) + pl.devy)
                     else (r -> 'rounds') end);
  else
    r := r || jsonb_build_object('devy_rounds', d.devy_rounds, 'devy_from', d.devy_from);
  end if;
  return r;
end $$;
grant execute on function draft_state(uuid) to authenticated;

-- rollover_league: 0368's, with the new draft's length said in rounds.
create or replace function rollover_league(p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; nl uuid; pl record; nrook int;
begin
  r := _rollover_league_0368(p_league_id, p_weeks, p_rookie_only);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  nl := (r ->> 'league_id')::uuid;
  select * into pl from _draft_plan(nl);
  select count(distinct pa.round) into nrook from pick_asset pa
   where pa.league_id = nl and pa.season = r ->> 'season' and pa.round < 100;
  return r || jsonb_build_object('devy_rounds', pl.devy,
    'draft_rounds', case when nrook > 0 and (select mode from draft where league_id = nl) = 'snake' then nrook + pl.devy
                         else greatest(pl.main, 0) + pl.devy end);
end $$;
grant execute on function rollover_league(uuid, int, boolean) to authenticated;
