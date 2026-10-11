-- 0476: PLAYOFFS FOR A SEASON HEAD-TO-HEAD CONTEST LEAGUE (v0.674.0).
-- HANDOFF's fourth not-done item: "Playoffs for season head-to-head (a top-N
-- bracket over the last weeks)." Not a second bracket: the classic one
-- (0073 the bracket and the consolation ladder, 0162 the season closing
-- itself, 0215 seeding, 0246 off, 0359 the commissioner's seeds) opens its
-- door to a contest league that plays head-to-head over the season. Its
-- winner rule already reads league_golf (0200), which a golf contest sets,
-- and its seeding is league_standings over the regular season.
--
-- `_bracket_league`: native, or a season head-to-head contest league, in
-- place of is_native_league in the two functions that gated on it
-- (set_playoff_rules, generate_playoffs_bracket). generate_playoffs'
-- sport check and league_playoff_teams' default (4, from week 15) apply as
-- they do to a classic league, so a contest league plays a four-team
-- bracket from week 15 unless its commissioner says otherwise — the
-- worker (pods.js) stops pairing the round-robin at the playoff start and
-- pokes generate_playoffs / advance_playoffs instead. A leaderboard league
-- and a one-week league play none. The regular-season standings
-- (contest_board's season rows, the records) stop at the bracket, and MY
-- WEEKS names a bracket week ("Semifinal").

create or replace function _bracket_league(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league l where l.id = p_league_id
                  and (l.provider = 'native'
                       or (_is_contest(l) and not _is_open_contest(l) and l.contest_week is null and _contest_format_of(l) = 'h2h')));
$$;
revoke all on function _bracket_league(uuid) from public, anon, authenticated;

-- ── set_playoff_rules — 0433's body, the gate widened ──
create or replace function set_playoff_rules(p_league_id uuid, p_teams int default null, p_start_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean; sw int; tm int; rounds int; last_wk int; seas text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'playoffs are not built for a daily sport yet');
  end if;
  if not _bracket_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues, or a season head-to-head contest league');
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
  -- 0374: a college-calendar league's weeks are board weeks 201..215; a plain
  -- college week number (2..15) is read as one. Its bracket must also END by
  -- Week 15, since the college regular season does.
  college := league_is_college_calendar(p_league_id);
  if college then
    if p_start_week is not null and p_start_week between 2 and 15 then p_start_week := 200 + p_start_week; end if;
    -- 0375: bowl weeks (216+) are playable too; the last playable week is the
    -- last one the college slate holds for this season (Week 15 without bowls).
    select season into seas from league where id = p_league_id;
    last_wk := greatest(215, coalesce((select max(week) from nfl_slate where season = seas and week between 216 and 223), 215));
    if p_start_week is not null and (p_start_week < 202 or p_start_week > last_wk) then
      return jsonb_build_object('ok', false, 'error',
        'college playoffs must start between college Week 2 and ' || college_week_label(last_wk));
    end if;
    sw := coalesce(p_start_week, league_playoff_start(p_league_id));
    tm := coalesce(p_teams, league_playoff_teams(p_league_id));
    rounds := case tm when 0 then 0 when 2 then 1 when 4 then 2 else 3 end;
    if rounds > 0 and sw + rounds - 1 > last_wk then
      return jsonb_build_object('ok', false, 'error',
        'a bracket of ' || tm || ' needs ' || rounds || ' weeks — start by ' || college_week_label(last_wk - rounds + 1)
        || ' so it ends by ' || college_week_label(last_wk));
    end if;
  elsif p_start_week is not null and (p_start_week < 2 or p_start_week > 18) then
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

-- ── generate_playoffs_bracket — 0249's body, the gate widened ──
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
  if not _bracket_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues, or a season head-to-head contest league');
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

-- ── contest_board — 0474's body; the season rows are the regular season ──
create or replace function contest_board(p_league uuid, p_week int default null, p_limit int default 100, p_near int default 5, p_find text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; wk int; started boolean; rows jsonb; mine jsonb; nrows jsonb; frows jsonb; srows jsonb; smine jsonb; snrows jsonb; sfrows jsonb;
        n int; lim int; nr int; q text; golf boolean; h2h boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest'); end if;
  if not (_is_open_contest(lg) or is_league_member(p_league) or is_league_commish(p_league) or is_admin()
          or exists (select 1 from league_listing li where li.league_id = p_league and li.open)) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  golf := _contest_of(lg) = 'golf';
  h2h := _contest_format_of(lg) = 'h2h';
  lim := greatest(1, least(coalesce(p_limit, 100), 500));
  nr := greatest(0, least(coalesce(p_near, 5), 50));
  -- The search is a plain substring: the pattern characters are escaped so a
  -- "%" or "_" in a name finds that name, not everything.
  q := case when nullif(btrim(coalesce(p_find, '')), '') is null then null
            else '%' || replace(replace(replace(btrim(p_find), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  wk := coalesce(p_week, lg.contest_week, _contest_week(lg.season), (select max(week) from matchup where league_id = p_league));
  started := wk is not null and coalesce(_week_first_lock(lg.season, wk) <= now(), false);
  select count(*) into n from sleeper_lineup where league_id = p_league and week = wk;

  if started then
    with sides as (
      select m.home_roster_id as roster_id, coalesce(m.home_final, st.home_score, 0) as ring, m.home_tb as tb, 'home' as side, st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk
      union all
      select m.away_roster_id, coalesce(m.away_final, st.away_score, 0), m.away_tb, 'away', st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk and m.away_roster_id <> m.home_roster_id
    ), sc as (
      select s.roster_id, lm.team_name, lm.app_user_id = auth.uid() as me, s.ring, s.tb, s.status,
             (select coalesce(sum((x ->> 'score')::numeric), 0) from jsonb_array_elements(coalesce(s.slot_scores, '[]'::jsonb)) x
               where x ->> 'side' = s.side) as points
        from sides s join league_membership lm on lm.league_id = p_league and lm.sleeper_roster_id = s.roster_id
    ), ranked as (
      select sc.*, rank() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last) as rank,
             row_number() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last, sc.team_name, sc.roster_id) as pos from sc
    ), mp as (select pos, rank from ranked where me limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) from ranked x, mp where mp.rank > lim and abs(x.pos - mp.pos) <= nr),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb)
              from (select * from ranked x where q is not null and x.team_name ilike q order by x.pos limit 20) x)
      into rows, mine, nrows, frows from ranked r;
  end if;

  if lg.contest_week is null then
    -- RECORDS (0471): each final head-to-head is a win, a loss or a tie by the
    -- contest's own rule (golf: the lower score wins). A board league's
    -- self-paired rows are neither. Head-to-head standings rank by record
    -- first, then the total; a leaderboard league by the total as before.
    -- A VOIDED week (0474) is neither played nor counted; a PLAYOFF week
    -- (0476) is the bracket's, not the regular season's.
    with fin as (
      select m.home_roster_id as roster_id, m.home_final as f,
             case when m.away_roster_id = m.home_roster_id or m.home_final = m.away_final then null
                  when golf then m.home_final < m.away_final else m.home_final > m.away_final end as w,
             (m.away_roster_id <> m.home_roster_id and m.home_final = m.away_final) as t
        from matchup m where m.league_id = p_league and m.status = 'final' and not m.is_playoff
         and not exists (select 1 from week_void v where v.league_id = m.league_id and v.week = m.week)
      union all
      select m.away_roster_id, m.away_final,
             case when m.home_final = m.away_final then null
                  when golf then m.away_final < m.home_final else m.away_final > m.home_final end,
             (m.home_final = m.away_final)
        from matchup m where m.league_id = p_league and m.status = 'final' and m.away_roster_id <> m.home_roster_id and not m.is_playoff
         and not exists (select 1 from week_void v where v.league_id = m.league_id and v.week = m.week)
    ), s as (
      select lm.sleeper_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
             coalesce(sum(fin.f), 0) as total, count(fin.f) as weeks,
             case when golf then min(fin.f) else max(fin.f) end as best,
             count(*) filter (where fin.w) as wins,
             count(*) filter (where fin.w = false) as losses,
             count(*) filter (where fin.t) as ties
        from league_membership lm
        left join fin on fin.roster_id = lm.sleeper_roster_id
       where lm.league_id = p_league and lm.enrolled
       group by lm.sleeper_roster_id, lm.team_name, lm.app_user_id
    ), ranked as (
      select s.*, rank() over (order by case when h2h then -s.wins else 0 end asc, case when h2h then s.losses else 0 end asc,
                                        case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last) as rank,
             row_number() over (order by case when h2h then -s.wins else 0 end asc, case when h2h then s.losses else 0 end asc,
                                        case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last, s.team_name, s.roster_id) as pos from s
    ), mp as (select pos, rank from ranked where me limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) from ranked x, mp where mp.rank > lim and abs(x.pos - mp.pos) <= nr),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb)
              from (select * from ranked x where q is not null and x.team_name ilike q order by x.pos limit 20) x)
      into srows, smine, snrows, sfrows from ranked r;
  end if;

  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'entries', n, 'contest', _contest_of(lg),
    'void', coalesce(_week_void(p_league, wk), false),
    'voided', coalesce((select jsonb_agg(v.week order by v.week) from week_void v where v.league_id = p_league), '[]'::jsonb),
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine, 'near', coalesce(nrows, '[]'::jsonb), 'found', coalesce(frows, '[]'::jsonb),
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine, 'near', snrows, 'found', sfrows) end);
end $$;

