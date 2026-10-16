-- Ops 061's full sweep ran clean and moved nothing: no league threw. The
-- sweep loads its leagues with ONE PostgREST read, `.in('id', leagueIds)`,
-- whose URL carries every league id that has an AI or agent seat, and it
-- never looked at that read's error. Past roughly 8 KB of URL the read fails,
-- `lgs` is null and the sweep walks nothing. How many ids is that, and when
-- did the count cross the line? Read only; counts and dates only.
\pset pager off
set search_path = public;
\echo '── 1. leagues the sweep loads (an AI seat or an agent row), and the URL that makes'
with ids as (
  select league_id from league_membership where controller = 'ai'
  union select league_id from seat_agent)
select count(*) as leagues,
       count(*) * 37 + 120 as approx_in_url_bytes,   -- 36-char uuid + comma, plus the path
       (select count(*) from league_membership where controller = 'ai') as ai_seats,
       (select count(*) from seat_agent) as agent_rows
  from ids;
\echo '── 2. that count by the day each league was created (cumulative), Sep 25 on'
with ids as (
  select league_id from league_membership where controller = 'ai'
  union select league_id from seat_agent),
d as (select l.created_at::date as day, count(*) as n from league l join ids on ids.league_id = l.id group by 1)
select day, n, sum(n) over (order by day) as cumulative, sum(n) over (order by day) * 37 + 120 as approx_url_bytes
  from d order by day desc limit 25;
