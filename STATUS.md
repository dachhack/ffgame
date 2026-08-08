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

2026-08-08 — **Window Pot v1 built, flagged OFF** (`v0.140.0`): poker-style ante/raise/call on every game window, one pot per (matchup, window), between the two managers of a matchup. Scope is ante + blind street + standing auto-call policy + settlement (spec scenarios S1–S9, S11–S15); reveal/live streets and the AI bidding personality stay v2/v3 with the seams left in. Migration `0106_window_pot.sql` is the authority — advisory-locked RPCs, RLS member-read + RPC-only writes, every wallet move through `spend_from_wallet`/`credit_wallet` with idem keys, so the worker's 25s re-resolve and restarts replay as no-ops. Worker hooks in `server/src/pot.js` (ante at lock, sweep each tick after resolve); client pot chip + action sheet in `src/screens/WindowPot.tsx`. Ships with `league.pot_ante = 0` everywhere — flipped on by hand per league from SQL. Every in-scope §6 scenario is asserted in `scripts/db/window-pot-probes.sql`; the scratch-probe harness was repaired on the way (pg_net stub, two stale gate assertions) and is green. Coin in, coin out — a pot never moves a point.

2026-08-07 — **First live-fire complete** (preseason CAR@ARI): the full loop — seal, 1h-lead lock, per-window reveal, live ESPN ingest, resolve, effects, window bonus, coin payout — ran end to end on a real NFL game, final 40.0–23.0. Nine live-found defects fixed the same night (PRs #254–#263; the standouts: the pick-cache clobber that could overwrite sealed picks, and ESPN's halftime drive restructuring silently freezing `live_play` via duplicate-key batch rejection — full detail in HANDOFF "First live-fire"). Field visuals overhauled (team-colored end zones, possession logos, TV-flip, YAC + return-split play rendering, window game log). Yahoo developer app APPROVED and `yahoo-oauth` deployed — remaining: `VITE_YAHOO_CLIENT_ID` repo variable + redirect-URI fix, then a first real league connect. New feature spec'd and ready to build: **the Window Pot** (`docs/window-pot.md` + kickoff prompt), v1 behind a per-league flag.

## Previous

2026-07-28 — Access model shipped (0094/0095): standalone solo play (pods/showdowns) is a per-account feature the founder flips (AdminPage FEATURE FLAGS); DFS leagues are commissioner-run — founder approves commissioners (`dfs_commish` flag), they found private DFS leagues (kind='dfs', same salary-board machinery) and distribute invite codes (the invite is the access); drafted-on-site native leagues (incl. mocks) moved off the admin-only "closed testing" gate onto the same model (`native` flag). Earlier: DFS-style team building shipped for pods + showdowns (0092): players build a 9-man squad under a $50k salary cap from a weekly-frozen salary board (weekly projections → salaries; source chain StatHead-weekly-bake → Sleeper live weekly → StatHead season → 2025 actuals); AI seats and no-show humans get a seeded auto-build; random deal removed. Per-game late swap (0093): each player locks 1h before HIS kickoff — frozen picks can't leave the entry, locked games can't be added, everything else swaps through Monday night. Earlier same day: Yahoo live-ready (PR #215), lead alerting (0091, needs one-click function deploy), proj2026.ts re-baked at 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback incl. injury-aware weekly + K/DST). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- `fly deploy` of the worker pending — now carries BOTH #262's `ret` emission for live game feeds and the Window Pot's ante/sweep hooks. Do before the Aug 13 preseason slate, which is the validation run for all the live-fire fixes and the pot's live-fire.
- Yahoo activation: set the `VITE_YAHOO_CLIENT_ID` repo VARIABLE (+ site rebuild) and fix the Yahoo console redirect URI (`https://dripfantasy.com/` + www — currently the httpbin placeholder); then the first real league connect (JSON mapping unvalidated against live Fantasy data).

## Next 3 tasks

1. **Live-fire the Window Pot** on the Aug 13 slate: `fly deploy` the worker, then `update league set pot_ante = 5` on the two-account test league and walk the definition of done — antes at lock, a blind-street raise, a policy auto-call, a beyond-policy raise left to its quiet-hours clock, a fold settling instantly, and one window finished + re-resolved twice to prove the pot pays exactly once. Spec §12 has the flag-flip procedure.
2. Aug 13 preseason slate = regression run for the nine live-fire fixes (lock lead, dedupe ingest, state-driven FINAL, feed-anchored clocks) + first `ret`/`yac` splits on live data. Watch `fly logs` for the new loud `poll game` errors.
3. Yahoo end-to-end (variable + redirect URI + first league connect), then update the FAQ's "Yahoo landing next" line to fully supported. Carried: showdown re-engagement email; DFS commissioner + solo flag approvals.
