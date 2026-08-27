-- 0249: THE WORKER MAY DRIVE THE ENDGAME.
--
-- Sweep finding: playoffs and the guillotine only ever moved when a member
-- opened the right screen. The client poke that builds round 1, advances a
-- finished round, or drops a guillotine week is the ONLY driver — so a league
-- whose managers are away between rounds simply stalls, and a bracket advanced
-- late lands its next round on a lock_at the tick has already passed and never
-- resolves. The fix is to let the FLY WORKER run these on its own cadence
-- (server/src/native.js sweepProgression), but the worker calls as the service
-- role, where auth.uid() is null.
--
-- advance_playoffs already allows a null uid (0073: `auth.uid() is not null and
-- not (...)`) precisely so the worker could drive advancement — it works
-- because it reads its seeds from the STORED bracket. generate (auto) and
-- guillotine_tick never got the same treatment; and generate SEEDS from live
-- standings, so it also needs league_standings to answer the worker rather than
-- returning {error:forbidden} (which then blows up jsonb_array_elements). So
-- three functions gain the same one-line guard the worker path needs, and
-- nothing else moves. Every safety the bodies carried is unchanged — auto is
-- seedless and refuses before the season is final or over an existing bracket;
-- the guillotine derives everything from finalized results and is idempotent;
-- the MANUAL seeded generate still requires a commissioner (only its auto
-- branch learned the null uid). A service-role caller can do exactly what a
-- member's screen-load already did, and no more.
--
-- league_standings is only ever READ, and only the trusted worker key can be
-- both service-role and null-uid — an authenticated user always carries a uid —
-- so opening it to the service role widens nothing an end user can reach.

create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name, 'division', z.division,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa)
      order by z.w desc, case when league_golf(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name, m.division,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa
      from league_membership m
      left join (
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               sum(x.us) as pf, sum(x.them) as pa
        from (
          select mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
          union all
          select mu.away_roster_id, mu.away_final, mu.home_final
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
grant execute on function league_standings(uuid) to authenticated;

create or replace function generate_playoffs_bracket(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; members int; wk int; la timestamptz; seas text; seeds int[]; sj jsonb; rounds int;
  ladder int[];
begin
  if p_auto then
    if auth.uid() is not null and not (is_admin() or is_league_commish(p_league_id) or is_league_member(p_league_id)) then
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

create or replace function guillotine_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; last_done int; victim int; vt numeric; alive int; done int := 0;
        sl record; nt text;
begin
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', true, 'eliminated', 0);
  end if;
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':guillotine'));

  -- the last fully-final week of the regular season
  select max(week) into last_done from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if last_done is null then return jsonb_build_object('ok', true, 'eliminated', 0); end if;

  for wk in 1..last_done loop
    select count(*) into alive from league_membership
      where league_id = p_league_id and eliminated_week is null;
    exit when alive <= 1;
    continue when exists (select 1 from league_membership
      where league_id = p_league_id and eliminated_week = wk);

    -- the floor: lowest weekly total among teams alive right now; a tie dies
    -- by the weaker season (PF), then the higher seat number. A team with no
    -- matchup that week is ON BYE and cannot be the victim — `pts is null`
    -- rather than 0 is the whole of 0247.
    select t.rid, t.pts into victim, vt from (
      select m.sleeper_roster_id as rid,
             (select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
               from matchup mu where mu.league_id = p_league_id and mu.week = wk
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
               limit 1) as pts,
             (select coalesce(sum(case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end), 0)
               from matchup mu where mu.league_id = p_league_id and mu.week <= wk and mu.status = 'final'
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as season_pf
      from league_membership m
      where m.league_id = p_league_id and m.eliminated_week is null
    ) t where t.pts is not null
      order by t.pts asc, t.season_pf asc, t.rid desc limit 1;
    -- Nobody eligible (every survivor byed, or the week has no finals for the
    -- living): no blade this week. `exit` would end the season's catch-up
    -- loop early, so this skips the week and carries on.
    continue when victim is null;

    update league_membership set eliminated_week = wk
      where league_id = p_league_id and sleeper_roster_id = victim;
    -- a dead seat's pending claims die with it (a win after death would trip
    -- the seat guard mid-waiver-run)
    update waiver_claim set status = 'lost', note = 'team eliminated'
      where league_id = p_league_id and roster_id = victim and status = 'pending';

    -- the event itself, then the releases logged AS releases
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (p_league_id, 'elimination', victim, '', 'week ' || wk || ' — lowest score, ' || round(vt, 1));
    nt := 'guillotine week ' || wk;
    perform set_config('app.txn_kind', 'release', true);
    perform set_config('app.txn_note', nt, true);
    for sl in select slug from native_roster where league_id = p_league_id and roster_id = victim loop
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = sl.slug;
      delete from native_roster where league_id = p_league_id and slug = sl.slug;
    end loop;
    perform set_config('app.txn_kind', '', true);
    perform set_config('app.txn_note', '', true);
    done := done + 1;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'eliminated', done);
end $$;
grant execute on function guillotine_tick(uuid) to authenticated;
