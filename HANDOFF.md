# Drip League FF — Session Handoff

_Last updated: 2026-06-20 · Build `v0.9.7.2`_

## Live board layout (v0.9.7.2)
- **Window header clock**: shows the **wall-clock time of day** (ET), e.g.
  "1:14 PM", instead of the old `game / 60:00`. `WindowSection` takes a
  `wallSeconds` prop (real seconds elapsed at the current feed position —
  `winClocks` directly in real modes, or game-position scaled into the window's
  real span in game mode). Base time-of-day is parsed from `w.time`
  (`kickoffSecOfDay` / `fmtTimeOfDay` helpers in Matchup.tsx). Progress bar +
  ▶/❚❚ + FINAL chip are unchanged.
- **Per-slot game line**: the `GameLine` component (`TEAM vs TEAM` + each game's
  current game clock) renders as the header of a slot's expandable log — in both
  the head-to-head and unopposed/backup `open` blocks. Each side shows its own
  team logo + `fmtClock(youClock/theirClock)` (clocks differ per game in real
  modes).
- **Real-time power-ups folded into ✦ APPLY**: the per-slot `⚡ USE` chip is
  gone. `metric-swap` / `player-swap` are now in `SPOT_APPLY`, so they list in
  the Apply card with an APPLY button → `pendingApply` → tap a live spot
  (`spotEligible` = `s.you && !done`) → opens the existing `SwapMenu` via
  `applyToSpot`. `ScoreRow`/`WindowSection` no longer take `canSwap`/`onPowerup`.

## What this is
Drip League FF (formerly "Gridiron Clash") — a Vite + React 18 + TypeScript
fantasy-football web game. Real 2025 NFL play-by-play drives a per-window,
per-clock matchup sim with hidden scoring metrics and a drip-coin power-up
economy. No backend — everything is deterministic from `(playerId, week)` plus
baked real play-by-play.

## Branches & shipping
- **Develop on:** `claude/elegant-allen-j85njq` (the checked-out working branch).
- **Mirror every ship to all three:** `claude/elegant-allen-j85njq`,
  `claude/youthful-albattani-s9kprl` (triggers the Pages deploy), and `main`.
  ```
  git push -u origin claude/elegant-allen-j85njq
  git push origin claude/elegant-allen-j85njq:claude/youthful-albattani-s9kprl
  git push origin claude/elegant-allen-j85njq:main
  ```
- **Bump `src/app/version.ts` (`APP_VERSION`) on every change.** Versioning is
  4-segment now (`v0.9.5.N`) to leave headroom before a real 1.0. The version
  chip renders in the header — use it to confirm a deploy went live (hard-refresh).
- **Build gate:** `npm run build` (`tsc -b && vite build`). `noUnusedLocals` /
  `noUnusedParameters` are ON — remove dead vars/props or the build fails.

## Key files
- `src/screens/Matchup.tsx` — the big one. Setup + live board, all power-up UI,
  `ScoreCard` / `ScoreRow` / `SetupRow` / `WindowSection`, all modals.
- `src/screens/MatchupFinal.tsx` — the week-result screen.
- `src/engine/sim.ts` — the simulation: `weekLine`, `buildPlays` (synthetic
  fallback), `playsForPlayer`, `resolveSlot` (merged timeline + all metric
  mechanics), `scorePlay`, `statlineAt`, `returnPlays`.
- `src/engine/matchup.ts` — `buildMatchup`, coin helpers (`metricCoin`,
  `slotCoin`, `weekEarnings`), window pools.
- `src/data/metrics.ts` — `METRICS` catalog per position (id, name, tag, fx, lock).
- `src/data/powerups.ts` — `POWERUPS` catalog (timing `pre`/`live`, target, kind).
- `src/data/returns.ts` — **generated** real KR/PR return plays (see below).
- `src/data/realPbp.ts` — per-week real play-by-play loader; `RealPlayKind`.
- `src/app/store.tsx` — drip-coin wallet, inventory, `applied[week]`
  (extraSlots/swaps/backups/buffs/doubleOrNothing/spy/byeSteal/emp), all the
  apply/clear/refund actions, `resetDripCoin`.
- `src/theme.ts` / `src/app/ui.tsx` — themes, `useIsMobile()`, header, chips.

## Power-up model (current state)
Two kinds of power-up surface, both reached from two header chips
(`◈ ACTIVE` / `✦ APPLY`, kept side-by-side on one row):

- **Whole-field buffs** (`TEAM_BUFFS`, no `target`): **ARM** from the Apply
  card. Armed buffs show as pills on the spot cards they affect
  (`buffAppliesToSpot`) and are listed in the Active card.
