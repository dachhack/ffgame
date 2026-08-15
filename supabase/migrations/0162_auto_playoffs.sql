-- 0162: THE SEASON CLOSES ITSELF — auto-generated playoff brackets.
--
-- 0073 built the whole endgame (settings, seeding, byes, the consolation
-- ladder, idempotent advancing, champion crowning) but round 1 waited for a
-- commissioner's click. Now the bracket follows the advance_playoffs
-- pattern: any member's league-load poke generates it, once the LAST
-- regular-season game is final — seedless only, never over an existing
-- bracket, so the commissioner's explicit-seed override (and their right to
-- regenerate before kickoff) is untouched.
--
-- Mechanics: generate_playoffs gains `p_auto boolean default false`. The old
-- two-arg signature is DROPPED (an overload would make {p_league_id} calls
-- ambiguous to PostgREST); existing callers' named params bind the new
-- signature with p_auto defaulting false, byte-identical behavior.
-- The function body below is 0073's, verbatim, apart from the gate —
-- future edits belong here, not in 0073.

create or replace function _regular_season_complete(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from matchup m where m.league_id = p_league_id and not m.is_playoff)
     and not exists (select 1 from matchup m
                      where m.league_id = p_league_id and not m.is_playoff and m.status <> 'final')
     and not exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete');
$$;

drop function if exists generate_playoffs(uuid, jsonb);

create or replace function generate_playoffs(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; members int; wk int; la timestamptz; seas text; seeds int[]; sj jsonb; rounds int;
  ladder int[];
begin
  if p_auto then
    -- The AUTO path (0162): any member's league-load poke may build the
    -- bracket, but only seedless, only once the WHOLE regular season is
    -- final, and never over an existing bracket — a commissioner's custom
    -- seeding can't be clobbered by a passive client.
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

  -- seeding: the commissioner's explicit order when given, else straight
  -- from the standings (wins → points-for → seat)
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
    select array_agg((s.e ->> 'roster_id')::int order by s.ord) into seeds
    from (select e, ord from jsonb_array_elements(league_standings(p_league_id)) with ordinality t(e, ord)
          where ord <= n) s;
  end if;
  if seeds is null or array_length(seeds, 1) < n then
    return jsonb_build_object('ok', false, 'error', 'not enough teams to seed');
  end if;
  -- everyone below the cut starts on the consolation ladder, standings order
  select array_agg((s.e ->> 'roster_id')::int order by s.ord) into ladder
  from (select e, ord from jsonb_array_elements(league_standings(p_league_id)) with ordinality t(e, ord)) s
  where not ((s.e ->> 'roster_id')::int = any (seeds));

  -- a regenerate replaces the (still-scheduled) old bracket
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

  -- the ladder plays every playoff week too
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

grant execute on function generate_playoffs(uuid, jsonb, boolean) to authenticated;
