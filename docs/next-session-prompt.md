# Next-session kickoff prompt

_Paste this into a fresh session to continue Drip Fantasy (dripfantasy.com)._

---

You're continuing **Drip Fantasy** — real-time H2H fantasy football, live at
**https://www.dripfantasy.com**, mid-transition of playtesters from web to the
Android app during the 2026 preseason. The founder (super admin:
mlporritt@gmail.com) drives; ship small, verified increments.

**State as of this handoff: `v0.166.1`, everything merged and deployed.**
Migrations through **0132** applied to production; web (Pages), worker (Fly) and
functions deploy from `main` automatically; latest sideloaded APK is
**versionCode 16601**.

## The three hosts, one core

- `packages/core/` — `@drip/core`: shared data layer (`data/liveApi.ts` is the
  RPC surface), analytics, version. Web and app both import it.
- Web: `src/` (Vite + React, GitHub Pages). Signed-in shell:
  `src/screens/LiveOnboard.tsx`; admin console `src/screens/AdminPage.tsx`.
- App: `apps/mobile/` (Expo/RN, sideloaded playtest APKs). Routing is a view
  union in `App.tsx` — tabs per open native league: `▦ MATCHUP / ⛏ DRAFT /
  ⇄ MY TEAM / ⚑ COMMISH` (`'picks' | 'draft' | 'team' | 'commishtools'`).
  Screens: `Leagues` (ALL / ⚑ COMMISH filter; every commissioned league listed,
  Sleeper ones included), `LivePicks`, `Draft`, `Team` (own team only),
  `CommishTools` (seats/co-managers/coin/players/settings; platform leagues get
  the league-agnostic subset), `Admin`, `Recruit`. Shared UI in
  `apps/mobile/src/ui/` (`CommishSettings`, `LeagueExtras`, `TradeCenter`,
  `AvatarGrid`, `prims`).
- Worker: `server/` (Fly). `src/index.js` ticks per active week context
  (regular + preseason at +100); `sweepNative` advances drafts, clears waivers,
  and auto-grants the weekly coin allowance.

## Non-negotiable discipline

1. **Migrations**: numbered files in `supabase/migrations/` (next: **0133**).
   `migrate.yml` applies only NEW files on merge to `main`. Before ANY merge,
   prove the migration with **`./scripts/db/run-scratch-probes.sh`** — spins a
   throwaway Postgres 16, applies all migrations, runs SEVEN probe suites (all
   must pass). Add probes for anything you add. Traps that have bitten:
   - RLS policy subqueries run AS THE CALLER → checks against no-policy tables
     must live in SECURITY DEFINER helpers (see `co_manages_pick`, 0125).
   - Probes must run pick/RLS sections under `set local role authenticated` —
     superuser bypasses RLS and proves nothing.
   - Worker-only functions: `revoke … from public; grant … to service_role`
     (see `adjust_wallet`, `auto_weekly_budget`).
2. **Versioning**: bump `packages/core/src/version.ts` every deployable change
   (patch per deploy, minor per feature). APK `versionCode` = version × 100
   pattern: v0.166.1 → 16601.
3. **Merge flow**: work on your `claude/…` branch → PR → squash-merge to
   `main` → `git fetch origin main && git checkout -B <branch> origin/main &&
   git push -u origin <branch> --force-with-lease=<branch>:<old-sha>`.
4. **APK ritual** (arm64 only; the override doesn't survive `--clean` unless
   env is set at BOTH steps):
   ```
   cd apps/mobile && export ANDROID_HOME=/opt/android-sdk \
     ANDROID_VERSION_CODE=<code> \
     VITE_POSTHOG_KEY=phc_mSSEUxhSRiRPaVmpPvFAWNUaZHf2x6yNznHvocSA7tSS
   npx expo prebuild --platform android --clean
   cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
   ```
   Verify before sending, every time: apksigner cert `CN=Drip Fantasy
   Playtest`; `versionCode` in `assets/app.config`; PostHog key in
   `assets/app.config`; new version string present and old one ABSENT in the
   Hermes bundle — check **both ASCII and UTF-16-LE** encodings.
   **THE TREE IS FROZEN WHILE GRADLE RUNS.** Metro bundles from the working
   tree AS IT IS during the build, not from the commit you launched at —
   editing mid-build produced two hybrid APKs on 2026-08-14 (caught only by
   the version-string check). Background the build if you like, but commit
   nothing, bump nothing, and edit nothing until it exits. Also: this remote
   env has NO Android SDK baked in — install JDK 17 + cmdline-tools + accept
   licenses first (see HANDOFF 2026-08-13), or bake them into a SessionStart
   hook.

## Load-bearing design decisions (don't re-derive)

- **Coin**: `team_wallet` (league, roster) + `coin_ledger`; invariant
  `sum(delta) == coins` — never UPDATE balances, always ledger via
  `adjust_wallet`. Levers: per-seat `commish_seed_coin`, league-wide
  `commish_bulk_coin` / `commish_clear_coin` (0131), weekly allowance
  `commish_set_weekly_budget` + idempotent per-week grant. **The allowance
  auto-grants**: worker calls `auto_weekly_budget(week)` each tick (0132), same
  idem_key as the manual button → one payment per (league, week, roster).
- **Analytics identity**: `identify()` takes ONLY the Supabase user id (both
  hosts), email attached as a trait; all other handles (Sleeper username) go
  through `setTraits()` — a second identified id would permanently split the
  person in PostHog. Persons split before 2026-08-13 stay split.
- **Co-managers (0125)**: co-managers write the OWNER's `sealed_pick` rows;
  identity threads as `pick_user_id` through `my_teams()` → Enrollment →
  `OpenLeague` → LivePicks. Power-up inventories stay personal; wallets are
  roster-keyed.
- **Illegal-roster lockout (0128)**: `enforce_legal_roster` on `sealed_pick` +
  `applied_state`. **Admins are exempt** — to see the lock fire, test with a
  non-admin account.
- **Single chokepoints**: `fa_window_open()` gates all FA adds;
  the `applied_state` trigger covers every power-up path; `my_teams()` feeds
  both clients' league lists. Extend these, don't fork them.
- Self-driving pattern: idempotent server fn + client-load call + worker sweep
  as safety net (`process_waivers` is the template).

## What shipped in the last session (2026-08-13, v0.165.0 → v0.166.1)

⚑ COMMISH tab (commissioner tools out of MY TEAM; gear-menu Commish screen
deleted); PostHog identity fix; every commissioned league in Your Leagues with
ALL/⚑ COMMISH filter (Sleeper leagues get MATCHUP + COMMISH tabs, seat
management works there); per-seat coin balances on the 💰 chips (0130); bulk
grant/dock + zero-all + weekly allowance card (0131); auto weekly allowance
(0132). Another session shipped 0129 (admin fixes a lead's mistyped email).

## Open items / watchouts

- **Real-device passes never done** for: co-manager loop (LEAVE → MANAGE →
  ＋ME), draft-room mock, trades end-to-end, lockout banner (needs non-admin),
  the new coin card, Sleeper-league COMMISH tab.
- **Preseason live-fire test** pending: watch a real evening window go
  scheduled → live → sealed picks → scores (⚙ → Admin health `LAST PLAY IN`).
- Playtesters are being moved onto the app mid-season — expect quick-turn asks;
  the cadence is: implement → probe → merge → verified APK per request.
- GitHub MCP `actions_list` responses overflow context — parse the saved JSON
  file with python (see any recent session transcript for the idiom).
