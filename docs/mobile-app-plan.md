# Mobile — the PWA now, an Expo/React Native app next

_The plan of record for iOS/Android. Supersedes the one-line native-apps note in
`scale-2026-2027-plan.md` §3. The port's engineering detail — package boundary,
platform contract, screen-by-screen scope — lives in
**`docs/native-port-plan.md`**; this file is the product plan around it._

**The shape of it:** the installable PWA shipped before the 2026 season (§1) and
stays — it is how most people will first use this on a phone, and it costs
nothing to keep. Alongside it, build an **Expo/React Native** app off the shared
`@drip/core` package (§2), starting with the live-picks loop during the season
and moving playtesters onto it part-way through. Store submission is gated on §3.

> **This reverses an earlier version of this document**, which proposed Capacitor
> shells and argued against React Native. §4 keeps that argument, because the
> costs it names are real and now measured — it is the risk register for this
> plan, not a rejection of it. Read it before committing to the next screen.

---

## 1. Shipped: the installable PWA

The site is installable to a home screen on Android and iOS, and keeps working
offline. Nothing about the hosting changed — same GitHub Pages deploy, same
`dist/`.

| Piece | Where |
|---|---|
| Manifest | `public/manifest.webmanifest` |
| Icons (192 / 512 / maskable / apple-touch) | `public/icons/pwa/`, baked by `scripts/gen-pwa-icons.py` |
| Service worker | `public/sw.js`, precache list injected by `pwaServiceWorker()` in `vite.config.ts` |
| Registration + install-prompt state | `src/app/pwa.ts` |
| The banner | `src/app/InstallPrompt.tsx`, mounted in `App.tsx` |
| Events | `pwa_install_shown` / `_accepted` / `_declined` / `_dismissed`, `pwa_installed`; `app_open` gained `standalone` |

**The manifest uses relative URLs** (`./`, `./icons/...`) so one file serves all
three bases we build at: `dripfantasy.com` (`/`), the `/ffgame/` Pages preview,
and `/ffgame-staging/`. Vite rewrites the `<link rel=manifest>` href per base;
everything inside resolves against wherever the manifest landed.

**The caching rules are built around one fear** — that a cache pins somebody to an
old build on a Sunday while we're hotfixing. So:

- **Navigations are network-first.** A reload always gets the newly deployed
  `index.html`; the cached copy is only the offline fallback. A stale build can
  never outlive one reload.
- **`/assets/` is cache-first**, which is only safe because Vite content-hashes
  those filenames — a new deploy references new names, so nothing can be served
  stale. It's matched by *directory*, not by the running worker's own precache
  list, so a tab can always find chunks from the build it actually loaded.
