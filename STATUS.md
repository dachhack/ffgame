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

2026-07-21 — Shipped public drop-in pods (solo-joinable, AI-filled leagues; PR #212) and weekly showdowns (one-week contests: recruit → crown → toss; PR #213). Migrations 0089/0090 applied; both need a Fly worker redeploy to go live.

## Current blockers

- Fly worker redeploy pending — pod/showdown roster dealing and league tossing don't run until the founder redeploys `server/` (sandbox can't reach Fly or Supabase).
- Live smoke test of `join_pod` / `join_weekly` needs a real signed-in session on prod (same sandbox egress limitation).

## Next 3 tasks

1. Redeploy the Fly worker, then smoke-test the solo paths live: fresh account → Play solo / This week's showdown → dealt roster + matchup appear.
2. Lead alerting for `code_request` rows (Reddit-ad leads currently sit unnoticed in the admin table; no email/notification on new leads).
3. Bar mode (DFS path step 3): same-room group play — design scope against the pod/showdown infra.
