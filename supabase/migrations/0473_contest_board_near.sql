-- 0473: "WHERE AM I" ON A BIG LEADERBOARD (v0.671.0). HANDOFF's first
-- not-done item: contest_board returned the top rows (up to 500) and the
-- caller's own row, so on a 50,000-seat contest a mid-table player saw the
-- top 100 and a lone "You: #23,418" line. Two additions, both on the same
-- ranked pass:
--
--   near  — when my row is off the top, the rows around mine (p_near either
--           side, by position, so a run of ties can't blow it up), so the
--           board shows who I'm chasing and who's chasing me.
--   found — a search by team name (p_find, case-insensitive substring, the
--           first 20 by rank), so a member can find a friend's seat without
--           paging.
--
-- Both ride the week board and the season standings. The signature grows by
-- two defaulted parameters, so the old overload is dropped first (two
-- overloads with defaults make a PostgREST call ambiguous), and the two
-- wrappers that call it by position (bullseye_league_board) are recreated
-- against the new one. The matchup(league_id, week) index 0001 created is
-- pinned by name here so a scratch rebuild or a hand-made database cannot
-- miss it — the week board's first read on a big contest is that index.

create index if not exists matchup_league_id_week_idx on matchup (league_id, week);

drop function if exists contest_board(uuid, int, int);
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
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine, 'near', coalesce(nrows, '[]'::jsonb), 'found', coalesce(frows, '[]'::jsonb),
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine, 'near', snrows, 'found', sfrows) end);
end $$;
create or replace function bullseye_league_board(p_league uuid, p_week int default null, p_limit int default 100)
  returns jsonb language sql security definer set search_path = public as $$ select contest_board(p_league, p_week, p_limit); $$;

revoke all on function contest_board(uuid, int, int, int, text) from public, anon;
grant execute on function contest_board(uuid, int, int, int, text) to authenticated;
