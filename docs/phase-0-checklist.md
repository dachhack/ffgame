# Phase 0 checklist — deploy + prove + gate (2026 pilot)

_Tracks the work in §2 of `docs/scale-2026-2027-plan.md`. Phase 0 makes the
**August preseason live-fire** trustworthy — that's the linchpin. ~3–4 focused
weeks; the load test (2b) is the long pole. Tick boxes as they land; the
`exit criteria` block at the bottom gates Phase 1._

> Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.
> Can't be run from the Claude sandbox (no `*.supabase.co` egress) — run on a
> normal network or the deployed worker. Sandbox can still build, syntax-check,
> and run the offline `validate`/`simulate --dry` gates.

## 2a · Deploy the worker to Fly  ✅ DONE + verified (2026-06-27)
- [x] **Rotated** the service-role key (twice — see note). GitHub secret updated
      + verified green; Fly secret set. _(A further rotation is pending: the key
      was visible in a deploy screenshot — re-rotate + update GitHub + Fly when done.)_
- [x] `fly auth login`; app `drip-pilot-worker` created (iad / us-east-1).
- [x] `fly secrets set SUPABASE_URL … SUPABASE_SERVICE_ROLE_KEY …`.
- [x] Deployed (`fly deploy`); machine `e82e9e0b600668` running.
- [x] Scheduler verified in `fly logs`: `player index built: 12200 players` →
      `injuries 140` → `resolved 6 / 6 matchups` every ~25s. Full pipeline
      (query → prefetch → resolve → write) live against the DB. No live scoring
      (offseason) — expected.
- [x] Dockerfile now also bundles `public/pbp`, `server/scripts`, `server/test`,
      so the on-worker dress rehearsal (`fly ssh … simulate`), `npm run smoke`,
      and the 2b scale re-run (`loadtest.mjs`) work in the deployed image.
- [ ] **Re-deploy from this branch** before the 2b load-test re-run: the running
      image predates the Dockerfile fix above (the secrets-set restart reused the
      same image sha), so it lacks `public/pbp` + `server/scripts`. `fly deploy`.

## 2b · Load-test at 100-league scale, offline  _(1–2 weeks — long pole)_
Proves the bottleneck `supabase/migrations/0034_scale_index.sql` was written for,
with no live games, via the **real** `resolveMatchup` sweep.
- [x] Seed: `npx tsx scripts/loadtest.mjs seed --leagues=100 --teams=12 --week=99`
      (100 leagues / 600 AI-vs-AI live matchups + one baked week of plays).
- [x] Run: `npx tsx scripts/loadtest.mjs run --week=99 --iters=5` — reports the
      indexed matchup-scan time, per-tick resolve-sweep p50/p95/max, and headroom
      vs the 25s `PLAYS_POLL_MS` tick budget.
- [x] Tear down: `npx tsx scripts/loadtest.mjs reset`.
- [ ] **Re-run from the deployed Fly worker** (`fly ssh console`) for the TRUE
      number — the run below was from a remote sandbox across the internet; the
      worker is co-located with the DB (iad = us-east-1). _This is the real exit
      measurement for this item._
- [ ] Keep the offline feed gates green in CI: `npm run validate` (ESPN adapter)
      and `simulate --dry` round-trip + reconciliation (`validate-feed.yml`).
- [ ] _Refinement:_ load-test lineups are skill-only; add K/DST to exercise the
      banker/suppress paths if their cost looks material.

### Result — first run (2026-06-27, from a remote sandbox)
600 matchups, 5 sweeps. **The `0034` index is vindicated** — the matchup scan is
~100–300 ms, negligible. The cost is **per-matchup DB round-trips** in
`resolveMatchup` (~6 sequential reads each), not CPU or the scan.

| concurrency | sweep p50 | worst | % of 25 s budget |
|---|---|---|---|
| chunk=20 | 15.8 s | 17.8 s | 71 % ⚠ |
| chunk=60 | 12.1 s (warm 10.3 s) | 15.2 s | 61 % ⚠ |

⚠ **TIGHT from here, but the number is pessimistic:** every round-trip paid full
internet RTT (sandbox → proxy → Supabase us-east-1). The production worker runs in
`iad` (same region as the DB), where RTT is ~1–5 ms instead of tens — and since
the bottleneck is round-trip-bound, the co-located sweep should be **multiples
faster → comfortable PASS at 100 leagues**. Raising concurrency helped (20→60
cut ~30 %), confirming it's latency-bound. **Optimization landed:** bulk-prefetch
of the per-tick reads (see plan §4 + `server/src/resolve.js:prefetchTick`),
collapsing ~3,600 reads/tick into ~5. Re-measure from the worker to confirm.

## 2c · Close the signup gate  _(DECISION: gate by leagues, not emails)_
- [x] **Resolved:** access is gated by the **~100 invited leagues**, not a
      per-account email allowlist. Invite codes already gate league entry, and a
      tester is only useful inside an enrolled league — so capping enrolled
      leagues at ~100 caps the pilot population. No email-allowlist migration.
- [ ] Operational cap: don't `sync` more than ~100 leagues (worker
      `PILOT_LEAGUE_IDS` / admin imports) — the only thing to watch.

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
