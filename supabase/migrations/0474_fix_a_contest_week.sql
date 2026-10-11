-- 0474: THE COMMISSIONER FIXES A CONTEST WEEK (v0.672.0). HANDOFF's second
-- not-done item: "Commissioner tools to fix a week: void, rescore after a
-- stat correction, set a member's squad." Three doors onto a weekly squad
-- league's week, each on the classic console's pattern (0353 re-score, 0355
-- stat correction, 0356 lineup fix) — the contest's twin where the classic
-- one can't apply, the classic one let through where it can.
--
-- ── VOID A WEEK ────────────────────────────────────────────────────────────
-- A week the league agrees shouldn't count (the feed died, the board was
-- priced wrong, a ruling). NOT a new matchup status: a voided week must still
-- read as PLAYED everywhere the engine asks "what week is this league on"
-- (contest_league, _contest_week, the pods tick all look for the first
-- non-final matchup), or the league would snap back to the voided week and
-- try to play it again. Instead a `week_void` row per league-week: the season
-- standings, the records and the result card skip it; the week board still
-- shows it, marked VOIDED. Only a FINAL week can be voided (a live one is
-- still being scored; a future one has nothing to void), the finals stay
-- stored, so RESTORE is a delete. The league is told either way.
--
-- ── RE-SCORE, AND THE STAT CORRECTION ──────────────────────────────────────
-- A contest league is classic by game_mode (0466) and resolveMatchup scores
-- its squads through classicPoints, so 0353's re-score and 0355's point
-- adjustment already work on it end to end — except that 0355 looked the
-- player up in league_pool, which a contest league doesn't have. Both
-- adjustment functions now look at the week's priced board (pod_salary) for
-- a contest league, and _txn_player names a board player too.
--
-- ── SET A MEMBER'S SQUAD ───────────────────────────────────────────────────
-- commish_set_contest_squad: one seat's squad for a week, past the kickoff
-- locks and the ruled-out rule (the commissioner is restoring what was meant,
-- after the fact), under every other rule a member's save obeys — the spot
-- rules, the budget, the floor, the board. Those rules are now ONE function,
-- _contest_squad_check, that save_contest_entry calls too, so the two can't
-- drift. A reason is required, the old and new squads go to lineup_edit_log,
-- the league hears who came in and out, and a stamped week keeps its finals
-- until it is re-scored (`rescore` in the answer, as 0356).

-- ── VOID ──────────────────────────────────────────────────────────────────
create table if not exists week_void (
  league_id uuid not null references league(id) on delete cascade,
  week      int  not null,
  note      text not null,
  set_by    uuid,
  set_at    timestamptz not null default now(),
  primary key (league_id, week)
);
alter table week_void enable row level security;
drop policy if exists week_void_read on week_void;
create policy week_void_read on week_void for select using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

create or replace function _week_void(p_league uuid, p_week int) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from week_void v where v.league_id = p_league and v.week = p_week);
$$;
revoke all on function _week_void(uuid, int) from public, anon, authenticated;

