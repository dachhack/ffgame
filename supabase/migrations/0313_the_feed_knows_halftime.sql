-- 0313: THE GAME FEED KNOWS HALFTIME (v0.434.3).
--
-- Founder, at halftime of IND–KC with the field frozen on "Q2 00:35":
-- "It's halftime for this game. Is half time and other clock stoppage
-- events something we can tell and show on the field and play by play?"
--
-- We could tell and did not keep it. ESPN's summary header carries the
-- game's STATUS — STATUS_HALFTIME, STATUS_END_PERIOD, STATUS_DELAYED, the
-- live period and display clock — and its drives carry the clock-management
-- plays (timeouts, the two-minute warning, End Period, End of Half, End of
-- Game) that the field adapter skips because they have no field situation.
-- 0103 kept one word of the status (pre|in|post) so halftime would not read
-- as FINAL; the rest was dropped at the poller. Two columns keep it:
--   status  — {name, detail, short, period, clock}, the header's status;
--   events  — [{c, ty, txt, tm?}], the stoppage rows in game-clock order.
-- Both nullable/defaulted: the simulator and the baked replays write neither,
-- and every reader falls back to the last play's clock, as before.
alter table game_feed add column if not exists status jsonb;
alter table game_feed add column if not exists events jsonb not null default '[]'::jsonb;
