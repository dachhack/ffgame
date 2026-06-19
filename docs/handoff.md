# Gridiron Clash — Session Handoff

Living handoff for picking up work in a fresh session. Last updated after
shipping **v0.4.7** (WR/TE Carries as an automatic plus-up).

## What the project is

A fantasy-football web game built on the 2025 **PeakedInDynasty** Sleeper league
(10-team, 2QB dynasty). Static **Vite + React + TypeScript** site, auto-deployed
to **GitHub Pages**. Stat/PBP data comes from **Stathead** (stathead.app), surfaced
in the UI footer + version chip.

The core loop: each NFL week, you field players into the 5 real time-slot
**windows** (TNF / early / late / SNF / MNF). Each slot picks a hidden **metric**
that both *scores* and applies a *strategic effect* (nuke / erase / drip / etc.)
against the head-to-head opponent in that slot. A **drip-coin** economy funds
**powerups**.

## Deploy / branch model — READ BEFORE PUSHING

- Work branch: **`claude/youthful-albattani-s9kprl`** (this is the repo's
  **default** branch and the **only** branch the deploy workflow triggers on).
- GitHub Pages env protection only allows the default branch. Pushing `main`
  must **NOT** trigger a deploy and would cancel the feature-branch deploy via
  the `pages` concurrency group — so `.github/workflows/deploy.yml` is
  restricted to `branches: [claude/youthful-albattani-s9kprl]`.
- To ship: `git push -u origin claude/youthful-albattani-s9kprl` (this deploys),
  then mirror without triggering: `git push origin claude/youthful-albattani-s9kprl:main`.
- Bump `APP_VERSION` in `src/app/version.ts` on every notable change (it shows
  as a chip at the top of the page so we can tell which build is live).
- Build to verify before pushing: `npm run build` (runs `tsc -b && vite build`).
- Do **NOT** open a PR unless explicitly asked. Commit trailers required:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the
  `Claude-Session:` line. The model id must never appear in any committed artifact.

## Architecture cheat-sheet

- `src/engine/sim.ts` — `resolveSlot(you, their, week, label, opts)` walks a merged
  play timeline and produces the event feed + finals for one slot. Metric families
  via `familyOf` (nuke/erase/streak/mult/compression/reset/stop). Drip rate
  integrator accrues per-minute while a side has possession. `scorePlay` = per-play
  points by pos+metric. Per-side armed buffs arrive as `opts.youBuffs`/`theirBuffs`
  (`Set<string>` of powerup ids); only the human side carries buffs in the demo.
- `src/engine/matchup.ts` — `buildMatchup(...)` resolves a full week across windows,
  applies best-ball backups, DEF SUPPRESS halving, K banker bonus, armed-buff
  payouts (`award`), and targeted powerups (`extras`). Coin economy: `metricCoin`
  (coin per event of note), `coinRisk`, `weekEarnings` (stipend 50 + unopposed 15 +
  signature events + turnover transfer). `turnoversCommitted` counts INT/fumble-lost.
- `src/data/metrics.ts` — `METRICS[pos]` catalog. Locked metrics carry `lock: <powerup id>`.
- `src/data/powerups.ts` — `POWERUPS` catalog. `kind: 'action'` + `timing: 'pre'` +
  no `target` ⇒ shows up in `TEAM_BUFFS` (armed one-click via BuffStrip).
- `src/app/store.tsx` — coin balance, inventory, `applied[week]` (extraSlots, swaps,
  backups, buffs, doubleOrNothing, spy, byeSteal, emp). `armBuff` consumes one and
  sets `buffs[id]=true`. `DEMO_GRANT = 2500` one-time for play-testing.
- `src/screens/Matchup.tsx` — the whole matchup UI: SetupRow (metric picker),
  ScoreRow/ScoreCard (live/final, unopposed slots reuse ScoreCard with a chip),
  TwoColLog (play feed with `◈` coin marks), BuffStrip, TargetPanel, EarningsModal.

## Just shipped — v0.4.7: WR/TE Carries as an automatic plus-up

