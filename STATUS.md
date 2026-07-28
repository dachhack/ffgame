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

2026-07-28 — Yahoo went live-ready: the approved app's key is wired into the Pages builds (PR #215; founder set the secrets + redirect URI). Lead alerting shipped: new `code_request` rows email the founder via a pg_net trigger → `lead-alert` Edge Function (migration 0091; needs its one-click function deploy). Pod/showdown deals now fueled by 2026 StatHead projections with 2025-actuals fallback — rookies dealable, offseason moves priced — and proj2026.ts re-baked at the new 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback: deeper pool, ids, as_of, injury-aware weekly + K/DST; weekly tool callable from the next session). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- Fly worker redeploy pending — pod/showdown roster dealing and league tossing don't run until the founder redeploys `server/` (sandbox can't reach Fly or Supabase).
- Live smoke test of `join_pod` / `join_weekly` needs a real signed-in session on prod (same sandbox egress limitation).

## Next 3 tasks

1. Founder ops pass: redeploy the Fly worker + one-click deploy `lead-alert`, then smoke-test live — solo paths (fresh account → Play solo / This week's showdown → dealt roster + matchup), one lead end-to-end, and the first real Yahoo league connect (the JSON mapping has never seen live Fantasy data).
2. Repoint the demo's post-run CTA at solo play (pod/showdown) instead of "request a code" — align the ad → demo → playing-user funnel with the new solo paths.
3. Weekly showdown re-engagement email ("Week N is open — defend your crown") — the recruit→crown→toss loop has no delivery channel yet; can reuse lead-alert's Gmail machinery.
