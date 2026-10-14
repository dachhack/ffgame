# Next-session kickoff prompt

_Paste this into a fresh session to continue Drip Fantasy (dripfantasy.com)._

---

You're continuing **Drip Fantasy** — real-time H2H fantasy football, live at
**https://www.dripfantasy.com** with a sideloaded Android app. The founder
(super admin: mlporritt@gmail.com) drives, usually from a phone, usually with a
screenshot. Ship small, verified increments.

**State at handoff: `v0.708.4`, everything merged and deployed (Oct 14).**
Migrations through **0503** applied (next: **0504**); ops errands through
**052** (next: **053**); latest APK is versionCode 40385; TestFlight's iOS
runtime is v0.656.3's (`apps/mobile/ios-build-runtime.txt`). Work branch:
`ccr-9ea4c0a9-m5lxbd` (resynced onto merged `main`). **HANDOFF.md's top
section ("The notifications arc") is the current state; the
numbers elsewhere in this prompt are from August and only the discipline
still holds.**

**The forcing function: first lock is Sep 9, 2026.** Everything competes with
that date. The founder is live-playtesting through the NFL preseason (PRE 4
just ran, Aug 27–29) on a real league ("Turf Warriors"), so bugs arrive as
screenshots from real games within minutes of happening.

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

1. **Migrations**: numbered files in `supabase/migrations/` (next: **0263**).
   Before ANY merge, prove it with **`./scripts/db/run-scratch-probes.sh`** —
   spins a throwaway Postgres 16, applies every migration, runs **~75 probe
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
   APK `versionCode` is **CI's business now**: `release-apk.yml` uses
   `40000 + run number`, derived from nothing anyone has to remember (see 5).
   The hand-built sequence stopped at 36950 and is deliberately below it. The
   gitignored `apps/mobile/android/app/build.gradle` still holds the local
   value, and only a local test build needs it touched (this container's
   `android/` dir persists between builds; a fresh container needs
   `expo prebuild` first).
3. **The battery, before every merge**:
   ```
   npx tsc --noEmit                          # web
   (cd apps/mobile && npx tsc --noEmit)      # app
   npm run check:parity                      # 28 scripts
   npx vite build                            # CHECK THE EXIT CODE
   ./scripts/db/run-scratch-probes.sh        # ~75 suites — when DB touched
   (cd server && npm test)                   # when worker/engine/core touched
   ```
4. **Merge flow**: work on the `claude/…` branch → PR → squash-merge to `main`
   → `git fetch origin main && git checkout -B <branch> origin/main &&
   git push -u origin <branch> --force-with-lease`.
5. **THE APK SHIPS ITSELF — DO NOT HAND-BUILD ONE AND ATTACH IT TO CHAT.**
   `.github/workflows/release-apk.yml` builds and publishes on every merge to
   `main` that touches `apps/mobile/**` or `packages/core/**` (~10 min), and
   republishes under one fixed tag so the URL never moves:

       https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk

   The site already links it from five places — the ⚙ menu (📱 Android app),
   the leagues-page chip, `#/changelog`, the FAQ and onboarding — all off
   `APK_URL` in `packages/core/src/data/changelog.ts`, and the app's What's New
   compares the installed build against the release's `manifest.json`. CI runs
   the same three checks a hand build does (versionCode, **CN=Drip Fantasy
   Playtest**, APP_VERSION in the bundle) and refuses to publish if any fail.

   So when the founder asks for the APK, the answer is the link, not a file.
   After merging, confirm the run went green and that `manifest.json` reports
   the version you just shipped — that is the delivery. CI's versionCode is
   `40000 + run number`, which is deliberately above the retired hand-built
   sequence (…36950), so a CI build always installs over a hand-built one.

   **Hand-building is for testing UNCOMMITTED work on a device** — nothing
   else. If you do it:
   ```
   # bump versionCode in apps/mobile/android/app/build.gradle (gitignored)
   cd apps/mobile/android
   export ANDROID_HOME=/opt/android-sdk
   ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
   ```
   (~5 min warm; a fresh container needs `npx expo prebuild --platform android
   --no-install` + `local.properties` first, and possibly the SDK provisioning
   in "This environment" below.) Verify all three the same way:
   `aapt2 dump badging` shows the new `versionCode`; `apksigner verify
   --print-certs` shows **CN=Drip Fantasy Playtest**; the new `APP_VERSION`
   string is in the bundled `assets/index.android.bundle` (unzip -p | grep —
   note Hermes stores any string containing a non-ASCII character as UTF-16,
   so an ASCII grep gives false negatives on em dashes and emoji).
   **THE TREE IS FROZEN WHILE GRADLE RUNS** — Metro bundles the working tree as
   it is, not the commit you launched from. Background the build if you like,
   but commit nothing and edit nothing until it exits. Stage a copy in the
   scratchpad before sending — don't send from `build/outputs`, the next build
   overwrites it mid-download.

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

0. **The new notifications' first live week** (v0.708.x): the night-before
   lineup check, waiver eves, big plays, the sweat, finals and coin — see
   HANDOFF's top section for where each lives and what to watch.
1. **Week 6 settles Tuesday Oct 20** — the first live week for the auto
   "hurt in his game" (v0.701.0, the 🩹), the landing week's flip on
   Wednesday (v0.699.2), the result cards, and the coin lines. **In week 5
   nobody in the Weekly Cointest got "built your squad" or a streak coin**
   (ops 051): if that repeats, the `built` rule in `contestCoin.ts` is not
   firing — probe before touching it.
2. **The Rams** (v0.707.0) are on the week-6 and week-7 boards, confirmed
   by ops 052. Team codes now go through `packages/core/src/data/teamCodes.ts`
   and `check:teamcodes` fails a raw comparison; waive a one-source line
   with `// team-code: same source — why`, never by loosening the scan.
3. **The first shotgun wedding through the private vows** (0494): the 💍
   chip → My Team › Trades, the other team's push, the commissioner's
   view under the shotgun switch.
4. **Production reads** are committed ops errands now (`ops/run/NNN.json`,
   `mode: query`, a SQL file under `scripts/db/` that starts with
   `set search_path = public;`). Workflow dispatch is 403 from a cloud
   session; the errand runs on merge to main and only new files run.
5. Older, still real: the app's targeted APPLY flows for classic power-ups
   (web-only), PII minimization of the PostHog identify trait, waiting-room
   notifications, the 2027 rollover polish.

_Done and merged Oct 12–13 (v0.699.2 → v0.707.0): see HANDOFF.md's top
section — power-ups reaching the stored score and the re-score of weeks
1–5, the landing week, hurt-in-his-game, the card drag and the rules-of-hooks
check, locked cards opening the game log, the full-screen trade composer,
the private shotgun vows and the 💍 chip, the query errand, and the Rams
with the one team-code table and its check._

## How the founder works

Screenshots, one line of context, high trust, fast cadence. They are usually
right about *what* is wrong and not always about *why* — reproduce before
diagnosing. When a fix lands wrong they say so plainly and immediately; take
that as the signal to narrow the fix, not to defend it. Every change ships the
same day it's asked for: version bump, STATUS entry, battery, PR, squash-merge,
branch reset, and a verified APK when the app changed.
