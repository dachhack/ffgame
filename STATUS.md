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

2026-07-28 — Yahoo went live-ready: the approved app's key is wired into the Pages builds (PR #215; founder set the secrets + redirect URI). Lead alerting built: new `code_request` rows now email the founder via a pg_net trigger → `lead-alert` Edge Function (migration 0091; function needs a one-time deploy via the Deploy Edge Functions workflow).

## Current blockers

- Fly worker redeploy pending — pod/showdown roster dealing and league tossing don't run until the founder redeploys `server/` (sandbox can't reach Fly or Supabase).
- Live smoke test of `join_pod` / `join_weekly` needs a real signed-in session on prod (same sandbox egress limitation).

## Next 3 tasks

1. Redeploy the Fly worker, then smoke-test the solo paths live: fresh account → Play solo / This week's showdown → dealt roster + matchup appear.
2. Deploy the `lead-alert` function + smoke-test one live lead end-to-end; validate the first real Yahoo league connect (the JSON mapping has never seen live Fantasy data).
3. Bar mode (DFS path step 3): same-room group play — design scope against the pod/showdown infra.
