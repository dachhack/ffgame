-- Has the hourly AI seat wire (server/src/seatWire.js) stopped for every
-- league, or just Kickoff League's Team 4? 059's one-seat pass legalised Team
-- 4 at once (cut, activate, two claims), so the code works for that seat when
-- it runs; its last claim before that was Oct 10. Read only. Counts per day
-- and per league id — no names, no user ids (public log).
\pset pager off
set search_path = public;
\echo '── AI / agent seats: claims filed per day since Oct 1, all leagues'
with ai as (
  select league_id, sleeper_roster_id as roster_id from league_membership where controller = 'ai'
  union select league_id, roster_id from seat_agent)
select date_trunc('day', w.created_at)::date as day, count(*) as claims, count(distinct w.league_id) as leagues
  from waiver_claim w join ai using (league_id, roster_id)
 where w.created_at > '2026-10-01' group by 1 order by 1;
\echo '── AI / agent seats: free-agent adds per day since Oct 1 (league_txn kind add)'
with ai as (
  select league_id, sleeper_roster_id as roster_id from league_membership where controller = 'ai'
  union select league_id, roster_id from seat_agent)
select date_trunc('day', t.at)::date as day, t.kind, count(*) as n, count(distinct t.league_id) as leagues
  from league_txn t join ai using (league_id, roster_id)
 where t.at > '2026-10-01' and t.kind in ('add', 'drop') group by 1, 2 order by 1, 2;
\echo '── each league with AI seats: its last AI claim, draft status, mode'
with ai as (
  select league_id, sleeper_roster_id as roster_id from league_membership where controller = 'ai'
  union select league_id, roster_id from seat_agent)
select l.id as league, l.settings_json ->> 'game_mode' as mode, (select status from draft d where d.league_id = l.id) as draft,
       count(distinct ai.roster_id) as ai_seats,
       (select max(w.created_at) from waiver_claim w join ai a2 on a2.league_id = w.league_id and a2.roster_id = w.roster_id where w.league_id = l.id) as last_ai_claim
  from league l join ai on ai.league_id = l.id
 where not coalesce(l.is_mock, false)
 group by l.id order by last_ai_claim desc nulls last;
