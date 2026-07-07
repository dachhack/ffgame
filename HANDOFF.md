# Drip League FF — Session Handoff

_Last updated: 2026-07-07 · Build `v0.96.0`_

## Targeted power-ups score in LIVE leagues (v0.96.0)
0059 made everything buyable; this makes the targeted/reactive set actually
WORK in live H2H — previously the client applied them locally and the worker
never scored them (pay-for-nothing).
- **Engine** (`liveResolve.ts`): `resolveLiveMatchup` gains per-side
  `extras` — Double or Nothing (post-suppress ×2/0, baked into the slot so
  window sums still equal totals), Bye Steal (flat score, clamped ≤25;
  unopposed target follows the normal backup rule), EMP (10-min opponent drip
  freeze per window), real-time Metric/Player Swaps + Mulligan (buildMatchup's
  pre/post-cut split, per side), and the Trick Play / Pick Six / Hail Mary
  flat awards (credited to the triggering slot). Backward compatible — the
  playtester/forceResolve callers are untouched.
- **DB** (`0060_targeted_powerups.sql`): `apply_targeted` / `clear_targeted` /
  `use_spy` write `applied_state.payload_json.targeted`. UNCHARGED state-
  setters (the shop flow already charges + consumes inventory — same pattern
  as hero_set_buffs); their value is validation: pre-vs-live timing gates via
  matchup status + `window_kickoff()` (0058), roster-membership checks on
  player targets (`caller_pool_has`), one-swap-per-slot / one-EMP-per-window,
  locked-metric unlock enforcement, clamps. `use_spy` consumes a purchased Spy
  from team_inventory itself and returns the opponent's REAL current pick
  (player or metric) pre-kickoff; a bought peek re-reads free (late swap means
  the pick can change — that's the gamble; blurb updated + rulebook regen).
- **Worker** (`resolve.js` / `premium.js`): `sideLineup` carries the targeted
  payload; premium gating strips premium targeted items in non-premium
  matchups (`gateTargeted`, alongside gateSide); payloads convert to engine
  extras with defensive re-clamps.
- **Client** (`Matchup.tsx` / `store.tsx` / `liveApi.ts`): every targeted
  apply/clear on the liveCtx board write-throughs to the RPCs; Spy in live
  goes through `use_spy` (real reveal shown in the SPY INTEL panel via
  `spy.value`; no undo — the item is consumed); store hydration merges the
  server's targeted record over the hero blob so live-phase applies (EMP,
  swaps) survive reload.
- **Verified**: 19-check engine harness on baked week 1 (DoN win math exact,
  EMP cuts only the opponent, swap@0 ≈ full new config / swap@end ≈ original,
  bye-steal clamp + backup rule, Hail Mary +15, window-sums invariant
  everywhere) + 17 RPC gating probes on a scratch Postgres (timing gates,
  pool membership, dup rejection, spy consume/re-read-free/qty-0).
- **Still unmodeled**: Ball Hawk (turnover feed dormant everywhere), manual
  backup assignment in live (auto-only), K-neg/suppress edge parity between
  buildMatchup and liveResolve unchanged.

## All 24 power-ups priced server-side + late-swap copy/ops (v0.95.1)
- **`0059_powerup_prices.sql`**: `powerup_price()` now lists every catalog item.
  Twelve (metric-swap, player-swap, mulligan, emp, spy, double-or-nothing,
  bye-steal, trick-play, pick-six, hail-mary, turnover-boost,
  unlock-carries-wipe) previously fell to the `else 9999` default, so
  `wallet_buy_powerup` rejected them as `'unknown powerup'` while the shop
  showed a price — the reactive/live toolkit was unbuyable in live leagues.
- **`scripts/check-powerup-prices.mjs`** now (a) parses the LATEST
  `powerup_price()` definition across migrations (create-or-replace semantics),
  and (b) fails on OMISSIONS in both directions — the class of bug above can't
  recur silently. All 24 in lockstep.
- **Late-swap copy**: rulebook §1 + intro and the FAQ now advertise per-window
  locks ("Sunday can answer what Thursday revealed"); rulebook HTML regenerated.
