// The web host's implementation of the core platform contract
// (packages/core/src/platform.ts).
//
// SIDE-EFFECT MODULE: importing it installs the adapter. main.tsx imports it
// FIRST, above every other import, because ES imports are hoisted and evaluated
// in source order — a plain `installWebPlatform()` call placed between imports
// would run *after* every one of them had already been evaluated, and any core
// module that reads config while initialising would have seen the neutral
// platform. Import order is the only ordering guarantee available here, so this
// module does its work on import rather than exposing a function to call.
//
// Everything here is browser-specific by design — this file is the reason
// packages/core has no `window`, `document`, `localStorage` or `import.meta` in
// it, and so can be imported unchanged by the Expo app and the Node worker.
import { setPlatform } from '@drip/core/platform';

const ENV = (import.meta as { env?: Record<string, string | undefined> }).env;

setPlatform({
  storage: {
    // Not wrapped in try/catch — the core wrappers (storeGet/storeSet/…)
    // already swallow the Safari-private-mode SecurityError, and swallowing it
    // twice would hide a genuine bug from anything using the raw interface.
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  },

  env: (k) => ENV?.[k],
  isDev: !!ENV?.DEV,

  // Vite rewrites BASE_URL per deploy target ('/' on dripfantasy.com,
  // '/ffgame/' on the plain Pages path), so bundled JSON must resolve through
  // it rather than being hardcoded.
  assetUrl: (p) => `${ENV?.BASE_URL ?? '/'}${p}`,

  url: {
    query: () => new URLSearchParams(window.location.search),
    hash: () => window.location.hash,
    // Origin + path, no query: callers append their own. Keeping the path means
    // a Pages sub-path deploy returns to /ffgame/ rather than the domain root.
    redirectBase: () => `${window.location.origin}${window.location.pathname}`,
    // Contract: EXTERNAL referrers only, so an in-app navigation can never
    // overwrite first-touch attribution with our own hostname.
    referrer: () => {
      const ref = document.referrer;
      return ref && !ref.includes(window.location.hostname) ? ref : '';
    },
  },

  openUrl: (url) => { window.location.href = url; },

  // The magic-link / OAuth callback lands in this tab's address bar, so the
  // auth SDK can pick the session out of the URL itself.
  detectSessionInUrl: true,
});
