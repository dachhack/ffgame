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

## What's wired vs. stubbed
**Wired:** Sleeper sync, all three pollers, lock/reveal, resolution data-flow,
Realtime-ready writes. The live (non-DB) paths are smoke-tested against real
Sleeper/ESPN data (player index + `espn_id` bridge + scoreboard).

**The one seam — scoring.** `resolve.js:baseScore` computes base fantasy points
(PPR + K + DST). The actual game — hidden metrics and their effects
(nuke/erase/streak/…) + the drip economy — lives in `src/engine/{sim,matchup}.ts`.
Next step: extract that engine into a package both the React client and this
worker import, then swap `baseScore` for `buildMatchup()` so authoritative
resolution equals the client's optimistic display. The `RealPlay` contract is
already shared, so this is a packaging task, not a rewrite.

## Slug resolution
Plays/picks/lineups/injuries all key on one slug = `slugOf(full_name)`. Play text
(names only) resolves via the directory name index; the boxscore/injury feeds can
use the **`espn_id` bridge** (`playerIndex.slugForEspnId`) to remove nickname
drift and — once boxscore ids are threaded through `buildRoster` — initials
collisions (the Etienne brothers).

> Deploy target (recommended Fly.io) is open — see `docs/pilot-2026-plan.md` §2.
> The static Pages site is unaffected; this worker deploys separately.
