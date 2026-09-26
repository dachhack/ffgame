-- 0363 · @COMPUTER ASKS (v0.537.0)
--
-- One row per chat line the worker has filed as a GitHub issue (server/src/
-- computer.js). The row is claimed before the issue is opened and removed if
-- GitHub refuses, so each "@computer" line becomes exactly one issue however
-- the sweeps overlap. `issue` is filled in once GitHub answers.
create table if not exists computer_ask (
  source      text not null check (source in ('league', 'dm')),
  message_id  bigint not null,
  issue       int,
  created_at  timestamptz not null default now(),
  primary key (source, message_id)
);
alter table computer_ask enable row level security;   -- no policies: worker-only
