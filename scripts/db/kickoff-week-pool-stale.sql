-- Kickoff League: the matchup board showed Team 4 with 13 on the bench while
-- its roster holds 10 there (founder). v0.730.11's reading: a live week's pool
-- (sleeper_lineup) is refreshed add-only (0314), so the three players Team 4
-- dropped by waiver after the Thursday kickoff (Oct 16 and 17) are still in
-- it, and the board listed the pool's non-starters as the bench. This reads,
-- for every team in the league's live week, the pool entries that are no
-- longer on the roster. Read only; seats and players only.
\pset pager off
set search_path = public;
\set lid '''5ae08e35-c852-42a6-b944-69779cb012d0'''
select min(week) as wk from matchup where league_id = :lid and status = 'live' \gset
\echo '── the live week'
select :wk as live_week;
\echo '── per team: the week pool''s size, the roster''s, and the pool entries no longer on the roster'
with pool as (
  select sl.roster_id, coalesce(e ->> 'slug', e ->> 'player_slug') as slug
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
   where sl.league_id = :lid and sl.week = :wk
)
select p.roster_id,
       count(*) as in_week_pool,
       (select count(*) from native_roster nr where nr.league_id = :lid and nr.roster_id = p.roster_id) as on_roster,
       string_agg(p.slug, ', ' order by p.slug) filter (
         where not exists (select 1 from native_roster nr where nr.league_id = :lid and nr.roster_id = p.roster_id and nr.slug = p.slug)) as gone_from_roster
  from pool p group by p.roster_id order by p.roster_id;
