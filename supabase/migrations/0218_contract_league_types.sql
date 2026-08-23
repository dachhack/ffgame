-- 0218: CONTRACT LEAGUE TYPES — the founder's "make contract league a
-- selection with dynasty, redraft, keeper, contract dynasty. The rest of the
-- selections like auction draft are pre-set once you make that selection."
--
-- THE AXIS GROWS TWO POINTS. Continuity (0185) becomes five choices:
--   • contract          — a redraft league that plays with contracts: the
--                         startup room is preset to an AUCTION (bids become
--                         salaries) and the salary cap turns on at the
--                         auction budget.
--   • contract_dynasty  — a dynasty league with contracts: same auction
--                         preset + cap, plus the full dynasty machinery
--                         (rookie rounds, the three-year pick horizon,
--                         rollover). Rookie drafts already run off
--                         pick_owners (0183), and rookies sign 3-year
--                         rookie-scale deals (0217).
--
-- THE PRESET RULE. Selecting a contract type DECIDES the other knobs rather
-- than opening them: create_native_league forces mode='auction' before its
-- own validation, and _apply_continuity turns the cap on (default = the
-- auction budget; $200 when the room isn't an auction) with the 4-year max.
-- Switching to a PLAIN mode (redraft/keeper/dynasty) turns contracts OFF —
-- the axis owns contract-ness; 📜 CONTRACTS & CAP remains the fine-tuning
-- surface inside a contract league.
--
-- LINEAGE (the 0216 lesson): create_native_league is patched from its
-- CURRENT 0216 body, rollover_league from its current 0185 body,
-- league_contracts from its current 0217 body — extracted programmatically,
-- never retyped from an older migration.

-- ── The axis reads back five values ──────────────────────────────────────────
create or replace function league_continuity(l_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when settings_json ->> 'continuity' in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty')
      then settings_json ->> 'continuity'
    when coalesce((settings_json ->> 'rookie_rounds')::int, 0) > 0
      or coalesce((settings_json ->> 'dynasty')::boolean, false) then 'dynasty'
    when coalesce((settings_json ->> 'keeper_count')::int, 0) > 0 then 'keeper'
    else 'redraft' end
  from league where id = l_id;
$$;

-- contract_dynasty IS a dynasty everywhere the machinery asks (keepers,
-- pick horizon, rollover, rookie drafts).
create or replace function league_is_dynasty(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select league_continuity(l_id) in ('dynasty', 'contract_dynasty');
$$;

-- ── _apply_continuity v2: five modes, contract presets ───────────────────────
-- 0185's engine with the two contract branches. Each contract mode runs its
-- base family's provisioning (contract→redraft's clears, contract_dynasty→
-- dynasty's three-year horizon) and then lands the cap keys; each PLAIN mode
-- removes them.
create or replace function _apply_continuity(p_league_id uuid, p_mode text, p_n int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; d draft%rowtype; n int; s int; r jsonb; base text; cap int; ym int; capkeys jsonb;
begin
  select * into lg from league where id = p_league_id;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if coalesce(p_mode, '') not in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper, dynasty, contract or contract_dynasty');
  end if;
  base := case p_mode when 'contract' then 'redraft' when 'contract_dynasty' then 'dynasty' else p_mode end;
  -- the cap a contract mode lands: keep a cap the league already runs,
  -- else the auction budget (bids-as-salaries must fit), else $200
  cap := coalesce(nullif(lg.settings_json ->> 'salary_cap', '')::int,
                  case when d.mode = 'auction' then d.budget else 200 end);
  ym := coalesce(nullif(lg.settings_json ->> 'contract_years_max', '')::int, 4);
  capkeys := case when p_mode in ('contract', 'contract_dynasty')
    then jsonb_build_object('salary_cap', cap, 'contract_years_max', ym)
    else '{}'::jsonb end;

  if base in ('redraft', 'keeper') then
    -- these families hold no pick assets — clear the futures, but never a traded one
    if exists (select 1 from pick_asset pa
               where pa.league_id = p_league_id and pa.season > lg.season
                 and pa.owner_roster <> pa.original_roster) then
      return jsonb_build_object('ok', false, 'error',
        'trades already moved future picks — undo those first');
    end if;
    delete from pick_asset where league_id = p_league_id and season > lg.season;
  end if;

  if base = 'redraft' then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'continuity' - 'dynasty' - 'keeper_count' - 'rookie_rounds'
        - 'salary_cap' - 'contract_years_max'
        || case when p_mode = 'contract'
             then jsonb_build_object('continuity', 'contract') || capkeys
             else '{}'::jsonb end
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', p_mode,
      'contracts', p_mode = 'contract');
  end if;

  if base = 'keeper' then
    if p_n is null or p_n < 1 or p_n > d.rounds - 1 then
      return jsonb_build_object('ok', false, 'error',
        'keepers must be 1–' || (d.rounds - 1) || ' (the roster holds ' || d.rounds || ')');
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'dynasty' - 'rookie_rounds' - 'salary_cap' - 'contract_years_max'
        || jsonb_build_object('continuity', 'keeper', 'keeper_count', p_n)
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', 'keeper', 'keeper_count', p_n);
  end if;

  -- dynasty family (dynasty / contract_dynasty)
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'league season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  n := coalesce(p_n, 3);
  if n < 1 or n > least(10, d.rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'rookie rounds must be 1–' || least(10, d.rounds - 1));
  end if;
  -- three years of futures, each round a tradeable asset from this moment
  for s in 1..3 loop
    r := _provision_pick_assets(p_league_id, ((lg.season)::int + s)::text, n);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      - 'salary_cap' - 'contract_years_max'
      || jsonb_build_object('continuity', p_mode, 'dynasty', true,
                            'rookie_rounds', n, 'keeper_count', d.rounds - n)
      || capkeys
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'continuity', p_mode, 'rookie_rounds', n,
    'keeper_count', d.rounds - n, 'contracts', p_mode = 'contract_dynasty',
    'seasons', jsonb_build_array(((lg.season)::int + 1)::text, ((lg.season)::int + 2)::text, ((lg.season)::int + 3)::text));
end $$;

-- ── create_native_league: 0216 body + the contract preset ────────────────────
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null,
  p_pos_caps jsonb default null,
  p_game_mode text default 'drip',
  p_continuity text default 'redraft',
  p_continuity_n int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int; err text; gm text; cont text; cn int; r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not has_native() then return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 99 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–99');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  -- Contract league types (0218) PRESET the room: the founder's "the rest of
  -- the selections like auction draft are pre-set once you make that
  -- selection". Forced before the mode checks so budget/clock validation
  -- runs against the auction the league will actually hold.
  if lower(btrim(coalesce(p_continuity, ''))) in ('contract', 'contract_dynasty') then
    p_mode := 'auction';
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'linear', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake, linear or auction');
  end if;
  if p_mode = 'auction' and (p_budget is null or p_budget < p_rounds or p_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
  end if;
  if p_mode = 'auction' and (p_lot_seconds is null or p_lot_seconds < 10 or p_lot_seconds > 172800) then
    return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
  end if;
  if p_mode = 'auction' and (p_max_lots is null or p_max_lots < 1 or p_max_lots > 4) then
    return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
  end if;
  if (p_night_start_min is null) <> (p_night_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'overnight pause needs both a start and an end');
  end if;
  if p_night_start_min is not null and (
       p_night_start_min < 0 or p_night_start_min > 1439
    or p_night_end_min < 0 or p_night_end_min > 1439
    or p_night_start_min = p_night_end_min) then
    return jsonb_build_object('ok', false, 'error', 'overnight hours must be two different times of day');
  end if;
  err := validate_pos_caps(p_pos_caps, p_rounds);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  gm := lower(btrim(coalesce(p_game_mode, 'drip')));
  if gm not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'game must be drip or classic');
  end if;
  -- Continuity (0185): validate the choice BEFORE anything is inserted, so a
  -- bad keeper count refuses cleanly instead of stranding a half-made league.
  cont := lower(btrim(coalesce(p_continuity, 'redraft')));
  if cont not in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper, dynasty, contract or contract_dynasty');
  end if;
  if cont = 'keeper' and (p_continuity_n is null or p_continuity_n < 1 or p_continuity_n > p_rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'keepers must be 1–' || (p_rounds - 1) || ' (the roster holds ' || p_rounds || ')');
  end if;
  cn := case when cont in ('dynasty', 'contract_dynasty') then coalesce(p_continuity_n, 3) else p_continuity_n end;
  if cont in ('dynasty', 'contract_dynasty') and (cn < 1 or cn > least(10, p_rounds - 1)) then
    return jsonb_build_object('ok', false, 'error', 'rookie rounds must be 1–' || least(10, p_rounds - 1));
  end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at, avatar_url)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native',
          jsonb_build_object('teams', p_teams, 'rounds', p_rounds, 'mode', coalesce(p_mode, 'snake'))
            || case when p_pos_caps is not null then jsonb_build_object('pos_caps', p_pos_caps) else '{}'::jsonb end
            -- A classic league carries BOTH keys: the mode it runs in, and the
            -- availability flag that lets its commissioner switch modes
            -- pre-draft. A drip league writes neither, so it reads exactly as
            -- every league created before this migration did.
            || case when gm = 'classic'
                 then jsonb_build_object('game_mode', 'classic', 'classic_ok', true)
                 else '{}'::jsonb end,
          auth.uid(), now(), random_drip_avatar())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds, mode, budget, lot_seconds, max_lots, night_start_min, night_end_min)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200),
          coalesce(p_lot_seconds, 15), coalesce(p_max_lots, 1), p_night_start_min, p_night_end_min);

  -- Continuity lands through the same engine the MODE & SEASON selector uses
  -- (keeper count / rookie rounds / the three-year pick horizon). Validated
  -- above, so a failure here is structural — raise, rolling the league back.
  if cont <> 'redraft' then
    r := _apply_continuity(lid, cont, cn);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'continuity failed: %', r ->> 'error';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1, 'game_mode', gm,
    'continuity', cont, 'dynasty', cont in ('dynasty', 'contract_dynasty'),
    'contracts', cont in ('contract', 'contract_dynasty'),
    'invite_code', (select invite_code from league where id = lid));
