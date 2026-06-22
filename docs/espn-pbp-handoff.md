# ESPN Play-by-Play Integration — Build Handoff

> **Audience:** a fresh session starting the ESPN data integration. Read
> `docs/handoff.md` (project state) and the root `HANDOFF.md` (data pipeline)
> first. This doc is the plan for sourcing play-by-play from **ESPN** so we can
> **pilot the 2026 season with a few users**, then **launch 2027 on paid feeds**
> (SportsRadar/Genius) if it goes well.
>
> **Strategy:** ESPN's free/unofficial API is perfect for a low-cost pilot
> (no contract), and the swap to a paid feed in 2027 only touches the *adapter*
> layer if we design the boundary correctly now.

---

## 0. The one insight that makes this cheap

The engine and UI consume a **fixed data contract** — per-week JSON in
`public/pbp/wN.json` plus a few generated runtime maps. **If an ESPN adapter
emits byte-compatible artifacts, nothing downstream changes.** So the entire job
is: *build an ESPN → (our RealPlay shape) adapter*, and keep the contract stable
across data sources (nflverse today → ESPN 2026 → paid feed 2027).

And we can **validate it for free**: re-derive the **2025** weeks from ESPN and
**diff against the existing nflverse-baked `public/pbp/w*.json`** (points per
player, play counts, TDs). That de-risks the whole pipeline before a single 2026
game is played.

---

## 1. The data contract the adapter must produce

Produced today by `scripts/pbp/genRealPbp.mjs`; the ESPN adapter must match it.

**Per-week file `public/pbp/wN.json`** = `{ pbp, points, poss, wall, ends, kick }`:
- `pbp: Record<slug, RealPlay[]>` where
  `RealPlay = { c, t?, pid?, k, y, td, ca, tg, to? }` (`src/data/realPbp.ts`):
  - `c` = **game-elapsed seconds** (see `clockOf`: `(qtr-1)*900 + (900 - remaining)`;
    OT after 3600s with 600s periods).
  - `t?` = **real seconds since the game's first snap** (from each play's
    wall-clock timestamp; drives real-time power-up gating + REAL CLOCK drip).
  - `pid?` = stable per-play id. `k` = `RealPlayKind`
    (`pass|rush|rec|incomplete|return|fg|fgmiss|xp|xpmiss|sack|int|fumrec|dst_td|safety|tackle`).
  - `y` yards, `td` 0/1, `ca` caught 0/1, `tg` targeted 0/1, `to?` turnover-committed.
  - Keyed by **league slug** (skill players), plus `"{team}-k"` and `"{team}-dst"`.
- `points: Record<slug, number>` — weekly fantasy total (PPR/K/DST rules in the baker).
- `poss[team] = [[startSec,endSec],…]` — offensive possession intervals (drip gating).
- `wall[team] = number[]` — cumulative real wall-seconds in play per game-minute
  (quarter/half breaks excluded), shared by both teams of a game.
- `ends[team]`, `kick[team]` — game end clock + kickoff epoch (floored 5 min).

**Generated runtime maps** (also from the baker): `src/data/realWeeks.ts`
(`REAL_WEEKS`), `bakedSlugs.ts`, `sleeperSlug.ts`, `scripts/pbp/kdst_registry.json`.

Everything is loaded lazily at runtime by `src/data/realPbp.ts`. **Match these
and the app Just Works.**

---

## 2. ESPN as the source — endpoints & mapping

ESPN's unofficial API is free, no key, undocumented (ToS/rate-limit risk — fine
for a pilot). Two layers:

- **Schedule / events:**
  `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=N&seasontype=2&year=2026`
  → event ids, teams, status, kickoff time.
- **Play-by-play (recommended for attribution): the core API plays endpoint**
  `sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{eventId}/competitions/{eventId}/plays?limit=400`
  → each play has `type`, `period.number` (quarter), `clock.value` (seconds
  remaining), `scoringPlay`, `wallclock` (ISO → our `t`), `start/end` (down,
  yardline, **team**), and **`participants[]`** with `athlete.$ref` (the **ESPN
  athlete id**) + role `type` (passer/rusher/receiver/…) + per-play `stats`.
  The `summary?event={id}` site endpoint is the simpler alternative but attributes
  via play **text** (brittle) — prefer the core `participants` array.

**Field mapping (ESPN → RealPlay):**
| Need | From ESPN |
|---|---|
| `c` (game-elapsed s) | `period.number` + `clock.value` via the existing `clockOf` formula |
| `t` (real s since snap) | `wallclock` − first play's `wallclock` |
| passer/rusher/receiver slug | `participants[].athlete.$ref` id → **espn_id → slug** (see §3) by role `type` |
| `y`, `td`, completion (`ca`/`tg`) | participant `stats` / play `statYardage` + `scoringPlay` + play `type` (pass complete vs incomplete) |
| K (fg/xp), DST (sack/int/fumrec/safety/def-TD) | play `type` + team; key `"{team}-k"` / `"{team}-dst"` (same as baker) |
| `poss`/`wall`/`ends`/`kick` | derive exactly as `genRealPbp.mjs` does, from drives + clock + wallclock |

---

## 3. The hard part: ESPN athlete id → our slug

