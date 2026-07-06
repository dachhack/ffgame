# Sunday ops runbook — 2026 pilot

_How to run a game week for the closed pilot: the weekly cadence, what to watch,
and how to intervene. Pairs with `docs/phase-0-checklist.md`, `server/DEPLOY.md`
(worker), and `server/README.md` (CLI). The worker is **`drip-pilot-worker`** on
Fly (`iad`); the admin console is the live site → **Admin** (allowlisted email)._

## The one signal that matters
The admin **Health** panel (`admin_health()` — already in `AdminPage.tsx`) is the
on-call dashboard. During a game window, the two freshness timestamps are the
heartbeat:

- **`last_play_ingest`** — newest `live_play` row. Should advance every poll
  (~25 s) while games are live. Stale > ~2 min during a window ⇒ the **ESPN poll**
  is stuck.
- **`last_state_update`** — newest `matchup_state`. Should advance every tick.
  Stale while `last_play_ingest` moves ⇒ the **resolver** is stuck.

Also on the panel: `matchups_by_status`, `live_matchups`, `live_play_count` vs
`sim_play_count` (a non-zero sim count outside a rehearsal means leftover SIM
feed — clear it). If both timestamps are fresh, the pipeline is healthy.

> **Known gap (not yet built):** there is no *push* alert — you have to look. The
> cheap fix when wanted: a dead-man's-switch that polls `admin_health()` and pages
> if `last_state_update` goes stale during a live window. Tracked in
> `docs/scale-2026-2027-plan.md`. For the pilot, watch the panel + `fly logs`
> during games.

## Weekly cadence

### Tue–Sat · prep the week
Mirror each league's schedule + lineups for the upcoming week. Either:
- **GitHub Action** → *Sync pilot league* → `mode: both` (runs `sync` +
  `sync-week`), one league at a time; **or**
- **Worker CLI**: `fly ssh console -C "sh -lc 'cd /app/server && npx tsx src/cli.js sync-week-all <week>'"`
  (mirrors every `PILOT_LEAGUE_IDS` league); **or**
- **Admin console** → import league / sync week.

Cap: **≤ ~100 enrolled leagues** (the pilot's access gate — see checklist 2c).

### ~24 h before kickoff · injuries + stragglers
- Injuries auto-ramp to hourly (worker `injuryPollGamedayMs`); no action needed.
- Chase un-set lineups: admin console **Pick readiness** (`admin_pick_readiness`)
  lists who hasn't sealed a lineup per league/week. Ping them before lock.

### Kickoff · lock (automatic, PER WINDOW since v0.95.0)
Two stages now:
- At `lock_at` (first kickoff of the week) the worker flips the matchup live and
  seals only the windows already underway — `fly logs`: `locked N matchups`.
  Pre-match power-ups stop arming here.
- Each later window's picks seal (and reveal to the opponent) at that window's
  OWN first kickoff — `fly logs`: `sealed N window picks` as SUN 1PM / 4PM /
  SNF / MNF go off. Until then those picks stay editable ("late swap").
Confirm through Sunday that the `sealed …` lines fire at each window boundary;
a silent gap means the tick's slate had no kickoffs (the sweep is slate-driven —
check `nfl_slate` for the week). The DB trigger (`enforce_window_lock`, 0058)
independently blocks client writes into a kicked-off window, so a late sweep is
a display/reveal lag, never an integrity hole.

### During games · monitor
- Watch the **Health** panel timestamps (above) and `fly logs --app drip-pilot-worker`
  (`polled N games, M play rows` → `resolved X / Y matchups` each tick).
- Players watch their live boards (Realtime push); nothing to do if healthy.

### After the slate · finalize (automatic)
Worker finalizes when every game is `completed`: `finalized N matchups`, writes
finals + banks drip-coin. Spot-check a few finals in the admin/commish board.

## Incident playbook

| Symptom | Check | Fix |
|---|---|---|
| **Worker down / no ticks** | `fly status --app drip-pilot-worker`; `fly logs` | `fly machine restart <id>`; if a bad deploy, `fly deploy` a known-good commit |
| **`last_play_ingest` stale during games** | `fly logs` for ESPN poll errors; is the slate live on ESPN? | one-off `fly ssh … npx tsx src/cli.js poll-once`; if ESPN feed is flaky, wait + watch (the reconcile is idempotent) |
| **`last_state_update` stale, ingest fresh** | `fly logs` for `resolve` errors | restart worker; if a specific matchup errors, fix its lineup/data then it self-heals next tick |
| **Wrong score on a matchup** | admin board vs box score | corrections self-reconcile by key; if a lineup is wrong, **override** (`admin_set_picks` / clear) or **force-resolve** from the admin console |
| **Stuck lock / late kickoff change** | matchup `status` + `lock_at` | admin console matchup lifecycle (re-open / re-lock); `admin_set_picks` lands locked+revealed for a rescue |
| **Leftover SIM feed** (`sim_play_count` > 0) | Health panel | *Simulate live feed* → `mode: reset` for that league/week |
| **Feed attribution looks off** | — | `npm run validate <week>` (ESPN→baked diff, the CI gate) to confirm the adapter |

## Quick reference

**Fly (worker):**
```
fly logs   --app drip-pilot-worker          # live tick stream (Ctrl-C to stop)
fly status --app drip-pilot-worker          # machine state
fly deploy --app drip-pilot-worker          # rebuild + roll (from repo root)
fly machine restart <id> --app drip-pilot-worker
fly ssh console -C "sh -lc 'cd /app/server && npx tsx src/cli.js <cmd>'"
```
Worker CLI `<cmd>`: `sync <lg>` · `sync-week <lg> <wk>` · `sync-week-all <wk>` ·
`poll-once` · `inj-once` · `simulate …` · `clone-week <lg> <from> <to>`.

**GitHub Actions:** *Sync pilot league* (`both|league|week`) · *Simulate live feed*
(`dry|check|live|reset`) · *migrate* (auto-applies new `supabase/migrations/*.sql`).

**Admin console** (live site → Admin): health · pick readiness · import/sync ·
matchup lifecycle · **force-resolve** · coin edit · pick override · audit.
**Commish dashboard:** per-league codes / members / sync / matchup lifecycle / coin.

## Dress rehearsal (offseason / pre-week confidence)
Before a real slate, prove the whole live path on a test league with baked data:
*Simulate live feed* → `mode: check` (DB reachable), then `mode: live` against a
test league/week (drips a baked week through the real resolver onto the live
board), then `mode: reset`. See `server/README.md`. The **August preseason
live-fire** is the first run against a *real* ESPN feed (`PILOT_SEASON_TYPE=1`).

**Per-window locks need their own rehearsal** — the simulator bulk-locks by
design (it rehearses a week already fully live), so it never exercises the
staged path. Once before the season: on a test league with a future-dated
`nfl_slate` week, let the worker tick across a window boundary and confirm
(1) `sealed N window picks` fires at the boundary, (2) a pick in a not-yet-
started window still saves from LivePicks after the week is live, (3) a write
into the started window is rejected (the 0058 trigger), and (4) the opponent's
picks for the later window stay hidden until it kicks off.
