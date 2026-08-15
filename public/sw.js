/* Drip Fantasy service worker — the offline/install half of the PWA.
 *
 * WRITTEN DEFENSIVELY ON PURPOSE. We deploy near-daily and hotfix DURING live
 * games, so the one unacceptable failure is a cache that pins somebody to an old
 * build on a Sunday. Every rule below follows from that:
 *
 *   1. Navigations are NETWORK-FIRST. A reload always gets the freshly deployed
 *      index.html; the cached copy is only the offline fallback. A stale build can
 *      therefore never outlive one reload.
 *   2. Build assets are cache-first, which is safe *because* they're content-hashed
 *      — a new deploy references new filenames, so it can't be served stale. This
 *      also fixes a pre-existing bug: GitHub Pages drops the previous deploy's
 *      files, so a mid-session deploy used to break React.lazy() chunk loads in
 *      open tabs. Precaching them means an open tab keeps working.
 *   3. Nothing dynamic is ever cached. Same-origin GET only, so Supabase (REST,
 *      auth, realtime) and PostHog are untouched — they're cross-origin and fall
 *      straight through to the network.
 *   4. No skipWaiting. A new worker waits for old tabs to close, so assets are
 *      never swapped underneath a live board. Freshness doesn't depend on it:
 *      new HTML names new hashed chunks, which miss the cache and hit the network.
 *
 * KILL SWITCH: if this worker ever misbehaves in production, set KILL = true and
 * deploy. Every installed client then drops its caches and unregisters on next
 * load, reverting to a plain website. (The worker script itself is always fetched
 * bypassing the HTTP cache — see updateViaCache in src/app/pwa.ts — so a kill
 * deploy is picked up on the next navigation, not up to 10 minutes later.)
 */
const KILL = false;

const VERSION = '__VERSION__';
const SHELL = `drip-shell-${VERSION}`;   // build output: hashed JS/CSS + index.html
const MEDIA = 'drip-media-v1';           // runtime: brand art, avatars, card backs, fonts
const MEDIA_MAX = 140;                   // entries; trimmed oldest-first after each add

// Build assets, injected at build time by the pwaServiceWorker() plugin in
// vite.config.ts. The filter keeps the un-injected dev placeholder harmless.
const PRECACHE = ["__PRECACHE__"].filter((u) => !u.includes('__PRECACHE__'));

// Scope root, e.g. "https://dripfantasy.com/" — or ".../ffgame/" on the GitHub
// Pages preview builds. Everything below is resolved against it so the same
// worker runs unmodified at any base.
const ROOT = new URL('./', self.registration.scope).href;
const INDEX = new URL('./index.html', ROOT).href;
const ASSETS = new URL('./assets/', ROOT).href;  // Vite's content-hashed output

// Big demo payloads: play-by-play and game feeds are megabytes of JSON that the
// HTTP cache already handles, and hoarding them would blow the storage budget for
// no gain (offline PLAY isn't a goal — installability and fast reloads are).
const NEVER = /\/(pbp|gamefeed)\//;
const MEDIA_TYPES = /\.(png|jpe?g|webp|avif|gif|svg|woff2?)$/i;

self.addEventListener('install', (e) => {
  if (KILL) return;
  // addAll is atomic — one 404 would fail the whole install and leave the old
  // worker in charge, so add individually and tolerate misses.
  e.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(
      [INDEX, ...PRECACHE.map((u) => new URL(u, ROOT).href)]
        .map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})),
    )),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (KILL) {
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      await self.registration.unregister();
      return;
    }
    // Keep the previous build's shell as well as our own. caches.keys() is in
    // creation order, so the tail is the most recent. One generation of grace
    // costs a couple of hundred KB and means a tab that was open across the
    // deploy can still find its chunks after this worker takes over.
    const shells = (await caches.keys()).filter((k) => k.startsWith('drip-shell-'));
    const keep = new Set([SHELL, ...shells.filter((k) => k !== SHELL).slice(-1)]);
    await Promise.all(shells.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Reserved for a future "new version — reload?" prompt; nothing sends it today.
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (KILL || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;  // Supabase, PostHog, Google Fonts
  if (!url.href.startsWith(ROOT) || NEVER.test(url.pathname)) return;

  // (1) Navigations — network first, cached shell only when the network fails.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(async () =>
      (await caches.match(INDEX)) ?? Response.error()));
    return;
  }

  // (2) Content-hashed build output — cache first, from ANY generation's cache.
  // Matching on the directory rather than on this worker's own PRECACHE list is
  // deliberate: a tab that loaded the previous build asks for the previous
  // build's chunks, which by then are 404s on the server. The filenames are
  // content-hashed, so serving whatever we have is always the right answer.
  if (url.href.startsWith(ASSETS)) {
    e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
    return;
  }

  // (3) Static art and fonts — serve cached, refresh in the background.
  if (MEDIA_TYPES.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(request);
      const net = fetch(request).then(async (res) => {
        if (res.ok && res.type === 'basic') { await cache.put(request, res.clone()); void trim(cache); }
        return res;
      });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
  }
  // Everything else: straight to the network, uncached.
});

// ── Web push (v0.194.0) ──────────────────────────────────────────────────────
// Payloads arrive aes128gcm-encrypted from the Fly worker (server/src/webpush.js)
// and decrypt to the same {title, body, data} JSON the app's FCM pushes carry.
// Not behind KILL: a kill deploy unregisters this worker anyway, and a push
// that arrives in the gap should still be shown rather than dropped —
// browsers may revoke the subscription of a worker that eats push events.
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data?.json() ?? {}; } catch { /* non-JSON push — show the fallback */ }
  e.waitUntil(self.registration.showNotification(p.title || 'Drip Fantasy', {
    body: p.body || '',
    icon: new URL('./icons/pwa/icon-192.png', ROOT).href,
    badge: new URL('./icons/pwa/icon-192.png', ROOT).href,
    data: p.data || {},
    // One notification per kind: a newer chat push replaces the older one
    // instead of stacking — mirrors the phone's channel behavior.
    tag: `drip-${(p.data && p.data.kind) || 'default'}`,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Focus an open tab if there is one; otherwise open the app at its root.
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((t) => t.url.startsWith(ROOT));
    if (tab) { await tab.focus(); return; }
    await self.clients.openWindow(ROOT);
  })());
});

/** Keep the media cache bounded — oldest insertion first (keys() is in put order). */
async function trim(cache) {
  try {
    const keys = await cache.keys();
    for (const k of keys.slice(0, keys.length - MEDIA_MAX)) await cache.delete(k);
  } catch { /* a full/evicted cache must not break the response */ }
}