The nflverse baker attributes by **gsis_id**; ESPN attributes by **espn_id**. We
need an **espn_id → slug** map. We already have the pieces:
- `src/data/headshots.ts` is `slug → ESPN headshot URL` (the URL contains the
  espn_id) — invertible to `espn_id → slug` today for 607/608 players.
- `scripts/pbp/crosswalk.json` is `slug → {gsis, pos, name, sleeper?}`.
- The Sleeper directory and nflverse roster files carry `espn_id` too.

**Recommended:** extend `buildCrosswalk.mjs` to carry `espn` per slug (it's
already pulling `get_player_crosswalk`, which returns `espn_id` — see
`docs/mcp-requests.md` item 2 about rookie gaps), then emit an `espn_id → slug`
runtime map alongside `sleeperSlug.ts`. K/DST key off team, no id mapping needed.

Unmapped espn ids (rookies/practice squad) fall back to "no slug" → that play is
dropped (same as an unrostered player today). Track coverage; it's the main
accuracy risk.

---

## 4. Build plan (phased)

**Phase A — id crosswalk.** Add `espn` to `crosswalk.json` / build an
`espn_id → slug` map. Verify coverage against the 2025 rosters.

**Phase B — ESPN adapter + validation (do this on 2025).** Write
`scripts/pbp/genEspnPbp.mjs` that pulls ESPN for a given season/week and emits
the **same `wN.json` shape** as `genRealPbp.mjs`. Run it for **2025** and **diff
against the committed nflverse `public/pbp/w*.json`**: per-player `points`, play
counts, TD counts. Iterate the mapping until the diff is small and explained.
This is the gate — don't move on until ESPN reproduces 2025 acceptably.

**Phase C — 2026 automated weekly bake (pilot v1, async).** Schedule the adapter
to run after each week's games and publish `wN.json` (replaces the manual
Stathead pull entirely). Ship the pilot as **async resolution** (results settle
after games end) for a few users — no backend or live feed required, lowest risk.

**Phase D — near-live (pilot stretch).** Poll the ESPN plays endpoint during
games (e.g. 20–30s cadence), append new plays, and drive the live board in real
time. This is where a thin backend/cache helps (see
`docs/commercialization-handoff.md` §11) — but keep the adapter output identical
so the engine is unchanged.

**2027 — paid feed.** Swap only the adapter's *source* (SportsRadar/Genius →
RealPlay), keeping §1's contract. The validation harness (diff vs a known-good
week) carries over.

---

## 5. Risks / watch-items specific to ESPN

- **Attribution granularity.** ESPN's per-player stats are less structured than
  nflverse. The core `participants` array is the best path; fall back to text
  parsing only where needed. Validate hard in Phase B.
- **id coverage** (espn_id → slug) for rookies/depth — the same gap as
  `docs/mcp-requests.md` item 1.
- **Clock/wallclock fidelity.** ESPN `wallclock` is per-play ISO — good for `t`
  and the `wall`/`poss` derivations — but confirm it's present and monotonic;
  fall back to game clock when absent (the engine already tolerates missing `t`).
- **ToS / rate limits / stability.** Unofficial API can change or throttle.
  Acceptable for a small 2026 pilot; the 2027 paid swap removes this. Cache
  responses; be polite with cadence.
- **Returns / IDP.** Return yards (`retyd` drip) need kick/punt return plays +
  returner id from ESPN; IDP (gated `IDP_ENABLED`) needs per-defender
  participants. Both map from the same `participants` array — wire when enabling.

---

## 6. First deliverables for the new session

1. `espn_id → slug` map (Phase A) + a coverage report vs 2025 rosters.
2. `scripts/pbp/genEspnPbp.mjs` (Phase B) + a **diff report** of ESPN-derived
   2025 vs the committed nflverse bake (points/plays/TDs per player). This is the
   proof the pipeline works.
3. A short decision memo: is ESPN attribution accurate enough to pilot, where are
   the gaps, and async-only vs near-live for the 2026 pilot.

## 7. Open questions for the founder

- **Async vs live for the 2026 pilot?** Async (Phase C) ships with no backend;
  near-live (Phase D) needs a thin server. Recommend async first.
- **How many pilot users, and do they need real PvP** (sealed picks held
  server-side), or is vs-AI / leaderboard fine for 2026? (PvP forces a backend.)
- **Acceptable accuracy bar** for ESPN attribution vs nflverse truth before we
  commit to piloting on it.

## Appendix: orientation
- Contract + lazy loader: `src/data/realPbp.ts`. Current baker:
  `scripts/pbp/genRealPbp.mjs` (mirror its `clockOf`, `poss`, `wall`, `ends`,
  `kick`, points logic). id maps: `crosswalk.json`, `headshots.ts`,
  `sleeperSlug.ts`. Engine consumers: `src/engine/sim.ts` (`realRawPlays`,
  `playsForPlayer`, drip accrual on `poss`/`wall`). Live board: `src/screens/Matchup.tsx`.
- Related: `docs/commercialization-handoff.md` (backend/cost for Phase D+),
  `docs/mcp-requests.md` (id/return/IDP data gaps that also apply to ESPN).
