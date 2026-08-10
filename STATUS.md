# STATUS

> Orchestrator-facing status. Keep this short and current — `meta`'s
> `/standup` reads it. In-repo WIP details belong in HANDOFF.md.
> Goal / Phase / Cadence are mirrored into `meta/projects.md`.

## Goal

Drip Fantasy (dripfantasy.com): a live head-to-head fantasy football game where lineups play out as real-time battles — drips, nukes, power-ups — on top of real NFL play-by-play. Enter the 2026 NFL season (first lock Sep 9) with pilot leagues, solo/DFS-style play, and a small paid-ads funnel that converts.

## Current phase

Pre-season pilot hardening + acquisition: engine and league infra are launch-ready; current work is solo onboarding (public pods, weekly showdowns), drama presentation, and the Reddit-ads funnel with attribution.

## Cadence

Near-daily (git shows daily bursts; season launch Sep 9 is the forcing function).

## Last worked (superseded entries below)

2026-08-09 — **Preseason practice for playtesters** (0110). Preseason play existed since 0054/0101 but was super-admin-only and not actually throwaway: practice results counted in the standings AND the playoff seeding, practice coin banked into the real wallet, practice power-ups charged that wallet and moved real inventory, and the weekly budget could be granted for a preseason week. All four sealed server-side behind one rule — *a practice week never moves real coin, real inventory, or a real record* — with power-ups made free (not refused) so a broke team can still exercise the board. Opening practice is now a commissioner's ONE click (`enablePreseasonPractice` = turn on + seed all three weeks' deep pools), replacing two admin buttons that had to be pressed in order and re-pressed after every re-toggle. Also revoked `_clone_preseason_weeks` from PUBLIC (SECURITY DEFINER, any signed-in user could wipe another league's preseason weeks). New probe suite green on a clean scratch DB; the probe runner itself was dying at 0091 for want of `pg_net`, so everything after it had gone unchecked.

2026-08-08 — **Window Pot v1 built, flagged OFF** (`v0.140.0`): an OPT-IN wager ladder on any game window. One manager puts ◎10 up, the other matches it or ignores it; if matched they trade check/wager/call/raise in strict turn until that window's PICKS lock, and the winner of the window takes the pot. Backing out costs exactly the ante and returns every wagered chip; an unmatched offer voids and an unanswered wager comes home, so silence is never punished. Designed and built twice the same day — the first pass followed the original spec (automatic ◎5 ante at lock, post-lock betting, hidden auto-call policy, quiet-hours clocks) and the founder inverted it to opt-in/pre-lock, which deleted the policy and the clocks outright. Migration `0117_window_pot.sql` is the authority — advisory-locked turn-gated RPCs, RLS member-read + RPC-only writes, every wallet move idempotent; the betting deadline is literally the `enforce_window_lock` expression so it can't drift from picks lock. Worker sweep in `server/src/pot.js` closes pots at the deadline and settles at the window's final; the client chip + action sheet live on the window section (`src/screens/WindowPot.tsx`) because the ladder is played during setup. Ships OFF everywhere behind a per-league super-admin toggle (AdminPage → ADMIN MODES → 🪙 window pot, with a `tune` for the ante/cap and a `⟲ void N open` escape hatch that refunds every chip); turning it off never strands coin — pots already running still close and settle themselves. Every §6 scenario asserted in `scripts/db/window-pot-probes.sql`; the scratch-probe harness was repaired on the way (pg_net stub, two stale gate assertions) and is green. Coin in, coin out — a pot never moves a point.

2026-08-07 — **First live-fire complete** (preseason CAR@ARI): the full loop — seal, 1h-lead lock, per-window reveal, live ESPN ingest, resolve, effects, window bonus, coin payout — ran end to end on a real NFL game, final 40.0–23.0. Nine live-found defects fixed the same night (PRs #254–#263; the standouts: the pick-cache clobber that could overwrite sealed picks, and ESPN's halftime drive restructuring silently freezing `live_play` via duplicate-key batch rejection — full detail in HANDOFF "First live-fire"). Field visuals overhauled (team-colored end zones, possession logos, TV-flip, YAC + return-split play rendering, window game log). Yahoo developer app APPROVED and `yahoo-oauth` deployed — remaining: `VITE_YAHOO_CLIENT_ID` repo variable + redirect-URI fix, then a first real league connect. New feature spec'd and ready to build: **the Window Pot** (`docs/window-pot.md` + kickoff prompt), v1 behind a per-league flag.

## Previous

2026-07-28 — Access model shipped (0094/0095): standalone solo play (pods/showdowns) is a per-account feature the founder flips (AdminPage FEATURE FLAGS); DFS leagues are commissioner-run — founder approves commissioners (`dfs_commish` flag), they found private DFS leagues (kind='dfs', same salary-board machinery) and distribute invite codes (the invite is the access); drafted-on-site native leagues (incl. mocks) moved off the admin-only "closed testing" gate onto the same model (`native` flag). Earlier: DFS-style team building shipped for pods + showdowns (0092): players build a 9-man squad under a $50k salary cap from a weekly-frozen salary board (weekly projections → salaries; source chain StatHead-weekly-bake → Sleeper live weekly → StatHead season → 2025 actuals); AI seats and no-show humans get a seeded auto-build; random deal removed. Per-game late swap (0093): each player locks 1h before HIS kickoff — frozen picks can't leave the entry, locked games can't be added, everything else swaps through Monday night. Earlier same day: Yahoo live-ready (PR #215), lead alerting (0091, needs one-click function deploy), proj2026.ts re-baked at 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback incl. injury-aware weekly + K/DST). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- Preseason practice (0110) is on the branch, not live: the migrate workflow only runs on push to `main` (`paths: supabase/migrations/**`), and the same `fly deploy` below carries `resolve.js`'s practice-week coin skip. Until both land, the RPC guards aren't in the DB and practice coin would still bank.
- `fly deploy` of the worker pending — carries #262's `ret` emission for live game feeds, the practice-week coin skip above, AND the Window Pot's sweep. Do before the Aug 13 preseason slate, which is the validation run for all the live-fire fixes and the pot's live-fire.
- Yahoo activation: set the `VITE_YAHOO_CLIENT_ID` repo VARIABLE (+ site rebuild) and fix the Yahoo console redirect URI (`https://dripfantasy.com/` + www — currently the httpbin placeholder); then the first real league connect (JSON mapping unvalidated against live Fantasy data).

## Next 3 tasks

1. **Live-fire the Window Pot** on the Aug 13 slate: `fly deploy` the worker, then flip the two-account test league on from the admin page and walk all five outcomes across the six-window preseason slate — an offer matched and laddered to the cap, one backed out of (costs exactly ◎10), one wager left unanswered (returns at picks lock), one offer left unmatched (voids), and one window finished + re-resolved twice to prove the pot pays once. Spec §12 has the flag-flip procedure.
2. Aug 13 preseason slate = regression run for the nine live-fire fixes (lock lead, dedupe ingest, state-driven FINAL, feed-anchored clocks) + first `ret`/`yac` splits on live data. Watch `fly logs` for the new loud `poll game` errors.
3. Yahoo end-to-end (variable + redirect URI + first league connect), then update the FAQ's "Yahoo landing next" line to fully supported. Carried: showdown re-engagement email; DFS commissioner + solo flag approvals.