Per request: *"Have the carries bonus apply automatically as an additional
'plus up' metric on top of whatever else you choose."*

- `unlock-carries-wipe` is now an **armable team buff** (`kind: 'action'` in
  `powerups.ts`) instead of a selectable metric. Arm it pre-kickoff; for the rest
  of the week **every WR/TE carry in your starting spots wipes its matched
  opponent to 0**, layered on top of whatever metric that slot is scoring.
- The `carries` metric was **removed** from the WR and TE lists in `metrics.ts`
  (RB `carries` COMPRESSION metric is untouched). Dead `scorePlay` branches for
  WR/TE carries removed.
- `sim.ts` carry-wipe block now gates on `myBuffs.has('unlock-carries-wipe')`
  (the acting side's buff set) rather than `metricId === 'carries'`, and tags the
  event with `coinAmt = 25` so the carry wipe pays its 25-coin bounty regardless
  of the slot's primary metric.
- New `PbpEvent.coinAmt?: number` (in `src/types.ts`); `weekEarnings` now adds
  `e.coinAmt ?? rate` per coin event (was `rate` only, gated on `rate > 0`).
- Removed the now-dead `metricId === 'carries'` branch in `metricCoin`.

## Open / pending work

### 1. PBP re-pull for exact fumble attribution (IN PROGRESS — week 1 only)

Goal: every week's `public/pbp/wN.json` should attribute lost fumbles to the
exact fumbler via Stathead's `fumbled_1_player_id`. The baker
(`scripts/pbp/genRealPbp.mjs`, committed c2a5cca) already does this when the raw
dumps carry `fumbled_1_player_id`, and falls back to a play-role heuristic when
they don't.

State of the data:
- The **existing 208 raw files** in `scripts/pbp/raw/` (all 14 weeks) were pulled
  **before** `fumbled_1_player_id` was exposed — they lack it (role-heuristic only).
- **Week 1 has been freshly re-pulled** WITH `fumbled_1_player_id`, landed as
  per-team `scripts/pbp/_t_<CODE>.jsonl` (31 files; LAR was a bye/no-data, 0 plays).
  These are committed to preserve the expensive pulls.
- The shipped `public/pbp/wN.json` (last baked in v0.4.6, commit 08e884a) still
  uses the role heuristic for fumbles.

To finish:
1. Re-pull weeks **2–14** per team. Stathead `get_play_by_play` has **no `offset`** —
   paginate via the `team` filter (~60–80 plays/team-week, under the 200-row cap),
   ~32 calls/week. Keep each team's `posteam` plays only. (Parallel background
   subagents work well; 8 batches × 4 teams per week. Do NOT read the subagent
   transcript output files — they overflow context; trust their summaries.)
2. Merge the per-team `_t_<CODE>.jsonl` pulls back into per-**game** raw files in
   `scripts/pbp/raw/` (each raw file is one game keyed `2025_<WW>_<AWAY>_<HOME>`
   holding both teams' plays — match the existing raw filename convention; the
   baker maps gsis→slug via `scripts/pbp/crosswalk.json`).
3. Re-run `node scripts/pbp/genRealPbp.mjs` → regenerates `public/pbp/wN.json`
   ({pbp, points, poss}) and `src/data/realWeeks.ts`.
4. Verify exact fumble attribution (spot-check a known multi-player fumble), bump
   `APP_VERSION`, commit + push (feature branch + mirror main).

NOTE: a partial re-bake (week 1 exact, weeks 2–14 heuristic) is safe — the baker
handles both — but ideally finish all 14 for consistency before shipping.

### 2. Return Yards powerup (parked — blocked on MCP data)

`docs/mcp-requests.md` item 2: the `unlock-return` powerup (0.1/yd banked +
0.003 drip multiplier) is wired but dormant until Stathead exposes `return_yards`
and the kick/punt returner id per return play.

## Constraints (persist these)

- GitHub MCP scope is restricted to `dachhack/ffgame` only.
- Commit/push only when work is complete (a stop-hook enforces no uncommitted
  changes at end of turn).
- Do not create PRs unless explicitly asked.
