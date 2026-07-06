-- 0057: per-game play-by-play feeds for the field visuals (FieldView/FieldBoard).
-- One row per NFL game per week, written by the worker's plays poller from the
-- SAME ESPN summary it already fetches (adapter gameToFeed) — and by the feed
-- simulator (game_id 'SIM:<key>') for dress rehearsals. The plays column is the
-- GamePlay[] contract (src/data/gameFeed.ts): every scrimmage play with down,
-- distance, start/end yards-to-endzone, possession, text and score. Each poll
-- carries the game's full current play set, so upsert-by-game replaces the doc
-- wholesale — ESPN mid-game revisions reconcile for free, no row-level diffing.
create table game_feed (
  week        int  not null,
  game_id     text not null,               -- ESPN event id ('SIM:<key>' for the simulator)
  key         text not null,               -- "AWAY@HOME" (nflverse abbrs)
  away        text not null,
  home        text not null,
  plays       jsonb not null default '[]'::jsonb,  -- GamePlay[]
  updated_at  timestamptz not null default now(),
  primary key (week, game_id)
);
create index on game_feed(week);

-- Public NFL info, same posture as live_play: any authed user can read; only the
-- service-role worker writes (bypasses RLS).
alter table game_feed enable row level security;
create policy game_feed_read on game_feed for select using (auth.role() = 'authenticated');
