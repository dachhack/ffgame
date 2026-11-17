-- Week 10 scoring against the play-by-play (founder, on Josh Allen's 16.2 in
-- Weekly Cointest: "Let's reconcile the scoring and play by play to see if we
-- are missing anything"). An outside play-by-play gives Allen about 22.3 under
-- standard scoring: 196 pass yards, 1 pass TD, two 1-yard rush TDs, 1 INT.
-- Read only: the league's scoring catalog, every row the feed holds for him
-- that week, the slot rows the worker published for him, and the week's
-- per-player totals by play kind (NFL players only; no member is named).
\pset pager off
set search_path = public;
\echo '── Weekly Cointest: scoring catalog and ppr'
select settings_json -> 'scoring' as scoring, settings_json ->> 'ppr' as ppr, kind, settings_json ->> 'game_mode' as game_mode
  from league where id = '5551fed6-ba4f-42e7-8326-3fe65c18c6c5';
\echo '── josh-allen, week 10: every feed row'
select c, pid, k, y, td, ca, tg, "to", fd, cp, ic, sk, p6, game_id, ingested_at
  from live_play where week = 10 and player_slug = 'josh-allen' order by c, pid, k;
\echo '── josh-allen, week 10: the slot rows published in that league'
select m.id as matchup, s.game_window, e ->> 'side' as side, e ->> 'slot' as slot, e ->> 'metric' as metric, e ->> 'score' as score, e ->> 'raw' as raw, e ->> 'play' as play
  from matchup m join matchup_state s on s.matchup_id = m.id
  cross join lateral jsonb_array_elements(coalesce(s.slot_scores, '[]'::jsonb)) e
 where m.league_id = '5551fed6-ba4f-42e7-8326-3fe65c18c6c5' and m.week = 10 and e ->> 'slug' = 'josh-allen'
 order by 1, 2, 3;
\echo '── week 10: per-player totals by offensive play kind (csv)'
\pset format csv
select player_slug, k, count(*) as n, sum(y) as y, sum(td) as td, sum(ca) as ca, sum(tg) as tg, sum(coalesce("to", 0)) as turnovers,
       sum(coalesce(cp, 0)) as cp, sum(coalesce(ic, 0)) as ic, sum(coalesce(sk, 0)) as sk
  from live_play
 where week = 10 and k in ('pass', 'rush', 'rec', 'incomplete', 'tp_pass', 'tp_rush', 'tp_rec', 'fum', 'frtd')
 group by 1, 2 order by 1, 2;
