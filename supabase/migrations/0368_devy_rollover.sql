-- ═══════════════════════════════════════════════════════════════════════════
-- 0368 · COLLEGE PLAYERS, PHASE 2c — DEVY AT ROLLOVER.
--
-- A college player in a devy spot always carries into next season, and he is
-- not a keeper choice: _keeper_resolve ranks the other players for the
-- keeper count and adds every devy college player on top. The new draft
-- counts the devy spots as pre-filled (draft.keeper_slots = keepers + devy),
-- so every team makes the same number of picks and the annual draft stays an
-- NFL draft. An empty devy spot refills from college free agency.
-- A graduated player still sitting in a devy spot competes as a normal keeper.
-- A league with no devy spots rolls over exactly as before.
-- Bodies copied from 0182 (_keeper_resolve) and 0220 (rollover_league) with
-- only the marked 0368 changes.
-- ═══════════════════════════════════════════════════════════════════════════

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
      -- 0366/0368: a college player in a devy spot is not a keeper choice.
      and not (nr.spot = 'devy' and nr.slug ~ '^c-[0-9]+$')
  ) t where t.rn <= p_count
  union all
  -- 0368: he always carries, on top of the keeper count.
  select nr.roster_id, nr.slug, true
    from native_roster nr
   where nr.league_id = p_league_id and nr.spot = 'devy' and nr.slug ~ '^c-[0-9]+$';
$$;

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

  -- CONTRACT CARRIAGE (0220). In a contract league the live deals ARE the
  -- keeper rule: a player under a multi-year deal (or a franchise tag)
  -- carries with his contract at years−1 (a tag carries its one year); an
  -- expiring, untagged deal walks to the pool no matter what the keeper
  -- machinery said. Dead money follows at years_left−1; retained-salary
  -- ghosts follow their contract; traded cap room does NOT carry (fresh
  -- season, fresh money — the wallet rule); open RFA tenders lapse.
  if contracts_on(p_league_id) then
    delete from native_roster nr where nr.league_id = nlid
      and exists (select 1 from contract c
        where c.league_id = p_league_id and c.slug = nr.slug
          and c.years <= 1 and not c.tagged);
    insert into native_roster (league_id, roster_id, slug, acquired)
    select nlid, c.roster_id, c.slug, 'keeper' from contract c
    where c.league_id = p_league_id and (c.years >= 2 or c.tagged)
      and exists (select 1 from native_roster o
        where o.league_id = p_league_id and o.slug = c.slug and o.roster_id = c.roster_id)
      and not exists (select 1 from native_roster n2
        where n2.league_id = nlid and n2.slug = c.slug);
    select count(*) into kept from native_roster where league_id = nlid;
    insert into contract (league_id, slug, roster_id, salary, years, acquired, start_season)
    select nlid, c.slug, c.roster_id, c.salary,
           case when c.years >= 2 then c.years - 1 else 1 end,
           c.acquired, c.start_season
    from contract c
    where c.league_id = p_league_id
      and exists (select 1 from native_roster n2 where n2.league_id = nlid and n2.slug = c.slug);
    insert into dead_money (league_id, roster_id, slug, amount, years_left, note)
    select nlid, dm.roster_id, dm.slug, dm.amount, dm.years_left - 1, dm.note
    from dead_money dm
    where dm.league_id = p_league_id and dm.years_left - 1 >= 1;
    insert into salary_retention (league_id, slug, roster_id, amount)
    select nlid, sr.slug, sr.roster_id, sr.amount
    from salary_retention sr
    where sr.league_id = p_league_id
      and exists (select 1 from contract nc where nc.league_id = nlid and nc.slug = sr.slug);
  end if;

  -- A fresh pending draft: same shape as this season's, minus the kept spots.
  insert into draft (league_id, status, rounds, pick_seconds, mode, budget,
                     lot_seconds, max_lots, night_start_min, night_end_min, keeper_slots)
  values (nlid, 'pending', d.rounds, d.pick_seconds, d.mode, d.budget,
          d.lot_seconds, d.max_lots, d.night_start_min, d.night_end_min,
          -- 0368: devy spots arrive pre-filled too (their players carry; an
          -- empty one refills from college free agency, not the draft).
          nk + _devy_slots(p_league_id));

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
    'keeper_slots', nk + _devy_slots(p_league_id), 'kept', kept,
    'draft_rounds', case when exists (select 1 from pick_asset pa
        where pa.league_id = nlid and pa.season = next_seas) and d.mode = 'snake'
      then (select max(round) from pick_asset where league_id = nlid and season = next_seas)
      else d.rounds - nk - _devy_slots(p_league_id) end,
    'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'picks_carried', carried,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;

grant execute on function rollover_league(uuid, int, boolean) to authenticated;
