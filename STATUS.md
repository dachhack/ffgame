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

2026-08-07 — **First live-fire complete** (preseason CAR@ARI): the full loop — seal, 1h-lead lock, per-window reveal, live ESPN ingest, resolve, effects, window bonus, coin payout — ran end to end on a real NFL game, final 40.0–23.0. Nine live-found defects fixed the same night (PRs #254–#263; the standouts: the pick-cache clobber that could overwrite sealed picks, and ESPN's halftime drive restructuring silently freezing `live_play` via duplicate-key batch rejection — full detail in HANDOFF "First live-fire"). Field visuals overhauled (team-colored end zones, possession logos, TV-flip, YAC + return-split play rendering, window game log). Yahoo developer app APPROVED and `yahoo-oauth` deployed — remaining: `VITE_YAHOO_CLIENT_ID` repo variable + redirect-URI fix, then a first real league connect. New feature spec'd and ready to build: **the Window Pot** (`docs/window-pot.md` + kickoff prompt), v1 behind a per-league flag.

## Previous

2026-07-28 — Access model shipped (0094/0095): standalone solo play (pods/showdowns) is a per-account feature the founder flips (AdminPage FEATURE FLAGS); DFS leagues are commissioner-run — founder approves commissioners (`dfs_commish` flag), they found private DFS leagues (kind='dfs', same salary-board machinery) and distribute invite codes (the invite is the access); drafted-on-site native leagues (incl. mocks) moved off the admin-only "closed testing" gate onto the same model (`native` flag). Earlier: DFS-style team building shipped for pods + showdowns (0092): players build a 9-man squad under a $50k salary cap from a weekly-frozen salary board (weekly projections → salaries; source chain StatHead-weekly-bake → Sleeper live weekly → StatHead season → 2025 actuals); AI seats and no-show humans get a seeded auto-build; random deal removed. Per-game late swap (0093): each player locks 1h before HIS kickoff — frozen picks can't leave the entry, locked games can't be added, everything else swaps through Monday night. Earlier same day: Yahoo live-ready (PR #215), lead alerting (0091, needs one-click function deploy), proj2026.ts re-baked at 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback incl. injury-aware weekly + K/DST). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- Preseason practice (0110) is on the branch, not live: the migrate workflow only runs on push to `main` (`paths: supabase/migrations/**`), and the same `fly deploy` below carries `resolve.js`'s practice-week coin skip. Until both land, the RPC guards aren't in the DB and practice coin would still bank.
- `fly deploy` of the worker pending (picks up #262's `ret` emission for live game feeds) — do before the Aug 13 preseason slate, which is the validation run for all the live-fire fixes.
- Yahoo activation: set the `VITE_YAHOO_CLIENT_ID` repo VARIABLE (+ site rebuild) and fix the Yahoo console redirect URI (`https://dripfantasy.com/` + www — currently the httpbin placeholder); then the first real league connect (JSON mapping unvalidated against live Fantasy data).

## Next 3 tasks

1. **Build the Window Pot v1** (fresh session — `docs/window-pot-kickoff-prompt.md`): ante + blind street + standing auto-call policy + settlement, feature-flagged OFF per league (`pot_ante = 0`); flip on for the test league before Aug 13 and live-fire it on that slate.
2. Aug 13 preseason slate = regression run for the nine live-fire fixes (lock lead, dedupe ingest, state-driven FINAL, feed-anchored clocks) + first `ret`/`yac` splits on live data. Watch `fly logs` for the new loud `poll game` errors.
3. Yahoo end-to-end (variable + redirect URI + first league connect), then update the FAQ's "Yahoo landing next" line to fully supported. Carried: showdown re-engagement email; DFS commissioner + solo flag approvals.