- **Two shell generations are retained.** This fixes a bug that predates the PWA:
  GitHub Pages drops the previous deploy's files, so deploying mid-session used
  to break `React.lazy()` chunk loads in open tabs (a blank screen on any screen
  the user hadn't visited yet). Now those chunks come from cache.
- **No `skipWaiting()`.** A new worker waits for every old tab to close. Costs
  one session of lag before a new build is precached; buys the guarantee that
  assets are never swapped underneath a live board. Deliberate, given we shipped
  nine fixes during one live-fire night.
- **Nothing dynamic is cached.** Same-origin GET only, so Supabase (REST, auth,
  realtime) and PostHog fall straight through. `/pbp/` and `/gamefeed/` are
  excluded by name — megabytes of JSON the HTTP cache already handles.

**Kill switch:** set `KILL = true` at the top of `public/sw.js` and deploy. Every
client drops its caches and unregisters on next load, reverting to a plain
website. The worker script is registered with `updateViaCache: 'none'`, so a kill
deploy lands on the next navigation rather than up to ten minutes later.

**The install banner** waits 60 seconds on a first visit (a returning or
signed-in visitor gets it immediately), snoozes 45 days when dismissed, and never
reappears after an install. It's hidden on `matchup` / `final` so it can't sit on
top of a live playout. On Chromium it opens the real install dialog; on iOS
Safari — which has no install API — it shows the Share → Add to Home Screen
instructions instead.

### Verified
Driven with a headless Chromium against a disk-backed static server (`vite
preview` is useless here: it keeps serving files it has already deleted, so a
rebuild doesn't simulate a deploy). Worker activates and precaches all build
assets; the site renders offline after a reload, including lazy route chunks; a
tab open across a deploy keeps working with no chunk-load errors; a newly
deployed `index.html` wins over the cached one; shells stay bounded at two;
Supabase/PostHog and the big JSON payloads stay out of the caches; the kill
switch drops everything and unregisters.

### Not done, deliberately
- **Push notifications.** Web push would reach Android and installed-PWA iOS
  16.4+ only, and the server half is the same work either way — so it's scheduled
  once, with the native app (§2, step 7).
- **iOS launch images.** Without `apple-touch-startup-image` the standalone app
  shows a blank frame for a beat on cold start. It's ~10 device-specific PNGs;
  worth doing when the native app lands, not before.
- **`screenshots` in the manifest**, which would give Android the richer install
  dialog. Needs real captures.
- **Orientation lock.** Left as `any`. The board is a mobile column and portrait
  is probably right, but that's a product call to make on a real device.

---

## 2. The native app: Expo / React Native

Not a WebView wrapper. A second UI shell over the same game engine, sharing
`packages/core` with the web app so a rules change lands once and both hosts get
it. Scope, sequencing and the per-screen cost estimates are in
`docs/native-port-plan.md`; the short version:

**Done and on `main`:**
1. **`@drip/core` extracted** (~11k lines: engine, data, types, tokens,
   analytics). No `window`, `document`, `localStorage` or `import.meta` left in
   it, so Metro and `tsx` consume it unchanged — the pilot worker now imports it
   as a package instead of through `../../src` deep paths.
2. **The platform shim** (`packages/core/src/platform.ts`) — storage, env,
   assetUrl, URL, openUrl. This is what the Capacitor plan's old work list
   called for in items 2 and 3, solved once for every host:
   - `redirectTo()` no longer builds off `window.location.origin`; it asks
     `platform().url.redirectBase()`, which is the web origin on web and the
     `dripfantasy://` deep link on native.
   - **supabase-js was defaulting to `localStorage` with no adapter** — which
     does not exist in React Native, so sessions died on every app restart, and
     which iOS can evict even on web. It now takes the host's storage
     explicitly.
3. **The Expo app** (`apps/mobile/`) with `LivePicks` ported — the smallest
   screen that exercises auth, the slate, lock rules, the metric catalogue, the
   premium gate and the wallet. Typechecks and bundles (706 modules); **not yet
   run on a device.**

**Next, in order:**
4. **Run it on a device.** `npm run apk` (free Expo account, no Mac) or
   `npm run ios` on a Mac. Expect more web-shaped assumptions like the supabase
   one — they only surface when a second host reads the same code.
5. **Sign-in.** `LiveOnboard` is 1,541 lines covering magic link, invite codes,
   commish codes and solo passes. Until it lands, sign in on the web; it is the
   same account and the same session.
6. **The live board**, which is where §4's animation cost gets paid and where
   this plan is genuinely tested.
7. **Push notifications** — the one thing native buys a live game that the PWA
   cannot on iOS. A `device_tokens` table with RLS, registration on login, and
   worker/edge hooks on the moments that matter: lock at T-60, window reveal,
   you got nuked, a pot offer, matchup final. **Budget most of the time here,
   not on screens.**

**Keep the PWA.** It is shipped, it costs nothing to maintain, and it stays the
zero-friction path for cold traffic and for anyone who never installs an app.
The native app is for the people who play every week.

**What does NOT carry over:** the guided demo (`DemoBoard`), the admin console
and the commissioner tools stay web-only. See `native-port-plan.md` §4.

## 3. The two things that can block a store release

**The Window Pot.** A wager ladder with an ante, a cap and raises reads as
gambling to a reviewer whatever the chips are. Apple 4.7 and Play's gambling
policy tolerate *simulated* gambling — no purchasable stake, no cash-out — but
it's the most likely rejection vector and it pushes the rating to 17+/Teen.
Keeping it flagged off for the first submission is the cheap answer. **The moment
◎ is purchasable with money, the pot becomes a real-money product** and we're in
the DFS-licensing territory `scale-2026-2027-plan.md` §3 tells us to avoid.

**Premium is digital content.** The $5 personal / $30 league tiers in
`premium-model.md` become IAP the moment they're purchasable in-app — 30% (15%
under the Small Business Program), and split-pay is awkward to model as an IAP
product at all. US rules now permit linking out to a web checkout without
commission, but that's storefront-specific and still being litigated; don't build
the business case on it. Simplest v1: sell nothing in the app and let entitlements
bought on dripfantasy.com resolve at sign-in.

**Also required:** in-app account deletion (Apple 5.1.1(v) — mandatory for any app
with signup, and we don't have it), privacy nutrition labels plus a privacy
manifest covering PostHog, ToS/privacy URLs, and an age rating. And **Play makes
new personal developer accounts run 14 days of closed testing with 12 testers**
before production — open that track early or it's a hard two-week wall.

---

## 4. The risk register — what this port actually costs

Kept verbatim in substance from the version of this document that argued
*against* the port, because none of it stopped being true. It is the honest
list of what can go wrong, and the measurements so far.

**The UI does not port; it gets rewritten.** `src/engine` and `src/data` moved
cleanly — pure TS, and supabase-js runs in RN. Every screen has to be rebuilt.
The styling is inline style objects full of DOM-only values (`boxShadow`
strings, gradients, `position: fixed`, `color-mix`), and the things that *are*
the product — `FieldView`, `cardTable.tsx`, the pixel sprites,
`@keyframes nukeburst`, the SVG field draw — are DOM and CSS to their bones.

**Measured since:** ~17.5k lines of web UI, cut to ~7.7k for mobile by dropping
the demo, admin and commissioner surfaces. 133 `color-mix()` calls (97 are plain
alpha, handled by `theme.native.ts`), 13 CSS keyframes, 29 `gridTemplateColumns`,
11 `position: sticky`. The first ported screen came in *smaller* than its web
counterpart because it used shared components in a degenerate mode — one data
point that the estimate may be pessimistic, not proof.

**The unpaid bill is the live board.** Nothing ported so far animates. The
nuke/flip/field-draw moments are the product's signature and they are the real
test of Reanimated versus `@keyframes`. If this plan fails, it fails there —
so build that screen before committing to the remaining six.

**The fork risk is real.** Two UI shells means every new player-facing surface
ships twice. That is the standing tax, and it is why the demo, admin and
commissioner tools are explicitly web-only. Watch for it: if a feature starts
landing on one host and lagging on the other, that is the signal to reconsider.

**The bail-out, if it comes to that:** the extraction and the platform shim are
not wasted under any alternative. A Capacitor shell around the same `dist/`
would need exactly the auth-redirect and session-storage fixes already made, and
would keep `@drip/core` for the worker. Reversing course costs `apps/mobile/`
and nothing else.
