-- 0139: ★ favorite players — personal bookmarks, account-scoped (to-do list:
-- "Allow users to Star or favorite players for personal reference").
--
-- Server-backed rather than localStorage so a star set on the phone is lit on
-- the desktop; plain RLS table ops, no RPC — the row IS the feature (the
-- hero_applied pattern, minus the status gate: stars have no lock semantics).
-- Slugs are the shared player key; nothing validates them against a roster
-- because a favorite is personal reference, not gameplay state.
create table if not exists favorite_player (
  app_user_id uuid not null references app_user(id) on delete cascade,
  player_slug text not null,
  created_at  timestamptz not null default now(),
  primary key (app_user_id, player_slug)
);
alter table favorite_player enable row level security;
create policy favorite_rw on favorite_player for all
  using (app_user_id = auth.uid())
  with check (app_user_id = auth.uid());
grant select, insert, delete on favorite_player to authenticated;