-- ── bullseye_my_weeks — 0474's body, plus the bracket label ──
create or replace function bullseye_my_weeks(p_league uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb; lg league; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  golf := _contest_of(lg) = 'golf';
  with sides as (
    select m.week, m.status, m.home_roster_id as roster_id, m.home_tb as tb, coalesce(m.home_final, st.home_score) as ring,
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, coalesce(m.away_final, st.away_score) as opp_ring,
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk' where m.league_id = p_league
    union all
    select m.week, m.status, m.away_roster_id, m.away_tb, coalesce(m.away_final, st.away_score), m.home_roster_id, coalesce(m.home_final, st.home_score),
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league and m.away_roster_id <> m.home_roster_id
  ), ranked as (
    select sides.*, rank() over (partition by week order by case when golf then coalesce(ring, 0) else -coalesce(ring, 0) end asc, tb asc nulls last) as rank,
           count(*) over (partition by week) as entries
      from sides
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', r.week, 'status', r.status, 'ring', r.ring, 'tb', r.tb,
           'rank', case when r.status in ('live', 'final') then r.rank end, 'entries', r.entries,
           'opp', r.opp, 'opp_team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = r.opp limit 1),
           'opp_ring', r.opp_ring, 'void', _week_void(p_league, r.week), 'playoff', r.is_playoff, 'label', r.playoff_label) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out);
end $$;
