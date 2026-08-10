// The ONE seam between core and its host (web / Expo / the Node worker).
//
// Everything else under packages/core is pure TypeScript with no ambient
// browser globals — that is the property that makes the engine and the data
// layer portable, and this file is what protects it. If you find yourself
// reaching for `window`, `document`, `localStorage` or `import.meta` anywhere
// in core, add it here instead and implement it per host.
//
// Hosts install an adapter at boot, BEFORE any core module runs:
//   web    → src/platform.web.ts        (localStorage / location / import.meta.env)
//   mobile → apps/mobile/platform.native.ts (MMKV / Linking / expo-constants)
//   worker → server/src/platform.node.ts (env vars; storage is a no-op Map)
//
// ── Why storage is SYNCHRONOUS ───────────────────────────────────────────────
// 51 call sites across the app read stored values during render or during
// module init (theme, card skin, the `dripLive` boot route). Making reads async
// would mean rewriting every one of them and introducing a hydration flash on
// first paint. `localStorage` is sync on web and `react-native-mmkv` is sync on
// native, so a sync contract costs nothing and keeps those call sites intact.
// Do NOT swap the native adapter to AsyncStorage without reading that note.

export interface PlatformStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** The host's URL / deep-link surface. On native these are backed by the last
 *  `Linking` URL rather than a live address bar, so read them at handling time,
 *  not at module scope. */
export interface PlatformUrl {
  /** Query parameters of the current URL (web) or the launch/deep-link URL (native). */
  query(): URLSearchParams;
  /** Fragment, including the leading '#'. Supabase returns auth tokens here. */
  hash(): string;
  /** Where an OAuth / magic-link round trip should return to. */
  redirectBase(): string;
  /** Referring URL, for first-touch attribution. Empty when unavailable. */
  referrer(): string;
}

export interface Platform {
  storage: PlatformStorage;
  /** Build-time configuration (VITE_* on web, `extra` on native). */
  env(key: string): string | undefined;
  /** True in a development build — gates dev-only logging. */
  isDev: boolean;
  /** Resolve a bundled static asset (e.g. `pbp/w3.json`) to a fetchable URL. */
  assetUrl(path: string): string;
  url: PlatformUrl;
  /** Leave the app for an external URL (OAuth consent, mail links). */
  openUrl(url: string): void;
}

/** In-memory storage — the default until a host installs its own, and the
 *  permanent implementation for the Node worker (which persists nothing). */
function memoryStorage(): PlatformStorage {
  const m = new Map<string, string>();
  return {
    get: (k) => (m.has(k) ? m.get(k)! : null),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
  };
}

/** A platform that works headlessly: no storage, no URLs, no env. Core modules
 *  imported by tests and the CLI resolve against this without any setup. */
const NEUTRAL: Platform = {
  storage: memoryStorage(),
  env: () => undefined,
  isDev: false,
  assetUrl: (p) => p,
  url: {
    query: () => new URLSearchParams(),
    hash: () => '',
    redirectBase: () => '',
    referrer: () => '',
  },
  openUrl: () => {},
};

let current: Platform = NEUTRAL;

/** Install the host adapter. Call once at boot, before rendering. Hosts may
 *  pass a partial adapter; unspecified capabilities keep their neutral no-op,
 *  so the worker can install `{ env }` alone. */
export function setPlatform(p: Partial<Platform>): void {
  current = {
    ...NEUTRAL,
    ...p,
    url: { ...NEUTRAL.url, ...(p.url ?? {}) },
    storage: p.storage ?? memoryStorage(),
  };
}

/** The active platform. Read it per call — never cache the result at module
 *  scope, or you will capture NEUTRAL before the host installs its adapter. */
export function platform(): Platform {
  return current;
}

// ── Convenience wrappers ─────────────────────────────────────────────────────
// Every one is failure-tolerant: storage throws in Safari private mode and in
// native builds where the store is not yet mounted, and no caller wants a
// preference read to take down a render.

export function storeGet(key: string): string | null {
  try { return current.storage.get(key); } catch { return null; }
}
export function storeSet(key: string, value: string): void {
  try { current.storage.set(key, value); } catch { /* ignore */ }
}
export function storeRemove(key: string): void {
  try { current.storage.remove(key); } catch { /* ignore */ }
}
export function env(key: string): string | undefined {
  try { return current.env(key); } catch { return undefined; }
}
