# Phase 0 checklist — deploy + prove + gate (2026 pilot)

_Tracks the work in §2 of `docs/scale-2026-2027-plan.md`. Phase 0 makes the
**August preseason live-fire** trustworthy — that's the linchpin. ~3–4 focused
weeks; the load test (2b) is the long pole. Tick boxes as they land; the
`exit criteria` block at the bottom gates Phase 1._

> Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.
> Can't be run from the Claude sandbox (no `*.supabase.co` egress) — run on a
> normal network or the deployed worker. Sandbox can still build, syntax-check,
> and run the offline `validate`/`simulate --dry` gates.

## 2a · Deploy the worker to Fly  _(days — the blocker)_
- [ ] **Rotate the Supabase service-role key** (Supabase → Project Settings →
      API). The old one was shared in chat during setup — rotate before it ever
      ships. _(`docs/pilot-handoff.md` flags this.)_
- [ ] `fly auth login`; create the app if needed (`drip-pilot-worker`).
- [ ] `fly secrets set SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=<rotated>`
      (+ optional `PILOT_LEAGUE_IDS` for the weekly auto-sync loop).
- [ ] Deploy from the repo root: **`server/scripts/deploy.sh`** (wraps
      `server/DEPLOY.md` with preflight + the rotation reminder).
- [ ] Confirm the scheduler ticks in `fly logs` (player index → injuries → lock →
      poll → resolve). Offseason caveat: no live scoring until preseason.

## 2b · Load-test at 100-league scale, offline  _(1–2 weeks — long pole)_
Proves the bottleneck `supabase/migrations/0034_scale_index.sql` was written for,
with no live games, via the **real** `resolveMatchup` sweep.
- [ ] Seed: `npx tsx scripts/loadtest.mjs seed --leagues=100 --teams=12 --week=1`
      (100 leagues / 600 AI-vs-AI live matchups + one baked week of plays).
- [ ] Run: `npx tsx scripts/loadtest.mjs run --week=1 --iters=5` — reports the
      indexed matchup-scan time, per-tick resolve-sweep p50/p95/max, and headroom
      vs the 25s `PLAYS_POLL_MS` tick budget.
- [ ] Verify the sweep stays **well under** the tick budget; watch Supabase
      connection-pool limits + Realtime fan-out at ~600 matchups.
- [ ] If TIGHT/FAIL: bump `fly.toml` memory, raise `PLAYS_POLL_MS`, or shard the
      poll loop (decision point, not a rewrite — see plan §4).
- [ ] Tear down: `npx tsx scripts/loadtest.mjs reset`.
- [ ] Keep the offline feed gates green in CI: `npm run validate` (ESPN adapter)
      and `simulate --dry` round-trip + reconciliation (`validate-feed.yml`).
- [ ] _Refinement:_ load-test lineups are skill-only; add K/DST to exercise the
      banker/suppress paths if their cost looks material.

## 2c · Close the signup gate  _(days)_
- [ ] Add the **email-allowlist / closed-signup** check so only approved emails
      can create an account (invite codes already gate *league* entry, not account
      creation). New RPC/table + a check in `LiveOnboard.tsx` /
      `liveApi.ts`; ship as a `supabase/migrations/00NN_*.sql` (auto-applies on
      push). _(Listed open in `docs/pilot-handoff.md`.)_

## 2d · Observability + ops runbook  _(days, parallel to 2b)_
- [ ] Error alerting on the worker (failed polls, resolve exceptions, stuck
      locks) beyond `fly logs`.
- [ ] Wire an on-call health view onto the existing pilot-ops RPCs
      (`supabase/migrations/0021_pilot_ops.sql`: pick-readiness / system-health).
- [ ] Write the weekly Sunday ops runbook: when `sync` / `sync-week` run, how to
      confirm lock, what to watch live. Note the `sync.yml` / `simulate.yml`
      GitHub Actions run ops without local creds.
- [ ] Decide: enable the built-but-not-defaulted weekly auto-sync
      (`SYNC_CHECK_MS` / `WEEKLY_SYNC_MS` in `server/src/config.js`) vs. running
      `sync-week` manually each week.

## Exit criteria → unlocks Phase 1 (preseason live-fire)
- [ ] Worker live on Fly, scheduler ticking, **service-role key rotated**.
- [ ] 100-league / 600-matchup offline sweep sustains the 25s cadence with
      headroom; no index or pool regressions.
- [ ] Closed-signup allowlist enforced.
- [ ] Alerting + a one-page Sunday ops runbook exist.
- [ ] Green light to point the worker at **real ESPN in preseason**
      (`PILOT_SEASON_TYPE=1`).
