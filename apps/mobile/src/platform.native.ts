// The native host's implementation of the core platform contract
// (packages/core/src/platform.ts).
//
// SIDE-EFFECT MODULE: importing it installs the adapter. index.ts imports it
// FIRST, above everything else, for the same reason main.tsx does on web —
// imports are hoisted and evaluated in source order, so a function call placed
// between imports would run after every one of them had already evaluated, and
// core modules that read config while initialising would see the neutral
// platform.
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createMMKV } from 'react-native-mmkv';
import { setPlatform } from '@drip/core/platform';
import { setSeasonLogLoader, type SeasonLogFile } from '@drip/core/data/seasonLog';

// MMKV, not AsyncStorage, and this is load-bearing rather than a preference:
// the core storage contract is SYNCHRONOUS because ~51 call sites read during
// render or module init (theme, card skin, the boot route). MMKV's get/set are
// synchronous; AsyncStorage's are not, and swapping it in would mean rewriting
// every one of those call sites and introducing a first-paint flash.
//
// v4 is a Nitro module: `createMMKV()` factory, not `new MMKV()` (v3), and it
// needs react-native-nitro-modules alongside it. It also means no Expo Go —
// this requires a development build.
const store = createMMKV({ id: 'drip' });

// The deep link that launched or resumed the app. Auth callbacks (Supabase
// magic link, Yahoo OAuth) arrive here rather than in an address bar, so it is
// mutable state that the URL accessors read at call time — never captured once.
let currentUrl: string | null = Linking.getLinkingURL() ?? null;

Linking.addEventListener('url', ({ url }) => { currentUrl = url; });

/** Called by the auth screens once a callback URL has been consumed, so a later
 *  read doesn't re-process a stale token. */
export function clearLaunchUrl(): void { currentUrl = null; }

function parsed() {
  if (!currentUrl) return null;
  try { return Linking.parse(currentUrl); } catch { return null; }
}

setPlatform({
  storage: {
    // getString returns undefined for a miss; the contract is null.
    get: (k) => store.getString(k) ?? null,
    set: (k, v) => store.set(k, v),
    remove: (k) => { store.remove(k); },
  },

  // app.json → expo.extra. Same keys as the web build's VITE_* vars, so core
  // reads identically on both hosts.
  env: (k) => {
    const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
    return extra?.[k] ?? undefined;
  },
  isDev: __DEV__,

  // There is no origin to resolve against: the per-week JSON the web fetches
  // from /pbp and /gamefeed is not shipped in the app bundle. The native app
  // only ever plays live matchups, which read their plays from the database, so
  // nothing should reach this. Loud rather than silently fetching a bad URL.
  // (The SEASON log is the one baked file the app does carry — it comes through
  // Metro's `require` below, not through a URL.)
  assetUrl: (p) => {
    throw new Error(
      `assetUrl(${p}) has no native implementation — baked play-by-play is web-only. ` +
      'A live board reads plays from the DB; if this fired, a demo/replay path leaked into the app.',
    );
  },

  url: {
    query: () => {
      const q = parsed()?.queryParams ?? {};
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (typeof v === 'string') p.set(k, v);
        else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && p.append(k, x));
      }
      return p;
    },
    // Supabase returns its session tokens in the fragment. expo-linking's parse
    // drops it, so read it off the raw URL.
    hash: () => {
      const i = currentUrl?.indexOf('#') ?? -1;
      return i >= 0 ? currentUrl!.slice(i) : '';
    },
    // The app's own deep-link scheme. Must be registered in BOTH Supabase Auth
    // → URL Configuration and the Yahoo developer console, alongside the
    // existing web origins — the two hosts return to different places.
    redirectBase: () => Linking.createURL('/auth'),
    // Native has no referrer. Returning '' keeps first-touch attribution
    // honest: install attribution is a different problem, solved by the store,
    // not by pretending we have a referring page.
    referrer: () => '',
  },

  // An in-app browser rather than leaving for Safari/Chrome: OAuth consent and
  // Stripe checkout both need to hand control back to us, and a system-browser
  // round trip loses the session on iOS.
  openUrl: (url) => { void WebBrowser.openAuthSessionAsync(url, Linking.createURL('/auth')); },

  // False on native: the callback arrives as a deep link this module tracks,
  // not as a page URL. Left true, the SDK scans whatever `currentUrl` happens
  // to be on cold start and can mis-fire.
  detectSessionInUrl: false,
});

// THE BAKED SEASON (v0.285.0) — the player card's game log, shipped in the app.
//
// The web fetches public/pbp/season.json over HTTP; native has no URL to fetch
// it from, so Metro bundles the same file and hands it over as a module. The
// `require` sits INSIDE the loader deliberately: Metro evaluates a module the
// first time it is required, so a session where nobody opens a game log never
// pays for the 1.5 MB parse.
setSeasonLogLoader(() => require('../assets/pbp/season.json') as SeasonLogFile);
