# 2026 Pilot — Session Handoff

_Read this first to pick up the near-live H2H pilot in a fresh session. Pairs with
`docs/pilot-2026-plan.md` (deeper plan, ESPN validation, data-model rationale),
`server/DEPLOY.md` (Fly worker), and `supabase/README.md`. Last build: **v0.30.1**._

## TL;DR — what exists now
A full **closed-pilot product** is built, deployed, and mobile-tested end to end —
everything except the live worker running on a real NFL Sunday (it's the offseason).

- **Live site:** https://dachhack.github.io/ffgame/ → Splash → "◈ join the live H2H pilot".
- **Supabase project** `dripff` (ref `kaoitimdsftclykhqaqx`, us-east-1, free tier) is
  fully provisioned: schema + RLS + auth + realtime. Migrations 0001–0010 applied.
- **Auth:** Google OAuth (working), email+password (sign in / create / reset), and
  magic-link + 6-digit OTP fallback. Apple is wired but hidden (`SHOW_APPLE=false`).
- **Player flow:** sign in → redeem invite code (or one-tap share link) → confirm
  team → set sealed lineup → live board (Supabase Realtime).
- **Commissioner flow:** verify ownership via a Sleeper team-name tag → self-serve
  dashboard (codes, members, sync week, run windows, regen invite).
- **Admin console** (allowlisted by email): import league, sync week, drive matchup
  lifecycle, **force-resolve a matchup from baked 2025 data** (real engine, in-browser,
  no worker), users/scoring/audit, manage admins/overrides, code regen, share links.
- **Auto-migrate pipeline:** push `supabase/migrations/00NN_*.sql` → a GitHub Action
  applies it. **No SQL pasting.**

## Branch + deploy model (IMPORTANT)
- **Work on `claude/admiring-brown-x5limu`.** Push there.
- **Mirror client changes to `claude/youthful-albattani-s9kprl`** — this is the branch
  the Pages deploy (`.github/workflows/deploy.yml`) triggers on:
  ```
  git push origin claude/admiring-brown-x5limu
  git push origin claude/admiring-brown-x5limu:claude/youthful-albattani-s9kprl   # client changes
  ```
- **Migrations auto-apply** via `.github/workflows/migrate.yml` on push to the work
  branch (runs only ADDED `supabase/migrations/*.sql` via `psql`; never re-runs). Needs
  the repo secret **`SUPABASE_DB_URL`** = the **session-pooler** connection string
  (`…pooler.supabase.com`, NOT the IPv6 `db.<ref>.supabase.co` direct host — GitHub
  runners are IPv4).
- **Bump `src/app/version.ts` (`APP_VERSION`)** every client change; confirm deploys via
  the version chip. **Build gate:** `npm run build` (strict tsc — remove unused vars).
- Commit trailers required (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session:`);
  the model id never appears in committed artifacts. No PRs unless asked.

## Architecture map
**Data spine (frozen contract — keep stable):** the engine consumes per-player,
slug-keyed `RealPlay[]` timelines. Same engine serves baked-2025, ESPN-live, and a
future paid feed by swapping only the adapter.

- `scripts/espn/espnAdapter.mjs` — ESPN `summary` → `RealPlay` (validated 99.6%/full
  season via `validate.mjs`). `injuries.mjs` — ESPN injuries → per-slug status.
- `src/engine/{sim,matchup}.ts` — the pure deterministic engine (demo + live share it).
- **Worker `server/`** (Node, runs via `tsx`): `sync.js` (Sleeper import/schedule),
  `poll/{scoreboard,plays,injuries}.js`, `lock.js`, `resolve.js` (reuses the engine via
  `engine.js` + `realPbp.setSyntheticWeeks`). **Not deployed** — Fly artifacts ready
  (`Dockerfile`, `fly.toml`, `server/DEPLOY.md`).
- **Client live mode** (`src/`): `data/supabaseClient.ts` (URL + publishable key baked
  in — both public), `data/liveApi.ts` (all auth + RPC wrappers), `data/sleeperAdmin.ts`
  (client-orchestrated import/sync), `data/forceResolve.ts` (in-browser engine preview),
  `screens/{LiveOnboard,LivePicks,LiveBoard,AdminPage,CommishDash}.tsx`. Route `'live'`
  in `App.tsx`; entry from `Splash.tsx`. The static vs-AI demo is untouched and gated:
  Live mode only activates when Supabase env/keys are present.

## Supabase specifics
- **Keys:** publishable/anon key is committed in `supabaseClient.ts` (safe — RLS guards
  everything). **Service-role key** is only for the Fly worker → store as a Fly secret,
  never in git. ⚠️ **Rotate the service-role key** if not already (it was shared in chat
  during setup).
- **Migrations 0001–0010:** 0001 schema+RLS+audit · 0002 invite codes · 0003 commish
  verify (+`http` extension) · 0004 commish override (admin exception: dachhack) · 0005
  realtime publication · 0006 admin · 0007 admin setup/writers · 0008 redeem preview ·
  0009 admin tools (members/regen) · 0010 commissioner-scoped RPCs + force-resolve.
- **RLS load-bearing fact:** a `sealed_pick` is unreadable by the opponent until the
  server flips `locked` at kickoff; clients can never set `locked`.
- **Admin allowlist:** `app_admin` table, seeded with `mlporritt@gmail.com`. `is_admin()`
  checks `auth.jwt()->>'email'`. Commissioner access via `is_league_commish()`.
- **Auth config done:** Email provider on; Redirect URLs include
  `https://dachhack.github.io/ffgame/?live=1`; Realtime on `matchup_state`/`matchup`;
  Google OAuth credentials set.
- **Test seed:** `supabase/seed_week1_test.sql` — PeakedInDynasty (`1181483840740397056`)
  week-1 matchup (roster 5 dachhack vs roster 1), invite code **`DRIP2026`**. (Now that
  admin "import league"/"sync week" buttons exist, prefer those over the seed.)

## Open items / next steps
1. **Deploy the worker to Fly** (`server/DEPLOY.md`) with the rotated service-role key.
   Only fully exercised on a live NFL Sunday — until then it runs injuries/scoreboard/
   lock; live scoring is previewable now via admin **force-resolve**.
2. **Supabase polish (founder, dashboard):**
   - Magic-link email template → add `{{ .Token }}` so the OTP-code path works (link works without it).
   - Email provider → "Confirm email" **OFF** for instant password signup.
   - Google **OAuth consent screen** → set App name "Drip League FF" + Publish (consent
     currently shows raw `…supabase.co`; App-name+publish cleans it up free; a custom
     auth domain removes supabase.co entirely but needs a domain + paid add-on).
3. **Product polish (code, optional):** slate-gate lineup slots to real NFL game windows
   (needs the ESPN slate; currently any player → any slot); official Google-button
   styling; email allowlist for closed signups; port the engine niceties still simplified
   in `resolve.js` (best-ball backups, coin economy, cross-window Field-General mult).
4. **Validation gate before trusting live ESPN:** `node scripts/espn/validate.mjs <wk>`
   re-derives a 2025 week and diffs vs `public/pbp/wN.json` (the cheap correctness check).

## Gotchas (save yourself time)
- **Sandbox egress is allowlisted.** Reachable: ESPN `site.api.espn.com`, Sleeper,
  npm, github.com. **Blocked:** `*.supabase.co`, `*.github.io`, ESPN `core.api`. So you
  **cannot test the live DB, OAuth, or the deployed site from the agent sandbox** — the
  founder tests on a real device. (You can run the ESPN adapters + the engine + builds.)
- **`mcp__github__actions_list` output overflows** the tool limit — it auto-saves to a
  file; `grep`/`python` the saved path for `conclusion`/`status` instead of reading it.
- Confirm a migration applied by checking the latest `migrate.yml` run is `success`.
- The big chunk-size build warning is expected (Supabase + engine in one bundle); not an error.

## How to verify the live flow (founder, on a phone)
Site (chip = current version) → join live → Google or email → redeem `DRIP2026` as
`dachhack` → set a lineup → Admin → matchups → ▶ "force-resolve from 2025 wk 1" →
open the live board → real Drip scoring (nukes/drips) appears.
