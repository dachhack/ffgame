# Pilot worker (`server/`)

Node worker for the 2026 near-live H2H pilot: Sleeper sync + ESPN pollers +
server-authoritative resolution. Connects to Supabase with the **service-role
key** (bypasses RLS — it ingests, locks, reveals, and resolves). Reuses the
validated ESPN adapters in `scripts/espn/` (`espnAdapter.mjs`, `injuries.mjs`).

See `docs/pilot-2026-plan.md` (plan) and `supabase/` (schema/RLS).

## Run
```bash
cd server
cp .env.example .env        # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm start                   # the scheduler (src/index.js)
```

Manual ops (CLI):
```bash
node src/cli.js sync <sleeperLeagueId>        # import league + memberships/enrollment
node src/cli.js sync-week <leagueId> <week>   # mirror that week's schedule + lineups
node src/cli.js poll-once                     # one plays pass for the current week
node src/cli.js inj-once                      # one injury poll
```

## Layout
| File | Role |
|---|---|
| `src/index.js` | scheduler: sync → lock → poll → resolve, on three cadences |
| `src/config.js` / `src/supabase.js` | env + lazy service-role client |
| `src/sleeper.js` / `src/playerIndex.js` | Sleeper API + shared slug index (espn_id bridge) |
| `src/sync.js` | import league, mirror schedule, store lineups, mark enrollment |
| `src/poll/scoreboard.js` | game-state + kickoff/lock detection |
| `src/poll/plays.js` | ESPN summary → `gameToRealPlays` → `live_play` |
| `src/poll/injuries.js` | ESPN injuries → `normalizeInjuries` → `injury_status` |
| `src/lock.js` | flip matchup `status` + seal picks at `lock_at` |
| `src/resolve.js` | gather picks/lineups + plays → `matchup_state` |

## Cadences
- **injuries** — daily; **hourly** within ~24h of a game window (pre-lock support).
- **scoreboard** — every tick (lock detection + which games to poll).
- **plays** — `PLAYS_POLL_MS` (~25s) during live windows → resolve live matchups.

## Real engine resolution
The worker resolves the **actual Drip game** — not placeholder points — by running
the SAME TypeScript engine the client runs (`src/engine/sim.ts`), via `tsx`
(`server/src/engine.js`). One source of truth, no compiled copy to drift.

- Live `live_play` rows are injected through `realPbp.ts:setSyntheticWeeks()` (the
  same hook the client uses for live Sleeper leagues), so `resolveSlot` reads them
  transparently via `realPbpFor(week, slug)`.
- When **both** managers are enrolled, `resolve.js` pairs their sealed picks by
  `(game_window, roster_slot)` and resolves each with full metric effects
  (nuke/erase/streak/drip). When an opponent isn't enrolled, it falls back to base
  fantasy points off their real Sleeper starters (`baseScore`).
- Proof it runs in Node: `npm run smoke` (`test/engine-smoke.mjs`) injects a baked
  2025 week and resolves real matchups — e.g. a rushing-TD NUKE wiping the
  opponent's bank to 0, exactly as the client engine does.

**Shared resolver:** the live H2H path runs `src/engine/liveResolve.ts` — the
same resolver the in-browser admin force-resolve uses — so the worker and the
founder's preview score identically. It layers cross-window Field General +
best-ball backups on top of per-slot `resolveSlot`, and computes the drip-coin
economy per side (returned, not yet persisted — no DB column). Still simplified
vs the demo's `buildMatchup`: DEF suppress halving, cross-window TE-TD nukes, and
the K banker bonus. The `RealPlay` contract stays frozen.

> Runs under `tsx` so the `.ts` engine imports resolve in Node — see the
> `start` / `cli` / `smoke` scripts.

## What's wired vs. untested
**Wired + smoke-tested (no DB needed):** the engine bridge, player index +
`espn_id` bridge, scoreboard normalize, and the ESPN adapters. **Untested only for
lack of network to Supabase from this sandbox:** the DB reads/writes (sync, poll
upserts, lock, resolve persistence) — they run on a normal network / at deploy.

## Slug resolution
Plays/picks/lineups/injuries all key on one slug = `slugOf(full_name)`. Play text
(names only) resolves via the directory name index; the boxscore/injury feeds can
use the **`espn_id` bridge** (`playerIndex.slugForEspnId`) to remove nickname
drift and — once boxscore ids are threaded through `buildRoster` — initials
collisions (the Etienne brothers).

> Deploy target (recommended Fly.io) is open — see `docs/pilot-2026-plan.md` §2.
> The static Pages site is unaffected; this worker deploys separately.
