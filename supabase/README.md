# Backend (Supabase) — 2026 pilot

Server-of-record for the near-live H2H pilot. See `docs/pilot-2026-plan.md` for
the full plan; this is the operational note.

## Layout
- `supabase/migrations/0001_init.sql` — schema, RLS policies, audit triggers.
- `server/` — the Node worker (ESPN poller + engine resolver + Sleeper sync).
  Connects with the **service role** key (bypasses RLS) for ingest/lock/reveal.

## Apply the migration
This SQL was authored from the data model but **has not been run against a live
Supabase instance from this environment** (no project credentials here). Apply it
in your project and review before trusting:

```bash
# with the Supabase CLI, against your project
supabase db push                 # or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

## The one property that must hold
A `sealed_pick` row is **unreadable by the opponent until the server locks the
window**. Enforced by RLS (`sealed_select` policy): the opponent's JWT only
matches rows where `locked = true`. The client can never set `locked` (the
`with check` on insert/update forbids it); only the worker (service role) flips it
at `lock_at`. If you change `sealed_pick` policies, that is a security change.

Quick check after applying (as a normal user JWT, not service role):
- you can `select` your own unlocked picks ✔
- you get **zero rows** selecting the opponent's picks while `locked = false` ✔
- after the worker sets `locked = true`, both participants can read them ✔

## Auth + anti-cheat (confirmed decisions)
- Email magic-link (Supabase Auth). On first sign-in, the user links a Sleeper
  account: enter username → resolve `sleeper_user_id` → store on `app_user`.
- Light anti-cheat **plus** audit logging: every pick/lock/reveal/applied change
  writes to `audit_log` via triggers (append-only; no client read policy).
- Real-wall-clock gating against a delayed feed is in the engine already
  (`RealPlay.t`), reused server-side.

## Worker (server/) — next slice
- **Sleeper sync:** import league → `league` + `league_membership` (mark
  `enrolled` where a Sleeper owner links to an `app_user`); per week, mirror the
  Sleeper schedule into `matchup` and store `sleeper_lineup` starters.
- **Poller:** every ~20–30s during game windows, ESPN scoreboard → in-progress
  events → `summary` → `gameToRealPlays` (scripts/espn/espnAdapter.mjs) → upsert
  `live_play`.
- **Resolver:** on new plays, for each live matchup, gather both sides'
  `RealPlay[]` from `live_play` + revealed sealed picks (or the Sleeper-lineup
  fallback for an unenrolled opponent) → run the shared `buildMatchup`/
  `resolveSlot` engine → write `matchup_state` → Supabase Realtime pushes to both
  clients.
- **Lock/reveal:** at `lock_at`, set `matchup.status` and `sealed_pick.locked`.

The engine (`src/engine/{sim,matchup}.ts`) is pure/deterministic and will be
extracted into a shared package so the worker and the React client run identical
scoring. Keep the `RealPlay` contract frozen.
