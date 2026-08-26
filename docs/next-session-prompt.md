# Next-session kickoff prompt

_Paste this into a fresh session to continue Drip Fantasy (dripfantasy.com)._

---

You're continuing **Drip Fantasy** — real-time H2H fantasy football, live at
**https://www.dripfantasy.com** with a sideloaded Android app. The founder
(super admin: mlporritt@gmail.com) drives, usually from a phone, usually with a
screenshot. Ship small, verified increments.

**State at handoff: `v0.358.1`, everything merged and deployed.** Migrations
through **0243** applied; latest APK is **versionCode 35801**. Work branch:
`claude/handoff-docs-next-session-fx74zy` (reset onto merged `main`).

**The forcing function: first lock is Sep 9, 2026.** Everything competes with
that date. Two weeks out at this writing, and the season's shape is set:
recruiting, not engine work, is the critical path.

## The three hosts, one core

- `packages/core/` — `@drip/core`: shared data layer (`data/liveApi.ts` is the
  RPC surface), the scoring engine (`engine/`), analytics, version. Both
  clients import it. **If a rule can be stated without a screen, it belongs
  here** — that's what makes it testable without a database.
- Web: `src/` (Vite + React, GitHub Pages). Signed-in shell
  `src/screens/LiveOnboard.tsx`; admin console `src/screens/AdminPage.tsx`;
  the board `src/screens/ClassicBoard.tsx`; the field `src/app/FieldView.tsx`;
  the rails `src/app/LeagueStrip.tsx`. Static assets live in `public/` and are
  referenced through `${import.meta.env.BASE_URL}`.
- App: `apps/mobile/` (Expo SDK 57 / RN 0.86, sideloaded playtest APKs).
  Routing is a view union in `App.tsx`; shared UI in `apps/mobile/src/ui/`.
- Worker: `server/` (Fly). `src/index.js` ticks per active week context;
  `src/lock.js` seals windows; `sweepNative` advances drafts and waivers;
  `src/push.js` detects what's worth a phone alert; `src/seatWire.js` spends
  the agent-seat waiver decisions.

Deploys are automatic from `main` (`deploy.yml` web, `deploy-worker.yml` Fly,
`deploy-functions.yml`, `migrate.yml` applies only NEW migration files).
**Merging IS deploying.**

## Non-negotiable discipline

