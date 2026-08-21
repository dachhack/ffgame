-- A PICK WITH A PLAYER BUT NO METRIC: how did Montgomery get no metric?
--
-- Founder, looking at a live TNF window: the opponent's David Montgomery card
-- shows "PTS 0.0" and no metric chip at all, while their own Jack Bech card
-- shows "Receiving Yards · 0 rec yd".
--
-- ── WHY THIS IS NOT COSMETIC ───────────────────────────────────────────────
-- `scorePlay` (engine/sim.ts) is a chain of `if (metricId === '…')` with a
-- final `return 0`. A NULL metric matches nothing and falls through, so the
-- pick scores EXACTLY ZERO for the whole window, no matter what the player
-- does. The seat is occupied and dead. Nothing on the board says so.
--
-- ── HOW A PICK LOSES ITS METRIC ────────────────────────────────────────────
-- `sealed_pick.metric_id` is nullable, and three paths null it ON PURPOSE
-- while KEEPING the player, so the manager re-picks:
--   • 0024 — a locked-metric unlock is disarmed; picks depending on it drop
--   • 0026 — a coin refund
--   • 0062 — a combodrip quantity change
-- Each is correct in isolation. What none of them does is make sure the
-- manager comes back before the window LOCKS — and once it locks, the seal is
-- the seal.
-- The auto/AI filler is NOT a suspect: autoLineup always assigns a metric
-- (DEFAULT_AI_METRIC; RB → 'rush'), so an agent seat never writes a null.
-- A human client can, though: savePicks persists whatever the UI hands it.
--
-- Sections 1-2 answer "is this one pick, or a pattern"; 3 dates it; 4 shows
-- whether the seat is locked (unfixable by the manager) or still open.

\echo ''
\echo '── 1. EVERY pick with a player and no metric, most recent first ──'
\echo '   locked = the window has sealed: the manager can no longer fix it.'
select
  l.name                                   as league,
  m.week,
  sp.game_window                           as win,
  sp.roster_slot                           as slot,
  sp.player_slug,
  coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
  sp.locked,
  sp.revealed_at
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league  l on l.id = m.league_id
left join league_membership lm
       on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
where sp.player_slug is not null
  and sp.metric_id is null
  and sp.game_window <> 'classic'          -- classic has no metrics; null is correct there
order by m.week desc, sp.revealed_at desc nulls last, l.name
limit 100;

\echo ''
\echo '── 2. Is it one manager, or everywhere? ──'
\echo '   A single team means a workflow (someone disarmed an unlock and never'
\echo '   went back). Spread across teams means a code path is writing nulls.'
select
  l.name as league,
  coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
  count(*)                                  as metricless,
  count(*) filter (where sp.locked)         as already_locked,
  min(m.week)                               as first_week,
  max(m.week)                               as last_week
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league  l on l.id = m.league_id
left join league_membership lm
       on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic'
group by l.name, coalesce(lm.team_name, left(sp.app_user_id::text, 8))
order by metricless desc;

\echo ''
\echo '── 3. Did that seat ever HAVE a metric? ──'
\echo '   Compares the metricless rows against the same team''s other picks in'
\echo '   the same week. A team whose OTHER slots all carry metrics was set up'
\echo '   properly and lost this one — which points at 0024/0026/0062 rather'
\echo '   than at a manager who never finished.'
with bad as (
  select sp.matchup_id, sp.app_user_id, sp.game_window
  from sealed_pick sp
  where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic'
)
select
  l.name as league, m.week,
  coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
  count(*) filter (where sp.metric_id is not null) as slots_with_metric,
  count(*) filter (where sp.metric_id is null and sp.player_slug is not null) as slots_without,
  case when count(*) filter (where sp.metric_id is not null) > 0
       then 'set up properly, then LOST one — look at 0024/0026/0062'
       else 'never finished setting up' end as reading
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league  l on l.id = m.league_id
left join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
where (sp.matchup_id, sp.app_user_id) in (select matchup_id, app_user_id from bad)
group by l.name, m.week, coalesce(lm.team_name, left(sp.app_user_id::text, 8))
order by m.week desc;

\echo ''
\echo '── 4. Is that seat an AI agent? ──'
\echo '   It should NOT be: autoLineup always assigns a metric, so an agent row'
\echo '   with a null metric means something nulled it AFTER the worker wrote'
\echo '   it — a different bug from a human who never picked.'
select l.name as league,
       coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
       lm.controller,
       count(*) as metricless
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league  l on l.id = m.league_id
left join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic'
group by l.name, coalesce(lm.team_name, left(sp.app_user_id::text, 8)), lm.controller
order by metricless desc;
