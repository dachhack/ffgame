-- 0506: WHAT CHANGED ON THE INJURY REPORT (v0.726.0).
--
-- Founder: "Can we add to the notification suite player status changes for
-- anyone on your roster?" injury_status (0001) holds only the CURRENT
-- designation, and the poller rewrites every row on every pass (updated_at is
-- the poll's clock, not the change's), so nothing could say "he went from Q
-- to OUT" or "he was cleared". The poller now diffs the table it is about to
-- write against what was there and logs each real change here: a new or
-- different designation, or a player no source designates any more
-- (to_status null = cleared). The worker's push sweep reads the last few
-- minutes of it; rows older than two weeks are trimmed by the poller.
--
-- Worker-only: RLS on and no policy, so only the service role reads or writes.
create table if not exists injury_change (
  id          bigserial primary key,
  player_slug text not null,
  from_status text,
  to_status   text,
  at          timestamptz not null default now()
);
create index if not exists injury_change_at on injury_change(at);
alter table injury_change enable row level security;
