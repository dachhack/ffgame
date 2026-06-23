# 2026 Pilot — Session Handoff

_Read this first to pick up the near-live H2H pilot in a fresh session. Pairs with
`docs/pilot-2026-plan.md` (deeper plan), `docs/supabase-polish.md` + `docs/domain-runbook.md`
(ops), `server/DEPLOY.md` (Fly worker), and `supabase/README.md`. Last build: **v0.37.0**._

## TL;DR — what exists now
A full **closed-pilot product** is built, deployed, and mobile-tested end to end —
everything except the live worker running on a real NFL Sunday (it's the offseason).

- **Live site:** **https://www.dripfantasy.com** (custom domain; GitHub Pages still
  backs it). Splash → "◈ join the live H2H pilot". Old `dachhack.github.io/ffgame/`
  still resolves.
- **Supabase project** `dripff` (ref `kaoitimdsftclykhqaqx`, us-east-1, **Pro plan**)
  fully provisioned: schema + RLS + auth + realtime. Migrations 0001–0015 applied.
- **Auth:** Google OAuth (consent screen published as "Drip League FF"),
  email+password (sign in / create / reset, confirm-email OFF), magic-link + 6-digit
  OTP fallback (template carries `{{ .Token }}`). Apple wired but hidden (`SHOW_APPLE=false`).
- **Custom auth domain:** `auth.dripfantasy.com` (Supabase Custom Domains add-on).
  `supabaseClient.ts` points at it. See "Domain cutover" below for live status.
