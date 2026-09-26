// APNs delivery (apns.js) and its routing in the push worker's flush.
//
// The HTTP/2 transport is stubbed, so this runs offline: it checks the
// provider JWT, the sandbox/production fallback, which refusals kill a token,
// and that flush sends 'ios' devices to APNs, parks them as 'waiting-apns'
// without a key, and never sends them a widget ping.
// Run from server/:  npx tsx test/apns.mjs
import assert from 'node:assert';
import { generateKeyPairSync, verify } from 'node:crypto';
import { __setClientForTest } from '../src/supabase.js';

delete process.env.FCM_SERVICE_ACCOUNT;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.APNS_KEY_P8;
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

const { apnsSend, __setApnsTransportForTest } = await import('../src/apns.js');
const { __flushForTest: flush } = await import('../src/push.js');

const calls = [];
let script = []; // queue of {status, body} answers; default 200
function useStub() {
  __setApnsTransportForTest(async (host, path, headers, body) => {
    calls.push({ host, path, headers, body: JSON.parse(body) });
    return script.shift() ?? { status: 200, body: '' };
  });
}
function withKey() {
  // Escaped newlines, as a Fly secret pasted on one line would hold it.
  process.env.APNS_KEY_P8 = PEM.replace(/\n/g, '\\n');
  process.env.APNS_KEY_ID = 'KEY1234567';
  process.env.APNS_TEAM_ID = 'TEAM123456';
  useStub();
}
const msg = { title: 'Trade offer', body: 'Somebody wants your RB', data: { league_id: 'L1' }, kind: 'trades' };

// ── no key → no send, not dead ──────────────────────────────────────────────
useStub();
let r = await apnsSend('tok-a', msg);
assert.deepEqual([r.ok, r.dead, calls.length], [false, false, 0]);
console.log('PASS  without a key nothing is sent and the token is kept');

// ── production accepts ──────────────────────────────────────────────────────
withKey();
calls.length = 0;
r = await apnsSend('tok-a', msg);
assert.ok(r.ok);
assert.equal(calls.length, 1);
assert.equal(calls[0].host, 'https://api.push.apple.com');
assert.equal(calls[0].path, '/3/device/tok-a');
assert.equal(calls[0].headers['apns-topic'], 'com.dripfantasy.app');
assert.equal(calls[0].headers['apns-push-type'], 'alert');
assert.deepEqual(calls[0].body.aps.alert, { title: msg.title, body: msg.body });
assert.equal(calls[0].body.league_id, 'L1');
assert.equal(calls[0].body.kind, 'trades');
console.log('PASS  production send carries topic, alert and data');

// ── the provider JWT is ES256, raw r||s, and verifies ──────────────────────
{
  const jwt = calls[0].headers.authorization.replace(/^bearer /, '');
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'TEAM123456');
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64, 'JWS signature is 64 raw bytes, not DER');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
  console.log('PASS  provider JWT verifies against the key');
}

// ── a development token: production refuses, sandbox accepts, and is remembered
calls.length = 0;
script = [{ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }, { status: 200, body: '' }];
r = await apnsSend('tok-dev', msg);
assert.ok(r.ok);
assert.deepEqual(calls.map((c) => c.host), ['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']);
calls.length = 0;
r = await apnsSend('tok-dev', msg);
assert.ok(r.ok);
assert.deepEqual(calls.map((c) => c.host), ['https://api.sandbox.push.apple.com'], 'second send goes straight to sandbox');
console.log('PASS  sandbox fallback for development tokens, remembered per token');

// ── dead vs not dead ────────────────────────────────────────────────────────
script = [{ status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }];
r = await apnsSend('tok-gone', msg);
assert.deepEqual([r.ok, r.dead], [false, true]);
script = [{ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }, { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }];
r = await apnsSend('tok-junk', msg);
assert.deepEqual([r.ok, r.dead], [false, true]);
script = [{ status: 403, body: JSON.stringify({ reason: 'InvalidProviderToken' }) }];
r = await apnsSend('tok-fine', msg);
assert.deepEqual([r.ok, r.dead], [false, false], 'an auth problem is ours, not the token\'s');
assert.match(r.error, /403 InvalidProviderToken/);
console.log('PASS  410 and a both-hosts BadDeviceToken kill the token; auth errors do not');

