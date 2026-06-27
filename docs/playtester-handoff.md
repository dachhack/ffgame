# Handoff — automated playtester & AI balance

_Goal of the next session: build a **headless automated playtester** that (1) hunts
for **gameplay balance breakers** — exploits, overpowered metrics/power-ups, runaway
coin, dominant strategies — and (2) uses that signal to **advance the AI rule set**.
This doc is self-contained; deeper context in `HANDOFF.md`, `docs/scale-2026-2027-plan.md`._

## Start here — what's already true
- The game is a hidden-pick, live-effect fantasy duel: 5 windows / 8 slots, each a
  **(player, hidden metric)** pair; metrics carry effects (NUKE / ERASE / HOT STREAK /
  FIELD GENERAL / COMPRESSION / RATE RESET / CLOCK STOP / SUPPRESS / BANKER), plus a
  **drip-coin economy** that buys **power-ups**. Mechanics live in `src/data/metrics.ts`,
  `src/data/powerups.ts`, and the engine.
- **The engine is pure & deterministic** — no RNG, no `Date.now()`; everything seeds
  off `(playerId, week)` + hashes, so a given `(picks, week)` always resolves
  **identically**. This is the property the whole playtester rests on: reproducible,
  searchable, no flakiness.
- **It runs headless in Node via `tsx`** — the worker (`server/`) already imports the
  `.ts` engine and runs it server-side. So the playtester is *another headless driver*
  over the same entry points, no Supabase needed (use baked weeks + `injectWeek`).
- Pilot infra (worker/load-test/ops) just landed on `main` — out of scope here, but
  `server/scripts/loadtest.mjs` and `server/test/engine-smoke.mjs` are working
  **examples of driving the real engine in Node** to copy from.

## The engine is your sandbox — how to drive it
Pure entry points (all in `src/engine/`, runnable under `tsx`):

```
injectWeek(week, pbp)                                  // load a baked week's plays (engine.js wraps it)
resolveSlot(you, their, week, label, opts)             // sim.ts — ONE slot H2H → events + banks
resolveLiveMatchup(homePicks, awayPicks, week, buffs)  // liveResolve.ts — FULL matchup:
                                                       //   cross-window Field General, best-ball
                                                       //   backups, DEF suppress, K banker, COIN
buildMatchup(...) / weekEarnings(...) / slotCoin(...)   // matchup.ts — league-bound variant + coin
aiLineup(slugs, week, owned, extraSlots)               // data/aiLineup.ts — the AI's pick logic
```

A playtest loop is: `injectWeek` → build two lineups (`aiLineup` per side, or a chosen
loadout) → `resolveLiveMatchup` → read `{ home, away, coin, states, events }` → tally.
Run thousands of seeded matchups per week and scan the aggregates. Baked weeks 1–14 live
in `public/pbp/wN.json`. Put the harness in `server/scripts/` or a new `tools/` dir;
run with `npx tsx`. **No DB required.**

## Job 1 — the balance-finder (exploit hunting)
**Approach:** a Monte-Carlo / tournament harness. For each baked week, generate many
matchups across varied lineups + metric choices + power-up loadouts (seeded so it's
reproducible), resolve them all, and flag outliers. Two complementary modes:
- **Honest field** — both sides use the *shipping* AI (no hindsight). Measures the
  baseline meta: which metrics/power-ups win, average coin, score spread.