- **Player flow:** sign in → redeem invite (or share link) → confirm team → set sealed
  lineup (**slate-gated** to each player's real NFL game window) → live board (Realtime).
- **Commissioner flow:** verify ownership via a Sleeper team-name tag → self-serve
  dashboard (codes, members, sync week, matchup lifecycle, **coin edit**, **audit**).
- **Admin console** (allowlisted by email): import league, sync week, matchup lifecycle,
  **force-resolve from baked 2025 data** (real engine, in-browser), coin edit, audit
  (with actor), manage admins/overrides, code regen, share links.
- **Auto-migrate pipeline:** push `supabase/migrations/00NN_*.sql` → a GitHub Action
  applies it. **No SQL pasting**, and it now runs on this work branch too.

## Branch + deploy model (IMPORTANT)
- **This session worked on `claude/charming-bardeen-tqeyue`.** Future sessions get
  their own branch from the harness — push there.
- **`.github/workflows/migrate.yml`** auto-applies ADDED `supabase/migrations/*.sql`
  on push to **either** `claude/admiring-brown-x5limu` **or** `claude/charming-bardeen-tqeyue`
  (uses `git diff --no-renames --diff-filter=A`; never re-runs existing files). Needs
  the repo secret **`SUPABASE_DB_URL`** = the **session-pooler** string
  (`…pooler.supabase.com`, IPv4). To watch a new branch, add it to that workflow's
  `push.branches`. (The Claude GitHub token lacks `actions: write`, so I can't trigger
  `workflow_dispatch` — push-triggered runs are the way.)
- **Pages deploy** (`.github/workflows/deploy.yml`) triggers on
  `claude/youthful-albattani-s9kprl` and builds with **`VITE_BASE=/`** (custom domain is
  served at root, not `/ffgame/`). Mirror client changes there:
  ```
  git push origin <work-branch>
  git push origin <work-branch>:claude/youthful-albattani-s9kprl   # client changes
  ```
  `public/CNAME` pins `www.dripfantasy.com` so deploys don't drop the custom domain.
- **Bump `src/app/version.ts`** every client change; confirm via the version chip.
  **Build gate:** `npm run build` (strict tsc — remove unused vars).
- Commit trailers required (`Co-Authored-By: Claude …` + `Claude-Session:`); the model
  id never appears in committed artifacts. No PRs unless asked.

## Architecture map
**Data spine (frozen contract — keep stable):** the engine consumes per-player,
slug-keyed `RealPlay[]` timelines. Same engine serves baked-2025, ESPN-live, and a
future paid feed by swapping only the adapter.

- `scripts/espn/espnAdapter.mjs` — ESPN `summary` → `RealPlay`. `validate.mjs` is now a
  **pass/fail gate** (`npm run validate [wk]`, exit 1 on regression) wired into
  `.github/workflows/validate-espn.yml` (push on `scripts/espn/**`, weekly Mon, dispatch).
- `src/engine/{sim,matchup}.ts` — pure deterministic engine (the vs-AI demo uses these).
- **`src/engine/liveResolve.ts` — the shared H2H resolver.** Used by BOTH the in-browser
  admin force-resolve (`src/data/forceResolve.ts`) AND the worker (`server/src/resolve.js`
  via `engine.js`), so preview and live score identically. Resolves slug-keyed sealed
  picks paired by (window, slot), layering every cross-slot effect: cross-window Field
  General, best-ball backups, TE-TD 8-pt nukes, DEF suppress halving, K banker XP bonus,
  and the per-side drip-coin economy. (`matchup.ts`'s `buildMatchup` is the demo's
  league-bound equivalent; `liveResolve` is the league-agnostic one.)
- `src/data/slugMeta.ts` — slug → {pos, team} (with team-abbrev normalization), used for
  slate-gating and the resolver. `src/data/nflSlate.ts` — `windowForTeam`, `hasSlate`.
- **Worker `server/`** (Node via `tsx`): `sync.js`, `poll/{scoreboard,plays,injuries}.js`,
  `lock.js`, `resolve.js`. **Not deployed** — Fly artifacts ready (`server/DEPLOY.md`).
- **Client live mode** (`src/`): `data/supabaseClient.ts` (URL + publishable key — both
  public), `data/liveApi.ts` (auth + RPC wrappers), `data/sleeperAdmin.ts`,
  `data/forceResolve.ts`, `screens/{LiveOnboard,LivePicks,LiveBoard,AdminPage,CommishDash}.tsx`.

## Supabase specifics
- **Keys:** publishable/anon key committed in `supabaseClient.ts` (safe — RLS guards
  everything). **Service-role key** only for the Fly worker (Fly secret, never git).
  ⚠️ **Rotate the service-role key** if not already (shared in chat during setup).
- **Migrations 0001–0015:** 0001 schema+RLS+audit · 0002 invite codes · 0003 commish
  verify · 0004 commish override · 0005 realtime · 0006 admin · 0007 admin setup ·
  0008 redeem preview · 0009 admin tools · 0010 commish-scoped RPCs + force-resolve ·
  **0011** matchup coin columns + `admin_set_state` coin · **0013** `admin_set_coin`
  + coin/status audit detail (0012 was renumbered to 0013 to ride auto-apply) ·
  **0014** `commish_audit` (league-scoped) · **0015** audit `actor` (email join).
- **RLS load-bearing fact:** a `sealed_pick` is unreadable by the opponent until the
  server flips `locked` at kickoff; clients can never set `locked`.
- **Admin allowlist:** `app_admin` table, seeded `mlporritt@gmail.com`. `is_admin()`
  checks the JWT email. Commissioner access via `is_league_commish()` /
  `is_matchup_commish()`.
- **Drip coin:** `matchup.home_coin`/`away_coin`, written by the resolver (worker live +
  force-resolve), shown on the live board, hand-editable in admin/commish (audited).
- **Test seed:** `supabase/seed_week1_test.sql` — PeakedInDynasty week-1 matchup
  (roster 5 dachhack vs roster 1), invite code **`DRIP2026`**. Prefer admin "import
  league"/"sync week" over the seed now.

## Domain cutover (COMPLETE)
- **Domain:** `dripfantasy.com` (Squarespace). DNS: `www`→`dachhack.github.io`, apex
  A-records→GitHub Pages, `auth`→`kaoitimdsftclykhqaqx.supabase.co`, plus the
  `_acme-challenge.auth` TXT for Supabase's cert.
- **Live end to end:** site at `https://www.dripfantasy.com` (Pages, `VITE_BASE=/`,
  `public/CNAME` pins it); auth/API at `https://auth.dripfantasy.com` (Supabase Custom
  Domain, valid SSL). The deployed bundle references `auth.dripfantasy.com` and **no**
  `supabase.co`. Google OAuth has the `auth.dripfantasy.com/auth/v1/callback` redirect
  URI; Supabase redirect URLs include `https://www.dripfantasy.com/?live=1`.
- `supabaseClient.ts` `DEFAULT_URL = https://auth.dripfantasy.com`. Old
  `dachhack.github.io/ffgame/` still resolves but the app self-references the new domain.
- To revert in an emergency: set `VITE_SUPABASE_URL` back to the `…supabase.co` host on
  the deploy workflow (or `DEFAULT_URL`), and the site keeps working.

## Onboarding — where to work next (founder is iterating here)
The player onboarding flow lives in:
- `src/screens/LiveOnboard.tsx` — sign-in (Google / email+password / magic-link OTP),
  invite-code redemption, team confirmation, resume. Entry from `src/screens/Splash.tsx`
  ("◈ join the live H2H pilot"); routed as `'live'` in `App.tsx`.
- `src/data/liveApi.ts` — all auth + redemption wrappers: `signInWithProvider`,
  `signInPassword`/`signUpPassword`/`sendPasswordReset`, `sendMagicLink`/`verifyEmailOtp`,
  `previewLeague`/`redeemPreview`/`redeemInvite`, `myEnrollments`, `ensureAppUser`.
- Redemption RPCs are server-side (`redeem_invite`, `redeem_preview`, `league_by_invite`)
  in migrations 0002/0008 — change behavior there, add a migration (auto-applies on push).
- Closed-signup **email allowlist** is still an open idea (gate who can create an account);
  would be a new RPC/check, likely in onboarding + a small table.

## Open items / next steps
1. **Onboarding polish** (founder actively working here — see the section above).
2. **Deploy the worker to Fly** (`server/DEPLOY.md`) with the rotated service-role key.
   Only fully exercised on a live NFL Sunday; live scoring previewable now via
   force-resolve. The worker already runs the full shared resolver.
3. **Product polish (optional):** official Google-button styling; email allowlist for
   closed signups (restrict who can sign up).

## Gotchas (save yourself time)
- **Sandbox egress is allowlisted.** Reachable: ESPN `site.api.espn.com`, Sleeper, npm,
  github.com. The founder can add hosts (e.g. `*.dripfantasy.com`) to the environment's
  network policy, but **it only takes effect after a session restart**. Default-blocked:
  `*.supabase.co`, `*.github.io`. You generally **cannot test the live DB/OAuth/site from
  the sandbox** — the founder tests on a device. (You can run ESPN adapters + engine +
  builds + `validate.mjs`.)
- **`mcp__github__actions_list` output overflows** the tool limit — it auto-saves to a
  file; `python`/`grep` the saved path for `conclusion`/`status`. `actions_get` /
  `list_workflow_jobs` (single run) stay small enough to read inline.
- Confirm a migration applied by checking the latest `migrate.yml` run is `success` AND
  the apply-step log shows `── applying …NN_*.sql ──` (a no-op run also "succeeds").
- The big chunk-size build warning is expected (Supabase + engine in one bundle).

## How to verify the live flow (founder, on a phone)
`www.dripfantasy.com` (chip = current version) → join live → Google or email → redeem
`DRIP2026` as `dachhack` → set a lineup (note slate-gating: each slot only lists players
whose NFL team plays that window) → Admin → matchups → ▶ "force-resolve from 2025 wk 1"
→ live board → real Drip scoring (nukes/drips/FG/suppress) + per-side ◇ drip coin.