// ── flush routing ───────────────────────────────────────────────────────────
function fakeDb(tables) {
  const deleted = [];
  function builder(name, rows) {
    const api = {
      select: () => api,
      is: (c, v) => builder(name, rows.filter((x) => (v === null ? x[c] == null : x[c] === v))),
      eq: (c, v) => builder(name, rows.filter((x) => x[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(name, rows.filter((x) => s.has(x[c]))); },
      or: (expr) => {
        const m = expr.match(/^error\.is\.null,error\.neq\.(.+)$/);
        return builder(name, rows.filter((x) => x.error == null || x.error !== m[1]));
      },
      order: () => api,
      limit: (n) => builder(name, rows.slice(0, n)),
      update: (patch) => ({ eq: (c, v) => { for (const x of rows.filter((x) => x[c] === v)) Object.assign(x, patch); return Promise.resolve({ error: null }); } }),
      delete: () => ({ eq: (c, v) => { deleted.push(v); return Promise.resolve({ error: null }); } }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }
  return { client: { from: (name) => builder(name, tables[name] ?? []) }, deleted };
}
const IOS = 'u-ios';
const outbox = () => [
  { id: 1, app_user_id: IOS, kind: 'trades', title: 'Trade offer', body: 'b', data: {}, sent_at: null, error: null },
  { id: 2, app_user_id: IOS, kind: 'widget', title: 'Drip Fantasy', body: 'score update', data: {}, sent_at: null, error: null },
];
const tokens = [{ token: 'ios-tok', app_user_id: IOS, platform: 'ios', prefs: {} }];

// No APNs key: the alert row parks as waiting-apns.
delete process.env.APNS_KEY_P8;
useStub();
{
  const rows = outbox();
  __setClientForTest(fakeDb({ push_outbox: rows, push_token: tokens }).client);
  calls.length = 0;
  await flush();
  // Nothing has credentials at all → flush leaves the queue standing untouched.
  assert.equal(rows[0].sent_at, null);
  assert.equal(calls.length, 0);
}
// With only the APNs key present, the alert goes to Apple; the widget ping has
// no iPhone to go to and resolves as "no devices".
withKey();
{
  const rows = outbox();
  __setClientForTest(fakeDb({ push_outbox: rows, push_token: tokens }).client);
  calls.length = 0;
  await flush();
  assert.equal(calls.length, 1, 'exactly one APNs request');
  assert.equal(calls[0].path, '/3/device/ios-tok');
  assert.ok(rows[0].sent_at && rows[0].error == null, `alert delivered, got error=${rows[0].error}`);
  assert.equal(rows[1].error, 'no devices', 'widget ping never goes to an iPhone');
  console.log('PASS  flush sends ios devices to APNs and skips widget pings');
}
// An iPhone and an Android phone, with only the APNs key: one channel
// delivering is enough to resolve the row; the keyless FCM side doesn't hold it.
{
  const rows = [outbox()[0]];
  __setClientForTest(fakeDb({ push_outbox: rows, push_token: [...tokens, { token: 'fcm-tok', app_user_id: IOS, platform: 'android', prefs: {} }] }).client);
  calls.length = 0;
  await flush();
  assert.equal(calls.length, 1);
  assert.ok(rows[0].sent_at, 'resolved by the iPhone delivery');
  console.log('PASS  an iPhone delivery resolves a row even while FCM is keyless');
}
// A dead iPhone token is deleted and named in the row's outcome.
{
  const rows = [outbox()[0]];
  const db = fakeDb({ push_outbox: rows, push_token: tokens });
  __setClientForTest(db.client);
  script = [{ status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }];
  await flush();
  assert.deepEqual(db.deleted, ['ios-tok']);
  assert.match(rows[0].error, /^iPhone refused: 410 Unregistered/);
  console.log('PASS  a dead iPhone token is deleted and reported');
}
// Only FCM keyed (APNs absent): an iPhone-only row parks as waiting-apns.
{
  delete process.env.APNS_KEY_P8;
  useStub();
  const { generateKeyPairSync: g } = await import('node:crypto');
  const { privateKey: rsa } = g('rsa', { modulusLength: 2048 });
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'x@y', project_id: 'p', private_key: rsa.export({ type: 'pkcs8', format: 'pem' }) });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ access_token: 'tok', expires_in: 3600 }) });
  const { __flushForTest: flush2 } = await import('../src/push.js?fcm');
  const rows = [outbox()[0]];
  __setClientForTest(fakeDb({ push_outbox: rows, push_token: tokens }).client);
  await flush2();
  assert.equal(rows[0].error, 'waiting-apns');
  assert.equal(rows[0].sent_at, null);
  console.log('PASS  without an APNs key an iPhone-only row waits as waiting-apns');
}
console.log('ALL APNS TESTS PASSED');
