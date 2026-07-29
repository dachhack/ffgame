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

## Last worked

2026-07-28 — Access model shipped (0094): standalone solo play (pods/showdowns) is now a per-account feature the founder flips (AdminPage FEATURE FLAGS); DFS leagues are commissioner-run — founder approves commissioners (`dfs_commish` flag), they found private DFS leagues (kind='dfs', same salary-board machinery) and distribute invite codes; the invite is the access. Earlier: DFS-style team building shipped for pods + showdowns (0092): players build a 9-man squad under a $50k salary cap from a weekly-frozen salary board (weekly projections → salaries; source chain StatHead-weekly-bake → Sleeper live weekly → StatHead season → 2025 actuals); AI seats and no-show humans get a seeded auto-build; random deal removed. Per-game late swap (0093): each player locks 1h before HIS kickoff — frozen picks can't leave the entry, locked games can't be added, everything else swaps through Monday night. Earlier same day: Yahoo live-ready (PR #215), lead alerting (0091, needs one-click function deploy), proj2026.ts re-baked at 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback incl. injury-aware weekly + K/DST). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- Fly worker redeploy pending — pod/showdown roster dealing and league tossing don't run until the founder redeploys `server/` (sandbox can't reach Fly or Supabase).
- Live smoke test of `join_pod` / `join_weekly` needs a real signed-in session on prod (same sandbox egress limitation).

## Next 3 tasks

1. Founder ops pass: redeploy the Fly worker + one-click deploy `lead-alert`, then smoke-test live — solo paths (fresh account → Play solo / This week's showdown → BUILD YOUR SQUAD under the $50k cap → entry saves), one lead end-to-end, and the first real Yahoo league connect (the JSON mapping has never seen live Fantasy data). Also: start a fresh Claude session to bake StatHead weekly projections (this session's tool registry predates get_weekly_projections) — the worker auto-consumes server/data/statheadWeekly2026.json once it lands.
2. Weekly showdown re-engagement email ("Week N is open — defend your crown") — the recruit→crown→toss loop has no delivery channel yet; can reuse lead-alert's Gmail machinery.
3. Approve the first DFS commissioners (AdminPage → USERS → FEATURE FLAGS: `dfs_commish`) and flag early solo testers (`solo`) — solo play + DFS creation are now invite-only (0094). Demo CTA stays request-a-code (public solo funnel is gated, so no repoint needed).