create or replace function commish_void_week(p_league uuid, p_week int, p_void boolean default true, p_note text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; why text := nullif(btrim(coalesce(p_note, '')), ''); n int; had boolean;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can do this'); end if;
  select count(*) into n from matchup where league_id = p_league and week = p_week;
  if p_week is null or n = 0 then return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?')); end if;
  had := _week_void(p_league, p_week);
  if coalesce(p_void, true) then
    if had then return jsonb_build_object('ok', true, 'void', true, 'week', p_week, 'already', true); end if;
    if exists (select 1 from matchup where league_id = p_league and week = p_week and status <> 'final') then
      return jsonb_build_object('ok', false, 'error', 'week ' || p_week || ' isn''t final yet — void it once it''s over');
    end if;
    if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
    insert into week_void (league_id, week, note, set_by) values (p_league, p_week, left(why, 200), auth.uid());
    perform _chat_house(p_league, '🚫 The commissioner voided week ' || p_week || ' — it doesn''t count in the standings. ' || left(why, 200),
      jsonb_build_object('kind', 'week_void', 'week', p_week));
  else
    if not had then return jsonb_build_object('ok', true, 'void', false, 'week', p_week, 'already', true); end if;
    delete from week_void where league_id = p_league and week = p_week;
    perform _chat_house(p_league, '↩️ The commissioner restored week ' || p_week || ' — it counts in the standings again.',
      jsonb_build_object('kind', 'week_restore', 'week', p_week));
  end if;
  return jsonb_build_object('ok', true, 'void', coalesce(p_void, true), 'week', p_week);
end $$;
revoke all on function commish_void_week(uuid, int, boolean, text) from public, anon;
grant execute on function commish_void_week(uuid, int, boolean, text) to authenticated;

-- The commissioner's week picker: every week this league has a row for, whether
-- it's final, voided, how many squads were entered and how many finals stand.
create or replace function contest_week_list(p_league uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_member(p_league) or is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  return jsonb_build_object('ok', true, 'week', coalesce(lg.contest_week, _contest_week(lg.season)), 'weeks', coalesce((
    select jsonb_agg(jsonb_build_object('week', x.week, 'status', x.status, 'final', x.fin, 'void', v.week is not null, 'void_note', v.note,
                                        'entries', (select count(*) from sleeper_lineup s where s.league_id = p_league and s.week = x.week),
                                        'stamped', x.stamped, 'matchups', x.n) order by x.week)
      from (select m.week, bool_and(m.status = 'final') as fin, count(*) as n,
                   count(*) filter (where m.status = 'final' and m.home_final is not null and m.away_final is not null) as stamped,
                   case when bool_and(m.status = 'final') then 'final' when bool_or(m.status = 'live') then 'live' else min(m.status::text) end as status
              from matchup m where m.league_id = p_league group by m.week) x
      left join week_void v on v.league_id = p_league and v.week = x.week), '[]'::jsonb));
end $$;
revoke all on function contest_week_list(uuid) from public, anon;
grant execute on function contest_week_list(uuid) to authenticated;

-- ── THE STANDINGS SKIP A VOIDED WEEK ───────────────────────────────────────
-- contest_board, 0473's body, plus: the season rows skip voided weeks, and the
-- answer says whether the week shown is voided and which weeks are.
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
    -- A VOIDED week (0474) is neither played nor counted.
    with fin as (
      select m.home_roster_id as roster_id, m.home_final as f,
             case when m.away_roster_id = m.home_roster_id or m.home_final = m.away_final then null
                  when golf then m.home_final < m.away_final else m.home_final > m.away_final end as w,
             (m.away_roster_id <> m.home_roster_id and m.home_final = m.away_final) as t
        from matchup m where m.league_id = p_league and m.status = 'final'
         and not exists (select 1 from week_void v where v.league_id = m.league_id and v.week = m.week)
      union all
      select m.away_roster_id, m.away_final,
             case when m.home_final = m.away_final then null
                  when golf then m.away_final < m.home_final else m.away_final > m.home_final end,
             (m.home_final = m.away_final)
        from matchup m where m.league_id = p_league and m.status = 'final' and m.away_roster_id <> m.home_roster_id
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

-- bullseye_my_weeks, 0466's body, plus `void` on each week.
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
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, coalesce(m.away_final, st.away_score) as opp_ring
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk' where m.league_id = p_league
    union all
    select m.week, m.status, m.away_roster_id, m.away_tb, coalesce(m.away_final, st.away_score), m.home_roster_id, coalesce(m.home_final, st.home_score)
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
           'opp_ring', r.opp_ring, 'void', _week_void(p_league, r.week)) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out);
end $$;

-- ── THE STAT CORRECTION REACHES A CONTEST BOARD ────────────────────────────
-- _txn_player (0290) names a board player when league_pool has nothing.
create or replace function _txn_player(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(full_name, '') from league_pool
                    where league_id = p_league_id and slug = p_slug),
                  (select nullif(name, '') from pod_salary where slug = p_slug order by season desc, week desc limit 1),
                  p_slug);
$$;

