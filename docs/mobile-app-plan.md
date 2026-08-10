# Mobile — the PWA now, native shells next season

_The plan of record for iOS/Android. Supersedes README "Phase 3" (which proposed an
Expo/React Native port) and the one-line native-apps note in
`scale-2026-2027-plan.md` §3._

**The shape of it:** ship the installable PWA before the 2026 season (done — §1),
build the Capacitor shells *during* the season, submit for the 2027 season. Do not
rewrite the UI in React Native (§4 says why).

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
  once, with the native shells (§2).
- **iOS launch images.** Without `apple-touch-startup-image` the standalone app
  shows a blank frame for a beat on cold start. It's ~10 device-specific PNGs;
  worth doing when the native shells land, not before.
- **`screenshots` in the manifest**, which would give Android the richer install
  dialog. Needs real captures.
- **Orientation lock.** Left as `any`. The board is a mobile column and portrait
  is probably right, but that's a product call to make on a real device.

---

## 2. Next season: Capacitor shells

Wrap the same `dist/` in a native WebView. Same codebase, same deploys, two store
listings. The engineering is small; the store work is not.

**Code changes needed:**
1. **Base.** Native serves from `capacitor://localhost`, so the native build needs
   `VITE_BASE=/`. Routing is already hash-based, which works unmodified.
2. **Auth redirects.** `redirectTo()` in `src/data/liveApi.ts` builds off
   `window.location.origin`. Magic links, OAuth and password reset all need a
   custom scheme (`com.dripfantasy.app://auth`) in the Supabase allowlist, plus an
   `appUrlOpen` listener that hands the token back to supabase-js. Universal
   Links / App Links for `dripfantasy.com/?live=1&code=…` so invite links open the
   app — invites *are* the access model, so this one matters.
3. **Session storage.** supabase-js defaults to localStorage, which iOS can evict.
   Use a Capacitor Preferences storage adapter so nobody gets signed out mid-season.
4. **Foreground/background.** Every live surface polls on `setInterval`
   (`Matchup.tsx`, `NativeLeague.tsx`, `WindowPot.tsx`) and iOS suspends WebView
   timers on background; the Supabase realtime channel dies silently too. Needs a
   resume handler that refetches and reconnects, wired to `appStateChange`.
5. **Safe areas.** `viewport-fit=cover` is set and `cardTable.tsx` already uses
   `env(safe-area-inset-bottom)`, but the sticky header in `src/app/ui.tsx` doesn't.
6. **OTA updates — not optional.** Store review is 24–48h; we hotfix during games.
   Capacitor Live Updates (or Capgo) pushes new web assets to installed apps
   without review. Both stores allow it as long as the app's purpose is unchanged.

**The genuinely new backend work is push:** a `device_tokens` table with RLS,
registration on login, and worker/edge hooks firing APNs+FCM on the moments that
matter — lock at T-60, window reveal, you got nuked, a pot offer, matchup final.
Budget most of the time here, not on the shell.

---

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

## 4. Why not React Native

`src/engine` and `src/data` would port cleanly — pure TS, and supabase-js runs in
RN. Every screen would not. The styling is inline style objects full of DOM-only
values (`boxShadow` strings, gradients, `position: fixed`, `color-mix`), and the
things that *are* the product — `FieldView`, `cardTable.tsx`, the pixel sprites,
`@keyframes nukeburst`, the SVG field draw — are DOM and CSS to their bones.
That's a months-long rewrite that forks the codebase, in exchange for native
rendering we have no evidence we need. Revisit only if the WebView demonstrably
can't hold frame rate on low-end Android during a live board.
