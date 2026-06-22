# Commercialization & Scaling Handoff — Drip League FF

> **Audience:** a future Claude session (or engineer) tasked with exploring how
> to turn Drip League FF from a polished single-player demo into a real,
> independent business. This is a map + question set, not a plan of record.
> Nothing here has been decided. Read `README.md` and `HANDOFF.md` first for the
> game design and data pipeline; this doc is the business/scaling lens.
>
> **App version at handoff:** `v0.19.1` (`src/app/version.ts`).
> **Status:** static SPA, deployed to GitHub Pages. Positive playtester feedback;
> no paying users, no accounts, no backend.

---

## 1. What exists today (one-paragraph truth)

A **Vite + React + TypeScript single-page app with no backend** (`package.json`
has only react/react-dom). The "game" is a deterministic **client-side
simulation**: real 2025 NFL box scores + play-by-play are **baked into the
bundle at build time** (`public/pbp/*.json` ≈ 3.1 MB for weeks 1–14,
`src/data/statsRaw.ts`, `returns.ts`, `headshots.ts`, `injuries.ts`), and the
engine (`src/engine/sim.ts`, `matchup.ts`) replays them through the drip
mechanics. A user can connect **any Sleeper account** at runtime to build a
playable sim of their real league. All progress (drip-coin economy, power-ups)
lives in **`localStorage`** (`src/app/store.tsx`). It's deployed as static files
to GitHub Pages (`.github/workflows/deploy.yml`, base `/ffgame/`).

This architecture is *excellent for a demo* and *insufficient for a product* —
the gap between the two is the whole job below.

---

## 2. Product strengths to preserve

- **Distinct, defensible game design.** The hidden-metric / window-slot / live
  effect-resolution loop is genuinely novel vs. points-total fantasy. The drip /
  nuke / erase / hot-streak system is tuned and playtested.
- **Real-data grounding + Sleeper onboarding.** Any Sleeper user can already
  pull their real league, rosters, schedule, and scores
  (`src/data/buildLeague.ts`, `sleeper.ts`). Frictionless onboarding for the
  fantasy crowd — no manual roster entry.
- **Built-in monetization scaffold.** A drip-coin currency + power-up shop
  already exist (`src/data/powerups.ts`, economy in `src/app/store.tsx`). The
  loop that a paid model would hang on is already designed.
- **Cheap to run.** Static hosting ≈ $0 today. Costs only appear when you add a
  backend and live data (which you must).

---

## 3. External-dependency & data map (the "not dependent on other entities" question)

This is the core of the user's question. Every dependency below is currently
used **without a commercial agreement**. Risk = availability risk × legal risk.

| Dependency | Where | When | What breaks without it | Risk |
|---|---|---|---|---|
| **Sleeper public API** (`api.sleeper.app`) | `sleeper.ts`, `buildLeague.ts`, `sleeperPlayers.ts` | **Runtime** | Onboarding, league/roster/score import, the whole "your real league" hook | **High** — undocumented ToS, no SLA, rate limits, can change/revoke; a core runtime path |
| **Sleeper 5 MB player directory** (`/players/nfl`) | `sleeperPlayers.ts` | Runtime | Mapping Sleeper ids → name/pos/team/espn_id | **High** — already a UX problem (stalls; see the timeout fix), and a per-session 5 MB pull doesn't scale |
| **ESPN headshot CDN** (`a.espncdn.com`) | `headshots.ts`, `media.ts` | Runtime (img) | Player photos | **Med-High** — hotlinking ESPN images, no license; can be blocked/changed |
| **ESPN team logos** (`a.espncdn.com/i/teamlogos`) | `media.ts` | Runtime (img) | Team logos (also NFL trademarks) | **Med-High** — trademark + hotlink |
| **Sleeper avatar CDN** (`sleepercdn.com`) | `media.ts`, `sleeper.ts` | Runtime (img) | Manager/league avatars | Med |
| **Stathead MCP** (nflverse-sourced) | `scripts/pbp/*.mjs`, `genInjuries.mjs` | **Build only**, manual | Refreshing baked stats/PBP/injuries | Med — not in the live path, but the *only* way data updates today, and it's manual (see `docs/mcp-requests.md`) |
| **nflverse GitHub releases** | `genHeadshots.mjs` | Build only | espn_id + schedule backfill | Low-Med |
| **NFL data/marks & player likeness** | everywhere | — | — | **Legal** — stats are facts (generally usable), but team logos/names are NFL trademarks and player headshots/names implicate NFLPA likeness rights. A free demo is one thing; a paid product is another. |

