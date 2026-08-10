# Native port plan

How Drip Fantasy gets an iOS/Android app without pausing the web product, and
how playtesters move from one to the other mid-season.

**Shape:** one shared core, two UI shells. The web app is not rewritten, frozen,
or wrapped — it keeps shipping from the repo root exactly as it does now. The
mobile app is a second consumer of the same engine.

```
ffgame/
  packages/core/   shared: engine, data, types, tokens, analytics   ~11k lines  ✅ DONE
  src/             the web app — screens + app shell (unchanged)     ~17.5k lines
  apps/mobile/     Expo app — its own screens                        to build
  server/          pilot worker — now imports core as a package
```

---

## 1. What `packages/core` contains

Extracted, building green, worker smoke passing.

| Moved from | To | Lines |
|---|---|---|
| `src/engine/` | `packages/core/src/engine/` | 2,849 |
| `src/data/` (52 files) | `packages/core/src/data/` | 7,508 |
| `src/types.ts`, `src/config.ts`, `src/theme.ts` | `packages/core/src/` | ~470 |
| `src/app/analytics.ts`, `src/app/version.ts` | `packages/core/src/` | ~130 |

`analytics.ts` moved because it was the **only** reverse dependency in the whole
tree — `data/premiumClient.ts` imported it from `app/`. It was already
vendor-agnostic (a pluggable sink), so it belongs in core; the PostHog adapter
stays in the web shell and registers at boot. Nothing else in `data/` or
`engine/` pointed upward at UI code, which is why this extraction was mechanical
rather than a refactor.

**Source-only package, no build step.** `@drip/core` exports `./*` → `./src/*.ts`.
Vite compiles it as part of the app (HMR works across the boundary), Metro will
do the same, and `tsx` runs it directly for the worker. No compile ordering, no
stale `dist/`.

**Subpath imports, not a barrel.** Call sites are `@drip/core/data/league`,
`@drip/core/engine/sim`. A single re-exporting `index.ts` would have pulled the
baked stat tables (`statsRaw`, `headshots`, `proj2026`) into the landing chunk
and undone the existing code-splitting. Verified: chunk structure is identical
before and after, landing payload 143.98 → 144.66 kB gzip (+0.5%, the shim).

---

## 2. The platform shim — the one seam

`packages/core/src/platform.ts` is the entire contract between core and its
host. Core has no `window`, `document`, `localStorage` or `import.meta` left in
it; a grep for those now returns only the game's own "window" (TNF, SUN 1PM…).

```ts
interface Platform {
  storage: { get; set; remove }      // SYNC — see below
  env(key): string | undefined       // VITE_* / expo extra / process.env
  isDev: boolean
  assetUrl(path): string             // bundled pbp/*.json, gamefeed/*.json
  url: { query(); hash(); redirectBase(); referrer() }
  openUrl(url): void                 // OAuth consent, Stripe checkout
}
```

Hosts install an adapter at boot: `src/platform.web.ts` (done), later
`apps/mobile/platform.native.ts`, and the worker runs on the built-in neutral
adapter (memory storage, no URLs) because it never needed any of this.

Three decisions worth knowing about, because they're load-bearing:

**Storage is synchronous.** 51 call sites read stored values during render or
module init — the theme, the card skin, the `dripLive` boot route. Async storage
would mean rewriting all of them and eating a hydration flash on first paint.
`localStorage` is sync and **`react-native-mmkv` is sync**, so a sync contract
costs nothing. Use MMKV on native, not AsyncStorage.

**Config reads are lazy functions, not consts.** `liveConfigured`,
`yahooConfigured`, `supabaseUrl()` and mark-free mode used to be evaluated at
module scope. ES imports hoist, so a module-scope read can run *before* the host
installs its adapter — which would silently latch the defaults and ignore a
configured `VITE_SUPABASE_URL`. That failure looks like "live mode is pointed at
the wrong project" and nothing else. All four are now functions.

**`platform.web.ts` is a side-effect import, and must stay the first import in
`main.tsx`.** Import order is the only ordering guarantee available; a plain
`installWebPlatform()` call placed between imports would run *after* every one of
them had already evaluated.

---

## 3. Mid-season transition: it's a sign-in, not a migration

The question that mattered most, and the audit answer is clean.

**Every** browser-persisted key falls into one of three buckets:

