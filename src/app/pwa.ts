// PWA plumbing: service-worker registration, and the state behind the
// "add to home screen" banner (src/app/InstallPrompt.tsx).
//
// Installing matters here for one concrete reason beyond the icon: paid traffic
// arrives once, and an installed app is the only surface that survives the tab
// being closed. It's also the groundwork for the native shells — the icon set,
// the standalone layout and the launch route are the same assets Capacitor wraps
// next season (docs/mobile-app-plan.md).
import { track, Ev } from '@drip/core/analytics';

const STORE = 'drip.pwa.v1';
// How long a dismissal sticks. Long enough not to nag, short enough that someone
// who came back for week 6 gets asked again.
const SNOOZE_DAYS = 45;
// Don't ask inside the first minute of a first visit — let them see the game
// first. A returning visitor (or a signed-in player) is asked immediately.
const WARMUP_MS = 60_000;

type State = { firstSeen?: number; dismissed?: number; installed?: number };

function read(): State {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') as State; } catch { return {}; }
}
function write(patch: State): void {
  try { localStorage.setItem(STORE, JSON.stringify({ ...read(), ...patch })); } catch { /* private mode */ }
}

/** Already launched from the home screen / app icon. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** iOS Safari, which never fires beforeinstallprompt — install is a manual
 *  Share → Add to Home Screen, so all we can do is show the instructions.
 *  Chrome/Firefox/Edge on iOS are excluded: they're WebKit too, but their share
 *  sheets don't offer it. */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);  // iPadOS 13+ lies about being a Mac
  return ios && !/crios|fxios|edgios/i.test(ua);
}

// Chromium hands us the install event once, early, and only if the site
// qualifies. Stash it — calling prompt() later is what actually installs.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;

const listeners = new Set<() => void>();
const emit = (): void => { for (const l of listeners) l(); };
export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Should the banner be on screen right now? */
export function canPromptInstall(): boolean {
  if (isStandalone()) return false;
  const s = read();
  if (s.installed) return false;
  if (s.dismissed && Date.now() - s.dismissed < SNOOZE_DAYS * 86_400_000) return false;
  if (s.firstSeen && Date.now() - s.firstSeen < WARMUP_MS) return false;
  return !!deferred || isIosSafari();
}

/** Fire the native install dialog (Chromium only — iOS has no such API). */
export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const ev = deferred;
  deferred = null;             // single use; Chromium re-fires it if declined
  emit();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    track(outcome === 'accepted' ? Ev.pwaInstallAccepted : Ev.pwaInstallDeclined);
  } catch { /* dialog already consumed */ }
}

/** Snooze the banner. */
export function dismissInstall(): void {
  write({ dismissed: Date.now() });
  track(Ev.pwaInstallDismissed);
  emit();
}

export function initPwa(): void {
  if (typeof window === 'undefined') return;
  if (!read().firstSeen) write({ firstSeen: Date.now() });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // suppress Chrome's own mini-infobar; we ask in-app
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    write({ installed: Date.now() });
    deferred = null;
    track(Ev.pwaInstalled);
    emit();
  });
  // The warm-up window closes without any event of its own.
  window.setTimeout(emit, WARMUP_MS);

  // Dev serves public/sw.js with its placeholders un-filled (vite.config.ts fills
  // them at build), and a worker caching a dev server is a debugging trap anyway.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // updateViaCache:'none' — the worker script must never be served from the
    // HTTP cache, or the kill switch in public/sw.js could take minutes to land.
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
      .catch(() => { /* an unregistrable worker just means no offline support */ });
  });
}
