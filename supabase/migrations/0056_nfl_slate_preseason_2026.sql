-- 0055: preload the real 2026 NFL preseason schedule (from the ESPN scoreboard,
-- seasontype=1) into nfl_slate at the preseason OFFSET weeks 101-103 (ESPN
-- preseason weeks 1-3 + 100), matching the worker's offset. Lets a preseason-mode
-- league's board render its real windows/kickoffs before the worker's first sync;
-- the worker re-upserts the same rows live. Week 101 is the Hall of Fame game.
-- Team codes are normalized to ours (WSH->WAS, LAR->LA) to match slateFromGames.
-- Idempotent.
delete from nfl_slate where season = '2026' and week in (101, 102, 103);
insert into nfl_slate (season, week, home, away, win, kickoff) values
  ('2026', 101, 'ARI', 'CAR', 'tnf', '2026-08-07T00:00Z'),
  ('2026', 102, 'CIN', 'DET', 'tnf', '2026-08-13T23:00Z'),
  ('2026', 102, 'PIT', 'GB', 'tnf', '2026-08-13T23:00Z'),
  ('2026', 102, 'NE', 'IND', 'tnf', '2026-08-13T23:30Z'),
  ('2026', 102, 'LV', 'ARI', 'tnf', '2026-08-14T00:00Z'),
  ('2026', 102, 'HOU', 'LAC', 'tnf', '2026-08-14T00:00Z'),
  ('2026', 102, 'SF', 'TEN', 'tnf', '2026-08-14T01:00Z'),
  ('2026', 102, 'ATL', 'DEN', 'tnf', '2026-08-14T23:00Z'),
  ('2026', 102, 'NYJ', 'TB', 'tnf', '2026-08-14T23:00Z'),
  ('2026', 102, 'WAS', 'MIA', 'tnf', '2026-08-14T23:00Z'),
  ('2026', 102, 'BUF', 'CAR', 'tnf', '2026-08-15T17:00Z'),
  ('2026', 102, 'CHI', 'CLE', 'tnf', '2026-08-15T17:00Z'),
  ('2026', 102, 'NYG', 'MIN', 'tnf', '2026-08-15T17:00Z'),
  ('2026', 102, 'KC', 'LA', 'tnf', '2026-08-15T20:00Z'),
  ('2026', 102, 'NO', 'JAX', 'tnf', '2026-08-15T20:00Z'),
  ('2026', 102, 'BAL', 'PHI', 'tnf', '2026-08-15T23:00Z'),
  ('2026', 102, 'SEA', 'DAL', 'tnf', '2026-08-16T00:00Z'),
  ('2026', 103, 'HOU', 'LV', 'tnf', '2026-08-21T00:00Z'),
  ('2026', 103, 'LAC', 'SF', 'tnf', '2026-08-21T02:00Z'),
  ('2026', 103, 'PIT', 'NYJ', 'tnf', '2026-08-21T23:00Z'),
  ('2026', 103, 'JAX', 'CAR', 'tnf', '2026-08-21T23:30Z'),
  ('2026', 103, 'DEN', 'GB', 'tnf', '2026-08-22T01:00Z'),
  ('2026', 103, 'DET', 'WAS', 'tnf', '2026-08-22T16:00Z'),
  ('2026', 103, 'CLE', 'BUF', 'tnf', '2026-08-22T17:00Z'),
  ('2026', 103, 'IND', 'ATL', 'tnf', '2026-08-22T17:00Z'),
  ('2026', 103, 'MIN', 'BAL', 'tnf', '2026-08-22T17:00Z'),
  ('2026', 103, 'LA', 'NO', 'tnf', '2026-08-22T20:00Z'),
  ('2026', 103, 'MIA', 'NYG', 'tnf', '2026-08-22T20:00Z'),
  ('2026', 103, 'CIN', 'CHI', 'tnf', '2026-08-22T23:00Z'),
  ('2026', 103, 'NE', 'PHI', 'tnf', '2026-08-22T23:00Z'),
  ('2026', 103, 'TB', 'KC', 'tnf', '2026-08-22T23:30Z'),
  ('2026', 103, 'ARI', 'DAL', 'tnf', '2026-08-23T02:00Z'),
  ('2026', 103, 'TEN', 'SEA', 'snf', '2026-08-24T00:00Z')
on conflict (season, week, home) do update set away = excluded.away, win = excluded.win, kickoff = excluded.kickoff;
