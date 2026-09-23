-- DID THE RUN HAPPEN, AND WHAT WEEK IS IT. Read-only. Run via dbquery.yml.
--
-- Founder, Wednesday morning: "Should waivers have run last night and the
-- leagues should be on week 3." Two questions, one clock. Since 0343 a
-- league's board turns over AT its after-games waiver run — Wednesday 3:00am
-- ET unless the league moved it — so "what week is it" and "did waivers run"
-- are answered by the same instant, and this asks for both side by side.
--
-- What each section answers:
--   1. the clock: now, in ET, and the current regular-season week's slate
--   2. per league: its turnover pair, the instant its board turned (or will),
--      and whether that instant has passed — the board's answer to "week 3?"
--   3. per league: what the matchups say (weeks scheduled/final)
--   4. per league: the waiver run — pending claims and their clearing times,
--      claims settled in the last 48h, and the house line the run posts
--   5. players still on waivers — a hold that reaches past the run means the
--      run has not visited yet (or the schedule never clears)

\pset pager off

-- ── 1. the clock and the slate ──────────────────────────────────────────────
select now() as now_utc, now() at time zone 'America/New_York' as now_et,
       extract(dow from now() at time zone 'America/New_York')::int as dow_et;

select season, week, count(*) as games,
       min(kickoff) at time zone 'America/New_York' as first_kick_et,
       max(kickoff) at time zone 'America/New_York' as last_kick_et,
       nfl_week_closes_at(week, season) at time zone 'America/New_York' as default_turnover_et
from nfl_slate
where week between 1 and 5
group by season, week order by season desc, week;

-- ── 2. when each league's board turns over ─────────────────────────────────
with lg as (
  select l.id, l.name, l.kind, l.season, l.provider,
         (select status from draft d where d.league_id = l.id) as draft_status,
         league_week_turnover(l.id) as turn,
         (select max(week) from matchup m where m.league_id = l.id and m.status = 'final') as last_final_week
  from league l
  where l.season = (select max(season) from league) and not l.is_mock
)
select name, kind, provider, draft_status,
       turn ->> 'source' as turn_source, (turn ->> 'dow')::int as dow, (turn ->> 'minute')::int as minute,
       last_final_week,
       nfl_week_closes_at(coalesce(last_final_week, 2), season,
                          (turn ->> 'dow')::int, (turn ->> 'minute')::int)
         at time zone 'America/New_York' as board_turns_et,
       now() >= nfl_week_closes_at(coalesce(last_final_week, 2), season,
                          (turn ->> 'dow')::int, (turn ->> 'minute')::int) as turned
from lg order by name;

-- ── 3. what the matchups say ───────────────────────────────────────────────
select l.name, m.week, m.status, count(*) as games,
       min(m.lock_at) at time zone 'America/New_York' as lock_et
from matchup m join league l on l.id = m.league_id
where l.season = (select max(season) from league) and not l.is_mock
  and m.week between 1 and 4
group by l.name, m.week, m.status order by l.name, m.week, m.status;

-- ── 4. the waiver run ──────────────────────────────────────────────────────
-- Pending claims: a clears_at in the past that is still pending means the
-- sweep has not visited (worker down, or process_waivers erroring).
select l.name, count(*) as pending,
       min(wc.clears_at) at time zone 'America/New_York' as earliest_clear_et,
       max(wc.clears_at) at time zone 'America/New_York' as latest_clear_et,
       count(*) filter (where coalesce(wc.clears_at, now()) <= now()) as overdue
from waiver_claim wc join league l on l.id = wc.league_id
where wc.status = 'pending'
group by l.name order by l.name;

-- Settled in the last 48h, by league and outcome, with the moment they settled.
select l.name, wc.status, count(*) as claims,
       min(wc.processed_at) at time zone 'America/New_York' as first_et,
       max(wc.processed_at) at time zone 'America/New_York' as last_et
from waiver_claim wc join league l on l.id = wc.league_id
where wc.processed_at >= now() - interval '48 hours'
group by l.name, wc.status order by l.name, wc.status;

-- The house line the run posts ("📋 Waivers ran — …"), last 7 days.
select l.name, lm.created_at at time zone 'America/New_York' as posted_et,
       left(lm.body, 160) as body
from league_message lm join league l on l.id = lm.league_id
where lm.kind = 'txn' and lm.txn ->> 'kind' = 'waiver'
  and lm.created_at >= now() - interval '7 days'
order by lm.created_at desc;

-- ── 5. players still held on waivers ───────────────────────────────────────
select l.name, count(*) as on_waivers,
       min(lp.waived_until) at time zone 'America/New_York' as earliest_clear_et,
       max(lp.waived_until) at time zone 'America/New_York' as latest_clear_et
from league_pool lp join league l on l.id = lp.league_id
where lp.waived_until > now()
group by l.name order by l.name;