- **Targeted power-ups**: **APPLY** in the Apply card → enters apply-mode
  (`pendingApply`) → tap the target. All five go through the same flow:
  - `double-or-nothing` → tap a filled YOUR spot.
  - `bye-steal` → tap an empty box → bye-player picker.
  - `spy` (after lock, pre-kick) → tap any slot → reveal player OR metric.
  - `mulligan` (live) → tap a live YOUR spot → metric picker.
  - `emp` (live) → tap a live window header.
  Apply-mode highlighting lives in `SetupRow` (setup) and is wrapped around
  `ScoreRow` (live) in `WindowSection`; EMP highlights the window header.
- **Extra Slot** still uses the window header ADD/REMOVE buttons.
- **Active card** (`ActivePowerupsModal`) lists everything in effect with a
  back-out where still legal (disarm / clear / remove / refund). The standalone
  live "BuffStrip" list was removed — the Active card is the single source.
- Apply card (`ApplyPowerupsModal`) only shows power-ups usable right now,
  scoped to open windows, each tagged with its deadline.
- **Back-out / refund** exists for every power-up pre-lock (store `clear*` /
  `disarm*` / `removeExtraSlot` / `refundUnlock`).

## This session's work (newest first)
- `v0.9.5.10` Active/Apply chips forced side-by-side (equal-width, nowrap;
  labels shortened to ACTIVE / APPLY).
- `v0.9.5.9` **Scout**: tapping a sealed opponent spot in setup opens a card
  listing every opponent player whose game is in that window (the candidate
  pool). Shows the FULL pool — slotted players are NOT removed — so the actual
  pick never leaks by commission or omission. Pre-lock counterpart to Spy.
- `v0.9.5.8` Removed the live-header buff list (dup of Active card); restored
  per-spot power-up pills; edge-aligned the metric chip / total / drip coin to
  the inner (center-facing) edge of each `ScoreCard` (far-right your side,
  far-left opponent), identity/statline on the outer edge.
- `v0.9.5.5–.7` **Return Yards metric wired up for real** (see below).
- `v0.9.5.3–.4` Active/Apply chip split; Spy/Mulligan/EMP migrated into the
  tap-to-target apply flow; `TargetPanel` reduced to a Spy-intel readout.
- `v0.9.5–.2` Fixed power-up arming bug (`consumeAndApply` was dropping prior
  applied state); Double or Nothing / Bye Steal pills on spot cards.

## Return Yards — important data note
The `unlock-return` power-up's Return Yards metric is now real and fully wired:
- `src/data/metrics.ts`: `retyd` on WR + RB, flat `0.1/yd + 6/return TD`.
- Real 2025 KR + PR pulled from the **Stathead MCP** (`get_play_by_play`,
  `play_type=kickoff|punt` + `player_ids`), with exact `qtr+time` clocks.
- Raw dumps live at `scripts/pbp/_ret_kr.jsonl` / `_ret_pr.jsonl`;
  `scripts/pbp/genReturns.mjs` aggregates them (weeks 1-14, via
  `crosswalk.json`) into `src/data/returns.ts` as exact-timed plays
  `slug -> { week: [[clock, yards] | [clock, yards, 1]] }`.
  Regenerate with: `node scripts/pbp/genReturns.mjs`.
- Engine emits return plays at their **exact game-elapsed second** (no
  synthesized timing), and folds them into the timeline **only when the slot's
  metric is `retyd`** (so a return TD never leaks into another metric's nuke /
  streak logic). `statlineAt` / `ScoreCard` take `metricId` for the same reason.

### Timing fidelity (a stated hard requirement)
For all 14 real weeks every metric resolves on the **real PBP clock** — base
plays were always baked from `qtr+time` (`scripts/pbp/genRealPbp.mjs`), and
returns now match. The only synthesized timing left is `buildPlays`, which only
fires for weeks/players with **no** real data (beyond week 14). If asked to make
the app *only ever* use real data, gate weeks 15+ out of selection rather than
touching real-week paths.

## Real play time — real-time power-up gating (v0.9.6.0)
Real-time power-ups (Metric Swap / Player Swap / Mulligan) are now gated on the
**real wall-clock time** a play happened, not the game clock the feed shows — so
a delayed feed can't be used to scoop a TD you already saw on TV. Wiring:
- `RealPlay.t?` (in `src/data/realPbp.ts`) and `RawPlay.t?` (in `sim.ts`) carry
  real seconds since the game's first snap. `sim.ts` exposes `realTimeAt()` /
  `clockAtRealTime()` to convert between a player's game-clock and real-time
  positions (linear interp between plays).
- `SlotSwap.atRt` (in `matchup.ts`) stamps activation with real time; the
  swap-split in `buildMatchup` maps `atRt` back to a cut-over game clock via the
  pre-swap player's timeline. Store actions (`applyMetricSwap` /
  `applyPlayerSwap` / `applyMulligan`) and the `Matchup.tsx` call sites pass it.