end $$;


-- ── rollover_league: 0185 body, the horizon gate covers contract_dynasty ─────
create or replace function rollover_league(
  p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype; d draft%rowtype; nk int; next_seas text; nlid uuid;
  kept int; sched jsonb; gm text; new_settings jsonb; rr int; carried int; i int;
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
  -- The Super Bowl gate (0185): the rollover appears when the season ends.
  if not (is_admin() or _season_over(p_league_id)) then
    return jsonb_build_object('ok', false, 'error',
      'the rollover opens after the Super Bowl — ' || ((lg.season)::int + 1) || '-02-15');
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
  -- them, and seed_league_pool preserves rostered players.
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

  -- Pick assets (0183/0185): carry EVERY future season's assets — ownership
  -- as traded — so a 2028 second dealt during 2026 still exists in 2027.
  -- The next-season rows become the new league's own-season assets (they
  -- drive _start_draft_now); the later ones stay tradeable futures. Then
  -- re-provision the three-year horizon from the carried rookie_rounds.
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select nlid, pa.season, pa.round, pa.original_roster, pa.owner_roster
  from pick_asset pa where pa.league_id = p_league_id and pa.season >= next_seas;
  get diagnostics carried = row_count;
  rr := coalesce((new_settings ->> 'rookie_rounds')::int, 0);
  if rr > 0 and league_continuity(nlid) in ('dynasty', 'contract_dynasty') then
    for i in 1..3 loop
      perform _provision_pick_assets(nlid, ((next_seas)::int + i)::text, rr);
    end loop;
  end if;

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
    'continuity', league_continuity(nlid),
    'keeper_slots', nk, 'kept', kept,
    'draft_rounds', case when exists (select 1 from pick_asset pa
        where pa.league_id = nlid and pa.season = next_seas) and d.mode = 'snake'
      then (select max(round) from pick_asset where league_id = nlid and season = next_seas)
      else d.rounds - nk end,
    'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'picks_carried', carried,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;


-- ── league_contracts v2 (0217 + locked): the cap sheet says whether lengths
-- are still the manager's to assign (the draft room is open) or locked ───────
create or replace function league_contracts(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not contracts_on(p_league_id) then return jsonb_build_object('contracts', false); end if;
  return jsonb_build_object(
    'contracts', true,
    'salary_cap', league_salary_cap(p_league_id),
    'years_max', contract_years_max(p_league_id),
    'locked', coalesce((select status from draft where league_id = p_league_id) = 'complete', true),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'roster_id', c.roster_id, 'salary', c.salary,
        'years', c.years, 'acquired', c.acquired) order by c.roster_id, c.salary desc, c.slug)
      from contract c where c.league_id = p_league_id), '[]'::jsonb),
    'payrolls', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'payroll', team_payroll(p_league_id, m.sleeper_roster_id)) order by m.sleeper_roster_id)
      from league_membership m where m.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_contracts(uuid) to authenticated;
