// Web Push delivery (v0.194.0) — the browser half of the push stack.
//
// Same no-middleman philosophy as the FCM path in push.js: we speak the Web
// Push protocol directly to each browser's push service (FCM for Chrome,
// Mozilla's autopush for Firefox, etc.) with nothing but node:crypto —
// RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID authentication.
//
// Credentials: VAPID_PRIVATE_KEY env (Fly secret) holds the base64url-encoded
// 32-byte P-256 private scalar. The public key is DERIVED from it here (ECDH
// point multiplication), so the secret is one opaque string and can never
// disagree with itself; the matching public key is committed client-side in
// src/app/webPush.ts and the two must be a pair. Absent the secret, web sends
// are skipped (the outbox row records why) — identical posture to FCM's.
//
// Encryption is verified against RFC 8291's Appendix A known-answer vector by
// scripts/webpush-vector-test.mjs (salt + ephemeral key are injectable for
// exactly that reason).
import { createECDH, hkdfSync, createCipheriv, createPrivateKey, sign as edSign, randomBytes } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');

// ── VAPID keys: private scalar from env, public point derived ───────────────
let vapidCache = null; // { ecdh, publicKey (Buffer), jwtKey (KeyObject) } | 'absent'
export function vapidKeys() {
  if (vapidCache === 'absent') return null;
  if (vapidCache) return vapidCache;
  const raw = process.env.VAPID_PRIVATE_KEY;
  if (!raw) { vapidCache = 'absent'; return null; }
  try {
    const d = Buffer.from(raw.trim(), 'base64url');
    if (d.length !== 32) throw new Error(`scalar is ${d.length} bytes`);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const publicKey = ecdh.getPublicKey(); // 65-byte uncompressed point
    // The JWT signer wants a KeyObject; build one from the JWK form.
    const jwtKey = createPrivateKey({
      key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)) },
      format: 'jwk',
    });
    vapidCache = { ecdh, publicKey, jwtKey };
    return vapidCache;
  } catch (e) {
    console.log(new Date().toISOString(), '[push] VAPID_PRIVATE_KEY invalid —', e.message);
    vapidCache = 'absent';
    return null;
  }
}

// ── RFC 8292: VAPID JWT (ES256, raw r||s signature), cached per audience ────
const jwtCache = new Map(); // aud → { header, expMs }
function vapidAuth(aud) {
  const keys = vapidKeys();
  const hit = jwtCache.get(aud);
  if (hit && hit.expMs - Date.now() > 10 * 60_000) return hit.header;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: now + 12 * 3600, sub: 'https://dripfantasy.com' })}`;
  const sig = edSign('sha256', Buffer.from(unsigned), { key: keys.jwtKey, dsaEncoding: 'ieee-p1363' });
  const header = `vapid t=${unsigned}.${b64u(sig)}, k=${b64u(keys.publicKey)}`;
  jwtCache.set(aud, { header, expMs: (now + 12 * 3600) * 1000 });
  return header;
}

// ── RFC 8291 + RFC 8188: aes128gcm payload encryption ───────────────────────
// One record, plaintext padded only by the mandatory 0x02 terminator.
// `testing` lets the vector test pin the ephemeral key and salt.
export function encrypt(plaintext, uaPublic, authSecret, testing = null) {
  const ecdh = testing?.ecdh ?? (() => { const e = createECDH('prime256v1'); e.generateKeys(); return e; })();
  const asPublic = ecdh.getPublicKey();
  const salt = testing?.salt ?? randomBytes(16);
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);
  // Body header: salt(16) | record size(4) | keyid len(1) | as_public(65)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

/** Send one payload to one browser subscription.
 *  subscription: { endpoint, keys: { p256dh, auth } } (the stored token JSON).
 *  Returns { ok } | { ok:false, dead, error } — same contract as fcmSend. */
export async function webPushSend(subscription, { title, body, data }) {
  if (!vapidKeys()) return { ok: false, dead: false, error: 'VAPID_PRIVATE_KEY unset' };
  let sub;
  try {
    sub = JSON.parse(subscription);
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('missing fields');
  } catch (e) {
    return { ok: false, dead: true, error: `bad subscription: ${e.message}` };
  }
  let payload;
  try {
    payload = encrypt(
      Buffer.from(JSON.stringify({ title, body, data: data ?? {} })),
      Buffer.from(sub.keys.p256dh, 'base64url'),
      Buffer.from(sub.keys.auth, 'base64url'),
    );
  } catch (e) {
    return { ok: false, dead: true, error: `encrypt failed: ${e.message}` }; // corrupt keys — sub is unusable
  }
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidAuth(new URL(sub.endpoint).origin),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'high',
    },
    body: payload,
  });
  if (res.ok) return { ok: true };
  const text = (await res.text()).slice(0, 160);
  // 404/410 mean the subscription is gone for good (browser unsubscribed,
  // permission revoked, or the push service expired it).
  return { ok: false, dead: res.status === 404 || res.status === 410, error: `${res.status} ${text}` };
}
