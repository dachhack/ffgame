-- 0182: DYNASTY, PHASE 1 — SEASON ROLLOVER WITH KEEPERS.
--
-- The commissioner ends a season and rolls the league into the next one. The
-- architecture works WITH two structural facts instead of against them:
--   • draft.league_id is the PRIMARY KEY (0064) — one draft per league row,
--     and every piece of draft machinery keys on it. We never put a second
--     draft on an existing league.
--   • league is unique(sleeper_league_id, season) (0001) — the same league
--     can exist once PER SEASON. So a new season is a NEW league row with the
--     SAME sleeper_league_id at season+1, which gets its own draft slot,
--     schedule, wallets and standings for free.
--
-- WHAT ROLLS OVER: settings_json wholesale (game mode, scoring, the classic
-- spec, roster shape, pos caps, pool filter, keeper_count — "same league,
-- next year"), commissioner, memberships with their claimed managers and team
-- names, the player pool, and each team's KEEPERS onto native_roster. What
-- deliberately does NOT: wallets (fresh season seed — team_wallet is keyed by
-- league row, so the new season starts at ◎0 and the existing weekly-budget
-- machinery funds it), FAAB balances (reset to the league default), waiver
-- priority (re-derived at the new draft), taxi/IR designations (players come
-- back 'active'; the manager re-designates), practice/test toggles, and the
-- member-sync clocks. Seat agents (0180) are NOT copied — the membership rows
-- for agent-backed seats arrive open and the worker re-provisions agents on
-- its own; seat_agent has unique(agent_user_id), so an old season's agent
-- could not serve the new row anyway.
--
-- KEEPERS: the commissioner sets a league-wide keeper count
-- (settings_json.keeper_count); managers declare up to that many from their
-- roster (keeper_pick, on the OLD league); at rollover every seat keeps
-- exactly N — declared players first, topped up by pool rank (the pool is
-- seeded ranked by projection, so "top-N by projection" and "top-N by rank"
-- are the same statement server-side). Kept players land on the new league's
-- native_roster as acquired='keeper' BEFORE the draft, so the existing draft
-- machinery excludes them without modification (native_exec_pick and
-- autopick both refuse rostered players).
--
-- ROUNDS vs ROSTER SIZE — the one semantic worth stating precisely.
-- draft.rounds has always meant BOTH "how many picks each team makes" and
-- "the roster cap" (add_free_agent, waivers, trades, auction budgets all read
-- it as the cap). Keepers split those meanings. We keep d.rounds = ROSTER
-- SIZE, so every cap consumer — add_free_agent, submit_waiver_claim,
-- process_waivers, the trade validator, auction_spots_left, native_team_state,
-- _sync_classic_rounds — is UNTOUCHED and stays correct. The new column
-- draft.keeper_slots says how many of those spots arrived pre-filled, and only
-- the PICK-COUNT logic learns about it: snake completion fires at
-- (rounds − keeper_slots) picks per team, and the auction already completes
-- off spots_left = rounds − roster count, which counts keepers by itself.
--
-- THE ROOKIE DRAFT (dynasty phase 2) falls out of this: rollover_league with
-- p_rookie_only=true carries ONLY the kept players into the new pool and sets
-- settings_json.pool_filter to {max_exp: 0} (0171's existing filter, which
-- buildDraftPool already honors), so the pre-draft reseed produces
-- keepers + rookies and the draft can only sell rookies. Until that reseed
-- happens the free pool is empty and _start_draft_now refuses — a scheduled
-- start cannot fire into a veterans-included pool by accident. seed_league_pool
-- is patched below to PRESERVE rostered players when it replaces the pool:
-- its delete-all previously cascaded into native_roster (the FK is
-- on delete cascade), which would have silently dropped every keeper.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────────────────────

alter table draft add column if not exists keeper_slots int not null default 0;
alter table draft drop constraint if exists draft_keeper_slots_check;
alter table draft add constraint draft_keeper_slots_check check (keeper_slots >= 0);

-- 'keeper' joins the acquisition kinds (0072 added 'trade').
alter table native_roster drop constraint if exists native_roster_acquired_check;
alter table native_roster add constraint native_roster_acquired_check
  check (acquired in ('draft', 'waiver', 'fa', 'commish', 'trade', 'keeper'));

-- A manager's declared keepers, on the CURRENT (pre-rollover) league. The FK
-- into native_roster means dropping or trading a player retracts the
-- declaration automatically — a keeper list can never name a player the team
-- no longer owns.
create table if not exists keeper_pick (
  league_id uuid not null references league(id) on delete cascade,
  roster_id int  not null,
  slug      text not null,
  added_at  timestamptz not null default now(),
  primary key (league_id, slug),
  foreign key (league_id, slug) references native_roster(league_id, slug) on delete cascade
);
create index if not exists keeper_pick_roster on keeper_pick(league_id, roster_id);

alter table keeper_pick enable row level security;
drop policy if exists keeper_pick_read on keeper_pick;
create policy keeper_pick_read on keeper_pick for select using (is_league_member(league_id));
-- No write policies: all writes go through the RPCs below.

-- ─────────────────────────────────────────────────────────────────────────────
-- Keeper declaration
-- ─────────────────────────────────────────────────────────────────────────────

-- The next-season league row this one already rolled into, if any.
create or replace function _rollover_target(p_league_id uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select n.id from league l
  join league n on n.sleeper_league_id = l.sleeper_league_id
    and l.season ~ '^\d{4}$'
    and n.season = ((l.season)::int + 1)::text
  where l.id = p_league_id
  limit 1;
$$;

-- Commissioner: how many players every team keeps into next season.
create or replace function set_keeper_count(p_league_id uuid, p_count int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; c int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  c := coalesce(p_count, 0);
  -- rounds − 1 keeps at least one draftable spot next season; 0 = full redraft.
  if c < 0 or c > d.rounds - 1 then
    return jsonb_build_object('ok', false, 'error',
      'keepers must be 0–' || (d.rounds - 1) || ' (the roster holds ' || d.rounds || ')');
  end if;
  if _rollover_target(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'this season already rolled over');
  end if;
  update league set settings_json =
      case when c = 0 then coalesce(settings_json, '{}'::jsonb) - 'keeper_count'
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('keeper_count', c) end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'keeper_count', c);
end $$;

-- A manager (or the commissioner on their behalf) declares this roster's
-- keepers. Replace-all semantics: the list sent is the list stored.
create or replace function set_keepers(p_league_id uuid, p_roster_id int, p_slugs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nk int; s text; cnt int := 0; d draft%rowtype;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'keepers are declared after the season''s draft');
  end if;
  nk := coalesce((select (settings_json ->> 'keeper_count')::int from league where id = p_league_id), 0);
  if nk = 0 then
    return jsonb_build_object('ok', false, 'error', 'this league keeps no players — ask the commissioner');
  end if;
  if _rollover_target(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'this season already rolled over');
  end if;
  if p_slugs is null or jsonb_typeof(p_slugs) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'keepers must be a list');
  end if;
  if (select count(distinct v) from jsonb_array_elements_text(p_slugs) v) > nk then
    return jsonb_build_object('ok', false, 'error', 'at most ' || nk || ' keepers');
  end if;

  -- Validate the whole list BEFORE touching stored state — an error return
  -- would otherwise commit a half-replaced declaration.
  select v into s from jsonb_array_elements_text(p_slugs) v
    where not exists (select 1 from native_roster nr
                      where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug = v)
    limit 1;
  if s is not null then
    return jsonb_build_object('ok', false, 'error', 'not on this roster: ' || s);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  delete from keeper_pick where league_id = p_league_id and roster_id = p_roster_id;
  insert into keeper_pick (league_id, roster_id, slug)
  select distinct p_league_id, p_roster_id, v from jsonb_array_elements_text(p_slugs) v;
  get diagnostics cnt = row_count;
  return jsonb_build_object('ok', true, 'declared', cnt);
end $$;

-- The keeper set rollover would carry TODAY: declared players first, then
-- top-up by pool rank. Used by both the preview (keeper_state) and the
-- rollover itself, so what the screen shows is what the rollover does.
create or replace function _keeper_resolve(p_league_id uuid, p_count int)
  returns table (roster_id int, slug text, declared boolean)
  language sql stable security definer set search_path = public as $$
  select t.roster_id, t.slug, t.declared from (
    select nr.roster_id, nr.slug, (kp.slug is not null) as declared,
           row_number() over (partition by nr.roster_id
             order by (kp.slug is not null) desc, lp.rank, nr.slug) as rn
    from native_roster nr
    join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    left join keeper_pick kp on kp.league_id = nr.league_id
      and kp.roster_id = nr.roster_id and kp.slug = nr.slug
    where nr.league_id = p_league_id
  ) t where t.rn <= p_count;
$$;

-- One-shot state for the keeper/rollover UI: the count, every seat's declared
-- list, the resolved keep-list preview, and whether the season already rolled.
create or replace function keeper_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nk int; d draft%rowtype; my_r int; seas text; rolled uuid;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  nk := coalesce((select (settings_json ->> 'keeper_count')::int from league where id = p_league_id), 0);
  select season into seas from league where id = p_league_id;
  rolled := _rollover_target(p_league_id);
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  return jsonb_build_object(
    'ok', true,
    'keeper_count', nk,
    'roster_size', d.rounds,
    'draft_status', d.status,
    'season', seas,
    'next_season', case when seas ~ '^\d{4}$' then ((seas)::int + 1)::text end,
    'game_mode', coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip'),
    'rolled_league_id', rolled,
    'my_roster_id', my_r,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'claimed', m.app_user_id is not null,
        'declared', coalesce((select jsonb_agg(kp.slug order by kp.added_at) from keeper_pick kp
          where kp.league_id = p_league_id and kp.roster_id = m.sleeper_roster_id), '[]'::jsonb),
        'keep', case when nk > 0 then coalesce((select jsonb_agg(jsonb_build_object(
            'slug', kr.slug, 'declared', kr.declared) order by kr.declared desc, kr.slug)
          from _keeper_resolve(p_league_id, nk) kr
          where kr.roster_id = m.sleeper_roster_id), '[]'::jsonb) else '[]'::jsonb end)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The rollover
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function rollover_league(
  p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype; d draft%rowtype; nk int; next_seas text; nlid uuid;
  kept int; sched jsonb; gm text; new_settings jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues roll over — re-import a platform league''s new season instead');
  end if;
  if lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'only full leagues roll over');
  end if;
  if lg.is_mock then
    return jsonb_build_object('ok', false, 'error', 'mock drafts don''t roll over');
  end if;
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'this season''s draft never finished — nothing to roll over');
  end if;

  next_seas := ((lg.season)::int + 1)::text;
  nlid := _rollover_target(p_league_id);
  if nlid is not null then
    return jsonb_build_object('ok', false, 'error', 'already rolled into ' || next_seas, 'league_id', nlid);
  end if;

  nk := least(coalesce((lg.settings_json ->> 'keeper_count')::int, 0), d.rounds - 1);
  gm := coalesce(lg.settings_json ->> 'game_mode', 'drip');

  -- Same settings, scoring and spec — with the pool filter forced to
  -- rookies-only when this rollover feeds a rookie draft.
  new_settings := coalesce(lg.settings_json, '{}'::jsonb);
  if p_rookie_only then
    new_settings := new_settings || jsonb_build_object('pool_filter', jsonb_build_object('max_exp', 0));
  end if;

  insert into league (sleeper_league_id, season, name, provider, settings_json,
                      commissioner_id, synced_at, avatar_url, kdst_mode, weekly_budget,
                      lineup_policy, pot_ante, pot_cap, kind)
  values (lg.sleeper_league_id, next_seas, lg.name, 'native', new_settings,
          lg.commissioner_id, now(), lg.avatar_url, lg.kdst_mode, lg.weekly_budget,
          lg.lineup_policy, lg.pot_ante, lg.pot_cap, 'league')
  returning id into nlid;

  -- Memberships: same seats, same managers, same team names. Balances and
  -- priorities are season state, not identity — they start fresh.
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id,
                                 app_user_id, enrolled, team_name, claim_email,
                                 avatar_url, controller)
  select nlid, m.sleeper_roster_id, m.sleeper_owner_id,
         m.app_user_id, m.enrolled, m.team_name, m.claim_email,
         m.avatar_url, m.controller
  from league_membership m where m.league_id = p_league_id;

  -- The player pool. A rookie-only rollover carries just the kept players
  -- (their native_roster rows need the FK) and leaves the rest to the
  -- rookies-only reseed; a full rollover carries the whole pool with waiver
  -- clocks cleared. Ranks are last season's — the pre-draft reseed refreshes
  -- them, and seed_league_pool (patched below) preserves rostered players.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select nlid, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
  from league_pool lp
  where lp.league_id = p_league_id
    and (not p_rookie_only or exists (
      select 1 from _keeper_resolve(p_league_id, nk) kr where kr.slug = lp.slug));

  -- Keepers onto the new roster, pre-draft. acquired='keeper', spot='active'
  -- (taxi/IR are in-season designations; the manager re-declares them).
  insert into native_roster (league_id, roster_id, slug, acquired)
  select nlid, kr.roster_id, kr.slug, 'keeper'
  from _keeper_resolve(p_league_id, nk) kr;
  get diagnostics kept = row_count;

  -- A fresh pending draft: same shape as this season's, minus the kept spots.
  insert into draft (league_id, status, rounds, pick_seconds, mode, budget,
                     lot_seconds, max_lots, night_start_min, night_end_min, keeper_slots)
  values (nlid, 'pending', d.rounds, d.pick_seconds, d.mode, d.budget,
          d.lot_seconds, d.max_lots, d.night_start_min, d.night_end_min, nk);

  -- The season schedule (round-robin; lock_at backfills from the live
  -- scoreboard once next season's slate exists). Best-effort: a 2-team
  -- edge case that refuses here shouldn't strand the created league.
  sched := native_generate_schedule(nlid, p_weeks);

  -- Wallets: deliberately NOT copied. team_wallet/coin_ledger key on the new
  -- league row, so every team starts next season at ◎0 and the weekly-budget
  -- machinery (auto_weekly_budget reads league.weekly_budget, which DID copy)
  -- funds the new season from week 1 — the "fresh season seed" decision.

  return jsonb_build_object(
    'ok', true, 'league_id', nlid, 'season', next_seas,
    -- the created-league confirmation must NAME the game it carries (v0.251.0)
    'game_mode', gm,
    'keeper_slots', nk, 'kept', kept,
    'draft_rounds', d.rounds - nk, 'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Draft machinery learns keeper_slots (pick counts only; caps untouched)
-- ─────────────────────────────────────────────────────────────────────────────

-- native_exec_pick v4: 0071's body verbatim, except the snake draft completes
-- after (rounds − keeper_slots) picks per team — keepers already occupy the
-- rest of the roster.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not p_auto then
    err := pos_cap_error(p_league_id, oc, p_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= (d.rounds - d.keeper_slots) * n then
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

-- _start_draft_now v2: 0177's body verbatim, plus (a) the pool-size check
-- counts FREE players against the picks actually being made — a keeper league
-- carries rostered players in its pool, and a rookie rollover's pool is
-- empty-but-for-keepers until the reseed, which must refuse to start — and
-- (b) a keeper count that fills the whole roster refuses out loud.
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
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
  if (select count(*) from league_pool lp
      where lp.league_id = p_league_id
        and not exists (select 1 from native_roster nr
                        where nr.league_id = lp.league_id and nr.slug = lp.slug))
     < (d.rounds - d.keeper_slots) * n then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

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

  update draft set status = 'live', draft_order = ord, current_overall = 1, nom_idx = 0,
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

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset);
end $$;

-- draft_state v-next: 0177's body verbatim, with 'rounds' now reporting the
-- rounds actually being DRAFTED (the room's grid, round counter and progress
-- all key on it), plus 'keeper_slots' and 'roster_size' for the copy. The
-- auction internals keep the full d.rounds — spots_left and max-bid math are
-- cap-based and already count keepers on the roster.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select count(*)::int into open_lots from auction_lot where league_id = p_league_id;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction'
      then (case when open_lots < d.max_lots then auction_nominator(d) end)
      else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'slug', al.slug, 'bid', al.bid, 'roster_id', al.roster_id,
      'deadline_at', al.deadline,
      'my_proxy', case when my_r is not null then
        (select px.max_amount from lot_proxy px where px.lot_id = al.id and px.roster_id = my_r) end,
      'my_max', case when my_r is not null then auction_lot_max(p_league_id, my_r, d.rounds, al.id) end
    ) order by al.created_at), '[]'::jsonb)
    into lots from auction_lot al where al.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds - d.keeper_slots,
    'keeper_slots', d.keeper_slots, 'roster_size', d.rounds,
    'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'pos_caps', league_pos_caps(p_league_id),
    'start_at', d.start_at,
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lots', lots,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'committed', auction_committed(p_league_id, m.sleeper_roster_id),
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, null))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

-- seed_league_pool v3: 0172's body verbatim, except the replace PRESERVES
-- rostered players. The old delete-all cascaded through native_roster's FK —
-- on a keeper league that would silently drop every keeper the moment the
-- commissioner reseeded for the new season's draft.
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr
                    where nr.league_id = lp.league_id and nr.slug = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         nullif(btrim(coalesce(p ->> 'espn_id', '')), ''),
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function set_keeper_count(uuid, int) to authenticated;
grant execute on function set_keepers(uuid, int, jsonb) to authenticated;
grant execute on function keeper_state(uuid) to authenticated;
grant execute on function rollover_league(uuid, int, boolean) to authenticated;
-- _rollover_target / _keeper_resolve are internal: no grants, reached only
-- through the SECURITY DEFINER functions above.
