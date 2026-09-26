// APNs delivery — the iPhone half of the push stack.
//
// Same no-middleman posture as the FCM path in push.js and webpush.js: the
// worker speaks Apple's provider API directly (HTTP/2 + a token-auth JWT), with
// nothing but node:http2 and node:crypto. The iOS app registers the raw APNs
// device token (expo-notifications getDevicePushTokenAsync on iOS) with
// platform 'ios'; push.js routes those rows here.
//
// Credentials (Fly secrets), all from developer.apple.com → Keys → a key with
// "Apple Push Notifications service" enabled:
//   APNS_KEY_P8    the .p8 file's contents (PEM; literal "\n" escapes are fine)
//   APNS_KEY_ID    the key's 10-character id
//   APNS_TEAM_ID   the developer team id
//   APNS_BUNDLE_ID optional, defaults to com.dripfantasy.app (the apns-topic)
// Absent any of the first three, iOS sends are skipped and the outbox parks the
// row as 'waiting-apns' — identical to FCM's and VAPID's posture.
//
// SANDBOX VS PRODUCTION. A token minted by a development build (Xcode, the
// Simulator) is only valid on api.sandbox.push.apple.com; TestFlight and App
// Store builds mint production tokens. Nothing in the token says which, so a
// send tries production first and, on BadDeviceToken, sandbox — and remembers
// which host answered for that token. A token is reported dead only when it is
// Unregistered (410) or refused by BOTH hosts.
import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

let credCache = null; // { key (KeyObject), keyId, teamId, topic } | 'absent'
export function apnsCreds() {
  if (credCache === 'absent') return null;
  if (credCache) return credCache;
  const pem = process.env.APNS_KEY_P8, keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID;
  if (!pem || !keyId || !teamId) { credCache = 'absent'; return null; }
  try {
    const key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    credCache = { key, keyId: keyId.trim(), teamId: teamId.trim(), topic: (process.env.APNS_BUNDLE_ID || 'com.dripfantasy.app').trim() };
  } catch (e) {
    console.log(new Date().toISOString(), '[push]', 'APNS_KEY_P8 unparsable — iOS sending off:', e.message);
    credCache = 'absent';
    return null;
  }
  return credCache;
}

// Apple wants the provider JWT refreshed between 20 and 60 minutes; reusing one
// for longer is refused (ExpiredProviderToken), minting one per request is
// throttled (TooManyProviderTokenUpdates). 40 minutes sits in the middle.
let jwtCache = null; // { jwt, atMs }
function providerJwt(c) {
  if (jwtCache && Date.now() - jwtCache.atMs < 40 * 60_000) return jwtCache.jwt;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'ES256', kid: c.keyId })}.${b64({ iss: c.teamId, iat: Math.floor(Date.now() / 1000) })}`;
  // JWS wants the raw r||s signature, not DER.
  const sig = sign('sha256', Buffer.from(unsigned), { key: c.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  jwtCache = { jwt: `${unsigned}.${sig}`, atMs: Date.now() };
  return jwtCache.jwt;
}

// ── transport: one HTTP/2 session per host, reopened when it drops ──────────
const sessions = new Map();
function session(host) {
  const s = sessions.get(host);
  if (s && !s.closed && !s.destroyed) return s;
  const fresh = http2.connect(host);
  fresh.on('error', () => sessions.delete(host));
  fresh.on('close', () => sessions.delete(host));
  // Idle, the session must not keep the process alive (a script that sends
  // once should still exit); in flight, it must — see h2Post.
  fresh.unref();
  fresh.inflight = 0;
  sessions.set(host, fresh);
  return fresh;
}

let transport = function h2Post(host, path, headers, body) {
  return new Promise((done) => {
    let req, s;
    try {
      s = session(host);
      req = s.request({ ':method': 'POST', ':path': path, ...headers });
    } catch (e) { done({ status: 0, body: String(e.message) }); return; }
    // Hold the event loop while this request is out; let go when idle again.
    if (s.inflight++ === 0) s.ref();
    let settled = false;
    const resolve = (v) => {
      if (settled) return;
      settled = true;
      if (--s.inflight === 0 && !s.destroyed) s.unref();
      done(v);
    };
    let status = 0, text = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = Number(h[':status']); });
    req.on('data', (d) => { text += d; });
    req.on('end', () => resolve({ status, body: text }));
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.setTimeout(10_000, () => { req.close(); resolve({ status: 0, body: 'timeout' }); });
    req.end(body);
  });
};
/** Tests swap the HTTP/2 call for a stub: (host, path, headers, body) → {status, body}. */
export function __setApnsTransportForTest(fn) { transport = fn; jwtCache = null; credCache = null; hostFor.clear(); }

const hostFor = new Map(); // device token → 'production' | 'sandbox', once one has answered

const reason = (body) => { try { return JSON.parse(body).reason ?? ''; } catch { return ''; } };

/** Send one alert to one iOS device. Same result shape as fcmSend. */
export async function apnsSend(deviceToken, { title, body, data, kind }) {
  const c = apnsCreds();
  if (!c) return { ok: false, dead: false, error: 'no APNs key' };
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default' },
    // Custom keys ride beside aps; expo-notifications surfaces them as data.
    ...Object.fromEntries(Object.entries({ ...(data ?? {}), kind }).map(([k, v]) => [k, String(v)])),
  });
  const headers = {
    authorization: `bearer ${providerJwt(c)}`,
    'apns-topic': c.topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  };
  const order = hostFor.get(deviceToken) === 'sandbox' ? ['sandbox', 'production'] : ['production', 'sandbox'];
  let last = null;
  for (const env of order) {
    const r = await transport(HOSTS[env], `/3/device/${deviceToken}`, headers, payload);
    if (r.status === 200) { hostFor.set(deviceToken, env); return { ok: true }; }
    const why = reason(r.body);
    last = { status: r.status, why: why || r.body.slice(0, 120) };
    // The token belongs to the other environment — try it before giving up.
    if (r.status === 400 && (why === 'BadDeviceToken' || why === 'DeviceTokenNotForTopic')) continue;
    // 410: the app was uninstalled or the token rotated. Dead for good.
    if (r.status === 410) return { ok: false, dead: true, error: `410 ${why || 'Unregistered'}` };
    // Anything else (auth, throttling, network) is not the token's fault.
    return { ok: false, dead: false, error: `${r.status} ${last.why}` };
  }
  // Refused as a bad token by both hosts.
  return { ok: false, dead: true, error: `${last.status} ${last.why}` };
}
