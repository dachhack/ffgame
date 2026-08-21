# Next-session kickoff prompt

_Paste this into a fresh session to continue Drip Fantasy (dripfantasy.com)._

---

You're continuing **Drip Fantasy** — real-time H2H fantasy football, live at
**https://www.dripfantasy.com** with a sideloaded Android app. The founder
(super admin: mlporritt@gmail.com) drives, usually from a phone, usually with a
screenshot. Ship small, verified increments.

**State at handoff: `v0.337.0`, everything merged and deployed.** Migrations
through **0212** applied; latest APK is **versionCode 33700**. Work branch:
`claude/dynasty-season-rollover-dt4xbk` (reset onto merged `main`).

**The forcing function: first lock is Sep 9, 2026.** Everything competes with
that date.

## The three hosts, one core

- `packages/core/` — `@drip/core`: shared data layer (`data/liveApi.ts` is the
  RPC surface), the scoring engine (`engine/`), analytics, version. Both
  clients import it. **If a rule can be stated without a screen, it belongs
  here** — that's what makes it testable without a database.
- Web: `src/` (Vite + React, GitHub Pages). Signed-in shell
  `src/screens/LiveOnboard.tsx`; admin console `src/screens/AdminPage.tsx`;
  the board `src/screens/ClassicBoard.tsx`; the field `src/app/FieldView.tsx`.
- App: `apps/mobile/` (Expo/RN, sideloaded playtest APKs). Routing is a view
  union in `App.tsx`; shared UI in `apps/mobile/src/ui/`.
- Worker: `server/` (Fly). `src/index.js` ticks per active week context;
  `src/lock.js` seals windows; `sweepNative` advances drafts and waivers.

Deploys are automatic from `main` (`deploy.yml` web, `deploy-worker.yml` Fly,
`deploy-functions.yml`, `migrate.yml` applies only NEW migration files).

## Non-negotiable discipline

1. **Migrations**: numbered files in `supabase/migrations/` (next: **0213**).
   Before ANY merge, prove it with **`./scripts/db/run-scratch-probes.sh`** —
   spins a throwaway Postgres 16, applies every migration, runs **59 probe
   suites**. Every migration gets probes, and they must be **wired into the
   runner**, not just written. Traps that have bitten, more than once:
   - **All suites share ONE database.** A global assertion ("exactly 1
     metricless pick") will pass alone and fail in the suite. Scope every
     assertion to your own fixture league, or assert a delta.
   - `auth.uid()` is shimmed from the **`app.uid`** setting, not
     `request.jwt.claims`. `app_user.id` FKs to `auth.users`.
   - Run pick/RLS sections under `set local role authenticated` — superuser
     bypasses RLS and proves nothing.
   - RLS policy subqueries run AS THE CALLER → cross-table checks live in
     SECURITY DEFINER helpers.
   - When you copy a SQL function body to extend it, copy it from the **LIVE**
     migration and re-read it. Do not reconstruct it from memory.
   - `is_admin()` checks the `app_admin` table by email. There is no column.
2. **Versioning**: bump `packages/core/src/version.ts` on every deployable
   change (patch per deploy, minor per feature). Docs-only commits don't bump.
   APK `versionCode` = version × 100: v0.337.0 → 33700.
3. **The battery, before every merge**:
   ```
   npx tsc --noEmit                          # web
   (cd apps/mobile && npx tsc --noEmit)      # app
   npm run check:parity                      # 718 assertions, 16 scripts
   npx vite build
   ./scripts/db/run-scratch-probes.sh        # 59 suites
   (cd server && npm run --silent smoke)
   ```
4. **Merge flow**: work on the `claude/…` branch → PR → squash-merge to `main`
   → `git fetch origin main && git checkout -B <branch> origin/main &&
   git push -u origin <branch> --force-with-lease`.
5. **APK ritual** (arm64 only), when `apps/mobile` or `packages/core` changed:
   ```
   cd apps/mobile
   export ANDROID_HOME=/opt/android-sdk ANDROID_VERSION_CODE=<code>
   npx expo prebuild --platform android --no-install
   printf 'sdk.dir=/opt/android-sdk\n' > android/local.properties
   (cd android && ANDROID_HOME=/opt/android-sdk \
      ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)
   ```
   Verify with **build-tools 35.0.0**'s `apksigner` (36.0.0 is also installed
   and is not the one to use). Certificate digest must be
   `b3fb017fcaaede1fdba4f44ffdad6db821987302321e60974f814f22436649b1`; check
   `versionCode` in `assets/app.config`; confirm the new version string is in
   the Hermes bundle and the old one is ABSENT — **both ASCII and UTF-16-LE**.
   **THE TREE IS FROZEN WHILE GRADLE RUNS** — Metro bundles the working tree as
   it is, not the commit you launched from. Background the build if you like,
   but commit nothing and edit nothing until it exits. Send with
   `SendUserFile`, then `rm` the staged copy and confirm `git status` is clean.

