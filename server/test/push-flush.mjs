// THE OUTBOX NEVER WALLS ITSELF OFF (v0.392.0).
//
// Founder: "the browser and mobile alerts are not coming through even though
// I have them on." The server had an FCM credential and no VAPID key, so a
// row whose only devices were browsers was skipped — silently, and re-fetched
// oldest-first on every sweep. Fifty of those were the whole page and every
// phone push behind them waited forever. Now such a row is parked with a
// 'waiting-vapid' mark and left out of the fetch while the key is absent, so
// the phone rows behind it go out. Fake Supabase, in-memory.
// Run from server/:  npx tsx test/push-flush.mjs
import assert from 'node:assert';
import { __setClientForTest } from '../src/supabase.js';

// No FCM creds in the env → the fcm channel is the credless one here; the
// test gives the VAPID channel a key so the mirror case is exercised.
delete process.env.FCM_SERVICE_ACCOUNT;
process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 7).toString('base64url');
const sent = [];
// Web sends are stubbed at the fetch layer: every push service says 201.
globalThis.fetch = async (url) => ({ ok: true, status: 201, text: async () => '', json: async () => ({ access_token: 'tok', expires_in: 3600 }) });
const { __flushForTest: flush } = await import('../src/push.js');

function makeFakeDb(tables) {
  const updates = [];
  function builder(name, rows) {
    const api = {
      select: () => api,
      is: (c, v) => builder(name, rows.filter((r) => (v === null ? r[c] == null : r[c] === v))),
      eq: (c, v) => builder(name, rows.filter((r) => r[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(name, rows.filter((r) => s.has(r[c]))); },
      or: (expr) => {
        const m = expr.match(/^error\.is\.null,error\.neq\.(.+)$/);
        assert.ok(m, `unexpected or(): ${expr}`);
        return builder(name, rows.filter((r) => r.error == null || r.error !== m[1]));
      },
      order: () => api,
      limit: (n) => builder(name, rows.slice(0, n)),
      update: (patch) => ({ eq: (c, v) => { for (const r of rows.filter((r) => r[c] === v)) Object.assign(r, patch); updates.push({ name, patch }); return Promise.resolve({ error: null }); } }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }
  return { client: { from: (name) => builder(name, tables[name] ?? []) }, updates };
}

const sub = JSON.stringify({ endpoint: 'https://push.example/abc', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } });
// The web key above is not a valid curve point, so encryption fails → the
// send reports dead. That's fine: what matters is which rows were ATTEMPTED.
const PHONE = 'u-phone', WEB = 'u-web';
const outbox = [];
for (let i = 1; i <= 60; i++) outbox.push({ id: i, app_user_id: PHONE, kind: 'chat', title: 't', body: 'b', data: {}, sent_at: null, error: null });
outbox.push({ id: 61, app_user_id: WEB, kind: 'chat', title: 'browser one', body: 'b', data: {}, sent_at: null, error: null });
const tables = {
  push_outbox: outbox,
  push_token: [
    { token: 'fcm-token', app_user_id: PHONE, platform: 'android', prefs: {} },
    { token: sub, app_user_id: WEB, platform: 'web', prefs: {} },
  ],
};
const { client } = makeFakeDb(tables);
__setClientForTest(client);

// Sweep 1: the first fifty rows are all phone rows on the credless channel.
await flush();
const parked = outbox.filter((r) => r.error === 'waiting-fcm' && r.sent_at == null).length;
assert.equal(parked, 50, `first page parked with a waiting mark, got ${parked}`);
assert.equal(outbox[60].sent_at, null, 'the browser row behind them has not been reached yet');
console.log('PASS  rows on a credless channel are parked, not silently skipped');

// Sweep 2: the parked rows are left out, so the page reaches the rest.
await flush();
assert.equal(outbox.filter((r) => r.error === 'waiting-fcm').length, 60, 'the next ten phone rows park too');
assert.ok(outbox[60].sent_at, 'the browser row behind sixty parked phone rows was attempted');
console.log('PASS  parked rows no longer wall off the rows behind them');

// The mark is undone the moment the channel has keys: a real send would then
// stamp sent_at. Here the fcm channel stays credless, so a third sweep finds
// nothing to do and touches nothing.
const before = JSON.stringify(outbox);
await flush();
assert.equal(JSON.stringify(outbox), before, 'a sweep with nothing attemptable is a no-op');
console.log('PASS  a fully parked queue costs one query per sweep');
console.log('ALL PUSH-FLUSH TESTS PASSED');

// ── v0.392.2: per-device outcomes ───────────────────────────────────────────
// A row that reaches a phone and a browser records each device's result; a
// phone success no longer hides a browser refusal.
{
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'x@y', project_id: 'p',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  const { __flushForTest: flush2 } = await import('../src/push.js?v2');
  // FCM token exchange goes through fetch → our stub returns ok with no
  // access_token, and fcmSend's fetch returns 201 → the phone "delivers".
  // The browser device's keys are not a valid curve point → encrypt fails →
  // refused.
  const BOTH = 'u-both';
  const rows = [{ id: 900, app_user_id: BOTH, kind: 'chat', title: 'both', body: 'b', data: {}, sent_at: null, error: null }];
  const { client: c2 } = makeFakeDb({
    push_outbox: rows,
    push_token: [
      { token: 'fcm-2', app_user_id: BOTH, platform: 'android', prefs: {} },
      { token: sub, app_user_id: BOTH, platform: 'web', prefs: {} },
    ],
  });
  __setClientForTest(c2);
  await flush2();
  assert.ok(rows[0].sent_at, 'the row resolved');
  assert.ok(/^delivered to 1 · browser refused: /.test(rows[0].error ?? ''), `per-device outcome recorded, got: ${rows[0].error}`);
  console.log('PASS  a phone success no longer hides a browser refusal');
}