- **Adversary vs. honest** — one side is an **oracle that searches** (tries every
  metric/power-up combo *with* hindsight of the baked week) to find the strongest
  degenerate line. If a cheap loadout reliably crushes an honest opponent, that's an
  exploit. (This adversary is a *tool*, not what ships — it's the exploit detector.)

**Detection signals (what "broken" looks like):**
- A metric/power-up with a **win-rate far above its cost-peers**, or that dominates
  regardless of matchup.
- **`double-or-nothing` win-rate ≠ ~50%** in honest play (it should be a coin flip);
  >50% means information leaks (e.g. spy+DoN) or projection bias.
- **Runaway drip-coin**: any single player/loadout averaging an outsized coin/week —
  there is **no per-week coin cap**, so this compounds.
- **Score blowups**: a single play swinging >150 pts (TE-TD nuke stacks, FG×FG).
- **Denial immunity**: `floodgates` (drips immune to pauses/erases) or TE-drip immunity
  making a strategy un-counterable.

**Prime suspects to test first** (from the numeric levers, §below):
- **TE `td` = 8 pts + −1.0/min knock to *every* opposing drip** — the strongest single
  play in the game. Does stacking TE-TDs cascade?
- **`momentum` (3× hot) + `unlock-combo-drip` on an elite dual-threat RB** — runaway
  drip + coin farm?
- **`fg-stack` / Twin Generals** — two QBs' FG multipliers **multiply** (mult×mult, not
  max). 300 yds ≈ 1.9× each → ~3.6× combined. Explosive?
- **Unopposed bounty (15 coin/slot) × `extra-slot` (80 coin)** — can a weak roster buy
  slots to farm coin?
- **`counter-nuke` (95) / `insurance` (80)** vs nuke metrics — is the counter strictly
  better than nuking, or vice-versa?
- **K `banker` +1/XP per TD** — linear stacking; a 5-XP K + 3-TD slot = +15.

## Job 2 — advance the AI rule set
**The playtester is the AI's fitness function:** an improved AI is one that wins more
honest matchups and resists the adversary's exploits, without using hindsight.

**What the AI does today (weak — this is the baseline to beat):**
- `src/data/aiLineup.ts` — picks players by **season projection** (no hindsight, correct),
  assigns the **default metric per position** (`DEFAULT_AI_METRIC`: QB→pass, RB→rush,
  WR/TE→recyd, K→banker, DEF→earn), and flips a QB to Field General only if its window
  has ≥2 drip teammates. **No metric optimization, no opponent awareness.**
- `server/src/lock.js` `aiBudgetPass()` — at lock, seeds a ~150-coin wallet and **buys
  blind**: combo-drip unlock if it has a dual-threat, 3 deterministic buffs, up to 2
  extra slots — **never tailored to the opponent or slate**, no defensive power-ups
  (spy/counter-nuke/insurance), no live swaps/EMP.

**Concrete improvements to drive with the playtester:**
1. **Metric selection vs. threat** — choose each slot's metric from the matchup (e.g.
   nuke into a drip-heavy opponent, suppress/erase as counters) instead of the flat default.
2. **Opponent-aware power-up buying** — prioritize counters (insurance/counter-nuke vs a
   likely nuker; spy for info) by expected value, not a fixed list.
3. **Coin budgeting** — spend to maximize expected win, with diminishing returns; stop
   stacking extra slots once marginal value drops.
4. **(Stretch) live play** — metric/player swaps + EMP during the week.
Each change is only "better" if it lifts honest win-rate in the harness — measure, don't guess.

## Numeric levers (the tuning table)
These constants govern balance; the playtester should be able to sweep them.

| Lever | Value | Where |
|---|---|---|
| Drip rate (skill / TE) | 0.01 / 0.005 pts·min⁻¹ per yd | `sim.ts` |
| Field General mult | `1 + 0.003 × passYds` (300 ≈ 1.9×) | `sim.ts` |
| HOT streak mult | 2× (3× with `momentum`) | `sim.ts` |
| TE-TD drip nuke | −1.0/min to every opposing drip | `sim.ts` / `liveResolve.ts` |
| Erase window | 10 min (15 for TE-tgt) | `sim.ts` |
| Compression trim | 25% of opponent's latest score | `sim.ts` |
| Weekly stipend | 50 coin | `matchup.ts` / `liveResolve.ts` |
| Unopposed bounty | 15 coin/slot | `matchup.ts` |
| Signature coin | K-neg 50 · nuke/suppress 10 · drip-HOT 5 | `matchup.ts` `metricCoin` |
| Turnover coin | 10 (25 with `turnover-boost`) | `matchup.ts` |
| K banker bonus | +1 per XP per TD | `liveResolve.ts` |
| Power-up costs | 30–95 coin | `powerups.ts` |
| AI wallet seed / extra-slot cap | ~150 coin / 2 | `server/src/lock.js` |
| Combo-drip threshold | 20 ypg rush AND rec | `aiLineup.ts` |

