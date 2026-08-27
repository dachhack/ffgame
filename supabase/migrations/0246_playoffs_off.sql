-- 0246: PLAYOFFS CAN BE TURNED OFF.
--
-- Founder: "you should be able to turn off and customize playoffs in all
-- leagues."
--
-- Customising them has existed since 0073 — bracket size and start week, any
-- native league, locked once underway. What was missing is OFF. A league that
-- wants its season to simply end (a guillotine, a keeper league that settles
-- on the regular-season table, a 32-team pod where a bracket is beside the
-- point) had no way to say so, and 0162's auto-generation would build one
-- anyway the moment the last regular-season game went final.
--
-- OFF IS `playoff_teams = 0`, not a separate flag. Every reader already goes
-- through league_playoff_teams(), so a zero there is understood everywhere at
-- once — and a league that never set the key still reads the default 4, so
-- nothing existing changes.
--
-- TWO CHOKEPOINTS, because there are exactly two ways a bracket gets built:
-- the commissioner's generate_playoffs and 0162's auto poke, which are the
-- same function. Guarding it once covers both.
--
-- A GUILLOTINE LEAGUE IS OFF BY CONSTRUCTION. It plays all 17 weeks (0245) and
-- its survivor IS the result; a bracket starting week 15 would have collided
-- with the season it was still playing. Rather than leave that to the
-- commissioner to notice, set_league_format switches playoffs off when the
-- format goes guillotine — the same place it already presets the FAAB market.

-- ── the setter learns 0 ─────────────────────────────────────────────────────
create or replace function set_playoff_rules(p_league_id uuid, p_teams int default null, p_start_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'playoffs are underway — settings are locked');
  end if;
  select count(*)::int into n from league_membership where league_id = p_league_id;
  -- 0 = OFF. Anything else is still a real bracket, and the shapes the builder
  -- knows how to seed and advance are still 2, 4, 6 and 8 (0073/0215) — a
  -- larger field needs the bracket engine generalised, not just this bound.
  if p_teams is not null and p_teams <> 0 and (p_teams not in (2, 4, 6, 8) or p_teams > n) then
    return jsonb_build_object('ok', false, 'error', 'playoff teams must be 0 (no playoffs), 2, 4, 6, or 8 (and fit the league)');
  end if;
  if p_start_week is not null and (p_start_week < 2 or p_start_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'playoffs must start between week 2 and 18');
  end if;
  -- Turning them OFF clears a bracket that was only ever SCHEDULED. The guard
  -- above already refused if any playoff game has been played, so this can
  -- never erase a result.
  if p_teams = 0 then
    delete from matchup where league_id = p_league_id and is_playoff;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_teams is not null then jsonb_build_object('playoff_teams', p_teams) else '{}'::jsonb end
      || case when p_start_week is not null then jsonb_build_object('playoff_start_week', p_start_week) else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'playoff_teams', league_playoff_teams(p_league_id),
    'playoff_start_week', league_playoff_start(p_league_id));
end $$;
grant execute on function set_playoff_rules(uuid, int, int) to authenticated;

-- ── the bracket builder, renamed ───────────────────────────────────────────
-- 0215's generate_playoffs body, unchanged, under a new name so the guard can
-- wrap it. Copied from the live definition rather than reconstructed: it is
-- the seeding, the consolation ladder and four hand-written bracket shapes,
-- and none of that is what this migration is changing.
create or replace function generate_playoffs_bracket(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; members int; wk int; la timestamptz; seas text; seeds int[]; sj jsonb; rounds int;
  ladder int[];
begin
  if p_auto then
    if not (is_admin() or is_league_commish(p_league_id) or is_league_member(p_league_id)) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    if exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff) then
      return jsonb_build_object('ok', true, 'generated', false, 'note', 'bracket already exists');
    end if;
    if not _regular_season_complete(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the regular season is not finished');
    end if;
    p_seeds := null;
  elsif not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'playoffs are underway — bracket is locked');
  end if;

  n := league_playoff_teams(p_league_id);
  select count(*)::int into members from league_membership where league_id = p_league_id;
  if n > members then return jsonb_build_object('ok', false, 'error', 'playoff teams exceed the league size'); end if;
  wk := league_playoff_start(p_league_id);
  if exists (select 1 from matchup m where m.league_id = p_league_id and not m.is_playoff and m.week >= wk) then
    return jsonb_build_object('ok', false, 'error', 'regular-season games exist at week ' || wk || '+ — pick a later start week');
  end if;
  rounds := case n when 2 then 1 when 4 then 2 else 3 end;

  if p_seeds is not null then
    if jsonb_typeof(p_seeds) <> 'array' or jsonb_array_length(p_seeds) <> n then
      return jsonb_build_object('ok', false, 'error', 'custom seeding must list exactly ' || n || ' teams');
    end if;
    select array_agg(v::int order by ord) into seeds
    from jsonb_array_elements_text(p_seeds) with ordinality t(v, ord);
    if (select count(distinct s) from unnest(seeds) s) <> n
       or exists (select 1 from unnest(seeds) s where not exists
         (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = s)) then
      return jsonb_build_object('ok', false, 'error', 'custom seeding must name ' || n || ' different league teams');
    end if;
  else
    -- 0215: division winners first. Without divisions this IS the standings.
    select array_agg((s.e ->> 'roster_id')::int order by s.ord) into seeds
    from (select e, ord from jsonb_array_elements(league_seed_standings(p_league_id)) with ordinality t(e, ord)
          where ord <= n) s;
  end if;
  if seeds is null or array_length(seeds, 1) < n then
    return jsonb_build_object('ok', false, 'error', 'not enough teams to seed');
  end if;
  select array_agg((s.e ->> 'roster_id')::int order by s.ord) into ladder
  from (select e, ord from jsonb_array_elements(league_seed_standings(p_league_id)) with ordinality t(e, ord)) s
  where not ((s.e ->> 'roster_id')::int = any (seeds));

  delete from matchup where league_id = p_league_id and is_playoff;

  select l.season into seas from league l where l.id = p_league_id;
  select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

  if n = 2 then
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label)
    values (p_league_id, wk, seeds[1], seeds[2], 'scheduled', la, true, 1, 1, 'Championship');
  elsif n = 4 then
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label) values
      (p_league_id, wk, seeds[1], seeds[4], 'scheduled', la, true, 1, 1, 'Semifinal'),
      (p_league_id, wk, seeds[2], seeds[3], 'scheduled', la, true, 1, 2, 'Semifinal');
  elsif n = 6 then
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label) values
      (p_league_id, wk, seeds[3], seeds[6], 'scheduled', la, true, 1, 1, 'Round 1'),
      (p_league_id, wk, seeds[4], seeds[5], 'scheduled', la, true, 1, 2, 'Round 1');
  else
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label) values
      (p_league_id, wk, seeds[1], seeds[8], 'scheduled', la, true, 1, 1, 'Quarterfinal'),
      (p_league_id, wk, seeds[4], seeds[5], 'scheduled', la, true, 1, 2, 'Quarterfinal'),
      (p_league_id, wk, seeds[3], seeds[6], 'scheduled', la, true, 1, 3, 'Quarterfinal'),
      (p_league_id, wk, seeds[2], seeds[7], 'scheduled', la, true, 1, 4, 'Quarterfinal');
  end if;

  perform make_consolation_round(p_league_id, wk, la, 1, ladder, 0, rounds = 1);

  sj := jsonb_build_object('teams', n, 'start_week', wk, 'rounds', rounds,
    'seeds', (select jsonb_agg(to_jsonb(s) order by ord) from unnest(seeds) with ordinality t(s, ord)),
    'consolation', coalesce(to_jsonb(ladder), '[]'::jsonb));
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('playoff_bracket', sj) || jsonb_build_object('playoff_champion', null)
    where id = p_league_id;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'bracket', sj);
