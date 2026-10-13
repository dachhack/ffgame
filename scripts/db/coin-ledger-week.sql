-- ─────────────────────────────────────────────────────────────────────────────
-- coin-ledger-week.sql — what a contest league's seats earned and spent, by week.
--
-- READ ONLY. Every statement is a SELECT; it changes nothing. Run it through the
-- "Run a database query" workflow (scripts/db/ files only, read-only session).
--
-- Seats, not team names, and no user ids: the workflow log is public. The
-- league is named by the first characters of its id. Founder (v0.706.2):
-- "Did I earn coin last week?" — the Weekly Cointest, week 5.
-- ─────────────────────────────────────────────────────────────────────────────
\pset pager off
-- the pooled connection resolves nothing unqualified (first run: relation "league" does not exist)
set search_path = public;
\echo '── the league'
select left(id::text, 8) as league, season, settings_json ->> 'contest' as contest, settings_json ->> 'contest_format' as format,
       settings_json ->> 'coin' as coin, settings_json -> 'coin_rules' as coin_rules
  from league where id::text like '5551fed6%';

\echo '── every ledger line, weeks 5 and 6'
select l.week, l.roster_id as seat, l.reason, l.delta, to_char(l.created_at at time zone 'America/New_York', 'Dy HH24:MI') as at_et
  from coin_ledger l join league g on g.id = l.league_id
 where g.id::text like '5551fed6%' and l.week in (5, 6)
 order by l.week, l.roster_id, l.created_at;

\echo '── the purses now, and what each seat has earned in all (credits only) and spent (debits only)'
select w.roster_id as seat, w.coins,
       coalesce((select sum(delta) from coin_ledger c where c.league_id = w.league_id and c.roster_id = w.roster_id and c.delta > 0), 0) as earned,
       coalesce((select sum(delta) from coin_ledger c where c.league_id = w.league_id and c.roster_id = w.roster_id and c.delta < 0), 0) as spent,
       (select string_agg(c.reason || ' ' || c.delta::text, ', ' order by c.created_at)
          from coin_ledger c where c.league_id = w.league_id and c.roster_id = w.roster_id and c.week = 5) as week5
  from team_wallet w join league g on g.id = w.league_id
 where g.id::text like '5551fed6%'
 order by w.roster_id;

\echo '── THE RAMS (a member: "Stafford is not a QB option in Bullseye or here but is not on bye"): the week-6 board'
select l.week, count(*) filter (where l.pos in ('QB','RB','WR','TE')) as skill_rows, string_agg(distinct l.team, ',') as teams_seen
  from pod_salary l where l.season = '2026' and l.week in (5, 6) group by l.week order by l.week;
select week, slug, pos, team, salary, proj from pod_salary where season = '2026' and week in (5, 6) and (team in ('LA', 'LAR') or slug like '%stafford%') order by week, pos, slug;
select week, home, away, kickoff from nfl_slate where season = '2026' and week = 6 and (home in ('LA', 'LAR') or away in ('LA', 'LAR'));
select player_slug, status, designation_date, team from injury_status where player_slug like '%stafford%';

\echo '── did the week-5 recap post (the settle runs as it posts)?'
select left(m.body, 90) as card, to_char(m.created_at at time zone 'America/New_York', 'Dy HH24:MI') as at_et
  from league_message m join league g on g.id = m.league_id
 where g.id::text like '5551fed6%' and m.kind = 'txn' and m.txn ->> 'kind' = 'contest_recap'
 order by m.created_at desc limit 3;