## Suggested build plan
1. **Headless harness** — `injectWeek` → `resolveLiveMatchup` over N seeded matchups for
   one week; print per-side scores + coin. (Copy the Node/tsx setup from
   `server/test/engine-smoke.mjs`.) Add a `--week` sweep over 1–14.
2. **Aggregator** — per metric / power-up / loadout: win-rate, avg margin, avg coin,
   biggest single-play swing. Flag outliers vs. cost-peers.
3. **Adversary** — the hindsight oracle that searches loadouts to beat an honest opponent;
   surface the top exploit lines.
4. **AI iteration** — implement improvement #1 (threat-aware metrics), re-run, confirm
   honest win-rate up and exploit margins down. Repeat for #2–#3.
5. **Report** — a balance report (which levers to retune, which power-ups are over/under-
   priced) + the improved `aiLineup`/`aiBudgetPass`.

## Conventions & gotchas
- **You'll get a fresh branch from the harness** (branch off `main`, which now has all the
  pilot work). Develop there; **don't** push to `main` or the Pages deploy branch without asking.
- **Build gate:** `npm run build` (`tsc -b && vite build`); strict — `noUnusedLocals` /
  `noUnusedParameters` ON, so remove dead vars. Bump `src/app/version.ts` on client changes.
- **Engine purity is load-bearing:** keep the `RealPlay` contract frozen; **no `Date.now()`
  / `Math.random()`** in engine code (they'd break determinism + the worker). Seed off
  hashes like the existing code.
- **Honest vs. adversary AI:** the *shipping* AI must never use hindsight (it sets picks
  before games). The exploit-finding adversary may — keep them separate, and never let
  hindsight leak into `aiLineup`/`aiBudgetPass`.
- **Demo simplifications** (documented in `src/engine/sim.ts`): Field General, Rate Reset /
  Clock Stop / Compression are partly flavored vs. fully modeled — know which effects are
  "real" before flagging one as broken. NUKE / ERASE / HOT STREAK are fully modeled.
- Commit trailers required (`Co-Authored-By` + `Claude-Session`); the model id never appears
  in committed artifacts. No PRs unless asked.

## File index
| File | What |
|---|---|
| `src/data/aiLineup.ts` | **AI rule set** (pre-game): `aiLineup`, `aiMetric`, `DEFAULT_AI_METRIC`, FG heuristic |
| `server/src/lock.js` | **AI budget pass** at lock: `aiBudgetPass` (blind power-up buying) |
| `src/data/metrics.ts` | Metric catalog: `WINDOWS`, `METRICS` (per-position id/effect/lock) |
| `src/data/powerups.ts` | `POWERUPS` (id, timing pre/live, target, cost) |
| `src/engine/sim.ts` | Per-slot resolve: drip/nuke/erase/compression/FG/streak — the mechanics |
| `src/engine/liveResolve.ts` | Cross-slot resolve: FG, backups, suppress, K banker, **coin** |
| `src/engine/matchup.ts` | League-bound variant + coin economy (`metricCoin`/`weekEarnings`/`slotCoin`) |
| `server/test/engine-smoke.mjs` | **Working example** of running the engine in Node (copy this) |
| `server/scripts/loadtest.mjs` | Headless many-matchup driver at scale (pattern to reuse) |
| `src/data/forceResolve.ts` | Client-side resolve via the shared `resolveLiveMatchup` |

_Engine line numbers drift — search by function name. The map this was distilled from is
in the session history if you want the exhaustive per-line detail._
