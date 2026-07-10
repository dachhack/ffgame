-- 0073: PLAYOFFS — the endgame for native leagues.
--
-- Playoff matchups are ORDINARY matchup rows (same lock → live → final
-- pipeline, same board, same materialized lineups) tagged with
-- is_playoff/playoff_round/bracket_pos, so nothing downstream changes.
--
--   • SETTINGS (settings_json.playoff_teams ∈ {2,4,6,8}, default 4;
--     playoff_start_week, default 15) — commish-editable until the bracket
--     is underway.
--   • SEEDING = regular-season standings: wins, then points-for, then seat.
--   • generate_playoffs builds round 1 (fixed bracket, higher seed at home;
--     6-team gives the top two seeds byes) and stamps the bracket plan into
--     settings_json.playoff_bracket. Re-runnable until any playoff game
--     starts (regenerates from live standings).
--   • advance_playoffs is IDEMPOTENT and member-callable (clients call it on
--     load, like process_waivers): when a round is fully final it creates
--     the next round one week later — ties advance the better seed — and
--     when the championship is final it crowns settings_json.playoff_champion.
--
-- Bracket shapes (fixed, no reseeding):
--   2:  R1 Championship: 1v2
--   4:  R1 Semis: 1v4, 2v3 → R2 Championship
--   6:  R1: 3v6, 4v5 (1+2 bye) → R2 Semis: 1vW(4v5), 2vW(3v6) → R3 Championship
--   8:  R1 Quarters: 1v8, 4v5, 3v6, 2v7 → R2 Semis: W1vW2, W3vW4 → R3 Championship
--
-- SEED OVERRIDE: generate_playoffs takes an optional explicit seed list —
-- the commissioner can reorder (or hand-pick) the field; omitted = straight
-- from the standings.
--
-- CONSOLATION LADDER: eliminated teams keep playing. Teams outside the
-- bracket start on a ladder in standings order; every playoff week adjacent
-- rungs pair off (odd team out: the BOTTOM rung sits), winners climb a rung
-- and losers drop (ties hold). Playoff losers join at the TOP of the ladder
-- as they're eliminated (ordered by seed), which makes the semifinal losers'
-- championship-week pairing the 3rd Place Game. The live ladder is stored in
-- settings_json.playoff_bracket.consolation and doubles as the final
-- below-the-cut standings once the title game ends.

alter table matchup add column if not exists is_playoff boolean not null default false;
alter table matchup add column if not exists playoff_round int;
alter table matchup add column if not exists bracket_pos int;
alter table matchup add column if not exists playoff_label text;
alter table matchup add column if not exists is_consolation boolean not null default false;

create or replace function league_playoff_teams(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'playoff_teams', '')::int, 4) from league where id = p_league_id;
$$;
create or replace function league_playoff_start(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'playoff_start_week', '')::int, 15) from league where id = p_league_id;
$$;

