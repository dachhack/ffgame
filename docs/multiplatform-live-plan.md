# Multi-platform live pilot — scoping

**Question:** the demo already *reads* Sleeper / ESPN / Yahoo / Fleaflicker / MFL,
but the **live head-to-head pilot** (import → enroll → lock → resolve → live board)
is Sleeper-only. What does it take to run a *live* league from another platform?

**TL;DR:** the engine, builder, sealed-pick security, realtime, and auth are all
platform-neutral and reusable. The Sleeper lock-in lives in three places: the DB
schema (`sleeper_*` primary keys), the import/sync server code, and identity/roster
claiming. The hardest problem is **identity** (only Sleeper has a stable public
username); the second is **matchup pairing** (only Sleeper hands us H2H pairs).
Recommended first step: **Sleeper + ESPN**, admin-mapped enrollment, ESPN real
plays — no schema rewrite.

---

## 1. What's already reusable (no change)

- **Provider abstraction (read side)** — `src/data/providers/*` already implements a
  `LeagueProvider` interface (`resolveUser`/`getLeagues`/`getStandings`/`buildLeague`)
  for all five platforms, with per-platform auth kinds (`none`/`handle`/`cookie`/`oauth`).
- **League builder** — `buildFromNormalized()` (`src/data/buildLeague.ts`) consumes a
  provider-agnostic `NormalizedLeague` and outputs an engine-playable league. ESPN/Yahoo/
  Fleaflicker/MFL already normalize into this shape for the demo.
- **Engine** (`src/engine/*`), **sealed-pick RLS**, **`matchup_state` → realtime**, and
  **email magic-link auth** have zero platform awareness.
- **Edge proxies** already exist: `espn-league`, `yahoo-oauth`, `fantasy-proxy` (Fleaflicker + MFL).
- **ESPN real play-by-play** is already validated (`scripts/espn/*`), feeding `live_play`.

## 2. Where the Sleeper lock-in is

| Layer | Sleeper-locked at | Note |
|---|---|---|
| **DB schema** | `league.sleeper_league_id`, `league_membership.sleeper_roster_id` / `sleeper_owner_id`, `matchup.sleeper_matchup_id`, table `sleeper_lineup` | hard PK/uniques; every admin RPC queries these |
| **Import/sync** | `server/src/sync.js`, `src/data/sleeperAdmin.ts` | calls `api.sleeper.app` directly; admin UI is "IMPORT A **SLEEPER** LEAGUE" (league-id only) |
| **Identity/claim** | `redeem_invite(code, sleeper_user_id, …)` matches roster by `sleeper_owner_id`; `src/data/liveApi.ts` imports Sleeper `resolveUser` | no equivalent owner id on other platforms |
| **Commissioner** | already fixed — `redeem_commish()` (migration 0039) is platform-agnostic | ✅ |

## 3. The real problems (not just plumbing)

1. **Identity.** Sleeper has a stable, public username → `sleeper_user_id`, perfect for a
   no-secrets email flow. ESPN/Yahoo/MFL/Fleaflicker have **no public manager id**:
   - ESPN: private `espn_s2`+`SWID` cookies, per-session, no user lookup.
   - Yahoo: user id only via OAuth token (not a typeable handle).
   - Fleaflicker/MFL: no stable public username API.
   → So self-serve "enter your username to claim your team" only works for Sleeper.
   Others need **admin pre-mapping** or an **OAuth-driven "pick your team"** flow.

2. **Matchup pairing.** Sleeper gives a `matchup_id` (shared id = opponents). The others
   don't expose league H2H pairings — we'd infer from schedule/standings or have the
   commissioner enter weekly pairings. Non-H2H leagues can't run the pilot at all.

3. **Live plays.** Only **ESPN + Sleeper** have real play feeds. Yahoo/Fleaflicker/MFL
   have **no play-by-play API** → they'd run on engine-resolved (synthetic-texture)
   scoring, same as the baked demo. Functional, just less live-play animation.

## 4. Per-platform feasibility

| Platform | Read (demo) | Live effort | Main blockers |
|---|---|---|---|
| Sleeper | ✅ | done | — |
| **ESPN** | ✅ public | **Medium** | admin-mapped enrollment (no public user id); server-side ESPN adapter + matchup inference; provider tagging |
| Yahoo | ✅ (after app approval) | High | OAuth app gate; OAuth-driven claim; no play API (synthetic) |
| Fleaflicker | ✅ public | High | no user-id API; H2H inference; no play API |
| MFL | ✅ public | High | same as Fleaflicker + multi-subdomain redirects/rate limits |

## 5. Recommended plan

**Phase 0 — schema, non-breaking.** Add `provider text not null default 'sleeper'` to
`league` (and optionally `league_membership`). Keep the `sleeper_*` columns; for non-Sleeper
imports, fill them with namespaced synthetic ids (e.g. `espn-<leagueId>`, `espn-<teamId>`).
Rename intent only (leave `sleeper_lineup` as-is to avoid churn). No rewrite, no data migration.

**Phase 1 — Sleeper + ESPN live (admin-driven).**
- Server ESPN adapter (`server/src/espn.js`) reusing the `espn-league` proxy: pull teams/
  rosters/scores, **infer weekly pairings** (or accept commissioner-entered pairings).
- Admin import: add a platform + league-id/link picker (the request form now captures this —
  migration 0040). Dispatch `importLeague(ref, platform)`.
- **Enrollment = admin-mapped**: admin assigns each ESPN roster to a signed-in user (fits the
  existing admin-assigned commissioner model). No self-serve username claim for ESPN.
- Live plays: reuse the validated ESPN adapter → `live_play` → existing resolution.

**Phase 2 — Yahoo (OAuth claim).** OAuth sign-in → list the user's leagues → pick team →
enroll. Scores/standings from Yahoo; **plays from the ESPN feed** (cross-source) or synthetic.

**Phase 3 — Fleaflicker / MFL.** Public reads via `fantasy-proxy`; admin-mapped enrollment;
synthetic plays. Lowest priority (no play feed, weaker identity).

## 6. Key decisions to make first

- **Identity model per platform**: admin-mapped (simplest, matches our admin-driven onboarding)
  vs. OAuth "pick your team" (nicer for Yahoo, more work). Recommend **admin-mapped** for the
  first non-Sleeper pilot.
- **Matchup source**: infer pairings vs. commissioner-entered. Recommend a commissioner
  "confirm this week's matchups" step — robust across platforms.
- **Schema**: additive `provider` column + synthetic ids (fast) vs. a proper polymorphic
  rewrite (`provider_id` + generic `league_key`/`owner_key`). Recommend **additive now**,
  revisit a rewrite only if we go past ESPN.

## 7. Rough file checklist (Phase 0–1)

- `supabase/migrations/00XX_provider_tag.sql` — `league.provider` column (+ synthetic-id note)
- `server/src/espn.js` (new) — ESPN league/roster/score adapter + pairing inference
- `server/src/sync.js` — dispatch `importLeague` by platform
- admin UI — platform + league-ref import (request form already feeds this via 0040)
- enrollment — `admin_assign_roster(league, roster, app_user)` RPC + a small admin control
- plays — point the existing ESPN adapter at pilot ESPN leagues

*Not building any of this yet — this is the scope. Phase 1 (Sleeper + ESPN, admin-mapped) is
the smallest slice that proves multi-platform live without a schema rewrite or Yahoo approval.*