- **Graceful fallback:** when `t` is absent (data baked before this, return
  plays, synthesized weeks) `t` falls back to the game clock, so `realTimeAt` /
  `clockAtRealTime` are the identity and scoring is byte-identical to before.
  The real-time axis only changes outcomes once a delayed feed exists.

### Baking real `t` + `pid` — canonical pipeline (v0.9.6.2)
Every baked play (`public/pbp/wN.json`) and return (`src/data/returns.ts`)
carries `t` (real seconds since its game's first snap, from nflverse
`time_of_day`) and `pid` (nflverse `play_id`, a stable per-game key for future
live-feed gating). Both are baked **natively from a full re-pull** — each play
gets its OWN exact `time_of_day` (no interpolation, no same-second approximation).
- **Pull** (Stathead MCP `get_play_by_play` now returns a full week per call;
  over-cap results auto-save to `tool-results/*.txt`): for each week 1-14,
  `season=2025 week=W output_format=jsonl limit=4000` with the full field set
  incl. `play_id` + `time_of_day`. Split the saved results into per-game
  `scripts/pbp/raw/<game_id>.jsonl` (one game per file).
- **Generate:** `node scripts/pbp/genRealPbp.mjs` → `public/pbp/wN.json`
  (+ `realWeeks.ts`, `kdst_registry.json`); `node scripts/pbp/genReturns.mjs` →
  `returns.ts`. Both read `raw/` and bake `t`+`pid`. `raw/` and `expected.txt`
  are gitignored/regenerable; the shipped output is the committed artifact.
- **Verified:** re-attribution reproduces the prior validated scoring exactly
  (0/2878 player-weeks changed); returns match except 2 legit returns the old
  `_ret` dumps had missed. 100% `t`+`pid` coverage on all 32,728 plays + 388
  returns.
- The engine still falls back to the game clock wherever `t` is absent
  (`realTimeAt`/`clockAtRealTime` become the identity), so older/synthetic data
  keeps working.

## Playback clock modes (v0.9.7.1)
The live board's `⏱` button (by `RUN ALL`) cycles three playback clock modes,
held in `clockMode: 'game' | 'feed' | 'real'` on `Matchup`:
- **GAME CLOCK** (`game`): every game in a window advances in lockstep on
  game-elapsed seconds — the original behavior.
- **REAL FEED** (`feed`): plays arrive on the real wall clock (each game runs at
  its own real pace via each play's baked `t`, so games desync), but scoring
  still **resolves on the game clock**.
- **REAL CLOCK** (`real`): real feed AND cross-game effects resolve in real-time
  order (see below).

Wiring:
- `wallClock = clockMode !== 'game'` drives the real-time reveal:
  `winTarget = wallClock ? winRealMax : winMax` (ticker/seed/done/winLife);
  `winClocks[win]` is the window position (game secs, or real secs since kickoff).
  Per side, `clockAtRealTime(player, week, pos)` maps the window's real position
  back to that player's game clock; `ScoreRow` takes `youClock`/`theirClock`
  (banks, statline, log filter, coin all per-side). Totals sum each side at its
  own clock. Changing modes re-seeds positions to 0.
- `realResolve = clockMode === 'real'` is passed to `buildMatchup`. The only
  genuinely cross-game scoring effect is the **TE-TD drip nuke**
  (`teTdNukeClocks` now returns `{c, rt}` per nuke). Game-resolve fires it at its
  own game clock; real-resolve lands it on the RECEIVING player's game clock at
  the nuke's real time (`clockAtRealTime(recv, rt)`), so a nuke from a real-time
  desynced game hits at the right wall-clock moment. Per-play points and per-game
  mechanics (drip rate, garbage-time, FG mult, OT) are unchanged — no rebalance;
  only nuke-affected slots can differ between `feed` and `real`. `MatchupFinal`
  always uses game-resolve (canonical).

## Suggested next steps / open threads
- Decide whether **Scout** should cost something (a power-up / drip coin) or
  stay free intel — asked, not yet answered.
- Consider showing the candidate count on the sealed box itself.
- PBP source dumps (`raw/`, `rtdump/`, `expected.txt`) are gitignored/
  regenerable; only the baked `public/pbp/*.json` + `returns.ts` are committed.
  The old per-team/`_ret_*` dumps and `genRealtime.mjs` enrichment pass were
  removed once the canonical full-pull pipeline landed.
- Mobile passes are ongoing; keep testing `ScoreCard` at narrow widths.

## Gotchas
- The deploy can lag; confirm via the version chip + hard-refresh before
  trusting a screenshot. Old screenshots have caused false "still broken" reports.
- `applied[week]` is the source of truth for everything in-flight; the
  `consumeAndApply` helper must spread the existing week (regression fixed in
  v0.9.5 — don't reintroduce a partial rebuild).
- GitHub MCP tools (`mcp__github__*`) and Stathead MCP (`mcp__stathead__*`) are
  available via ToolSearch; scope is the `dachhack/ffgame` repo.
