# Drip Fantasy — native app (Expo)

Player surfaces only. Admin, commissioner tools and the guided demo stay on the
web — see `docs/native-port-plan.md` for what's in scope and why.

## Status

Playable on Android. Sign-in (magic link + Google), leagues, `LivePicks` (set
your lineup, seal metrics, buy and arm power-ups, scout the opponent's window
pool) and `LiveBoard` (the server-authoritative live view). Between them they
exercise the whole stack — Supabase auth and reads/writes, the slate and
per-window lock rules, the metric catalogue, the premium gate, the coin wallet.

Release APKs are built locally (`android/gradlew assembleRelease`) and signed
with the committed playtest key — see **Signing** below. iOS has never been
built or run.

## Running it

```bash
npm install            # from the REPO ROOT — this is an npm workspace
cd apps/mobile
```

**No configuration needed for a production build.** `liveConfig.ts` carries the
production Supabase URL and anon key as defaults — public by design, since the
anon key grants nothing on its own and every table is RLS-guarded — so a build
with no environment at all talks to the real backend.

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

### Signing, and why there's a keystore in the repo

Release builds are signed with `playtest.keystore`, which is **committed**, with
its password in `plugins/withPlaytestSigning.js`. That's deliberate. What it
replaces is worse: the bare template signs release with the `debug.keystore` it
ships — a fixed file dated 2013 whose private half is in every React Native
project on earth. Builds signed with it install perfectly well, which is exactly
why it goes unnoticed, but it means anyone can forge an update for
`com.dripfantasy.app` and that Play will never accept the identity.

The committed key is safe to commit because of what it is not:

- **Not the Play upload key.** Generate a fresh one for the store, hand it to
  EAS credentials, and leave this to sideloaded builds. Play App Signing makes
  the upload key rotatable, so deferring that choice costs nothing.
- **Not a server credential.** Every table is RLS-guarded against the signed-in
  user. A forged build gets you a login screen.

Committing it is what makes the identity *stable* — a fresh clone or a
throwaway CI container signs the same way, so a playtester's next APK installs
over the last one instead of demanding an uninstall. If that trade ever stops
being worth it, move the file out and pass the path in through the environment;
the plugin asserts the keystore exists rather than falling back to the debug key,
so its absence fails the build loudly.

`versionCode` is derived from `version` in `app.json` (0.1.0 → 100), computed in
`app.config.js`. Set `ANDROID_VERSION_CODE` to override it when you hand out two
different APKs on one day without bumping the version.

```bash
ANDROID_VERSION_CODE=101 npx expo prebuild --platform android --clean
```

To confirm what a built APK is actually signed with — worth doing once after any
change to the plugin, since a build that quietly fell back to the debug key
looks exactly like a build that didn't:

```bash
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
# Signer #1 certificate DN: CN=Drip Fantasy Playtest, …
```

### The splash

`assets/splash.png` is the hero mark and the wordmark (`public/brand/hero-mark.png`
+ `hero-wordmark.png`) composited into one 1024px transparent asset, over a plate
of `#0D1F22` — sampled from `public/brand/ig-profile.png`, so the ground behind
the logo is the green the logo was drawn against rather than a colour picked to
go with it. Regenerate it from those two sources if the brand art changes; it is
laid out by centring the stack, not by fixed offsets, because the first attempt
used fixed offsets and ran the wordmark off the bottom edge.

`imageWidth` is set. Without it the logo scales with the screen and turns into a
poster on a tablet.

The splash is also held past the first frame from JS (`preventAutoHideAsync` in
App.tsx, hidden when the session resolves). Otherwise it hides the moment React
mounts — which is before `getSession()` answers — and the launch reads splash →
spinner → app, with the spinner the longest part. There is a 4s ceiling on that
hold: a slow launch is a nuisance, an app that appears not to start is a bug
report.

### Building the APK by hand

```bash
export ANDROID_HOME=/path/to/android-sdk   # prebuild --clean deletes
                                           # android/local.properties, so
                                           # gradlew can't find the SDK without it
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

**Pass the architecture.** Without it Gradle emits a universal APK carrying all
four ABIs — 75 MiB against 28 MiB for arm64 alone, and the other three are dead
weight for every phone shipped in the last decade. Drop the flag only when
something genuinely needs x86 (an emulator image, an old device).

And verify the JS bundle, not just that the build succeeded:

```bash
unzip -p android/app/build/outputs/apk/release/app-release.apk \
  assets/index.android.bundle | sha256sum
```

Two byte-identical APKs from two different source trees have shipped from this
repo before. `withCoreBundleInput` is the fix and this is the check that the fix
is still working — an unchanged hash after a change to `packages/core` means the
bundle is stale, not that the build was fast.

### iOS

Needs macOS with Xcode — there is no way to run or emulate iOS elsewhere.

```bash
npm run ios            # expo run:ios — builds and boots the Simulator
```

No paid Apple Developer account is needed for the Simulator. For a build you
can put on a real iPhone, `npm run ios:simulator` covers Simulator-only via EAS,
and TestFlight distribution needs the $99/yr enrollment.

### Google sign-in needs a Supabase redirect entry

`dripfantasy://**` must be listed under **Supabase → Authentication → URL
Configuration → Redirect URLs**. Without it Google sign-in appears to work and
then dumps you on the website.

