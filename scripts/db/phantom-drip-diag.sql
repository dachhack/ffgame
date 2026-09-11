-- A drip that banks with no catches (Thursday opener, Week 1 2026): Parkinson's
-- TNF card read 6.9 over "0 rec yd" at Q1 12:19, SF 0 – LA 0. A TE drip only
-- ever scores by RATE (yds × 0.0065 pts/min accrued over his team's offensive
-- minutes), so 6.9 that early needs plays the worker can see and the board's
-- clock can't — leftover rows for his slug (a prior season's real feed, a
-- simulator run the purge missed), a feed row missing for the game (drips then
-- accrue over the whole game instead of known possession), or a slot row that
-- isn't his at all. Read-only. Run via dbquery.yml.

-- 1) What week 1 holds, by game: real ESPN ids only, or something else too?
select game_id, count(*) as rows, count(distinct player_slug) as players,
       min(c) as min_c, max(c) as max_c, min(ingested_at) as first_seen, max(ingested_at) as last_seen
from live_play
where week = 1
group by game_id
order by game_id;

-- 2) Every play row the worker can attribute to Parkinson, any week.
select week, game_id, pid, c, t, k, y, td, ca, tg, ingested_at
from live_play
where player_slug = 'colby-parkinson'
order by week, game_id, c;

-- 3) Any slug that could be him under another spelling.
select week, game_id, player_slug, count(*) as rows, sum(y) as yards
from live_play
where player_slug like '%parkinson%'
group by week, game_id, player_slug
order by week, game_id, player_slug;

-- 4) The feed rows the drip's possession gating reads. No SF@LA row while its
--    plays exist in (1) = drips accrue over the full game, ungated.
select game_id, key, away, home, state, jsonb_array_length(coalesce(plays, '[]'::jsonb)) as plays, updated_at
from game_feed
where week = 1
order by game_id;

-- 5) The worker's published TNF slot rows for every week-1 matchup: which slug
--    and metric sit on each slot, and what it scored.
select l.name as league, ms.matchup_id, ms.home_score, ms.away_score,
       s.value->>'side' as side, s.value->>'slot' as slot, s.value->>'slug' as slug,
       s.value->>'metric' as metric, s.value->>'score' as score, ms.updated_at
from matchup_state ms
join matchup m on m.id = ms.matchup_id
join league l on l.id = m.league_id
cross join lateral jsonb_array_elements(coalesce(ms.slot_scores, '[]'::jsonb)) s
where m.week = 1 and ms.game_window = 'tnf'
order by l.name, ms.matchup_id, side, slot;

-- 6) The sealed TNF picks those rows were scored from — does the stored slug
--    match the card the board draws?
select l.name as league, sp.matchup_id, sp.app_user_id, sp.roster_slot, sp.player_slug, sp.metric_id, sp.locked, sp.updated_at
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league l on l.id = m.league_id
where m.week = 1 and sp.game_window = 'tnf'
order by l.name, sp.matchup_id, sp.app_user_id, sp.roster_slot;