## This environment

- **It comes up bare — provision it before you trust the battery.** Three gaps,
  all hit in one session (v0.337.1), none of them obvious from the failure:
  1. **No `node_modules`, in any of the three workspaces.** `npm install` in
     the repo root, in `apps/mobile`, AND in `server/`. Without them
     `check:parity` dies on `tsx: not found`, the mobile `tsc` reports a
     missing `expo/tsconfig.base`, and the server smoke can't find `dotenv`.
  2. **JDK 21 only; the APK build needs 17.** Expo's gradle plugin pins a
     `languageVersion=17` toolchain and auto-provisioning is blocked (foojay
     returns 403 through the proxy). `apt-get update` FIRST — the shipped apt
     index is stale and every `openjdk-17-*` archive 404s until you refresh it
     — then `apt-get install -y openjdk-17-jdk-headless`.
  3. **No Android SDK at all** — `/opt/android-sdk` does not exist, whatever
     the APK ritual below implies. `sdkmanager` is not an option either: every
     `commandline-tools-linux-*.zip` 404s through this proxy, including build
     numbers that certainly exist. What works is assembling it by hand from
     Google's manifest, which fetches fine:
     ```
     curl -sSL -o repo.xml https://dl.google.com/android/repository/repository2-3.xml
     # then, from the same host: build-tools_r35_linux.zip (→ build-tools/35.0.0),
     #   platform-35_r02.zip (→ platforms/android-35),
     #   platform-tools_r37.0.1-linux.zip (→ platform-tools)
     ```
     Write the accepted license hashes into `/opt/android-sdk/licenses/` or
     gradle stops to prompt. `apps/mobile/playtest.keystore` is committed and
     its password is in `android/app/build.gradle`, so signing needs nothing
     extra. A cold `assembleRelease` then takes ~8½ minutes.
- **Capture gradle's exit code directly — never through a pipe.** `./gradlew …
  | tail -20` reports `tail`'s status, so a FAILED build looks like a clean
  exit 0 and you will report success on an APK that was never written.
  Redirect to a log and read `$?`.
- **No live database credentials.** `.env.local` is gitignored and absent.
  Production cannot be queried from here — that's what the scratch probes and
  the admin panels are for. To read production, hand the founder a SQL file and
  use **Actions → Run a database query** (`dbquery.yml`), or build the read as
  an admin RPC + panel (see `admin_metricless_picks`, 0211).
- **Headless Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  and it has been decisive over and over.** Every CSS/SVG bug this session was
  solved by *measuring* in it — card width, name-box px, composer position,
  arc apex, path overlap — not by reasoning from a screenshot. Measure before
  and after. Do this first, not last.
- Outbound HTTPS goes through an agent proxy. Never disable TLS verification or
  unset `HTTPS_PROXY`; see `/root/.ccr/README.md`.
- GitHub MCP `actions_list` responses overflow context — save to a file and
  parse with python. GitHub 502s on merge are common: verify with
  `pull_request_read` before retrying, because the merge usually landed.

## Bug classes worth recognizing on sight

- **Two rulebooks.** The client computes a value the server will never score.
  Monty's "missing metric" was this: the web fabricated `pickMetric(found, 0)`
  in `lookup()` and displayed a metric the resolver ignored (v0.336.0). If a
  screen shows something, it must be the row the engine reads.
- **`??` does not catch an empty string.** `''` is the engine's canonical
  no-metric value; `metricId ?? default` sails straight past it. Same family:
  `Number(null) === 0` read a null seat count as "no seats".
- **`scorePlay` is a chain of `if (metricId === '…')` ending in `return 0`.**
  A metric that isn't in the chain scores exactly zero, silently.
- **CSS grid blowout**: bare `1fr` means `minmax(auto, 1fr)`, and `auto` is
  min-content. A wide child pushes the whole page off-screen. Use
  `minmax(0, 1fr)` on every track. `maxWidth` caps the box, not the track.
- **Over-applying a fix.** v0.332.0 gave every carry its own lane; the founder
  came back with "it should just be arch then the yards after the arch." Gate
  the new behavior on the condition that actually motivated it.
- **Source-reading assertions** (a test that greps a migration or a TS file)
  guard duplicated lists and removed defaults well — strip `//` comment lines
  before matching, or the assertion catches the comment explaining itself.

