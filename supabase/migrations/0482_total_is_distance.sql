-- 0482: THE DISTANCE IS THE SCORE (v0.683.0). Founder: "why are there
-- rings? It's just a target number and how far you are from it." A
-- one-team-total Bullseye week (settings_json.bullseye = 'total') used to
-- bank a ring — radius × spots − distance, higher winning — which only
-- renamed the distance and flipped its sign. From here the side's score IS
-- its distance from the target (zero penalties included) and the LOWEST
-- wins, like golf. The per-spot variant keeps its rings: nine darts need a
-- sum where closer is more.
--
-- The engine (applyBullseye's total branch) writes the distance; this
-- migration teaches every ranking which way is up —
--   league_lower_wins(id)  golf, or a one-team-total Bullseye: the classic
--                          winner rule (golf_beats) and standings
--                          (league_standings) read it;
--   _contest_lower_wins(lg) the same for a contest league: contest_board's
--                          week ranks, records and season rows, and
--                          bullseye_my_weeks's ranks —
-- and turns the finals already stamped as rings into distances
-- (_bullseye_total_to_distance: ring r at span s = radius × spots reads
-- back as s − r, or 2s − r past the dead-on bonus; a ring of 0 is a miss at
-- the span). The commissioner's RESCORE re-stamps a week exactly from the
-- stats if a converted number looks off.

create or replace function league_lower_wins(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select league_golf(p_league_id) or coalesce(league_bullseye(p_league_id) = 'total', false);
$$;
create or replace function golf_beats(p_league_id uuid, a numeric, b numeric) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when a is null or b is null then false
              when league_lower_wins(p_league_id) then a < b else a > b end;
$$;
create or replace function _contest_lower_wins(lg league) returns boolean
  language sql stable as $$
  select _contest_of(lg) = 'golf' or (_contest_of(lg) = 'bullseye' and coalesce(lg.settings_json ->> 'bullseye', 'slots') = 'total');
$$;
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name, 'division', z.division,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa,
        'median_w', z.mw, 'median_l', z.ml,
        'vampire', league_format(p_league_id) = 'vampire' and is_vampire_seat(p_league_id, z.rid),
        'eliminated', z.eliminated)
      order by z.w desc, case when league_lower_wins(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name, m.division, m.eliminated_week as eliminated,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa,
             coalesce(s.mw, 0) as mw, coalesce(s.ml, 0) as ml
      from league_membership m
      left join (
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.us, x.them)) as mw,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.them, x.us)) as ml,
               sum(x.us) filter (where x.pts) as pf, sum(x.them) filter (where x.pts) as pa
        from (
          with fin as (
            select mu.week, mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
            union all
            select mu.week, mu.away_roster_id, mu.away_final, mu.home_final
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
          ),
          med as (select week, (percentile_cont(0.5) within group (order by us))::numeric as med from fin group by week)
          select fin.rid, fin.us, fin.them, true as pts from fin
          union all
          select fin.rid, fin.us, med.med, false from fin join med on med.week = fin.week
          where league_median_game(p_league_id)
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;

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
  golf := _contest_lower_wins(lg);   -- lower wins: golf, and a one-team-total Bullseye (0482)
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
    ), mp as (select pos, rank from ranked where me order by pos limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me order by x.pos limit 1),
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
    ), mp as (select pos, rank from ranked where me order by pos limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me order by x.pos limit 1),
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

create or replace function bullseye_my_weeks(p_league uuid, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb; lg league; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  golf := _contest_lower_wins(lg);
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
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out, 'seats', _my_contest_seats_json(p_league));
end $$;

-- ── the finals already stamped as rings ─────────────────────────────────────
create or replace function _bullseye_total_to_distance(p_league uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare lg league; n int; span numeric; moved int := 0; k int;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or coalesce(lg.settings_json ->> 'bullseye', '') <> 'total' then return 0; end if;
  n := case when lg.kind in ('dfs', 'bullseye') then jsonb_array_length(_contest_slots(lg))
            when jsonb_typeof(lg.settings_json -> 'roster_slots') = 'array' then greatest(1, jsonb_array_length(lg.settings_json -> 'roster_slots'))
            else 9 end;
  span := coalesce(nullif(lg.settings_json ->> 'bullseye_radius', '')::numeric, 10) * n;
  update matchup set
      home_final = case when home_final is null then null when home_final > span then 2 * span - home_final else span - home_final end,
      away_final = case when away_final is null then null when away_final > span then 2 * span - away_final else span - away_final end
    where league_id = p_league and status = 'final' and (home_final is not null or away_final is not null);
  get diagnostics k = row_count; moved := moved + k;
  update matchup_state st set
      home_score = case when st.home_score > span then 2 * span - st.home_score else span - st.home_score end,
      away_score = case when st.away_score > span then 2 * span - st.away_score else span - st.away_score end
    from matchup m where st.matchup_id = m.id and m.league_id = p_league and st.game_window = 'wk' and m.status = 'final';
  get diagnostics k = row_count; moved := moved + k;
  return moved;
end $$;
do $$
declare l record; k int;
begin
  for l in select id, name from league where settings_json ->> 'bullseye' = 'total' loop
    k := _bullseye_total_to_distance(l.id);
    raise notice '0482: % — % rows now read as distances', l.name, k;
  end loop;
end $$;

revoke all on function _contest_lower_wins(league), _bullseye_total_to_distance(uuid) from public, anon, authenticated;
revoke all on function league_lower_wins(uuid) from public, anon;
grant execute on function league_lower_wins(uuid) to authenticated;
