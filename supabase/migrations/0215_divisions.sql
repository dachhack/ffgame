-- 0215 — DIVISIONS (founder's platform-gap list, item 2).
--
-- A division is a LABEL on a seat, and everything else is derived: teams
-- sharing a label are a division, the standings carry the label, division
-- winners take the top playoff seeds, and the schedule's rematch weeks prefer
-- divisional opponents. No division table, no count setting — the commissioner
-- names each seat's division and the league either HAS divisions (every seat
-- labeled, at least two labels) or it doesn't. Half-labeled leagues behave
-- exactly as before, so nothing here can strand an existing league.
--
-- Three functions are re-created wholesale (SQL has no partial edit): the
-- 0200 league_standings body + a division field, the 0162 generate_playoffs
-- body with its seedless branch reading the new league_seed_standings, and
-- the 0064 native_generate_schedule + a divisional-preference pass on the
-- weeks BEYOND the full round-robin. Future edits belong here.

alter table league_membership add column if not exists division text;

-- Commissioner names (or clears) a seat's division.
create or replace function set_team_division(p_league_id uuid, p_roster_id int, p_division text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dv text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  dv := nullif(btrim(coalesce(p_division, '')), '');
  if dv is not null and length(dv) > 24 then
    return jsonb_build_object('ok', false, 'error', 'division names cap at 24 characters');
  end if;
  update league_membership set division = dv
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such seat'); end if;
  return jsonb_build_object('ok', true, 'roster_id', p_roster_id, 'division', dv);
end $$;
grant execute on function set_team_division(uuid, int, text) to authenticated;

/** Divisions are ACTIVE when every seat is labeled and there are ≥2 labels.
 *  A half-assigned league keeps pre-division behavior everywhere — better no
 *  divisions than a playoff seeding computed from a partial map. */
create or replace function league_divisions_active(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from league_membership m
                     where m.league_id = p_league_id and m.division is null)
     and (select count(distinct m.division) from league_membership m
          where m.league_id = p_league_id) >= 2;
$$;

-- league_standings (0200 body) + the seat's division riding each entry.
-- Order is unchanged — the table people read is still the global race.
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
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

/** The SEEDING order: division winners first (each division's best team, in
 *  standings order among themselves), then everyone else in standings order.
 *  Divisions inactive → exactly league_standings, so 0162's seedless branch
 *  behaves byte-identically for every league without divisions. */
create or replace function league_seed_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare base jsonb;
begin
  base := league_standings(p_league_id);
  if base ? 'error' or not league_divisions_active(p_league_id) then return base; end if;
  return coalesce((
    select jsonb_agg(e order by is_winner desc, ord)
    from (
      select t.e, t.ord,
        -- the division's best team is the one whose standings ordinal is the
        -- division's minimum — ties are already settled by standings order
        (t.ord = min(t.ord) over (partition by t.e ->> 'division')) as is_winner
      from jsonb_array_elements(base) with ordinality t(e, ord)
    ) t), '[]'::jsonb);
end $$;

-- generate_playoffs — 0162's body, with the seedless seeds and the consolation
-- ladder drawn from league_seed_standings (division winners protected).
create or replace function generate_playoffs(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
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

-- native_generate_schedule — 0064's circle method for the first round-robin,
-- then DIVISIONAL PREFERENCE for the rematch weeks: past week n−1 the circle
-- would just replay the same rotation, so those weeks now pair division mates
-- first (rotating within the division for variety), cross-division leftovers
-- filling the rest. Divisions inactive → the 0064 behavior, verbatim.
create or replace function native_generate_schedule(p_league_id uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids int[]; n int; ghost boolean := false; wk int; i int;
  a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
  use_div boolean; rot int; pool int[]; pairs int[]; div_a text; j int; pick int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 18 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–18');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  use_div := league_divisions_active(p_league_id);
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;  -- 0 = bye

  select l.season into seas from league l where l.id = p_league_id;
  delete from matchup where league_id = p_league_id;  -- all scheduled (checked above)

  for wk in 1..p_weeks loop
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

    if use_div and wk > n - 1 then
      -- REMATCH WEEK, divisions on: greedy division-first pairing. `rot`
      -- rotates which division mate each seat meets so consecutive rematch
      -- weeks differ; anyone whose division is exhausted pairs across.
      rot := wk - (n - 1);
      select array_agg(m.sleeper_roster_id order by m.division, m.sleeper_roster_id)
        into pool from league_membership m where m.league_id = p_league_id;
      pairs := '{}';
      while coalesce(array_length(pool, 1), 0) >= 2 loop
        a := pool[1]; pool := pool[2:];
        select m.division into div_a from league_membership m
          where m.league_id = p_league_id and m.sleeper_roster_id = a;
        -- division mates still unpaired, rotation picking among them
        select count(*) into j from unnest(pool) u
          join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
          where m.division = div_a;
        if j > 0 then
          pick := ((rot - 1) % j) + 1;
          select u into b from (
            select u, row_number() over (order by u) as rn from unnest(pool) u
            join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
            where m.division = div_a) t where t.rn = pick;
        else
          b := pool[1];
        end if;
        pool := array_remove(pool, b);
        pairs := pairs || a || b;
      end loop;
      -- (an odd human count leaves one seat over: that seat's bye, as before)
      i := 1;
      while i < coalesce(array_length(pairs, 1), 0) loop
        a := pairs[i]; b := pairs[i + 1]; i := i + 2;
        if wk % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
        insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, hm, aw, 'scheduled', la)
        on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
        made := made + 1;
      end loop;
      continue;
    end if;

    for i in 0..(n / 2 - 1) loop
      -- circle method: ids[n] fixed, the rest rotate one step per week
      a := ids[((wk - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n]
                else ids[((wk - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      if wk % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', p_weeks, 'matchups', made);
end $$;

-- admin_league_members (0130 body) + the seat's division, so the commissioner's
-- teams screen shows the map it edits.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email,
    'coin', coalesce(w.coins, 0),
    'division', m.division,
    'drifted', (
      coalesce(l.provider, 'sleeper') = 'sleeper'
      and m.enrolled
      and m.claim_email is null
      and u.sleeper_user_id is distinct from m.sleeper_owner_id
    )
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m
    join league l on l.id = m.league_id
    left join app_user u on u.id = m.app_user_id
    left join team_wallet w on w.league_id = m.league_id and w.roster_id = m.sleeper_roster_id
  where m.league_id = p_league_id;
  return result;
end $$;
