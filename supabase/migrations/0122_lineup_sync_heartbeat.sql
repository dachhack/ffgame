-- When did the weekly sync last touch this lineup?
--
-- There was no answer to that anywhere in the schema, and its absence cost real
-- time: asked "is the worker running", the nearest-looking column was
-- league.synced_at, which importLeague() stamps and the weekly sync never
-- touches. Reading it as a heartbeat says a healthy worker is four days dead.
-- The fix is not a better inference — it is the column that was missing.
--
-- A TRIGGER, not a default and not an application write. sleeper_lineup has
-- several writers: server/src/sync.js (the worker and the CLI), the client-side
-- syncWeek in packages/core/data/sleeperAdmin.ts (the web admin's manage card
-- and the app's Commissioner screen), and the fake-league seeds in 0030/0032.
-- A column each of them must remember to set is a column that goes stale the
-- first time one of them forgets — and a stale timestamp presented as a
-- heartbeat is worse than no timestamp at all, because it is believed. A
-- DEFAULT doesn't work either: these are upserts, and a default only applies to
-- the INSERT, so the ON CONFLICT DO UPDATE path would keep the original value
-- forever. The trigger fires for every writer on both paths, with no way to
-- opt out by forgetting.
--
-- Existing rows are left NULL rather than backfilled to now(): they were
-- written before this column existed and we genuinely do not know when. NULL
-- reads as "unknown", which is true; now() would read as "just synced", which
-- is exactly the kind of confident-and-wrong that made this migration
-- necessary. The first sync of each week fills them in.

alter table sleeper_lineup add column if not exists synced_at timestamptz;

comment on column sleeper_lineup.synced_at is
  'Set by trigger on every insert/update — when the weekly sync last wrote this row. NULL = written before 0122. This is the sync heartbeat; league.synced_at is the league IMPORT time and is not.';

create or replace function touch_sleeper_lineup() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.synced_at := now();
  return new;
end $$;

drop trigger if exists sleeper_lineup_touch on sleeper_lineup;
create trigger sleeper_lineup_touch
  before insert or update on sleeper_lineup
  for each row execute function touch_sleeper_lineup();

-- Surface it where the question actually gets asked. The app's Admin → Health
-- tab and the web's readiness card both read admin_health(); a heartbeat nobody
-- can see is how this went unnoticed for a day in the first place.
--
-- Repeated verbatim from 0021 apart from the new key: create or replace
-- replaces the whole body, and it keeps the existing grants.
create or replace function admin_health()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select jsonb_build_object(
    'now', now(),
    'leagues', (select count(*) from league),
    'enrolled', (select count(*) from league_membership where enrolled),
    'matchups_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status::text, count(*) n from matchup group by status) s),
    'live_matchups', (select count(*) from matchup where status = 'live'),
    'live_play_count', (select count(*) from live_play),
    'sim_play_count', (select count(*) from live_play where game_id = 'SIM'),
    'last_play_ingest', (select max(ingested_at) from live_play),
    'last_state_update', (select max(updated_at) from matchup_state),
    'last_lineup_sync', (select max(synced_at) from sleeper_lineup)
  ) into result;
  return result;
end $$;
