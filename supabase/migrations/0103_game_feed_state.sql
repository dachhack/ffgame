-- Real game state on the game feed: 'pre' | 'in' | 'post' from ESPN's
-- scoreboard, written by the worker's plays poller. The first preseason
-- live-fire showed the client inferring FINAL from "no next play yet" — true
-- for baked replays (the full game is always present) but wrong the moment a
-- live feed pauses (halftime read as FINAL). The explicit state ends the
-- guessing; clients fall back to a late-Q4 heuristic for rows/bakes without it.
alter table game_feed add column if not exists state text;
