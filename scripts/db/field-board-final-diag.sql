-- Field-board FINAL diagnosis: what `state` does each game_feed row actually
-- carry, and how does it compare to what the plays themselves say?
--
-- Context (v0.342.0): the ALL GAMES board sinks a game and banners it FINAL
-- only when the feed's state is the ESPN 'post'. The founder's board showed
-- finished preseason games still on top with no banner — so either the client
-- had a stale bundle, or these rows never flipped to 'post' (e.g. the worker
-- stopped polling a game before ESPN's state caught up). This prints the truth.
select
  week,
  key,
  state,
  jsonb_array_length(plays)                                as n_plays,
  (plays -> -1 ->> 'c')::int                               as last_c,
  to_char(updated_at, 'MM-DD HH24:MI:SS')                  as updated_utc,
  now() - updated_at                                       as staleness
from game_feed
where updated_at > now() - interval '3 days'
order by week, updated_at desc;
