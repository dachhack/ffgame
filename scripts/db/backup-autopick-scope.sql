-- Before v0.735.0 (the blind backup auto-pick) reaches the worker: which
-- drip matchups the resolver still re-scores (status not final), by week, and
-- how many applied_state rows on them hold a manual backup assignment.
-- Read only; counts only, no names, no seats.
\pset pager off
set search_path = public;
\echo '── matchups not final, by week and status'
select m.week, m.status, count(*) as matchups
  from matchup m
 where m.status <> 'final'
 group by 1, 2 order by 1, 2;
\echo '── on those, applied_state rows with a manual backup assignment'
select m.week, count(*) as rows_with_backups
  from matchup m join applied_state a on a.matchup_id = m.id
 where m.status <> 'final'
   and jsonb_typeof(a.payload_json -> 'targeted' -> 'backups') = 'object'
   and a.payload_json -> 'targeted' -> 'backups' <> '{}'::jsonb
 group by 1 order by 1;
