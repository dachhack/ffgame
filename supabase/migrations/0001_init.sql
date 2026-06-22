-- Drip League FF — 2026 near-live H2H pilot: initial schema.
--
-- Decisions baked in (docs/pilot-2026-plan.md):
--   • Supabase (Postgres + Auth + Realtime + RLS) is the backend of record.
--   • Auth = email magic-link; each app_user links a Sleeper user-id.
--   • Anti-cheat = server-held sealed picks, RLS-gated until kickoff, PLUS an
--     append-only audit log of every pick / lock / reveal.
--   • Matchups MIRROR the Sleeper league schedule; an opponent who isn't enrolled
--     falls back to their real Sleeper starting lineup.
--
-- The Node worker (server/) connects with the SERVICE ROLE key and bypasses RLS
-- for ingestion, locking, reveal, and resolution. Browser clients connect with
-- the user's JWT and are constrained entirely by the policies below — in
-- particular a sealed pick is UNREADABLE by the opponent until the server locks
-- the window. That property is the whole point; treat changes to the sealed_pick
-- policies as security-critical.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity
-- ─────────────────────────────────────────────────────────────────────────────
create table app_user (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  sleeper_user_id  text unique,          -- linked Sleeper account (null until linked)
  sleeper_username text,
  display_name     text,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Imported Sleeper leagues + per-manager enrollment
-- ─────────────────────────────────────────────────────────────────────────────
create table league (
  id                 uuid primary key default gen_random_uuid(),
  sleeper_league_id  text not null,
  season             text not null,
  name               text,
  settings_json      jsonb,
  synced_at          timestamptz,
  created_at         timestamptz not null default now(),
  unique (sleeper_league_id, season)
);

create table league_membership (
  id                 uuid primary key default gen_random_uuid(),
  league_id          uuid not null references league(id) on delete cascade,
  sleeper_roster_id  int  not null,
  sleeper_owner_id   text,
  app_user_id        uuid references app_user(id) on delete set null, -- NULL ⇒ unenrolled opponent
  enrolled           boolean not null default false,
  team_name          text,
  unique (league_id, sleeper_roster_id)
);
create index on league_membership(league_id);
create index on league_membership(app_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Weekly H2H matchups mirrored from the Sleeper schedule
-- ─────────────────────────────────────────────────────────────────────────────
create type matchup_status as enum ('scheduled', 'locked', 'live', 'final');

create table matchup (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references league(id) on delete cascade,
  week                int  not null,
  sleeper_matchup_id  int,
  home_roster_id      int  not null,
  away_roster_id      int  not null,
  status              matchup_status not null default 'scheduled',
  lock_at             timestamptz,        -- first kickoff of the week (server locks at/after)
  home_final          numeric,
  away_final          numeric,
  created_at          timestamptz not null default now(),
  unique (league_id, week, home_roster_id, away_roster_id)
);
create index on matchup(league_id, week);

-- The real Sleeper starting lineups per week: the player pool AND the
-- unenrolled-opponent fallback (we resolve their actual starters to player slugs).
create table sleeper_lineup (
  league_id     uuid not null references league(id) on delete cascade,
  week          int  not null,
  roster_id     int  not null,
  starters_json jsonb not null,           -- [{slot, player_slug, sleeper_id}, ...]
  primary key (league_id, week, roster_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sealed picks (the load-bearing secret) + server-mirrored applied state
-- ─────────────────────────────────────────────────────────────────────────────
create table sealed_pick (
  id           uuid primary key default gen_random_uuid(),
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  window       text not null,             -- TNF | SUN1 | SUN4 | SNF | MNF
  roster_slot  text not null,
  player_slug  text,
  metric_id    text,
  locked       boolean not null default false,  -- server flips at lock_at; never the client
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  revealed_at  timestamptz,
  unique (matchup_id, app_user_id, window, roster_slot)
);
create index on sealed_pick(matchup_id);

-- Server mirror of the client `applied[week]` (powerups/swaps/buffs/etc.).
create table applied_state (
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  week         int  not null,
  payload_json jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (matchup_id, app_user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Live data: normalized RealPlay rows from the ESPN poller + engine output
-- ─────────────────────────────────────────────────────────────────────────────
create table live_play (
  id          bigint generated always as identity primary key,
  week        int  not null,
  game_id     text not null,
  player_slug text not null,
  c           int  not null,              -- game-elapsed seconds
  t           int,                        -- real seconds since first snap
  pid         int,                        -- nflverse/ESPN play id
  k           text not null,              -- RealPlayKind
  y           int  not null default 0,
  td          int  not null default 0,
  ca          int  not null default 0,
  tg          int  not null default 0,
  "to"        int,
  ingested_at timestamptz not null default now(),
  unique (week, game_id, pid, player_slug, k)
);
create index on live_play(week, player_slug);

create table matchup_state (
  matchup_id  uuid not null references matchup(id) on delete cascade,
  window      text not null,
  home_score  numeric not null default 0,
  away_score  numeric not null default 0,
  events_json jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (matchup_id, window)
);

-- Live injury report (ESPN /nfl/injuries, daily→hourly), per player slug. Public
-- NFL info, surfaced to managers setting lineups; written by the worker.
create table injury_status (
  player_slug      text primary key,
  status           text not null,            -- O | D | Q | IR
  designation_date timestamptz,              -- ESPN per-entry date (freshness/trend)
  return_date      date,
  comment          text,
  team             text,
  source           text not null default 'espn',
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only audit log (pick / lock / reveal and friends)
-- ─────────────────────────────────────────────────────────────────────────────
create table audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  op         text not null,               -- INSERT | UPDATE | DELETE
  row_id     text,
  actor      uuid,                         -- auth.uid() of the writer (null = service role)
  old_row    jsonb,
  new_row    jsonb,
  at         timestamptz not null default now()
);

create or replace function audit_row() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(table_name, op, row_id, actor, old_row, new_row)
  values (
    tg_table_name, tg_op,
    coalesce(new.id::text, old.id::text),
    auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_sealed_pick   after insert or update or delete on sealed_pick
  for each row execute function audit_row();
create trigger audit_matchup       after update on matchup
  for each row execute function audit_row();
create trigger audit_applied_state after insert or update or delete on applied_state
  for each row execute function audit_row();

-- keep updated_at fresh on sealed_pick
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger touch_sealed_pick before update on sealed_pick
  for each row execute function touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table app_user          enable row level security;
alter table league            enable row level security;
alter table league_membership enable row level security;
alter table matchup           enable row level security;
alter table sleeper_lineup    enable row level security;
alter table sealed_pick       enable row level security;
alter table applied_state     enable row level security;
alter table live_play         enable row level security;
alter table matchup_state     enable row level security;
alter table injury_status     enable row level security;
alter table audit_log         enable row level security;
-- NOTE: the service role bypasses RLS entirely, so the worker can ingest, lock,
-- reveal, and resolve without any policy below granting it access.

-- Is auth.uid() one of the two participants in a matchup?
create or replace function is_matchup_participant(m_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from matchup m
    join league_membership lm on lm.league_id = m.league_id
    where m.id = m_id
      and lm.app_user_id = auth.uid()
      and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  );
$$;

-- Is auth.uid() a member of a league?
create or replace function is_league_member(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_membership lm
    where lm.league_id = l_id and lm.app_user_id = auth.uid()
  );
$$;

-- app_user: a user sees/edits only their own row.
create policy app_user_self on app_user
  for all using (id = auth.uid()) with check (id = auth.uid());

-- league / membership / lineup / matchup / state: visible to league members /
-- matchup participants. Writes are the worker's job (service role) — no client
-- INSERT/UPDATE policies, so clients are read-only here.
create policy league_read       on league            for select using (is_league_member(id));
create policy membership_read    on league_membership for select using (is_league_member(league_id));
create policy lineup_read        on sleeper_lineup    for select using (is_league_member(league_id));
create policy matchup_read       on matchup           for select using (is_league_member(league_id));
create policy matchup_state_read on matchup_state     for select using (is_matchup_participant(matchup_id));

-- live_play + injury_status: public NFL data, readable by any authenticated
-- user; written by the worker (service role).
create policy live_play_read on live_play for select using (auth.role() = 'authenticated');
create policy injury_read on injury_status for select using (auth.role() = 'authenticated');

-- applied_state: a participant reads both sides AFTER the matchup locks; before
-- lock you see only your own. You may write only your own row.
create policy applied_self_write on applied_state
  for all
  using (app_user_id = auth.uid())
  with check (app_user_id = auth.uid());
create policy applied_read_after_lock on applied_state
  for select using (
    app_user_id = auth.uid()
    or exists (select 1 from matchup m
               where m.id = applied_state.matchup_id
                 and m.status <> 'scheduled'
                 and is_matchup_participant(m.id))
  );

-- ── sealed_pick: THE security boundary ──────────────────────────────────────
-- SELECT: your own picks always; the opponent's picks ONLY once locked (and only
-- if you're a participant). The opponent literally cannot read an unlocked pick.
create policy sealed_select on sealed_pick
  for select using (
    app_user_id = auth.uid()
    or (locked and is_matchup_participant(matchup_id))
  );
-- INSERT / UPDATE: only your own rows, only while still unlocked, and the client
-- may never set locked=true (the WITH CHECK forbids it). The server locks via the
-- service role, which bypasses RLS.
create policy sealed_insert on sealed_pick
  for insert with check (app_user_id = auth.uid() and locked = false);
create policy sealed_update on sealed_pick
  for update
  using (app_user_id = auth.uid() and locked = false)
  with check (app_user_id = auth.uid() and locked = false);
create policy sealed_delete on sealed_pick
  for delete using (app_user_id = auth.uid() and locked = false);

-- audit_log: no client access at all (service role / SQL console only).
-- (RLS enabled with zero policies = deny all for non-service connections.)