-- league_player_adjustments, 0355's body; a contest league's search runs over
-- the week's priced board, and "owner" counts the squads that hold him.
create or replace function league_player_adjustments(p_league_id uuid, p_week int default null, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), ''); lg league; wk int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'adjustments', coalesce((
    select jsonb_agg(jsonb_build_object('week', a.week, 'slug', a.slug, 'name', _txn_player(a.league_id, a.slug),
             'points', a.points, 'note', a.note, 'set_at', a.set_at) order by a.week desc, a.set_at desc)
      from player_adjustment a
     where a.league_id = p_league_id and (p_week is null or a.week = p_week)), '[]'::jsonb),
    'found', case when q is null or not (is_league_commish(p_league_id) or is_admin()) then '[]'::jsonb
      when _is_contest(lg) then coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', ps.slug, 'name', ps.name, 'pos', ps.pos, 'team', ps.team,
                   'owner', case when h.n > 0 then 'in ' || h.n || ' squad' || case when h.n = 1 then '' else 's' end end) as x
            from pod_salary ps
            left join lateral (select count(*) as n from sleeper_lineup sl
                                where sl.league_id = p_league_id and sl.week = ps.week
                                  and exists (select 1 from jsonb_array_elements(sl.starters_json) e where e ->> 'player_slug' = ps.slug)) h on true
           where ps.season = lg.season and ps.week = coalesce(p_week, lg.contest_week, _contest_week(lg.season))
             and ps.name ilike '%' || q || '%'
           order by (h.n = 0), ps.salary desc limit 12) s), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                   'owner', case when nr.roster_id is not null then _txn_team(p_league_id, nr.roster_id) end) as x
            from league_pool lp
            left join native_roster nr on nr.league_id = lp.league_id and nr.slug = lp.slug
           where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
           order by (nr.roster_id is null), lp.rank limit 12) s), '[]'::jsonb) end);
end $$;

-- commish_set_player_adjustment, 0355's body; the player check reads the
-- week's board for a contest league.
create or replace function commish_set_player_adjustment(p_league_id uuid, p_week int, p_slug text, p_points numeric, p_note text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare pts numeric := round(coalesce(p_points, 0), 1); why text := nullif(btrim(coalesce(p_note, '')), '');
        had numeric; stamped boolean; line text; lg league;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'point adjustments are for classic leagues — a drip week isn''t a sum of points');
  end if;
  if p_week is null or not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?'));
  end if;
  if _is_contest(lg) then
    if not exists (select 1 from pod_salary where season = lg.season and week = p_week and slug = p_slug) then
      return jsonb_build_object('ok', false, 'error', 'player not on week ' || p_week || '''s board');
    end if;
  elsif not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if pts < -50 or pts > 50 then
    return jsonb_build_object('ok', false, 'error', 'an adjustment is between -50 and +50 points');
  end if;
  if pts <> 0 and why is null then
    return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason');
  end if;
  select points into had from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
  if pts = 0 then
    delete from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
    if had is null then return jsonb_build_object('ok', true, 'removed', false); end if;
    line := '✏️ The commissioner removed the week ' || p_week || ' adjustment on ' || _txn_player(p_league_id, p_slug)
      || ' (was ' || case when had > 0 then '+' else '' end || had::text || ')';
  else
    insert into player_adjustment (league_id, week, slug, points, note, set_by)
    values (p_league_id, p_week, p_slug, pts, left(why, 200), auth.uid())
    on conflict (league_id, week, slug) do update
      set points = excluded.points, note = excluded.note, set_by = excluded.set_by, set_at = now();
    line := '✏️ The commissioner adjusted ' || _txn_player(p_league_id, p_slug) || '''s week ' || p_week || ' score by '
      || case when pts > 0 then '+' else '' end || trim(to_char(pts, 'FM990.0')) || ' — ' || left(why, 200);
  end if;
  select exists (select 1 from matchup where league_id = p_league_id and week = p_week
                   and home_final is not null and away_final is not null) into stamped;
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'adjust', 'week', p_week, 'slug', p_slug, 'points', pts));
  return jsonb_build_object('ok', true, 'points', pts, 'note', line,
    -- A stamped week keeps its old finals until it is re-scored.
    'rescore', stamped);
end $$;