-- Regular-season standings (final, non-playoff games): wins desc, PF desc.
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa)
      order by z.w desc, z.pf desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa
      from league_membership m
      left join (
        select x.rid, count(*) filter (where x.us > x.them) as w,
               count(*) filter (where x.us < x.them) as l,
               count(*) filter (where x.us = x.them) as t,
               sum(x.us) as pf, sum(x.them) as pa
        from (
          select mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and mu.home_final is not null and mu.away_final is not null
          union all
          select mu.away_roster_id, mu.away_final, mu.home_final
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and mu.home_final is not null and mu.away_final is not null
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;

-- Playoff settings: editable until any playoff game has started.
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
  if p_teams is not null and (p_teams not in (2, 4, 6, 8) or p_teams > n) then
    return jsonb_build_object('ok', false, 'error', 'playoff teams must be 2, 4, 6, or 8 (and fit the league)');
  end if;
  if p_start_week is not null and (p_start_week < 2 or p_start_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'playoffs must start between week 2 and 18');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_teams is not null then jsonb_build_object('playoff_teams', p_teams) else '{}'::jsonb end
      || case when p_start_week is not null then jsonb_build_object('playoff_start_week', p_start_week) else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'playoff_teams', league_playoff_teams(p_league_id),
    'playoff_start_week', league_playoff_start(p_league_id));
end $$;

-- A roster's position in the stamped seed list (99 = not seeded).
create or replace function seed_idx(p_seeds jsonb, p_rid int) returns int
  language sql immutable as $$
  select coalesce(min(ord), 99)::int from jsonb_array_elements_text(p_seeds) with ordinality t(v, ord)
  where v::int = p_rid;
$$;

-- The better (lower) seed of two rosters, per the stamped bracket.
create or replace function better_seed(p_seeds jsonb, p_a int, p_b int) returns int
  language sql immutable as $$
  select case when a.i <= b.i then p_a else p_b end
  from (select coalesce(min(ord), 99) as i from jsonb_array_elements_text(p_seeds) with ordinality t(v, ord) where v::int = p_a) a,
       (select coalesce(min(ord), 99) as i from jsonb_array_elements_text(p_seeds) with ordinality t(v, ord) where v::int = p_b) b;
$$;

-- A final playoff game's winner (ties advance the better seed).
create or replace function playoff_winner(m matchup, p_seeds jsonb) returns int
  language sql stable as $$
  select case
    when m.home_final > m.away_final then m.home_roster_id
    when m.home_final < m.away_final then m.away_roster_id
    else better_seed(p_seeds, m.home_roster_id, m.away_roster_id) end;
$$;

-- Apply a round's FINAL consolation results to the ladder: within each played
-- pair the winner takes the upper rung, the loser the lower; ties hold rungs.
create or replace function reorder_ladder(p_league_id uuid, p_round int, p_ladder int[]) returns int[]
  language plpgsql stable security definer set search_path = public as $$
declare l int[] := p_ladder; g record; i int; j int; win int; tmp int;
begin
  for g in select * from matchup where league_id = p_league_id and is_playoff and is_consolation
             and playoff_round = p_round and status = 'final'
             and home_final is not null and away_final is not null
  loop
    win := case when g.home_final > g.away_final then g.home_roster_id
                when g.home_final < g.away_final then g.away_roster_id end;
    if win is null then continue; end if;   -- tie: rungs hold
    i := array_position(l, g.home_roster_id); j := array_position(l, g.away_roster_id);
    if i is null or j is null then continue; end if;
    if j < i then tmp := i; i := j; j := tmp; end if;
    if l[j] = win then tmp := l[i]; l[i] := l[j]; l[j] := tmp; end if;
  end loop;
  return l;
end $$;

-- Pair the ladder's adjacent rungs for one week (odd team out: the BOTTOM
-- rung sits). p_fresh = how many top rungs are freshly-eliminated playoff
-- losers — their top pairing in the championship week is the 3rd Place Game.
create or replace function make_consolation_round(
  p_league_id uuid, p_week int, p_lock timestamptz, p_round int,
  p_ladder int[], p_fresh int, p_final_round boolean
) returns int language plpgsql security definer set search_path = public as $$
declare n int := coalesce(array_length(p_ladder, 1), 0); i int := 1; pos int := 0; lbl text;
begin
  while i + 1 <= n loop
    pos := pos + 1;
    lbl := case when p_final_round and p_fresh >= 2 and i = 1 and p_fresh <= 2 then '3rd Place Game' else 'Consolation' end;
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at,
                         is_playoff, is_consolation, playoff_round, bracket_pos, playoff_label)
    values (p_league_id, p_week, p_ladder[i], p_ladder[i + 1], 'scheduled', p_lock,
            true, true, p_round, pos, lbl);
    i := i + 2;
  end loop;
  return pos;
end $$;