## Load-bearing design decisions (don't re-derive)

- **`draft.rounds` means ROSTER SIZE.** Keepers split "picks a team makes" from
  "roster cap" via `draft.keeper_slots`; every cap consumer is untouched.
- **Coin**: `team_wallet` + `coin_ledger`, invariant `sum(delta) == coins`.
  Never UPDATE a balance; always ledger through `adjust_wallet`.
- **Continuity is ONE axis**: REDRAFT / ★ KEEPER / 🏰 DYNASTY
  (`set_league_continuity`). Rollover is gated by `_season_over` (Feb 15 of
  season+1); admins bypass for testing, so dynasty probe fixtures live in PAST
  seasons (2024). Dynasty pick assets are season-tagged; `rollover_league`
  carries them and re-provisions to keep a three-season horizon.
- **Analytics identity**: `identify()` takes ONLY the Supabase user id; every
  other handle goes through `setTraits()`.
- **Single chokepoints**: `fa_window_open()` gates FA adds; the `applied_state`
  trigger covers every power-up path; `my_teams()` feeds both clients' league
  lists; `lockDueWindows` is where a window seals. Extend these, don't fork.
- **Auto-courtesies happen at lock, on the server**: auto-slot fields your best
  eligible player for an empty spot, and (v0.337.0) `metricGapFills` fills a
  missing metric — both inside `lockDueWindows`, before the lock update, so no
  window is ever sealed incomplete.

## What to pick up

1. **Live-fire the dynasty loop** on a real league before the season relies on
   it: keeper count + rookie rounds, declare keepers, trade a pick, roll, open
   the new league on both hosts, run the draft, confirm the traded slot lands
   on the acquirer's clock. The probes cover the SQL end to end; **no
   production league has ever rolled over.** Needs the founder.
2. **Rebake `proj2026.ts` + `adp2026.ts` through August** — both are as of
   **2026-08-19**, and ADP moves all summer, so they want a weekly pull right
   up to the Sep 9 lock. Auto-slot, seat agents, previews and keeper defaults
   all rank by these numbers, so a stale bake mis-ranks every one of them.
   Each file's header carries its own `get_projections` / `get_adp` call and
   the join convention; `proj2026.ts` additionally documents why the stored
   number is `ppg * games / 17` and not StatHead's `ppg` — read that before
   changing the shape of the bake.
3. **Audit server-side `injuryFor` callers** — with no live install and no
   season set it serves the BAKED 2025 report. Note the shape of the fix that
   landed for the sibling bug in v0.337.2 (below): the client-side half of this
   family is already handled, so check what the WORKER resolves, not the
   screens.
4. **Nobody is told when someone lands in a league's waiting room.** Offered,
   not built (v0.326.0 added the commissioner's "League Full" close).
5. **Reply to StatHead** about their "unknown fields are named" message not
   firing in CSV mode (`docs/mcp-requests.md`).
6. Dynasty polish when it earns a session: multi-year futures, draft-day pick
   trades, resizing a ROLLED league's pending rookie draft.

_Done and merged this arc: the web's live screens now install the league pool's
slug meta at the `buildLiveLeague` chokepoint (v0.337.2), and the app's
commissioner map lays out in two columns (v0.337.1)._

## How the founder works

Screenshots, one line of context, high trust, fast cadence. They are usually
right about *what* is wrong and not always about *why* — reproduce before
diagnosing. When a fix lands wrong they say so plainly and immediately; take
that as the signal to narrow the fix, not to defend it. Every change ships the
same day it's asked for: version bump, STATUS entry, battery, PR, squash-merge,
branch reset, and a verified APK when the app changed.