| Bucket | Keys | Survives the switch? |
|---|---|---|
| Transient handoff | `dripInviteCode`, `dripCommishCode`, `dripDfsCode`, `dripSoloPass` | Consumed within one flow; irrelevant |
| Device preference | theme, icon set, card skin, big text, full stats, field-follow | No — cosmetic only |
| Logged-out demo save | `gc-coins` (coins/inventory/applied for the **demo**) | No — and shouldn't; it's the vs-AI sandbox |

Everything that decides a real matchup is already server-side and reloaded on
sign-in: coins and inventory via `myInventory`, armed/applied power-up state via
`heroSetApplied` + `myBuffs` + `myTargeted`, the lineup via `sealed_pick`, and
standings/pot state from their own tables. `store.tsx` persists the working
applied blob on every change "so it restores anywhere" — that's the design
intent, and it's what makes the transition free.

**So: a playtester installs the app, signs in with the same email, and is in
their league mid-week with picks, coin and armed power-ups intact.** No export,
no migration script, no cutover window.

Three things to settle before you actually move them:

1. **Device prefs don't follow.** Theme and card skin reset on the new device.
   If that matters, move the six preference keys onto the profile row — small,
   and it's the only state worth syncing.
2. **Auth redirect changes shape.** Magic-link and Yahoo OAuth currently return
   to a web origin. Native needs a deep-link scheme registered in Supabase Auth
   → URL Configuration and in the Yahoo console. `redirectBase()` is already the
   single place this is decided.
3. **Stale comment in `store.tsx`** says armed power-ups "aren't server-backed
   yet". The code right below it hydrates them from the server. Worth correcting
   so nobody plans around the wrong constraint.

---

## 4. Mobile scope

The full web UI is ~17.5k lines. **Do not port all of it.** The admin and
commissioner surfaces are desktop tools and should stay web-only:

| Screen | Lines | Mobile? |
|---|---|---|
| `AdminPage` | 2,453 | ❌ web-only — founder tool |
| `CommishDash`, `adminUi` | 123 | ❌ web-only |
| `LeagueOverview` | 422 | ⏳ later — mostly reading |
| `Faq`, `Rulebook` | 390 | ⏳ later — or a webview |
| **`DemoBoard`** | 1,242 | ✅ the acquisition surface |
| **`Matchup`** | 3,308 | ✅ the product |
| **`LivePicks`, `boardParts`, `FieldView`, `WindowPot`** | 2,125 | ✅ the live loop |
| **`LiveOnboard`, `Leagues`, `LeagueHub`** | 1,969 | ✅ sign-in + league entry |
| **`MatchupFinal`, `FeedSheet`** | 504 | ✅ the payoff |

That's roughly **9k lines to write**, not 17.5k — the phone app does
demo → sign in → picks → live board → final, and sends everything else to the
web.

The genuinely hard parts, in order:
- **Animations.** 13 CSS keyframes (`nukeburst`, `flipin`, `fvdraw`, `guidepulse`)
  become Reanimated timelines. These are the product's signature moments.
- **Theming.** 133 `color-mix()` calls have no RN equivalent — needs a real color
  library resolving `theme.ts` tokens at render time. The token file itself ports
  as-is; only the applier changes.
- **Layout.** 29 `gridTemplateColumns`, 11 `position: sticky`, the visual-viewport
  modal handling in `ui.tsx`. Flexbox and a modal library replace all of it.

## 5. Sequencing against the season

Sep 9 is first lock; playtesters start on web. The port must not compete with
that.

- **Now → Sep 9:** core extraction (done). No mobile work. Ship the season.
- **Sep–Oct (season running):** build the Expo shell + **one** screen — `LivePicks`
  (591 lines, smallest screen that exercises picks + live state) — against real
  core. This measures the animation/theming translation cost for real, before
  committing to the other eight.
- **Oct–Nov:** the remaining player screens, TestFlight to the same playtesters.
  They can move whenever, because there's nothing to migrate.
- **Gate before store submission:** the coin economy. Purchasable coin is IAP at
  30%, and Apple applies gambling-adjacent scrutiny far harder than the web does
  — `docs/scale-2026-2027-plan.md` already flags this for the web product. Decide
  whether the app ships with coin purchases at all, or earned-only.

**Push notifications** are the one thing native genuinely buys a live game
("your window locks in 15 minutes", "you just got nuked"). Worth prototyping via
web push first — it covers Android and installed iOS 16.4+ PWAs, and it's days
rather than months.
