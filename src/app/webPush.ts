// Web push subscription (v0.194.0) — the browser side of the push stack.
//
// The phone registers an FCM device token; a browser registers a PushManager
// SUBSCRIPTION — endpoint + encryption keys — and that JSON is what we store
// in push_token (platform 'web', token = the JSON, same table, same prefs,
// same worker outbox). Delivery is server/src/webpush.js; display is the
// push/notificationclick handlers in public/sw.js.
//
// VAPID_PUBLIC_KEY is the committed half of the keypair whose private scalar
// lives in the VAPID_PRIVATE_KEY Fly secret. Rotating the pair invalidates
// every existing subscription — browsers bind subscriptions to the key.
import { registerPushToken, removePushToken } from '@drip/core/data/liveApi';
import { track, Ev } from '@drip/core/analytics';

// ROTATED v0.392.0: the private half of the original pair never reached the
// server (the deploy log read "VAPID_PRIVATE_KEY secret not set" on every run
// since v0.194.0), so every browser push ever queued waited in the outbox.
// This is the public half of a fresh pair (scripts/webpush-keygen.mjs); a
// browser still subscribed under the old key re-subscribes on its next visit
// (webPushState below) — permission is already granted, so it is silent.
export const VAPID_PUBLIC_KEY = 'BFc9iY1TExHXLiSEXRHpIS2Xod3wcgrhRFnFnm2Hsl1F_TRVwnIZd9RjL1Tx8BdaUxF8nAWNQMzzqe8wn8pBjZQ';

export type WebPushState = 'unsupported' | 'denied' | 'subscribed' | 'off';

function keyBytes(): Uint8Array {
  const raw = atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function webPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

// Stable serialization: endpoint + the two keys, nothing else
// (sub.toJSON() also carries expirationTime, which would churn the row key).
function serialize(sub: PushSubscription): string {
  const j = sub.toJSON();
  return JSON.stringify({ endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth } });
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  // getRegistration, not .ready — .ready never resolves when no worker is
  // registered (dev builds don't register one), and a hang here would wedge
  // the notifications card.
  try { return (await navigator.serviceWorker.getRegistration()) ?? null; } catch { return null; }
}

/** Does this subscription belong to OUR current server key? A subscription is
 *  bound to the key it was made with; after a rotation the old one still
 *  exists in the browser but the server can no longer sign for it. */
function underCurrentKey(sub: PushSubscription): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // no way to tell — assume fine rather than churn
  const have = new Uint8Array(k), want = keyBytes();
  if (have.length !== want.length) return false;
  for (let i = 0; i < have.length; i++) if (have[i] !== want[i]) return false;
  return true;
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<WebPushState> {
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes() as BufferSource,
    });
    const r = await registerPushToken(serialize(sub), 'web');
    if (!r?.ok) { await sub.unsubscribe().catch(() => {}); return 'off'; }
    return 'subscribed';
  } catch {
    return 'off'; // push service refused (rare: private mode, enterprise policy)
  }
}

/** Where this browser stands. When already subscribed, silently re-register —
 *  keeps last_seen fresh and moves the subscription if the account changed.
 *  A subscription made under a previous server key is replaced in place
 *  (v0.392.0): dropped from push_token, unsubscribed, and re-made under the
 *  current key — no prompt, permission was already given. */
export async function webPushState(): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') {
    if (!underCurrentKey(sub)) {
      await removePushToken(serialize(sub)).catch(() => {});
      await sub.unsubscribe().catch(() => {});
      return subscribe(reg);
    }
    void registerPushToken(serialize(sub), 'web').catch(() => {});
    return 'subscribed';
  }
  return 'off';
}

/** Ask permission, subscribe, register. Returns the resulting state. */
export async function enableWebPush(): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const perm = await Notification.requestPermission();
  track(Ev.pushRegistered, { granted: perm === 'granted', platform: 'web' });
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  // A leftover subscription under an old key would make subscribe() throw
  // (the browser refuses a second key) — clear it first.
  const old = await reg.pushManager.getSubscription().catch(() => null);
  if (old && !underCurrentKey(old)) {
    await removePushToken(serialize(old)).catch(() => {});
    await old.unsubscribe().catch(() => {});
  }
  return subscribe(reg);
}

/** Unsubscribe this browser and drop its row. */
export async function disableWebPush(): Promise<WebPushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await removePushToken(serialize(sub)).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}