That symptom is worth spelling out because it looks like an app bug and isn't
one. Supabase does not reject an unlisted `redirect_to` — it silently
substitutes the project's Site URL. So the in-app browser completes the Google
round trip, lands on dripfantasy.com, and `openAuthSessionAsync` never sees the
`dripfantasy://` callback it is waiting for. Email-code sign-in is unaffected,
because `verifyOtp` exchanges the code directly and never redirects — which
makes "one sign-in method works, the other opens the website" the signature of
this specific misconfiguration.

The app sends `dripfantasy:///auth?live=1` — three slashes, since
`Linking.createURL('/auth')` builds `scheme:` + `//` + an empty host + the path.
The `**` in the pattern matches across separators, so it covers that and the
two-slash form both.

You can check the allow-list without rebuilding or reinstalling anything. Any
`type=magiclink` verify with a junk token redirects to wherever the rules say it
should go, so the destination tells you whether the entry took:

```bash
curl -sI "$SUPABASE_URL/auth/v1/verify?token=junk&type=magiclink\
&redirect_to=dripfantasy%3A%2F%2F%2Fauth%3Flive%3D1" -H "apikey: $ANON" | grep -i ^location
# allowed  → location: dripfantasy:///auth?live=1#error=access_denied&…
# NOT listed → location: https://dripfantasy.com#…       (the Site URL fallback)
```

The `error=access_denied` is just the junk token; only the destination matters.
Run it against a URL you know is bogus too — if that one is preserved as well,
the rules are too broad rather than working.

### Pointing a build somewhere else

Only needed to target a different Supabase project (staging), or to flip
mark-free / Yahoo. Core reads config via `platform().env(key)`, which on native
resolves to `expo.extra`; `app.config.js` layers the environment onto it at
**build** time, so changing one means rebuilding.

The keys are the web build's names verbatim — `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_YAHOO_CLIENT_ID`, `VITE_MARK_FREE` — so one name
means the same thing on both hosts and there's no mapping to maintain.

```bash
# 1. your machine, gitignored — best for day to day
echo 'VITE_SUPABASE_URL=https://staging.xyz.supabase.co' >> .env.local
echo 'VITE_SUPABASE_ANON_KEY=sb_publishable_…'           >> .env.local

# 2. one-off
VITE_SUPABASE_URL=https://staging.xyz.supabase.co npx expo run:android

# 3. EAS — the `env` block on a build profile in eas.json
```

Check what a build will actually carry before you build it:

```bash
npx expo config --type public --json | python3 -c "import json,sys; print(json.load(sys.stdin)['extra'])"
```

An empty `extra` is correct and means "use the production defaults".

### First-run gotchas

- Run `npm install` from the repo root, not from `apps/mobile` — npm workspaces
  hoists most packages to the root and a local install will half-resolve.
- `npx expo install` needs `api.expo.dev`. If it's unreachable, read the pinned
  versions out of `node_modules/expo/bundledNativeModules.json` instead of
  guessing — that's where the ones in `package.json` came from.

## Layout

```
index.ts               entry — installs the platform adapter FIRST (order matters)
App.tsx                brand header, session gate, picks/board tabs
src/platform.native.ts MMKV / expo-constants / Linking → core's platform contract
src/theme.native.ts    core's design tokens for RN + the color-mix replacement
src/intl-polyfill.ts   formatjs — Hermes ships no IANA zones; see the gotcha below
src/ui/cards.tsx       the card table: faces, backs, stock texture
src/ui/animations.tsx  the moments: flip, nuke, hot, live pulse, deal, wobble
src/ui/FieldView.tsx   the drive chart (react-native-svg), web geometry verbatim
src/ui/PlayLog.tsx     two-column play-by-play with running banks on the edges
src/ui/                Overlay, SetupRow, PlayerPicker, ShopModal, RosterPanel,
                       PowerupHand, ErrorBoundary, themed primitives
src/screens/           SignIn, Leagues, LivePicks, LiveBoard, DemoBoard
assets/pbp, gamefeed   one baked 2025 week, bundled for the replay demo
plugins/               Expo config plugins — android/ is generated, so anything
                       the native build needs lives here or it gets erased
```

## Still deferred

In rough order of how much they'll cost:

- **Extra-slot picks.** Buying/selling works; filling uses three stacked
  `<select>`s on web, which needs a purpose-built native sheet.
- **Fonts.** Space Grotesk needs `expo-font`; headings currently fall back to
  the system sans.
- **Card face gradient.** The dot texture is faithful (a real tiled PNG); the
  radial gradient's centre highlight has no RN equivalent and is still missing.
- **iOS.** Never built or run. Needs a Mac; TestFlight needs the $99 enrolment.

Sign-in is done (magic link + Google OAuth, `src/screens/SignIn.tsx`); invite
codes, commish codes and solo passes still live on the web's `LiveOnboard`.
Navigation is deliberately absent — `@react-navigation` was removed once it
turned out to be shipping a native library nothing imported. Bring it back for a
real stack, not to model one push.

## Two things that will bite

**Import order in `index.ts`.** `./src/platform.native` must stay the first
import. ES imports hoist and evaluate in source order, so anything above it that
touches core would read config against the neutral no-op platform.

**`assetUrl` throws on purpose.** Baked play-by-play (`public/pbp/*.json`) isn't
in the app bundle. Live matchups read plays from the database, so nothing should
call it; if it throws, a demo or replay path leaked into the app.
