# Scale plan — 2026 100-league pilot → 2027 commercial launch

_Strategy + timeline review. Pairs with `docs/pilot-2026-plan.md` (the original
near-live H2H plan), `docs/pilot-handoff.md` (what's built), `server/DEPLOY.md`
(worker deploy), and `supabase/README.md`. Written against the repo at `v0.81.0`._

## 0. Where we actually are (the starting line)

The top-level `README.md` still frames live H2H as "Phase 2 — future." That is
stale. A **full closed-pilot product already exists and is mobile-tested end to
end** — everything except the live worker running on a real NFL Sunday:

- **Supabase Pro** project `dripff`: schema + **RLS-sealed picks** + Auth
  (Google / email+password / magic-link OTP) + Realtime, on
  `auth.dripfantasy.com`, with an auto-migrate pipeline (33 migrations applied).
- **Player / commissioner / admin** flows built: invite redemption, slate-gated
  sealed lineups, live board, commish dashboard, admin force-resolve from baked
  2025 data.
- **ESPN→RealPlay adapter validated at 99.58%** attribution across all 14 weeks
  of 2025, behind a CI pass/fail gate (`scripts/espn/validate.mjs`).
- **Server worker** (`server/`): Sleeper sync, ESPN pollers
  (scoreboard / plays / injuries), lock/reveal, server-authoritative resolve via
  the *same* engine the client runs — smoke-tested, with a full offline
  "simulate the ESPN feed" dress-rehearsal harness.
- Scale was already anticipated: `supabase/migrations/0034_scale_index.sql` is
  commented _"Matters at ~100 leagues / ~600 matchups polled every tick."_

**The one thing not yet done:** the worker has **never run against a real NFL
Sunday**, and it isn't deployed. From here, reaching 100 leagues is a
**scale + ops + go-to-market** problem, not a build-the-product problem.

## 1. The 2026 100-league pilot — timeline

Anchor dates: today ≈ **late June 2026**; NFL **Week 1 ≈ Sept 10, 2026**
(~10–11 weeks out); **preseason ≈ August 2026**.

**Critical insight:** preseason is the *only* window to validate the live worker
against a real ESPN feed before games count. The whole timeline keys off it.

| Phase | Window | Goal | Headline work |
|---|---|---|---|
| **0 · Harden + scale** | Now → late July | Worker deployed; proven at 100-league scale *offline* | See §2 (detailed) |
| **1 · Live-fire** | August (preseason) | First-ever run on a **real ESPN feed** | Worker on live preseason games (`PILOT_SEASON_TYPE=1`) with 3–5 friendly leagues; shake out feed latency, lock timing, injury cadence, reconnection |
| **2 · Controlled ramp** | Sept W1–W3 | Don't open all 100 at once | Onboard in waves — ~10 leagues W1, ~40 W2, ~100 by W3–4 — so the first *regular-season* Sunday is small and recoverable |
| **3 · Run the pilot** | Sept → Jan (W4–18) | 100 leagues live, weekly | Ops cadence (sync/lock/monitor), support channel, structured feedback + retention/engagement metrics to inform the 2027 go/no-go |

**Scale reality at 100 leagues:** ~1,000 users, ~600 matchups. Infra cost stays
small (~$30–60/mo: Supabase Pro + one small Fly worker). The single-worker poller
is adequate here; it becomes the bottleneck only *beyond* the pilot (see §4).

## 2. Phase 0 — what it takes (detailed)

The product is built, so Phase 0 is deploy + prove + gate, not new features.
Roughly **3–4 focused weeks**, mostly sequential on the load-test result.

### 2a. Deploy the worker to Fly (days)
The blocker. Artifacts are ready (`Dockerfile`, `fly.toml`, `server/DEPLOY.md`).

- `fly apps create`, `fly deploy` from repo root (build context needs
  `src/` + `scripts/` + `server/`).
- **Rotate the Supabase service-role key first** (flagged in `pilot-handoff.md`
  as shared in chat during setup) and set it as a Fly secret — never in git.
- Confirm the scheduler ticks via `fly logs` (injuries → lock → plays → resolve).
- Offseason caveat: with no live games, this initially exercises only the injury
  feed, scoreboard, lock/reveal, and the data model — not live scoring.

### 2b. Load-test at 100-league scale, offline (1–2 weeks — the long pole)
We can prove scale *without* live games using the simulate harness, which drips
baked 2025 plays into `live_play` and re-resolves each tick exactly as ESPN would.

- Seed ~100 leagues / ~600 matchups (`server/scripts/gen-fake-league.mjs` +
  `sync`), then drive concurrent `simulate` runs.
- Verify the **per-tick "live matchups this week" scan** stays fast under the
  `0034_scale_index` index; watch resolve latency, Supabase connection-pool
  limits, and Realtime fan-out at ~600 matchups.
- Confirm a single `shared-cpu-1x`/512MB worker keeps up within the ~25s plays
  cadence; if not, bump `fly.toml` memory or shard the poll loop (a Phase-0
  decision point, not a rewrite — see §4).
- The `simulate --jitter` / `--corrections` flags already exercise late/
  out-of-order delivery and provisional-then-corrected stats; keep them in the
  CI feed gate (`validate-feed.yml`).

### 2c. Close the signup gate (days)
Pilot must be invite-only. The **email allowlist / closed-signup** check is
listed as still-open in `pilot-handoff.md` — add the RPC/table check in
onboarding so only approved emails can create an account. (Invite codes already
gate *league* entry; this gates *account* creation.)

### 2d. Observability + ops runbook (days, parallel to 2b)
- Error alerting on the worker (failed polls, resolve exceptions, stuck locks)
  and a simple health signal beyond `fly logs`.
- The admin console already has pick-readiness / system-health RPCs
  (`0021_pilot_ops`); wire a lightweight on-call view onto them.
- Write the weekly ops cadence: when `sync` / `sync-week` run, how lock is
  confirmed, what to watch Sunday. Note the **GitHub Actions** (`sync.yml`,
  `simulate.yml`) can run sync/simulate without local creds — useful since the
  sandbox can't reach Supabase.
- Decide whether to wire the built-but-not-defaulted weekly auto-sync
  (`SYNC_CHECK_MS` / `WEEKLY_SYNC_MS` in `server/src/config.js`) vs. running
  `sync-week` manually each week.

### 2e. Phase 0 exit criteria
1. Worker live on Fly, scheduler ticking, service-role key rotated.
2. 100-league / 600-matchup offline simulate sustains the 25s resolve cadence
   with headroom; no index or pool regressions.
3. Closed-signup allowlist enforced.
4. Alerting + a one-page Sunday ops runbook exist.
5. Green light to point at **real ESPN in preseason** (Phase 1).

## 3. 2027 broader launch + business model

Three distinct lifts beyond the pilot:

**(1) Self-serve + payments — the biggest product gap.** Today onboarding is
invite-code and admin/commish-assisted. Public launch needs fully self-serve
league creation, **Stripe** subscriptions/billing, and zero manual ops per league.

**(2) Data-feed licensing — the biggest risk + cost line.** ESPN's free
`site.api.espn.com` endpoints are unofficial and **not licensed for commercial
use** — fine for a pilot, a liability at paid scale. The architecture isolates
this behind the `RealPlay` adapter (an explicit swap point), so moving to a
**licensed feed** (SportsData.io / Sportradar / Genius) is a clean swap — but it
is likely the largest recurring cost (hundreds–thousands/mo) and sets the pricing
floor. Same diligence on **Sleeper API ToS** at commercial scale.

**(3) A model that avoids the gambling wall.**

| Option | Verdict |
|---|---|
| **Paid season subscription** (commish/league pays, ~$20–50/league/szn or ~$5/user) + cosmetic IAP (the 7 themes / avatars already exist) | ✅ **Recommended first step.** Skill/social, no cash prizes → sidesteps DFS/gambling licensing |
| **Real-money contests** (cash prizes) | ⛔ Not for first commercial launch — triggers state-by-state DFS regulation, KYC, age-gating, licensing, payment compliance. A separate, later, separately-licensed product |
| **B2B / white-label** to league platforms | 🔭 A channel to explore, not the v1 model |

⚠️ **Design watch-item:** the drip-coin / power-up economy. If players can *buy*
power-ups that change competitive outcomes in paid leagues, that's pay-to-win and
edges toward gambling-adjacent scrutiny. Keep paid coins cosmetic/convenience, or
keep competitive power-ups earned-only.

**Also needed for 2027:**
- **Legal:** ToS, privacy (GDPR/CCPA), fantasy-contest disclaimers, age-gating,
  Sleeper/feed ToS compliance.
- **Horizontal scale (see §4):** beyond one poll worker.
- **Reliability/on-call** for peak Sundays.
- **Native apps** (README "Phase 3", optional): the engine is already
  UI-agnostic/portable, so Expo/React Native is mostly a shell over shared code.

**Unit economics:** the licensed feed dominates variable cost. If it's ~$Xk/mo,
enough paying leagues must clear that fixed cost before anything else — so the
2026 pilot's real job is to prove **retention** strong enough to justify it.

## 4. Scaling past 100 leagues (the 2027 infra note)

**Measured (2026-06):** a 100-league / 600-matchup load test (`server/scripts/
loadtest.mjs`) confirmed the `0034` index makes the per-tick matchup scan
negligible (~100–300 ms). The real cost is **per-matchup DB round-trips** —
`resolveMatchup` did ~6 sequential reads × 600 matchups ≈ 3,600 reads/tick. Fix
landed: **`prefetchTick` bulk-loads those reads for the whole live set in ~5
queries**, and the worker tick passes them in via `opts.ctx` (the per-matchup
query path stays as a fallback for the sim/CLI callers).

**In-region re-measure (2026-06-27, deployed worker, 100 leagues / 600 matchups):**
the sweep is **11.7 s p50 / 12.6 s max = 50 % of the 25 s tick** — pilot-safe with
~50 % headroom; per-matchup resolve dropped to 108 ms (4×). But the bottleneck
**moved** to the two per-tick bulk fetches: `inject+prefetch ≈ 7.5 s` (60 % of the
sweep) — the full week's plays + all memberships/lineups, CPU-bound on
`shared-cpu-1x`. The next levers, in order of bang-for-buck:
- **Cache the static prefetch across ticks** — memberships/lineups/policies don't
  change after lock; fetch once per week, re-pull only the volatile bits (sealed
  picks pre-lock, new plays). Turns the ~7.5 s into near-zero on steady-state ticks.
- **Incremental play fetch** — pull only `live_play` rows newer than the last tick
  instead of re-fetching the whole week's ~3,100 every 25 s.
- **Bigger Fly VM** — it's CPU-bound parsing thousands of rows; `shared-cpu-1x →
  2x`/`performance-1x` is a few dollars and helps directly.
- Batching the per-matchup `matchup_state` **writes** is a smaller follow-on.

The pilot's single always-on worker polling every game each tick is fine at ~600
matchups but is the first thing to break at, say, 1,000+ leagues:

- **Stop re-resolving settled matchups** — the tick re-resolves every `live`/`final`
  matchup each cycle, so once a week's games end the worker keeps running the engine
  + writing `matchup_state` for finalized matchups 24/7 (harmless — idempotent — but
  ~600 wasted resolves/writes per tick at 100 leagues). Skip matchups already `final`
  with state written (a `settled` flag, or resolve `final` once then drop it from the
  scan). Cheap; worth doing even before sharding. _(Observed live, 2026-06-27.)_
- **Shard / queue the poll loop** — multiple workers, each owning a slice of
  games; resolve fan-out off a work queue rather than one serial pass.
- **Feed rate-limits** — a licensed feed has quotas; centralize polling per
  *game* (not per matchup) and reuse across all leagues sharing that game (the
  worker already keys plays by game, so this is mostly there).
- **Supabase tier** — connection pool and Realtime concurrency become the ceiling;
  size up or front with a cache for read-heavy live boards.

None of this is needed for the 2026 pilot; it's the 2027 launch-hardening list.

## 5. The one linchpin

The single biggest unknown is whether the worker survives a **real** NFL Sunday,
and **preseason (August 2026) is the only chance to find out before it counts.**
Treat "deploy worker + preseason live-fire" as the gating milestone — everything
in Phase 0 exists to make that preseason run trustworthy.
