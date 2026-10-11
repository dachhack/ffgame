-- 0471: HEAD-TO-HEAD RECORDS (v0.670.0). Founder: "Head-to-head records and a
-- round-robin schedule next, one PR."
--
-- A head-to-head contest league's season standings summed ring totals, the
-- same as a leaderboard's. A head-to-head league expects WINS AND LOSSES,
-- with the total as the tiebreak. contest_board's season rows now carry
-- wins, losses and ties, counted from the final matchups by the contest's
-- own rule (golf: the lower score wins), and a head-to-head league ranks by
-- record first. The schedule itself (seat one fixed, the rest rotating, so
-- everyone plays everyone once before anyone twice) is the worker's:
-- server/src/pods.js roundRobinPairs.

create or replace function contest_board(p_league uuid, p_week int default null, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; wk int; started boolean; rows jsonb; mine jsonb; srows jsonb; smine jsonb; n int; lim int; golf boolean; h2h boolean;
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
      select sc.*, rank() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last) as rank from sc
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.tb nulls last, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into rows, mine from ranked r;
  end if;

  if lg.contest_week is null then
    -- RECORDS (0471): each final head-to-head is a win, a loss or a tie by the
    -- contest's own rule (golf: the lower score wins). A board league's
    -- self-paired rows are neither. Head-to-head standings rank by record
    -- first, then the total; a leaderboard league by the total as before.
    with fin as (
      select m.home_roster_id as roster_id, m.home_final as f,
             case when m.away_roster_id = m.home_roster_id or m.home_final = m.away_final then null
                  when golf then m.home_final < m.away_final else m.home_final > m.away_final end as w,
             (m.away_roster_id <> m.home_roster_id and m.home_final = m.away_final) as t
        from matchup m where m.league_id = p_league and m.status = 'final'
      union all
      select m.away_roster_id, m.away_final,
             case when m.home_final = m.away_final then null
                  when golf then m.away_final < m.home_final else m.away_final > m.home_final end,
             (m.home_final = m.away_final)
        from matchup m where m.league_id = p_league and m.status = 'final' and m.away_roster_id <> m.home_roster_id
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
                                        case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last) as rank from s
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into srows, smine from ranked r;
  end if;

  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'entries', n, 'contest', _contest_of(lg),
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine,
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine) end);
end $$;