-- ── ONE SQUAD CHECK, TWO CALLERS ───────────────────────────────────────────
-- The rules a squad obeys whoever saves it: every spot filled from this
-- week's board, one spot per player, the spot's own rule (_contest_spot_error:
-- position, tenure, flags, the pool filter, the seat rule), the budget and
-- the floor. p_member adds the member's ruled-out rule (0467); the kickoff
-- locks stay in save_contest_entry, since they are about WHO is saving.
-- Returns {error} or {lineup, spent, budget, min_spend}.
create or replace function _contest_squad_check(lg league, p_roster int, p_week int, p_slots jsonb, p_season text, p_old jsonb, p_member boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare spots jsonb; n int; i int; slot text; pslug text; ps pod_salary; bad text;
        spent int := 0; seen text[] := '{}'; lineup jsonb := '[]'::jsonb; budget int; floor_ int;
begin
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('error', 'a squad is one player per spot'); end if;
  spots := _contest_slots(lg);
  n := jsonb_array_length(spots);
  budget := _contest_budget(lg);
  floor_ := _contest_min_spend(lg);
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where k !~ '^S[0-9]+$' or substr(k, 2)::int < 1 or substr(k, 2)::int > n;
  if bad is not null then return jsonb_build_object('error', 'unknown spot: ' || bad); end if;
  for i in 1..n loop
    slot := 'S' || i;
    pslug := nullif(btrim(coalesce(p_slots ->> slot, '')), '');
    if pslug is null then
      return jsonb_build_object('error', 'fill every spot — ' || coalesce(nullif(spots -> (i - 1) ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(spots -> (i - 1) -> 'pos') x), '/')) || ' is empty');
    end if;
    if pslug = any (seen) then return jsonb_build_object('error', 'a player can only fill one spot'); end if;
    seen := array_append(seen, pslug);
    select * into ps from pod_salary where season = p_season and week = p_week and pod_salary.slug = pslug;
    if ps.slug is null then return jsonb_build_object('error', 'a pick is not on this week''s board'); end if;
    -- RULED OUT (0467): a player the injury report has at O or IR is not a
    -- new pick — the DFS rule. One already in the saved squad may stay (and
    -- be swapped out until his game locks). The commissioner's fix is after
    -- the fact: whoever played, played.
    if p_member and exists (select 1 from injury_status ist where ist.player_slug = pslug and upper(ist.status) in ('O', 'IR'))
       and not exists (select 1 from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o where o ->> 'player_slug' = pslug) then
      return jsonb_build_object('error', ps.name || ' is ruled out this week — pick someone else');
    end if;
    bad := _contest_spot_error(lg, p_roster, spots -> (i - 1), slot, ps);
    if bad is not null then return jsonb_build_object('error', bad); end if;
    spent := spent + ps.salary;
    lineup := lineup || jsonb_build_object('slot', slot, 'sleeper_id', null, 'player_slug', pslug, 'pos', upper(ps.pos));
  end loop;
  if budget > 0 and spent > budget then return jsonb_build_object('error', 'over the $' || to_char(budget, 'FM999,999,999') || ' budget by $' || to_char(spent - budget, 'FM999,999,999')); end if;
  -- THE FLOOR (0469): golf's constraint — spend at least this much.
  if floor_ > 0 and spent < floor_ then return jsonb_build_object('error', 'under the $' || to_char(floor_, 'FM999,999,999') || ' minimum spend by $' || to_char(floor_ - spent, 'FM999,999,999')); end if;
  return jsonb_build_object('lineup', lineup, 'spent', spent, 'budget', budget, 'min_spend', floor_);
end $$;
revoke all on function _contest_squad_check(league, int, int, jsonb, text, jsonb, boolean) from public, anon, authenticated;

-- save_contest_entry, 0470's body, its squad rules moved into _contest_squad_check.
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; bad text; chk jsonb;
        spent int := 0; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int; floor_ int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
  end if;
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;

  chk := _contest_squad_check(lg, seat.sleeper_roster_id, p_week, p_slots, p_season, old, true);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup'; spent := (chk ->> 'spent')::int; budget := (chk ->> 'budget')::int; floor_ := (chk ->> 'min_spend')::int;

  -- the per-player lock (0093) — AT KICKOFF for a contest league (0470).
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e ->> 'player_slug' and o ->> 'slot' = e ->> 'slot');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;

