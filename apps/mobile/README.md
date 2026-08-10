# Drip Fantasy — native app (Expo)

Player surfaces only. Admin, commissioner tools and the guided demo stay on the
web — see `docs/native-port-plan.md` for what's in scope and why.

## Status

First pass: the shell plus **one** ported screen (`LivePicks`), chosen because
it's the smallest screen that exercises the whole stack — Supabase auth and
reads/writes, the slate and per-window lock rules, the metric catalogue, the
premium gate, the coin wallet.

Verified: typechecks, and Metro bundles it (706 modules) against `@drip/core`
across the workspace. **Not yet run on a device** — that needs a development
build, which needs an Apple/EAS account.

## Running it

First: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `app.json` →
`expo.extra`. Same key names as the web build, because core reads them through
the same shim. Without them the app opens on a "Live mode isn't configured"
placeholder.

```bash
npm install            # from the REPO ROOT — this is an npm workspace
cd apps/mobile
```

**Expo Go will not work.** `react-native-mmkv` v4 is a Nitro module with native
code, so every path below produces a real build. That's a deliberate trade:
MMKV's synchronous storage is what lets core's ~51 read-during-render call sites
work unchanged — see the note in `src/platform.native.ts`.

### An Android APK (no Mac needed)

```bash
npx eas login          # a free Expo account
npm run apk            # eas build --profile preview --platform android
```

Builds in Expo's cloud and hands back an install link plus a downloadable
`.apk`. The `preview` profile sets `buildType: apk` on purpose — the
`production` profile emits a `.aab`, which Play requires but which **cannot be
sideloaded**. Use `npm run apk:local` to build on your own machine instead;
that one needs the Android SDK + NDK installed locally.

### iOS

Needs macOS with Xcode — there is no way to run or emulate iOS elsewhere.

```bash
npm run ios            # expo run:ios — builds and boots the Simulator
```

No paid Apple Developer account is needed for the Simulator. For a build you
can put on a real iPhone, `npm run ios:simulator` covers Simulator-only via EAS,
and TestFlight distribution needs the $99/yr enrollment.

### First-run gotchas

- Run `npm install` from the repo root, not from `apps/mobile` — npm workspaces
  hoists most packages to the root and a local install will half-resolve.
- `npx expo install` needs `api.expo.dev`. If it's unreachable, read the pinned
  versions out of `node_modules/expo/bundledNativeModules.json` instead of
  guessing — that's where the ones in `package.json` came from.

## Layout

```
index.ts               entry — installs the platform adapter FIRST (order matters)
App.tsx                theme context + session gate around the one screen
src/platform.native.ts MMKV / expo-constants / Linking → core's platform contract
src/theme.native.ts    core's design tokens for RN + the color-mix replacement
src/ui/                themed primitives, SetupRow, PlayerPicker
src/screens/           ported screens
```

## What the next screen needs

Deliberately deferred, in rough order of how much they'll cost:

- **Sign-in.** `LiveOnboard` (1,541 lines on web) covers magic link, invite
  codes, commish codes and solo passes. Until it's ported, sign in on the web —
  it's the same account and the same session.
- **Navigation.** A single route doesn't justify a stack. `@react-navigation`
  is installed and ready for screen two.
- **Extra-slot picks.** Buying/selling works; filling uses three stacked
  `<select>`s on web, which needs a purpose-built native sheet.
- **Fonts.** Space Grotesk needs `expo-font`; headings currently fall back to
  the system sans.
- **Animations.** Nothing here animates yet. The 13 CSS keyframes
  (`nukeburst`, `flipin`, `fvdraw`…) land with the live board, and that's the
  real test of the port — `react-native-reanimated` isn't installed yet because
  nothing needed it.

## Two things that will bite

**Import order in `index.ts`.** `./src/platform.native` must stay the first
import. ES imports hoist and evaluate in source order, so anything above it that
touches core would read config against the neutral no-op platform.

**`assetUrl` throws on purpose.** Baked play-by-play (`public/pbp/*.json`) isn't
in the app bundle. Live matchups read plays from the database, so nothing should
call it; if it throws, a demo or replay path leaked into the app.