end $$;
grant execute on function generate_playoffs_bracket(uuid, jsonb, boolean) to authenticated;

-- ── the ONE place a bracket is built refuses when off ───────────────────────
-- Wrapping rather than re-copying 0215's 120-line body: the guard belongs at
-- the top of it either way, and a wrapper cannot drift from a body it does not
-- restate. The inner function keeps its name and signature, so 0162's auto
-- poke and the commissioner's call both land here first.
create or replace function generate_playoffs(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if league_playoff_teams(p_league_id) = 0 then
    -- The auto poke fires from any member's league load, every load, all
    -- season. It must be a quiet no-op, not an error the client shows.
    if p_auto then return jsonb_build_object('ok', true, 'generated', false, 'playoffs', 'off'); end if;
    return jsonb_build_object('ok', false, 'error', 'this league plays no playoffs — turn them on in the commissioner tools first');
  end if;
  return generate_playoffs_bracket(p_league_id, p_seeds, p_auto);
end $$;
grant execute on function generate_playoffs(uuid, jsonb, boolean) to authenticated;

-- ── guillotine implies off ──────────────────────────────────────────────────
create or replace function set_league_format(p_league_id uuid, p_format text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; f text; wks int; want int; sched jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  f := lower(btrim(coalesce(p_format, 'standard')));
  if f not in ('standard', 'guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'format must be standard, guillotine or vampire');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if f = 'guillotine' and d.status <> 'pending'
     and league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', false, 'error', 'guillotine must be chosen before the draft — it changes how the season scores');
  end if;
  if exists (select 1 from league_membership where league_id = p_league_id and eliminated_week is not null) then
    return jsonb_build_object('ok', false, 'error', 'the blade has already fallen — the format is locked for the season');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('format', f)
      || case when f = 'guillotine'
           then jsonb_build_object('waiver_mode', 'faab',
                  'faab_budget', coalesce(nullif(settings_json ->> 'faab_budget', '')::int, 1000),
                  -- 0246: the survivor IS the result, and the season runs
                  -- through week 17 — there is no room for a bracket and
                  -- nothing for it to decide.
                  'playoff_teams', 0)
           else '{}'::jsonb end
    where id = p_league_id;
  if f = 'guillotine' then
    delete from matchup where league_id = p_league_id and is_playoff and status = 'scheduled';
  end if;

  -- 0245: the season's length follows the format. Only re-cuts a schedule that
  -- already exists; at creation the client makes it at the right length.
  if exists (select 1 from matchup where league_id = p_league_id) then
    wks := (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff);
    want := case when f = 'guillotine' then 17 else 14 end;
    if wks <> want then
      sched := native_generate_schedule(p_league_id, want);
      if not coalesce((sched ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', true, 'format', f,
          'schedule_error', sched ->> 'error', 'weeks', wks);
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'format', f,
    'weeks', (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff));
end $$;
grant execute on function set_league_format(uuid, text) to authenticated;

-- ── the view says so ────────────────────────────────────────────────────────
-- playoff_state already returns playoff_teams; a 0 now reaches the client and
-- both hosts read it as OFF rather than as "a bracket that has not generated".