-- ── THE COMMISSIONER SETS A SEAT'S SQUAD ───────────────────────────────────
-- Reads a seat's saved squad for a week (sleeper_lineup is the member's own
-- to read while the week is sealed), and writes one.
create or replace function commish_contest_squad(p_league uuid, p_week int, p_roster int)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; seat league_membership; m matchup;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can do this'); end if;
  select * into seat from league_membership where league_id = p_league and sleeper_roster_id = p_roster;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'no such seat'); end if;
  select * into m from matchup where league_id = p_league and week = p_week and p_roster in (home_roster_id, away_roster_id) limit 1;
  return jsonb_build_object('ok', true, 'roster_id', p_roster, 'team', seat.team_name, 'week', p_week,
    'entry', (select starters_json from sleeper_lineup where league_id = p_league and week = p_week and roster_id = p_roster),
    'status', m.status, 'stamped', m.id is not null and m.home_final is not null and m.away_final is not null,
    'slots', _contest_slots(lg), 'budget', _contest_budget(lg), 'min_spend', _contest_min_spend(lg), 'season', lg.season);
end $$;
revoke all on function commish_contest_squad(uuid, int, int) from public, anon;
grant execute on function commish_contest_squad(uuid, int, int) to authenticated;

create or replace function commish_set_contest_squad(p_league uuid, p_week int, p_roster int, p_slots jsonb, p_note text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; why text := nullif(btrim(coalesce(p_note, '')), ''); old jsonb; chk jsonb; lineup jsonb;
        ins text[]; outs text[]; stamped boolean; lk timestamptz;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can do this'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if p_week is null or not exists (select 1 from matchup where league_id = p_league and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?'));
  end if;
  select * into seat from league_membership where league_id = p_league and sleeper_roster_id = p_roster and enrolled;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'no such seat'); end if;
  if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = p_roster;

  chk := _contest_squad_check(lg, p_roster, p_week, p_slots, lg.season, old, false);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup';

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, p_roster, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(lg.season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, p_roster, p_roster, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  insert into lineup_edit_log (league_id, week, roster_id, before, after, note, set_by)
  values (p_league, p_week, p_roster, coalesce(old, '[]'::jsonb), lineup, left(why, 200), auth.uid());

  select array_agg(_txn_player(p_league, s) order by s) into ins from (
    select x ->> 'player_slug' s from jsonb_array_elements(lineup) x
    except select x ->> 'player_slug' from jsonb_array_elements(coalesce(old, '[]'::jsonb)) x) a;
  select array_agg(_txn_player(p_league, s) order by s) into outs from (
    select x ->> 'player_slug' s from jsonb_array_elements(coalesce(old, '[]'::jsonb)) x
    except select x ->> 'player_slug' from jsonb_array_elements(lineup) x) a;
  select exists (select 1 from matchup where league_id = p_league and week = p_week and p_roster in (home_roster_id, away_roster_id)
                   and home_final is not null and away_final is not null) into stamped;
  if ins is not null or outs is not null then
    perform _chat_house(p_league,
      '🧾 The commissioner set ' || _txn_team(p_league, p_roster) || '''s week ' || p_week || ' squad: '
      || concat_ws('; ', 'in ' || array_to_string(ins, ', '), 'out ' || array_to_string(outs, ', '))
      || ' — ' || left(why, 200),
      jsonb_build_object('kind', 'lineup_fix', 'week', p_week, 'roster_id', p_roster));
  end if;
  return jsonb_build_object('ok', true, 'in', coalesce(to_jsonb(ins), '[]'::jsonb), 'out', coalesce(to_jsonb(outs), '[]'::jsonb),
    'spent', (chk ->> 'spent')::int, 'rescore', stamped);
end $$;
revoke all on function commish_set_contest_squad(uuid, int, int, jsonb, text) from public, anon;
grant execute on function commish_set_contest_squad(uuid, int, int, jsonb, text) to authenticated;