- **Ops**: sunday-ops-runbook's lock section documents the two-stage lock
  (`locked N matchups` at first kickoff, then `sealed N window picks` per
  window) and adds a per-window dress-rehearsal checklist — the simulator
  bulk-locks by design and never exercises the staged path.
- NOTE: several newly-buyable power-ups remain unmodeled by the live resolver
  (playtester findings §2 limitations) — buying works; effect coverage is the
  open thread.

## Per-window pick locks — "late swap" (v0.95.0)
Picks now seal **per window at that window's own first kickoff**, not all at
the week's first kickoff — the rulebook's "sealed until the window locks at
kickoff" is finally literal. A MNF pick stays editable (and hidden) through
Sunday; each window's reveal keeps riding the same `sealed_pick.locked` flag,
so the opponent reads a window exactly when it kicks off.
- **DB** (`0058_window_locks.sql`): `window_kickoff(week, win)` (min slate
  kickoff, scoped to the newest season carrying that week) + an
  `enforce_window_lock` trigger that rejects client pick writes into a
  kicked-off window — the worker sweep's tick cadence is never an integrity
  hole (no kickoff sniping). Service-role writes bypass (`auth.uid() is null`).
- **Worker** (`lock.js`/`index.js`): `lockDueMatchups` still flips status →
  live at `lock_at` but seals only due windows; new `lockDueWindows(week,
  winKicks)` sweeps each later window at its kickoff (winKicks derived from the
  tick's ESPN slate; unknown slate ⇒ seal-everything fallback).
  `materializeAutoLineups` writes future-window rows UNLOCKED so an AI/missed
  manager's later picks don't leak early (and a missed manager can still edit
  them).
- **Resolver** (`resolve.js`): `enrolledPicks` now distinguishes "has picks,
  none sealed yet" (⇒ `[]`, fields nothing until the window locks) from "no
  picks at all" (⇒ auto-lineup fallback) — without it, a real-but-unsealed
  week resolved as a phantom AI lineup between Thursday and the manager's
  first locked window. `prefetchTick` carries `hasPicks` alongside `picks`.
- **Client** (`LivePicks.tsx`/`liveApi.ts`): per-window lock gating
  (`winLocked` from server-sealed rows + slate kickoffs, 30s re-check; unknown
  kickoff after week start fails safe to locked), per-window 🔒/locks-at chips,
  SEAL visible until every window kicks off and filtering locked windows out
  of the upsert, extra-slot rows follow their chosen window's lock. `myPicks`
  returns `locked`; `liveSlate` season-scopes unscoped reads (a stale prior
  season's past kickoffs must never lock a current week).
- **Why**: this converts the week from one blind simultaneous move into a
  multi-street game — Sunday/MNF picks can react to revealed TNF/early
  results — the top recommendation of the design review (see session notes).
  Pre-match power-ups/extra slots still arm only before the week's first
  kickoff (status `scheduled` gate, unchanged). The sim harness
  (`simulate.js`) still bulk-locks — it dress-rehearses a whole live week.

## Add-a-league request path + Splash retired (v0.94.2)
- **"＋ add a league" now has a no-code path**: `RoleChooser` takes an
  optional `onRequest` third choice ("My league isn't in the pilot yet →")
  opening `RequestCodeModal`. Wired in BOTH RoleChooser mounts — the
  My-Leagues `add` view and the fresh-sign-in no-enrollments fork.
- **`Splash.tsx` is DELETED** — the `splash` route now renders `DemoBoard`
  (route id kept for history/deep-link compat), so every legacy
  `navigate({name:'splash'})` call site lands on the demo landing.
- **Sign-out lands on the demo landing** (both paths: the LiveOnboard header
  button and the SiteSettings gear — the gear now also clears `dripLive`,
  which it previously left set). Both call `markBootSessionChecked()` (new
  DemoBoard export) before navigating so the demo's one-shot boot session
  check can't race the async `signOut()` and bounce the user back to `live`.

## Demo UX fixes (v0.94.1)
- **End-card "More demo" is a real input now** — the focus-the-bottom-bar
  button (invisible feedback) is replaced by an inline Sleeper-username field
  + GO in the end card itself, sharing state with the persistent bottom bar.
- **↺ BACK TO START** header chip after FINAL (plus an end-card link) —
  full reset to a pristine step-① board (`backToStart`), unlike
  "change my lineup" which keeps the picks.
- **Signed-in players land on their leagues**: `DemoBoard` checks
  `getSession()` ONCE per app load (`bootSessionChecked` module flag) and
  navigates to `live` — covers the first OAuth redirect / magic-link-in-new-tab
  cases that beat the `dripLive` boot flag. The once-only guard keeps the
  back button from being hijacked on later demo visits.
- Dropped the CLEAN/REAL BOARD `DemoViewToggle` from the demo header
  (the toggle still exists on the board-demo surface for signed-in flows).

## Demo watch phase: expandable LOG & FIELD per duel (v0.94.0)
Every duel row on the demo board expands once its window kicks off: a
centered `▾ LOG & FIELD` chip under the row opens `DuelLog` (the GuidedDemo
two-sided play log — scoring plays, effects, 🗑️×2 buff notes, ◇ coin —
revealed to the window clock, auto-scrolling while live) plus
`SlotFieldViews` (the real board's drive charts, both players' games, own
⬢ FIELD collapse). Live windows sample at `wClock`, final windows at that
window's max clock, so logs/fields stay browsable after FINAL. The featured
(first-placed) duel's panel auto-opens at RUN (`openSlots` seeded in `run()`).
Sealed windows don't expand. Ops note: the v0.93.0 Pages deploy failed with a
transient GitHub "Deployment failed, try again later" AFTER a green build —
the token can't rerun Actions jobs (403), so the fix is the repo's usual
fresh-SHA-to-main re-trigger (v0.93.1 was exactly that).

## Demo landing sets up like the hero board (v0.93.0)
The demo landing's "pick your star" wizard is gone — setup is now the REAL
hero-board interaction, reusing the actual components (`SetupRow`,
`PlayerPicker`, `RosterAside`, `ScoutModal` — the latter two newly exported
from `Matchup.tsx`):
- **Both full rosters on display**: desktop shows the two roster rails
  (yours draggable, theirs sealed-pool view) flanking the board; narrow
  screens get the same rails as fluid toggle panels (opponent starts
  collapsed). Assigned players strike through, exactly like the hero board.
- **Drag or tap to field a player** (`assignFromRoster`/`assignToSlot` with
  top-down `compact`, mirroring Matchup's semantics), then **seal the hidden
  metric inline on the spot** (SetupRow's own "② PICK A METRIC ↓" list with
  ⓘ info cards). 🔍 SCOUT on sealed opponent boxes opens the real scout modal.
- **Guided prompt is state-derived, not a modal wizard**: ① build lineup →
  ② seal metric → ③ arm power-up (Garbage Time / EMP / Momentum) & RUN.
  `✦ AUTO-FILL` fills remaining spots from `defaultLineup` (dedup-aware);
  RUN requires ≥1 fully-sealed pick and auto-fills the rest. EMP targets the
  viewer's FIRST-placed player's window at a fixed halftime clock (1800s).
  "↩ change my lineup" on the end card hands the auto-filled board back as
  editable picks. Playout/watch phase unchanged from v0.92.0.
- Verified headlessly both ways: mobile tap flow (place → metric → scout →
  picker → auto-fill → run → FINAL → back to setup) and desktop HTML5
  drag-and-drop from the rail onto a spot.

## The demo IS the landing page (v0.92.0)
Logged-out onboarding collapsed to one screen: `src/screens/DemoBoard.tsx`
replaces `GuidedDemo.tsx` as the `demo` route's clean view AND becomes the boot
route for logged-out visitors (`store.tsx` initial route: dripLive → `live`,
remembered Sleeper user → `leagues`, else → `demo`; popstate fallback → `demo`).
- **One playable board, zero gate**: the Drip Test League **Week 2** matchup
  (`DEMO_WEEK = 2` in `config.ts` — Taco Time Titans vs Beach Day Ballers), a
  tight version of the hero board: all 5 windows with real slate times + game
  counts, both lineups (opponent picks render 🔒 SEALED until their window
  kicks off), metric chips, unopposed-backup teaching text.
- **Three guided decisions, everything else defaulted**: pick a star (best
  contested duel per position, top 3) → seal his hidden metric → arm a power-up
  (Garbage Time / EMP / Momentum) → `▶ RUN WEEK 2`. Playout is
  window-SEQUENCED (TNF → … → MNF, ~50s at 1×), narrated by `demoNarration`
  beats per live window, with `SlotFieldViews` under the featured duel and a
  score header that ticks live. Backup (unopposed) slots bank 0 during
  playout so the total never visibly drops when the engine zeroes them at
  FINAL. End card = result + bonuses + the two conversion CTAs.
- **Persistent CTAs per the onboarding spec**: a fixed bottom "MORE DEMO?"
  bar (Sleeper username → `leagues` flow, same logic as Splash), a standing
  "Request a code for your league" card (→ `RequestCodeModal`; the global
  `RequestCodeFab` is hidden on this screen), and small `sign in · FAQ` in the
  header + footer. `Splash.tsx` still exists (reachable) but is no longer the
  landing. New analytics: `demo_step` / `demo_run` (see analytics-plan.md).
- FAQ copy updated (demo opens Week 2, not Week 4). Verified end-to-end
  headlessly (vite preview + Chromium): land → 3 steps → run → FINAL
  100.8–36.3 → CTAs all functional.

## Field visuals in the demo flow + lean live board (v0.89.0)
- **Guided demo** (`GuidedDemo.tsx` watch step): `SlotFieldViews` renders the
  duel's live field(s) under the duel card, driven by the demo clock — both
  players' games, takeover/red-zone included. Intro narration points at it.
- **Lean pilot board** (`LiveBoard.tsx`): new "⬢ AROUND THE LEAGUE" collapsible
  card — every game the worker has plays for this week as a `FieldView` grid
  (clock = MAX → always the latest play). `weekGameFeeds` is fetched in the
  same refresh as scores/picks and installed via `setLiveGameFeed` (exclusive
  overlay, never baked data on a live board).
- Where visuals live on the live 2026 surfaces: the FULL matchup board
  (Matchup.tsx with liveCtx) has per-slot fields under LOG + the ▦ FIELDS
  all-games overlay with outcome tinting; the lean LiveBoard summary now has
  the around-the-league grid (no tinting — it has no engine events).

## Field visuals polish: outcome tinting, takeover, red zone (v0.88.0)
- **Outcome-based tinting** replaces participation tinting on the ▦ FIELDS
  board: `FieldBoardEntry.pids` now carries the plays a side actually BANKED on
  — built in `Matchup.tsx` from the slot event logs (`delta > 0` or an effect;
  denial effects nuke/erase/stop/reset/compression/cold log on the VICTIM's
  side, so their benefit flips to the opponent, whose player's play at that
  clock supplies the pid). Legend reads SCORED FOR YOU / FOR OPPONENT / BOTH.
- **Scoring takeover** (`Field`): big TOUCHDOWN/FIELD GOAL/SAFETY pop over the
  field (pure CSS `fvtakeover`, 2.8s, self-fading). Trigger is the most recent
  scoring play within the last 3 plays — the TD's XP + ensuing kickoff share
  its game-clock second, so requiring "latest play" would never fire. The
  scorer line derives the team from the SCORE DELTA, not `tm` (offense at
  snap), so pick-sixes/return TDs credit the right side.
- **Red-zone glow**: the attacked end zone pulses (`bpulse`) whenever the
  upcoming snap is inside the 20 (derived from the feed spot, no extra data).
- **Preseason**: verified end-to-end — the worker polls preseason as board
  weeks 101-103 into `game_feed`, the client live overlay is week-agnostic,
  and the board header reads "PRESEASON WK N" (`isPreseasonWeek`). Live-test
  the visuals in August before the regular season.

## Live game feeds — field visuals Phase B (v0.87.0)
The drive charts now light up on the LIVE pilot board, not just baked replays:
- **Adapter**: `gameToFeed(summary)` moved into `scripts/espn/espnAdapter.mjs`
  (shared by the baker and the worker; baker rebake byte-identical).
- **DB**: `game_feed` table (`0057_game_feed.sql`) — one row per game per week,
  `plays` jsonb = the GamePlay[] contract, whole-doc upsert per poll so ESPN
  mid-game revisions reconcile by replacement. Authed-read RLS like live_play.
  **Apply the migration before the worker ships.**
- **Worker**: `pollGame` also upserts the game's feed from the same summary
  (zero extra ESPN calls). The **simulator** time-releases baked
  `public/gamefeed/` docs as `game_id 'SIM:<key>'` on the same clock as the
  play feed (cleared on start + reset), so the dress rehearsal exercises the
  visuals end-to-end.
- **Client**: `gameFeed.ts` live overlay (`setLiveGameFeed`/`feedRowsToWeek`,
  exclusive per week like realPbp so 2026 week N never falls back to baked
  2025 week N — the board claims the slot with an empty overlay before the
  first fetch). The 15s liveCtx poll in `Matchup.tsx` installs plays + feeds
  together; ▦ FIELDS gates on `hasGameFeed(week)`.

## Field board + collapsible fields (v0.86.0)
- **Slot fields are collapsible**: `FieldCollapse` wraps `SlotFieldViews` and
  the backup `FieldView collapsible` mount — a centered `⬢ FIELD ▾/▴` chip
  (default open, per-slot state).
- **▦ FIELDS — the all-games board** (`FieldBoard`, `src/app/FieldView.tsx`):
  a full-screen overlay (live-phase header button, gated on `REAL_WEEKS`) with
  NOTHING but drive charts — every NFL game holding a slotted player, one
  `Field` each in a responsive grid, ESC/✕ to close. Entries are built in
  `Matchup.tsx` mirroring the slot rows' clock math (`effWinClock` +
  `clockAtRealTime` in wall modes), so the board matches the board rows.
- **You/opponent play tinting**: per game, pid→side sets are built from each
  slotted player's `realPbpFor` plays (pids are per-game, grouped per-game so
  no cross-game collisions). The shown play tints arc, marker ring, situation
  chip, text dot and card border — `--you` for your roster, `--opp` for the
  opponent's, `--warn` when both touch the same play (turnovers, K/DST).

## Play-by-play field visuals (v0.83.0)
Sleeper-style drive chart per NFL game on the live board (see
`docs/pbp-visuals-research.md` for the research + design):
- **Data**: `scripts/pbp/genGameFeed.mjs` bakes `public/gamefeed/wN.json` from
  ESPN summaries (cached in gitignored `scripts/pbp/espn-cache/`) — every
  scrimmage play with down/distance/start-end yards-to-endzone/possession/text/
  score (`GamePlay`, `src/data/gameFeed.ts`, lazy per-week loader). ESPN's
  numeric `yardsToEndzone` is FLIPPED on ~2.6% of plays (mostly punts); the
  baker derives it from `possessionText` instead (residual drive-continuity
  mismatches: 0.03%, all ESPN sequence oddities like overturned plays).
- **UI**: `src/app/FieldView.tsx` — SVG field (perspective tilt, yard lines,
  end zones, first-down line, ball marker w/ team logo + abbr fallback, play
  arc, situation chip, play text), driven by the same feed clock as the log
  (`plays.filter(c <= clock)`, marker/banner from the NEXT play's start spot —
  authoritative across penalties). `SlotFieldViews` renders ONE field when both
  slot players share an NFL game, else two (side-by-side desktop / stacked
  mobile). Mounted in `Matchup.tsx` above `TwoColLog` in both the H2H and
  backup/unopposed open blocks, gated on `slot.real`.
- Away team always attacks right (`x = away ? 100-yl : yl`) so the ball is
  continuous across possession changes. `fvdraw` keyframes in `styles.css`.
- Phase B (live): the poller's summary already carries `drives` — emit
  `gameToFeed` rows into a `game_feed` table and install like `setLivePlays`.

## Zero synthetic player data (v0.9.8.0)
All player production is now real 2025 nflverse PBP — the synthetic simulation
was removed from `src/engine/sim.ts`:
- Deleted `rng`, `sampleCount`, `spreadClocks`, `weekLine`, `WeekLine`, and
  `buildPlays` (the procedural per-game generator). `playsForPlayer` and the
  `teTdNukeClocks`/`defEarnScore`/`windowFgMult` call sites now use
  `realRawPlays(...) ?? []` — a real week with no baked entry for a player is a
  genuine DNP (zero), never fabricated. `real` flag = `REAL_WEEKS.has(week) ||
  !!r`, so the REAL PBP badge lights up.
- `projectedPoints` now returns a deterministic per-game projection from the
  player's REAL season totals (`p.stats`, from `statsRaw.ts` nflverse CSVs) — no
  RNG. Used only for default-lineup ranking + bye-steal flat score.
- Coverage check: of 184 rostered skill players, only `brandon-aiyuk`,
  `philip-rivers`, `deshaun-watson` never appear in any week (all genuinely did
  not play in 2025 → correctly zero). K & DST fully covered (31 each/week).
- The old hardcoded `47:12:00` "LOCKS IN" countdown is replaced by a real
  datetime: `weekLockLabel(week)` in `nflSlate.ts` returns the actual date + time
  one hour before the week's first game kicks off (e.g. "Thu, Sep 4 · 7:15 PM
  ET"), used in `Matchup`/`LeagueHub`/`LeagueOverview`. First game = earliest
  window with games (TNF); kickoff parsed from the window's `time` label.

## Real PBP enabled (v0.9.7.6) — was silently synthetic
`src/data/realWeeks.ts` had `REAL_WEEKS = new Set([])` even though
`public/pbp/w1–w14.json` (real 2025 nflverse play-by-play, with real game clock
`c`, real wall-clock `t`, and `play_id`) were committed. With the set empty the
loader never fetched them and the whole engine ran on `buildPlays` (synthetic).
Set to `{1..14}` so `realRawPlays` actually returns real plays (player ids are
`normName(name)`-slugs, matching the pbp keys). The re-bake generator
(`scripts/pbp/genRealPbp.mjs`) should populate this; it did not, so it's set by
hand for now. The log now prints **both** the game clock and the real wall-clock
time per event (`TwoColLog` `realOf`/`realOrder`).

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
- **Develop on:** a working branch, then open a PR to `main`.
- **Deploy:** merging to `main` publishes to GitHub Pages automatically
  (`.github/workflows/deploy.yml` triggers on every push to `main`).
  ```
  git push -u origin <your-branch>
  # open a PR and merge to main → Pages deploys automatically
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
- `src/data/metrics.ts`: `retyd` on WR + RB, a **drip** — return yards feed a
  `0.01/yd` rate that accrues over possession (3 returns of 10+ yds → hot, a
  short return cools). Wired through `dripKindOf(['return'])` in `sim.ts`.
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

## Playback clock modes (v0.9.7.5)
The live board's `⏱` button (by `RUN ALL`) cycles three playback clock modes,
held in `clockMode: 'game' | 'feed' | 'real'` on `Matchup`. Two axes are in
play: the **reveal** (which plays are visible now) and the **resolve/order**
(how the log orders+interleaves and how effects resolve):
- **GAME CLOCK** (`game`): lockstep game-clock reveal; log + effects on the game
  clock — the original behavior.
- **REAL FEED** (`feed`): real wall-clock **reveal** (each game runs at its own
  real pace via each play's baked `t`, so games desync), but the log still
  **orders/interleaves on the game clock** (game-clock stamps) and effects
  resolve on the game clock.
- **REAL CLOCK** (`real`): real reveal AND the log **orders/interleaves on the
  real clock** (wall-clock stamps via `fmtTimeShort`) and effects resolve in
  real-time order.

Wiring:
- `wallClock = clockMode !== 'game'` drives the real-time **reveal**:
  `winTarget = wallClock ? winRealMax : winMax` (ticker/seed/done/winLife);
  `winClocks[win]` is the window position (game secs, or real secs since kickoff).
  Per side, `clockAtRealTime(player, week, pos)` maps the window's real position
  back to that player's game clock; `ScoreRow` takes `youClock`/`theirClock`
  (banks, statline, log filter, coin all per-side). Totals sum each side at its
  own clock. Changing modes re-seeds positions to 0.
- `realClock = realResolve = clockMode === 'real'` drives **order + resolve**:
  passed to `ScoreRow.buildLog`, which (only in `real`) sorts each slot's log by
  per-event real time (`realTimeAt(sidePlayer, …)`) and stamps wall-clock time;
  `feed`/`game` keep the natural game-clock order. Same flag → `buildMatchup`:
  the only
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