1. **Migrations**: numbered files in `supabase/migrations/` (next: **0244**).
   Before ANY merge, prove it with **`./scripts/db/run-scratch-probes.sh`** —
   spins a throwaway Postgres 16, applies every migration, runs **65 probe
   suites**. Redirect it to a log; the output overflows context. Grep for
   `PROBE FAIL` (want none) and `ALL CONTRACT PROBES PASSED`. Every migration
   gets probes, and they must be **wired into the runner**, not just written.
   Traps that have bitten, more than once:
   - **All suites share ONE database.** A global assertion ("exactly 1
     metricless pick") will pass alone and fail in the suite. Scope every
     assertion to your own fixture league, or assert a delta.
   - **Respin from the LATEST body, never from memory.** Extract the function
     you're extending out of the migration that last defined it. Current
     lineage tips: `my_teams` → **0242**; `league_invite` → **0243**;
     `set_league_archived` → 0239; `chat_members` → 0238; `market` functions
     → 0237; `_contract_originate` / `commish_reset_draft` → 0235;
     `set_draft_setup` → 0234.
   - `auth.uid()` is shimmed from the **`app.uid`** setting, not
     `request.jwt.claims`. `app_user.id` FKs to `auth.users`.
   - Run pick/RLS sections under `set local role authenticated` — superuser
     bypasses RLS and proves nothing.
   - RLS policy subqueries run AS THE CALLER → cross-table checks live in
     SECURITY DEFINER helpers.
   - `is_admin()` checks the `app_admin` table by email. There is no column.
   - **A new column on a live table takes no `default now()`.** 0241 added
     `enrolled_at` nullable and stamped it with a trigger precisely so the
     backfill wouldn't page every commissioner about members who joined weeks
     ago. Ask what a backfilled value would TRIGGER before you write one.
2. **Versioning**: bump `packages/core/src/version.ts` on every deployable
   change (patch per deploy, minor per feature). Docs-only commits don't bump.
   APK `versionCode` = version × 100: v0.358.1 → 35801.
3. **The battery, before every merge** (all from the repo root):
   ```
   npm run typecheck                         # web + core
   (cd apps/mobile && npx tsc --noEmit)      # app
   npm run check:parity                      # 740 assertions, 27 scripts
   npm run build
   ./scripts/db/run-scratch-probes.sh        # 65 suites
   (cd server && npm run --silent smoke)
   ```
   **`cd apps/mobile && …` leaves you there.** Every root command after it
   fails in a way that looks like a different bug (`npm error … workspace
   @drip/mobile`, `sed: can't read packages/core/src/version.ts`). Start root
   commands with `cd /home/user/ffgame`. This cost time three times in one
   session.
4. **Merge flow**: work on the `claude/…` branch → PR → squash-merge to `main`
   → `git fetch origin main && git checkout -B <branch> origin/main &&
   git push -u origin <branch> --force-with-lease`. When a migration rode
   along, read the `migrate.yml` job log afterwards and confirm it applied.
5. **APK ritual** (arm64 only), when `apps/mobile` or `packages/core` changed:
   ```
   cd apps/mobile
   export ANDROID_HOME=/opt/android-sdk ANDROID_VERSION_CODE=<code>
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   npx expo prebuild --platform android --no-install
   printf 'sdk.dir=/opt/android-sdk\n' > android/local.properties
   ./android/gradlew -p android assembleRelease -PreactNativeArchitectures=arm64-v8a
   ```
   Verify with `apksigner`: certificate digest must be
   `b3fb017fcaaede1fdba4f44ffdad6db821987302321e60974f814f22436649b1`; check
   `versionCode` in `assets/app.config`; confirm the new version string is in
   the Hermes bundle and the old one is ABSENT. **Search the bundle in BOTH
   ASCII and UTF-16-LE** — any string containing an emoji, ✓ or ⚑ lands as
   utf-16, so an ASCII-only grep returns 0 matches for text that is right
   there. **THE TREE IS FROZEN WHILE GRADLE RUNS** — Metro bundles the working
   tree as it is, not the commit you launched from. Background the build if you
   like, but commit nothing and edit nothing until it exits. Send with
   `SendUserFile`, then `rm` the staged copy and confirm `git status` is clean.

## This environment

- **It comes up bare — provision it before you trust the battery.** Three gaps,
  none obvious from the failure:
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
     the APK ritual implies. `sdkmanager` is not an option either: every
     `commandline-tools-linux-*.zip` 404s through this proxy. What works is
     assembling it by hand from Google's manifest, which fetches fine:
     ```
     curl -sSL -o repo.xml https://dl.google.com/android/repository/repository2-3.xml
     # then, from the same host: build-tools_r35_linux.zip (→ build-tools/35.0.0),
     #   platform-35_r02.zip (→ platforms/android-35),
     #   platform-tools_r37.0.1-linux.zip (→ platform-tools)
     ```
     Write the accepted license hashes into `/opt/android-sdk/licenses/` or
     gradle stops to prompt. `apps/mobile/playtest.keystore` is committed and
     its password is in `android/app/build.gradle`, so signing needs nothing
     extra. A cold `assembleRelease` takes ~8½ minutes; a warm one ~4.
- **Capture gradle's exit code directly — never through a pipe.** `./gradlew …
  | tail -20` reports `tail`'s status, so a FAILED build looks like a clean
  exit 0 and you will report success on an APK that was never written.
  Redirect to a log and read `$?`.
- **No live database credentials.** `.env.local` is gitignored and absent.
  Production cannot be queried from here — that's what the scratch probes and
  the admin panels are for. To read production, hand the founder a SQL file and
  ask them to run **Actions → Run a database query** (`dbquery.yml`), or build
  the read as an admin RPC + panel (see `admin_metricless_picks`, 0211).
  **You cannot dispatch a workflow yourself** — `actions_run_trigger` returns
  403 "Resource not accessible by integration". Anything needing a dispatch
  needs the founder's hand; say so plainly rather than leaving it pending.
- **Headless Chromium is at `/opt/pw-browsers/chromium/chrome-linux/chrome`
  and it has been decisive over and over.** Measure in it — card width,
  name-box px, composer position, arc apex, path overlap — rather than
  reasoning from a screenshot. Measure before and after. Do this first, not
  last. A founder screenshot can also be measured directly (crop, threshold,
  find the edge): that is how the v0.356.13 keyboard fix got its missing 38dp.
- Outbound HTTPS goes through an agent proxy. Never disable TLS verification or
  unset `HTTPS_PROXY`; see `/root/.ccr/README.md`.
- GitHub MCP `actions_list` responses overflow context — save to a file and
  parse with python. GitHub 502s on merge are common: verify with
  `pull_request_read` before retrying, because the merge usually landed. The
  MCP server also drops mid-session; reload its tools with `ToolSearch`.

## Bug classes worth recognizing on sight

- **Two rulebooks.** The client computes a value the server will never score.
  This class has now cost four separate versions (v0.336.0's fabricated
  metric, v0.339.3's local `banksAtClock`, v0.339.6's banker/turnover/stipend
  drift, v0.341.0's staked effects applied in two different orders). The cure
  shipped: `engine/scoringRules.ts` holds every layered rule once,
  `engine/orchestrate.ts` holds the ORDER once, and
  `scripts/check-engine-parity.mjs` fails the build if a rule grows a second
  home. **Never re-derive a rule inside a screen.**
- **`??` does not catch an empty string.** `''` is the engine's canonical
  no-metric value; `metricId ?? default` sails straight past it. Same family:
  `Number(null) === 0` read a null seat count as "no seats".
- **`scorePlay` is a chain of `if (metricId === '…')` ending in `return 0`.**
  A metric that isn't in the chain scores exactly zero, silently.
- **CSS grid blowout**: bare `1fr` means `minmax(auto, 1fr)`, and `auto` is
  min-content. A wide child pushes the whole page off-screen. Use
  `minmax(0, 1fr)` on every track. `maxWidth` caps the box, not the track.
- **A remount re-guesses.** The rails flashed a DRAFT icon on every room
  change because `LeagueStrip` is rendered inside each view's own return, so
  each navigation remounted it with `draftDone = false` before the fetch
  answered. Tri-state (`boolean | null`, draw nothing while unknown) plus a
  module-level cache. Any "flashes then disappears" report is this shape.
- **A number that is right for the wrong axis.** Preseason board weeks are
  101–103 — numerically ABOVE real weeks 1–18 — so `order by week desc` served
  a practice roster as the live one. Sort keys that encode a category are a
  trap; `.lte('week', PRESEASON_BASE)` is the fix pattern.
- **Over-applying a fix.** v0.332.0 gave every carry its own lane; the founder
  came back with "it should just be arch then the yards after the arch." Gate
  the new behavior on the condition that actually motivated it.
- **Source-reading assertions** (a test that greps a migration or a TS file)
  guard duplicated lists and removed defaults well — strip `//` comment lines
  before matching, or the assertion catches the comment explaining itself.
- **Contrast is measurable; don't eyeball a theme.** The empty roster slot was
  a fixed gold that measured 5.3:1 on dark boards and **1.59:1** on the light
  ones. `scripts/check-card-contrast.mjs` now walks all seven themes on every
  parity run. Any "washed out" report deserves a number, not a nudge.

## Load-bearing design decisions (don't re-derive)

- **`draft.rounds` means ROSTER SIZE.** Keepers split "picks a team makes" from
  "roster cap" via `draft.keeper_slots`; every cap consumer is untouched.
- **Coin**: `team_wallet` + `coin_ledger`, invariant `sum(delta) == coins`.
  Never UPDATE a balance; always ledger through `adjust_wallet`.
- **Continuity is ONE axis, now five points**: REDRAFT / ★ KEEPER /
  🏰 DYNASTY / 📜 CONTRACT / 📜🏰 CONTRACT DYNASTY (`set_league_continuity`).
  Picking a contract type PRESETS the rest — the room is forced to an auction
  (bids become salaries) and the cap turns on at the auction budget. There is
  no "contract keeper". Rollover is gated by `_season_over` (Feb 15 of
  season+1); admins bypass for testing, so dynasty probe fixtures live in PAST
  seasons (2024).
- **Game mode, format and golf are separate axes from continuity.**
  `game_mode` drip|classic; `format` standard|guillotine|vampire; `golf` is a
  **classic-only** setting (`set_league_golf` refuses a drip league, so "Drip
  Golf" cannot exist). Classic needs an admin `classic_ok` unlock
  (`set_league_classic_access`) unless chosen at creation. Guillotine must be
  set pre-draft and locks once anyone is eliminated. All of it freezes when the
  draft starts. The full grid is in the published "Every shape a league can
  take" artifact; the rules are asserted in `format-probes.sql`.
- **Analytics identity**: `identify()` takes ONLY the Supabase user id; every
  other handle goes through `setTraits()`.
- **Single chokepoints**: `fa_window_open()` gates FA adds; the `applied_state`
  trigger covers every power-up path; `my_teams()` feeds both clients' league
  lists; `league_invite()` feeds all four invite surfaces; `lockDueWindows` is
  where a window seals; `applyPostSlotPipeline` is where effects land. Extend
  these, don't fork them — the reason 0242 and 0243 were one-line migrations is
  that the chokepoints were already there.
- **Auto-courtesies happen at lock, on the server**: auto-slot fields your best
  eligible player, and `metricGapFills` fills a missing metric — both inside
  `lockDueWindows`, before the lock update, so no window is sealed incomplete.
- **An agent seat tends its roster, it does not strip-mine it**
  (`engine/seatWaivers.ts`): a HOLE (empty or zeroed starting spot) clears on
  any positive gain; an UPGRADE over a healthy starter must beat
  `UPGRADE_MIN_GAIN`. The asymmetry is the design — one threshold either
  ignores injuries or churns.
- **Android chat is edge-to-edge**, so the window never resizes for the
  keyboard and `KeyboardAvoidingView` cannot work. Use `useKeyboardInset()`
  (`apps/mobile/src/ui/keyboard.ts`); it adds back the nav-bar inset that RN's
  `keyboardDidShow` subtracts. The file explains the exact RN source line.

## What to pick up

1. **Redeploy the Fly worker.** `server/src/push.js` gained the join detector
   (`detectMembers`) and the every-message chat path in v0.357.0, and
   `server/src/seatWire.js` before it. Migration 0241, the prefs UI and the
   RPCs are all live; **nothing detects until that worker restarts**, and it is
   outside this repo's deploy. Needs the founder's `fly deploy`.
2. **Run `scripts/db/external-roster-weeks.sql`** (Actions → Run a database
   query, writes off). It asks whether each imported league has a real-week
   `sleeper_lineup` row or only preseason ones. If a league reads
   `real_week_rows = 0`, web MY TEAM honestly says "No synced roster yet" and
   the fix is a live Sleeper fetch. Needs the founder's dispatch.
3. **Live-fire the dynasty and contract loops** on a real league before the
   season relies on them: keeper count + rookie rounds, declare keepers, trade
   a pick, roll, run the draft, confirm the traded slot lands on the acquirer's
   clock — and for contracts, lock a cap sheet, tag someone, extend someone,
   run an RFA tender to both outcomes. Probes cover the SQL end to end;
   **no production league has ever rolled over.** Needs the founder.
4. **Rebake `proj2026.ts` + `adp2026.ts` right up to Sep 9** — last pulled
   **2026-08-22** (`projStats2026.ts` rides the SAME `get_projections` call —
   all three or none; the proj-scoring suite fails on a split pull, and
   check-draft-spots pins three values so a rebake forces its fixtures to be
   revisited). Auto-slot, seat agents, previews, keeper defaults and the
   auction AI all rank by these numbers. Each file's header carries its own
   call and join convention; read `proj2026.ts`'s note on why the stored number
   is `ppg * games / 17` before changing the bake's shape.
5. **Recruiting is the critical path now.** `?game=classic` + the classic demo
   board (v0.358.0) + the invite panel's look-first link (v0.358.1) are live.
   What's untested is whether a cold recruit lands, understands and signs.
   Watch the funnel; the demo is the pitch.
6. **Nobody is told when someone lands in a league's waiting room.** Offered,
   not built (v0.326.0 added the commissioner's "League Full" close). 0241's
   push plumbing makes this cheap now — it is the same detector shape as
   `detectMembers`.
7. **Reply to StatHead** about their "unknown fields are named" message not
   firing in CSV mode (`docs/mcp-requests.md`).
8. Dynasty polish when it earns a session: multi-year futures, draft-day pick
   trades, resizing a ROLLED league's pending rookie draft.

## How the founder works

Screenshots, one line of context, high trust, fast cadence. They are usually
right about *what* is wrong and not always about *why* — reproduce before
diagnosing. When a fix lands wrong they say so plainly and immediately ("Still
below the keys"); take that as the signal to narrow the fix, not to defend it.
They will send a follow-up requirement mid-turn — fold it in rather than
finishing the smaller version first. Every change ships the same day it's asked
for: version bump, STATUS entry, battery, PR, squash-merge, branch reset, and a
verified APK when the app changed. "merge please" means PR + squash-merge +
branch reset; "merge and apk" adds the build; "merge and deploy" is the same
thing as "merge" — the deploy is automatic.
