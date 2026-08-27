-- ─────────────────────────────────────────────────────────────────────────────
-- diagnose-finals.sql — is the "week never closes" bug live in production?
--
-- READ ONLY. Every statement is a SELECT; it changes nothing. Paste it into the
-- Supabase SQL editor (or run: psql "$DATABASE_URL" -f scripts/db/diagnose-finals.sql).
--
-- WHAT IT PROVES. A matchup carries TWO different scores:
--   • the board total  — summed live from matchup_state's per-window rows; this
--     is the "37.7 vs 13.1 FINAL" you see on the phone.
--   • home_final/away_final — a separate pair the worker is supposed to stamp
--     ONCE when the week closes. Standings, playoff seeding, guillotine
--     eliminations and coin payout read THESE, not the board total.
-- The bug (fixed on branch, not yet deployed): the worker flips a finished
-- matchup to status='final' but never stamps home_final. So a matchup can read
-- "final" with a real board total while home_final is still NULL — invisible on
-- the matchup screen, fatal to the season machinery.
--
-- THE SMOKING GUN is any row below with verdict = 'UNSTAMPED (bug)': status is
-- final, the board shows a score, home_final is NULL.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Fleet summary: how many finished matchups are unstamped, by week ───────
with board as (
  select matchup_id,
         round(sum(home_score), 1) as board_home,
         round(sum(away_score), 1) as board_away
  from matchup_state group by matchup_id
)
select
  m.week,
  count(*)                                                   as final_matchups,
  count(*) filter (where m.home_final is null)               as home_final_null,
  count(*) filter (where m.home_final is null
                     and coalesce(b.board_home, 0) + coalesce(b.board_away, 0) > 0)
                                                             as unstamped_but_scored,
  count(*) filter (where m.home_final is not null)           as stamped_ok
from matchup m
left join board b on b.matchup_id = m.id
where m.status = 'final'
group by m.week
order by m.week desc;

-- ── 2. Per-matchup detail (most recent finals first) ──────────────────────────
-- Look at `verdict`. 'UNSTAMPED (bug)' with a non-zero board total is the bug in
-- the flesh: the phone shows a final score, the DB field behind it is empty.
with board as (
  select matchup_id,
         round(sum(home_score), 1) as board_home,
         round(sum(away_score), 1) as board_away
  from matchup_state group by matchup_id
)
select
  l.name                       as league,
  l.season,
  m.week,
  m.home_roster_id             as home,
  m.away_roster_id             as away,
  m.status,
  m.home_final,                             -- what the season machinery reads
  m.away_final,
  b.board_home,                             -- what the phone shows
  b.board_away,
  case
    when m.home_final is not null                                    then 'stamped OK'
    when coalesce(b.board_home, 0) + coalesce(b.board_away, 0) > 0   then 'UNSTAMPED (bug)'
    else 'final, no board score yet'
  end                          as verdict
from matchup m
join league l on l.id = m.league_id
left join board b on b.matchup_id = m.id
where m.status = 'final'
order by m.week desc, l.name
limit 100;

-- ── 3. One specific matchup — fill in its id to check just yours ───────────────
-- Uncomment and set the id (from the URL or an admin screen):
--
-- with board as (
--   select matchup_id, round(sum(home_score),1) as board_home, round(sum(away_score),1) as board_away
--   from matchup_state group by matchup_id
-- )
-- select m.status, m.home_final, m.away_final, b.board_home, b.board_away,
--        case when m.home_final is not null then 'stamped OK'
--             when coalesce(b.board_home,0)+coalesce(b.board_away,0) > 0 then 'UNSTAMPED (bug)'
--             else 'final, no board score yet' end as verdict
-- from matchup m left join board b on b.matchup_id = m.id
-- where m.id = 'PASTE-MATCHUP-ID-HERE';
