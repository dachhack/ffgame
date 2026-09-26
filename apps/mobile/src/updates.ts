// OVER-THE-AIR UPDATES (v0.542.0) — the JS half of every merge, without a build.
//
// Founder: "how do updates work? I make like 50 updates a day." A new APK or a
// new TestFlight build per change can't keep up (and an iPhone build is 20+
// minutes on EAS plus Apple's processing). So every merge that touches the app
// publishes its JavaScript with `eas update` (.github/workflows/eas-update.yml)
// to the one "production" channel, and installed apps pick it up themselves.
// Only native changes need a new build; runtimeVersion's fingerprint policy
// (app.json + fingerprint.config.js) keeps an update away from any build whose
// native code it doesn't match.
//
// WHEN AN UPDATE LANDS. expo-updates on its own checks at launch
// (checkAutomatically ON_LOAD, fallbackToCacheTimeout 0 — never blocks the
// splash on the network) and applies what it downloaded at the NEXT cold
// start. Phones cold-start rarely, so on its own a fix could sit unapplied for
// days. This adds the missing half:
//   • every return to the foreground checks, and downloads anything new;
//   • a downloaded update is applied (a reload, about a second of splash) the
//     next time the app comes back after being away RELOAD_AFTER_MS or more —
//     a moment the player is re-orienting anyway, never mid-tap. A quick
//     app-switch doesn't reload them out from under a half-set lineup.
//
// A dev build (Updates.isEnabled false — Metro serves the JS) skips all of it.
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const RELOAD_AFTER_MS = 5 * 60_000;

let installed = false;
let backgroundedAt: number | null = null;
let pending = false;   // an update is downloaded and waiting for its moment
let checking = false;

async function checkAndFetch(): Promise<void> {
  if (checking || pending) return;
  checking = true;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return;
    const f = await Updates.fetchUpdateAsync();
    if (f.isNew) pending = true;
  } catch {
    // Offline, or the update server is unreachable: the next foreground tries
    // again. Nothing a player can act on, so nothing is shown.
  } finally {
    checking = false;
  }
}

function onChange(s: AppStateStatus): void {
  if (s === 'background') { backgroundedAt = Date.now(); return; }
  if (s !== 'active') return;
  const awayMs = backgroundedAt == null ? 0 : Date.now() - backgroundedAt;
  backgroundedAt = null;
  if (pending && awayMs >= RELOAD_AFTER_MS) {
    Updates.reloadAsync().catch(() => { /* applies at the next cold start instead */ });
    return;
  }
  void checkAndFetch();
}

/** Wire the foreground check. Called once from index.ts; safe to call again. */
export function installOtaUpdates(): void {
  if (installed || !Updates.isEnabled) return;
  installed = true;
  AppState.addEventListener('change', onChange);
}