**Key takeaways for independence:**
1. **There is no first-party data layer.** The product borrows Sleeper for
   identity/league data and ESPN for imagery, and bakes nflverse/Stathead stats
   by hand. None of this is contracted or guaranteed.
2. **"Live" is simulated.** The marketed live-resolution experience runs off
   *baked historical box scores*, not a live feed. A real in-season product
   needs a **paid real-time play-by-play feed** (SportsRadar, Genius Sports,
   Sportradar's NFL rights, etc.) — this is the single biggest data cost/▾
   licensing item and the biggest gap between demo and product.

---

## 4. Technical weaknesses for scaling

1. **No backend, no accounts, no server-authoritative state.** Everything is
   client-side + `localStorage` (`store.tsx`). Consequences:
   - No cross-device sync, no account recovery, no real identity.
   - **No anti-cheat / no trust boundary.** Hidden picks, the drip economy, and
     power-ups are all client-side — trivially editable. The moment money or
     competition is involved this must move server-authoritative.
   - No true PvP. Today it's you-vs-AI (`aiLineup`/`aiBuffs` in `matchup.ts`).
     Real head-to-head with *sealed* picks requires a server to hold secrets.
2. **Determinism is load-bearing.** The sim is reproducible by design (no
   backend needed). Real live games are not deterministic — moving to a live
   feed reworks the core resolution path (`sim.ts` `accrue`/`resolveSlot`).
3. **Data update pipeline is manual and offline.** `scripts/pbp/genRealPbp.mjs`
   etc. require a human pulling from the Stathead MCP, splitting per game, and
   rebuilding. No automated weekly ingestion; nothing runs in-season.
4. **Bundle-as-database.** 3.1 MB of PBP ships in the build; this grows every
   season and per-position (IDP would ~triple the player universe). Needs a real
   data store + on-demand fetch, not a baked bundle.
5. **Single-league/demo coupling.** The baked demo is hardwired to
   PeakedInDynasty; some flows assume the demo league shape.
6. **No observability/analytics/error tracking/CI tests.** No way to measure
   funnel, retention, or breakage. (No analytics or test suite in the repo.)
7. **Scoring rules live in code.** Metric/power-up balance is in TS
   (`metrics.ts`, `powerups.ts`, `sim.ts`). Live-ops tuning (which a F2P economy
   needs) means a deploy each time, not a config flip.

---

## 5. Data-availability weaknesses (independence-focused)

- **No rights to the data you display.** Stats (facts) are largely fine; team
  logos/names (NFL marks) and player headshots/names (NFLPA) are not yours.
  Mitigations: license marks/likeness, or go mark-free (generic team colors +
  silhouettes), or use a data provider whose license includes imagery.
- **Runtime reliance on Sleeper for identity + league data.** If Sleeper rate-
  limits, changes, or objects, onboarding breaks. Mitigations: cache server-side,
  support multiple platforms (ESPN/Yahoo/MFL APIs), or build first-party leagues.
- **No live feed.** The product *is* "live effects," but there's no live source.
  Mitigation: contract a real-time NFL data feed; budget for it; it gates the
  in-season product.
- **Seasonal/temporal gap.** Only 2025 wk 1–14 is baked; nothing updates in
  real time. A current-season product needs automated ingestion + storage.

---

## 6. Path to technical independence (suggested sequencing)

1. **Stand up a backend + database.** Accounts/auth, server-authoritative game
   state, sealed picks, the drip economy, and an API the SPA calls instead of
   third parties directly. (Pick: a managed Postgres + a typed API; keep the
   React SPA.)
2. **Move third-party calls server-side + cache.** Proxy/cache Sleeper, host the
   player directory yourself (kills the 5 MB client download — see
   `docs/mcp-requests.md` item 7), and mirror/host imagery you have rights to.
3. **Automate data ingestion.** A scheduled job that pulls weekly stats/PBP into
   your DB (replacing the manual `scripts/pbp` pipeline) — first historical,
   then a **live feed** for in-season.
4. **License the data + imagery** (or go mark-free) so you're not hotlinking and
   not exposed on trademark/likeness.
5. **Make scoring/economy server-driven config** for live-ops tuning.
6. **Add observability, analytics, payments, CI/tests.**

Independence is a spectrum: step 2 removes the *fragile* runtime hotlinks; step 3
removes the *manual* pipeline; step 4 removes the *legal* exposure; step 7 (live
feed) is the expensive, unavoidable one for an in-season live product.

---

## 7. Business / commercialization high-level steps

1. **Sharpen positioning & wedge.** Companion-game to existing Sleeper/ESPN
   leagues? Standalone competitor? The Sleeper-import onboarding suggests
   "companion layer on the leagues you already have" as the cheapest wedge.
2. **Pick the monetization model** (the economy scaffold already exists):
   cosmetic/power-up F2P, season pass/subscription, or entry-fee contests.
   **Entry fees = real-money gaming**, which changes everything legally (see §8).
3. **Legal & entity.** Form the company; get specialist counsel on (a) NFL/NFLPA
   data + likeness licensing, (b) fantasy/skill-game vs. gambling law by US
   state if any cash prizing, (c) data-provider contracts, (d) privacy (CCPA/GDPR
   once you hold accounts), (e) platform ToS (Sleeper/ESPN) for derivative use.
4. **Secure data rights & a live feed.** Provider selection + contract; this is
   the long-pole cost. Budget it before committing to "live, in-season, paid."
5. **Build the backend + accounts + real-time infra** (per §6).
6. **Payments & compliance plumbing** (Stripe + tax + age/geo gating if cash).
7. **Closed beta with the current playtesters** on the new stack; instrument
   retention/funnel.
8. **Go-to-market.** Fantasy communities, Sleeper/Reddit/Discord, content; the
   import hook is the growth lever.
9. **Cost & unit-economics model.** Live data feed + infra + payment fees vs.
   ARPU; F2P conversion assumptions.

---

## 8. Legal/compliance flags (get specialist counsel — not legal advice)

- **Real-money contests** (entry fees/prizes) trigger state-by-state
  fantasy/skill-game and gambling regulation, licensing, and geofencing. This is
  the single biggest fork in the business model.
- **NFL trademarks** (team names/logos) and **NFLPA player likeness/name**
  (headshots, names) — currently used without license. A paid product likely
  needs licenses or a mark-free presentation.
- **Platform ToS** — scraping/using Sleeper and ESPN endpoints/images for a
  commercial product may violate their terms; review or replace.
- **Privacy** once you store accounts/PII.

---

## 9. Open questions for the next session to resolve (with the founder)

1. **Money model:** cosmetic F2P, subscription, or real-money contests? (Gates
   §8 and the entire compliance/infra burden.)
2. **Live vs. async:** must games resolve on real live feeds in-season, or is a
   next-morning/async resolution acceptable for v1? (Async dramatically lowers
   data cost and lets you ship on cached box scores.)
3. **PvP vs. vs-AI:** is sealed-pick head-to-head required for v1, or is
   single-player/leaderboard enough to launch?
4. **Companion vs. standalone:** lean into Sleeper import, or run first-party
   leagues?
5. **Budget/runway & timeline** — determines whether to license a feed now or
   bootstrap on historical data.

---

## 10. Suggested first deliverables for the next session

- A **target architecture diagram** (SPA → API → DB → ingestion/live-feed) with
  a concrete stack recommendation and rough monthly cost at 1k / 10k / 100k MAU.
- A **data-rights memo**: options for stats/imagery/live feed (providers, rough
  cost tiers, what each license covers) + the mark-free fallback.
- A **build-vs-the-demo gap list** turned into an epic-level roadmap (accounts,
  server-authoritative state, ingestion, live feed, payments, compliance).
- A **monetization model** sized against unit economics, reusing the existing
  drip-coin/power-up design.
- A recommendation on the **v1 scope** that minimizes data-licensing cost
  (likely: async resolution on cached/historical data, cosmetic F2P, mark-free)
  to get to revenue before taking on a live-feed contract.

---

## 11. Target architecture & rough cost model

> Order-of-magnitude, not a quote. Assumes the **§10 v1 recommendation** (async
> resolution, cosmetic/F2P, mark-free) first, then a path to live in-season.
> Numbers are monthly USD, infra only — **Stripe fees (~2.9% + 30¢) and any
> live-feed/compliance contracts are called out separately** because they dwarf
> infra and scale with revenue/licensing, not MAU.

### 11.1 Target architecture (recommended)

Keep the React/Vite SPA; put everything it currently borrows behind your own API.

```
                          ┌──────────────────────────────┐
        Browser  ───────► │  React/Vite SPA (static)      │
        (user)            │  CDN: Cloudflare/Vercel Pages │
                          └───────────────┬──────────────┘
                                          │ HTTPS (your API only — no direct
                                          │ Sleeper/ESPN calls from the client)
                                          ▼
                          ┌──────────────────────────────┐
                          │  API / app server            │  ← server-authoritative
                          │  Fastify/tRPC (Node) or       │    game state, sealed
                          │  Supabase Edge / CF Workers   │    picks, economy, anti-cheat
                          └───┬───────────┬───────────┬───┘
                              │           │           │
                  ┌───────────▼──┐ ┌──────▼──────┐ ┌──▼───────────────┐
                  │ Postgres     │ │ Realtime/WS │ │ Cache + proxy     │
                  │ (Supabase/   │ │ (Supabase   │ │ (CF Workers + KV/ │
                  │  Neon/RDS)   │ │  Realtime / │ │  Redis): Sleeper, │
                  │ users, games,│ │  Ably)      │ │  player directory │
                  │ economy,     │ │ pick reveal,│ │  (kills the 5MB    │
                  │ stats        │ │ live tick   │ │  client download) │
                  └──────▲───────┘ └─────────────┘ └──▲────────────────┘
                         │                             │
            ┌────────────┴───────────┐    ┌────────────┴───────────────┐
            │ Ingestion (cron jobs)  │    │ Object storage + CDN (R2/S3)│
            │ historical stats/PBP → │    │ imagery you have rights to  │
            │ DB; in-season: LIVE    │    │ (headshots/logos/avatars)   │
            │ FEED (SportsRadar/     │    └─────────────────────────────┘
            │ Genius) → DB → Realtime│
            └────────────────────────┘
   Cross-cutting: Auth (Supabase/Clerk) · Payments (Stripe) ·
   Observability (Sentry + PostHog) · Email (Resend) · IaC + CI/CD
```

**Component picks** (recommended → alternative → why):

| Concern | Recommended | Alternative | Notes / cost driver |
|---|---|---|---|
| SPA hosting/CDN | Cloudflare Pages | Vercel/Netlify | Cheap/flat; egress-bound |
| API | Fastify or tRPC on Fly.io/Render | Supabase Edge Fns / CF Workers | Server-authoritative state lives here |
| DB | Supabase Postgres | Neon, RDS | Scales with rows/compute/connections |
| Auth | Supabase Auth | Clerk, Auth0 | Clerk/Auth0 bill **per-MAU** and get pricey fast |
| Realtime | Supabase Realtime | Ably, Pusher, CF Durable Objects | **Bills on concurrency + messages** — the spiky cost (see 11.3) |
| Cache/proxy | CF Workers + KV / Upstash Redis | — | Removes runtime Sleeper/ESPN coupling |
| Object storage | Cloudflare R2 | S3 | R2 has no egress fees — good for imagery |
| Payments | Stripe | — | % of revenue, not MAU |
| Observability | Sentry + PostHog | Datadog | Datadog scales steeply |
| Email | Resend | Postmark | Transactional + lifecycle |

**Why this shape:** one platform (Supabase) collapses DB + Auth + Realtime +
Storage to cut early ops; the CF cache/proxy layer is what actually buys
*independence* from Sleeper/ESPN at runtime; ingestion is isolated so you can
ship v1 on historical data and bolt on a live feed later without touching the
client.

### 11.2 Rough monthly cost by scale (infra only)

Assumptions: fantasy usage is **weekly-active and hyper-concurrent on NFL
Sundays**; ~30–40% of MAU active in a given game window; small JSON payloads;
imagery served from your CDN.

| Line item | 1k MAU (beta) | 10k MAU | 100k MAU |
|---|---|---|---|
| SPA hosting + CDN | $0 | $20 | $100–300 |
| API compute | $0–25 | $50–150 | $400–1,500 |
| Postgres | $25 | $50–150 | $400–1,500 |
| Realtime/WebSockets | $0–25 | $50–250 | $800–4,000 |
| Cache/proxy (Workers/Redis) | $5 | $20–60 | $200–800 |
| Object storage + CDN egress | $0–5 | $20–60 | $150–600 |
| Auth | $0 (Supabase) | $0–100 | $0–500 |
| Observability + analytics | $0–30 | $50–250 | $400–1,500 |
| Email | $0–20 | $20–60 | $150–600 |
| **Infra subtotal** | **~$30–140** | **~$300–1,100** | **~$2,500–11,000** |

**Not in the table (can dominate):**
- **Live in-season feed** (SportsRadar/Genius NFL play-by-play): roughly
  **$1k–$15k+/mo or rev-share**, largely fixed regardless of MAU. This is the
  reason v1 should run on cached/historical data. Historical/aggregated stats
  licenses are far cheaper than real-time.
- **Stripe**: ~2.9% + 30¢ per transaction — scales with revenue, not users.
- **Real-money compliance** (only if you do entry-fee contests): geo/age
  verification vendors, licensing, and legal — can run **tens of thousands**
  upfront + per-check fees, and easily exceeds all infra combined. Strong
  argument to launch cosmetic/F2P first.
- **Marks/likeness licensing** if not going mark-free.

### 11.3 The one cost trap to flag now

Fantasy traffic is **not** smooth — it spikes hard during Sunday game windows
when most users are online watching picks resolve live. **Realtime and API
costs must be sized for peak concurrency, not average MAU**, and per-connection
realtime pricing (Ably/Pusher) can balloon during those windows. Two levers:
(1) **async resolution for v1** sidesteps the live-concurrency cost entirely;
(2) if/when you go live, prefer connection-efficient transport (shared channels,
CF Durable Objects, or self-hosted WS) over per-connection SaaS pricing.

---

## Appendix: fast file orientation for the next session

- **Game engine:** `src/engine/sim.ts` (scoring/effects/clock), `matchup.ts`
  (lineups, AI, window resolution).
- **Metrics & economy:** `src/data/metrics.ts`, `src/data/powerups.ts`,
  economy/persistence in `src/app/store.tsx` (localStorage keys there).
- **Real-league build (runtime third-party calls):** `src/data/buildLeague.ts`,
  `sleeper.ts`, `sleeperPlayers.ts`.
- **Baked data + pipeline:** `public/pbp/*.json`, `src/data/statsRaw.ts`,
  `returns.ts`, `headshots.ts`, `injuries.ts`; generators in `scripts/` +
  `scripts/pbp/`; data gaps/requests in `docs/mcp-requests.md`.
- **Imagery/CDN coupling:** `src/data/media.ts`, `headshots.ts`.
- **Deploy:** `.github/workflows/deploy.yml` (GitHub Pages, base `/ffgame/`).
- **Dormant IDP work** (flag-gated, not enabled): `IDP_ENABLED` in
  `sleeperPlayers.ts`; see `docs/mcp-requests.md` item 8.