create or replace function generate_playoffs(p_league_id uuid, p_seeds jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; members int; wk int; la timestamptz; seas text; seeds int[]; sj jsonb; rounds int;
  ladder int[];
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
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

-- Idempotent round-advancer: safe for any member's poll.
create or replace function advance_playoffs(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  br jsonb; seeds jsonb; rounds int; teams int; cur int; wk int; la timestamptz; seas text;
  w int[]; losers int[]; ladder int[]; champ int; s1 int; s2 int; a int; b int; lbl text;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select settings_json -> 'playoff_bracket' into br from league where id = p_league_id;
  if br is null or br = 'null'::jsonb then return jsonb_build_object('ok', true, 'advanced', false); end if;
  seeds := br -> 'seeds'; rounds := (br ->> 'rounds')::int; teams := (br ->> 'teams')::int;

  -- the BRACKET drives advancement; consolation games never block it
  select max(playoff_round) into cur from matchup where league_id = p_league_id and is_playoff and not is_consolation;
  if cur is null then return jsonb_build_object('ok', true, 'advanced', false); end if;
  if exists (select 1 from matchup where league_id = p_league_id and is_playoff and not is_consolation
             and playoff_round = cur
             and (status <> 'final' or home_final is null or away_final is null)) then
    return jsonb_build_object('ok', true, 'advanced', false);
  end if;

  -- winners of the just-finished round, by bracket position
  select array_agg(playoff_winner(mu, seeds) order by mu.bracket_pos) into w
  from matchup mu where mu.league_id = p_league_id and mu.is_playoff and not mu.is_consolation
    and mu.playoff_round = cur;
  -- this round's eliminated teams, best seed first (they join the ladder's top)
  select array_agg(x.loser order by x.si) into losers from (
    select case when playoff_winner(mu, seeds) = mu.home_roster_id then mu.away_roster_id else mu.home_roster_id end as loser,
           seed_idx(seeds, case when playoff_winner(mu, seeds) = mu.home_roster_id then mu.away_roster_id else mu.home_roster_id end) as si
    from matchup mu where mu.league_id = p_league_id and mu.is_playoff and not mu.is_consolation
      and mu.playoff_round = cur
  ) x;
  -- fold this week's consolation results into the ladder (winners climb)
  select coalesce(array_agg(v::int order by ord), '{}') into ladder
  from jsonb_array_elements_text(coalesce(br -> 'consolation', '[]'::jsonb)) with ordinality t(v, ord);
  ladder := reorder_ladder(p_league_id, cur, ladder);

  if cur >= rounds then
    -- crown once (idempotent); the settled ladder is the final below-the-cut order
    champ := w[1];
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('playoff_champion', champ)
        || jsonb_build_object('playoff_bracket', br || jsonb_build_object('consolation', to_jsonb(ladder)))
      where id = p_league_id
        and coalesce(nullif(settings_json ->> 'playoff_champion', ''), '') <> champ::text;
    return jsonb_build_object('ok', true, 'advanced', false, 'champion', champ);
  end if;

  wk := (br ->> 'start_week')::int + cur;
  select l.season into seas from league l where l.id = p_league_id;
  select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

  -- eliminated teams drop onto the ladder's top rungs and keep playing
  ladder := coalesce(losers, '{}') || ladder;
  perform make_consolation_round(p_league_id, wk, la, cur + 1, ladder,
    coalesce(array_length(losers, 1), 0), cur + 1 = rounds);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('playoff_bracket', br || jsonb_build_object('consolation', to_jsonb(ladder)))
    where id = p_league_id;

  if teams = 4 or (teams = 8 and cur = 2) or (teams = 6 and cur = 2) then
    a := w[1]; b := w[2]; lbl := 'Championship';
    s1 := better_seed(seeds, a, b); s2 := case when s1 = a then b else a end;
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label)
    values (p_league_id, wk, s1, s2, 'scheduled', la, true, cur + 1, 1, lbl);
  elsif teams = 6 and cur = 1 then
    -- semis: seed 1 hosts the 4v5 winner (pos 2); seed 2 hosts the 3v6 winner (pos 1)
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label) values
      (p_league_id, wk, (seeds ->> 0)::int, w[2], 'scheduled', la, true, 2, 1, 'Semifinal'),
      (p_league_id, wk, (seeds ->> 1)::int, w[1], 'scheduled', la, true, 2, 2, 'Semifinal');
  elsif teams = 8 and cur = 1 then
    insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, is_playoff, playoff_round, bracket_pos, playoff_label) values
      (p_league_id, wk, better_seed(seeds, w[1], w[2]), case when better_seed(seeds, w[1], w[2]) = w[1] then w[2] else w[1] end, 'scheduled', la, true, 2, 1, 'Semifinal'),
      (p_league_id, wk, better_seed(seeds, w[3], w[4]), case when better_seed(seeds, w[3], w[4]) = w[3] then w[4] else w[3] end, 'scheduled', la, true, 2, 2, 'Semifinal');
  end if;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'advanced', true, 'round', cur + 1, 'week', wk);
end $$;

-- One-shot playoff poll: settings, standings/seeds, the bracket, the champ.
create or replace function playoff_state(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare br jsonb; champ int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select settings_json -> 'playoff_bracket',
         nullif(settings_json ->> 'playoff_champion', '')::int
    into br, champ from league where id = p_league_id;
  if br = 'null'::jsonb then br := null; end if;
  return jsonb_build_object(
    'ok', true,
    'playoff_teams', league_playoff_teams(p_league_id),
    'playoff_start_week', league_playoff_start(p_league_id),
    'generated', br is not null,
    'underway', exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff and m.status <> 'scheduled'),
    'rounds', br -> 'rounds', 'seeds', br -> 'seeds',
    'consolation', coalesce(br -> 'consolation', '[]'::jsonb),
    'champion', champ,
    'champion_team', (select team_name from league_membership
      where league_id = p_league_id and sleeper_roster_id = champ),
    'matchups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', mu.id, 'week', mu.week, 'round', mu.playoff_round, 'pos', mu.bracket_pos,
        'label', mu.playoff_label, 'status', mu.status, 'consolation', mu.is_consolation,
        'home', mu.home_roster_id, 'away', mu.away_roster_id,
        'home_final', mu.home_final, 'away_final', mu.away_final,
        -- consolation ties hold rungs — no winner to show
        'winner', case when mu.status = 'final' and mu.home_final is not null
                            and not (mu.is_consolation and mu.home_final = mu.away_final)
                       then playoff_winner(mu, br -> 'seeds') end)
        order by mu.is_consolation, mu.playoff_round, mu.bracket_pos)
      from matchup mu where mu.league_id = p_league_id and mu.is_playoff), '[]'::jsonb),
    'standings', league_standings(p_league_id));
end $$;

grant execute on function league_standings(uuid) to authenticated;
grant execute on function set_playoff_rules(uuid, int, int) to authenticated;
grant execute on function generate_playoffs(uuid, jsonb) to authenticated;
grant execute on function advance_playoffs(uuid) to authenticated;
grant execute on function playoff_state(uuid) to authenticated;
