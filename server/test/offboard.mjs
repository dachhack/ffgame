// Offboarding (v0.612.0): who is told, who goes, who waits — and the mails
// say what they must. Pure; no database.
import assert from 'node:assert';
import { planOffboard, noticeMail, goodbyeMail } from '../src/offboard.js';
import { mimeMessage, serviceJwt, mailConfigured } from '../src/mail.js';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const day = (n) => new Date(NOW + n * 86400e3).toISOString();
const rows = [
  { app_user_id: 'a', email: 'a@x.com', last_active_at: day(-90), noticed_at: null, delete_after: null },     // told today
  { app_user_id: 'b', email: 'b@x.com', last_active_at: day(-80), noticed_at: day(-15), delete_after: day(-1) }, // past grace → removed
  { app_user_id: 'c', email: 'c@x.com', last_active_at: day(-70), noticed_at: day(-3), delete_after: day(11) },  // on the clock
  { app_user_id: 'd', email: 'd@x.com', last_active_at: day(-61), noticed_at: null, delete_after: null },     // told today
];
const plan = planOffboard(rows, NOW);
assert.deepStrictEqual(plan.notify.map((c) => c.app_user_id), ['a', 'd']);
assert.deepStrictEqual(plan.remove.map((c) => c.app_user_id), ['b']);
assert.deepStrictEqual(plan.waiting.map((c) => c.app_user_id), ['c']);
assert.strictEqual(plan.deferred, 0);
// The per-run notice cap defers, never drops: the rest are told tomorrow.
const capped = planOffboard(rows, NOW, 1);
assert.deepStrictEqual(capped.notify.map((c) => c.app_user_id), ['a']);
assert.strictEqual(capped.deferred, 1);
// A notice whose grace ends exactly now is due.
assert.strictEqual(planOffboard([{ ...rows[2], delete_after: new Date(NOW).toISOString() }], NOW).remove.length, 1);
// Nothing to do → empty lists, no throw.
assert.deepStrictEqual(planOffboard([], NOW), { notify: [], deferred: 0, remove: [], waiting: [] });

// The notice names the date and the way out; the goodbye keeps the promise
// the privacy page makes (results stay, seat shown by team name).
const n = noticeMail('someone@example.com', day(14), 14);
assert.ok(/October 18, 2026/.test(n.subject), `subject carries the date: ${n.subject}`);
assert.ok(/Sign in to keep my account/.test(n.html) && /live=1/.test(n.html), 'the button signs you in');
assert.ok(/14 days/.test(n.html), 'the grace period is said in days');
assert.ok(/someone@example\.com/.test(n.html), 'the mail names the account');
const g = goodbyeMail('<b>x</b>@example.com');
assert.ok(/keep their results/.test(g.html), 'the goodbye keeps the privacy page\'s promise');
assert.ok(!/<b>x<\/b>/.test(g.html) && /&lt;b&gt;x&lt;\/b&gt;/.test(g.html), 'an address is escaped, never injected');

// The MIME message: UTF-8 subject encoded per RFC 2047, body base64 so any
// character survives, headers in place.
const mime = mimeMessage({ from: 'hi@dripfantasy.com', fromName: 'Drip Fantasy', to: 'to@x.com', subject: 'Still playing? — ✓', html: '<p>héllo</p>' });
assert.ok(/^From: Drip Fantasy <hi@dripfantasy\.com>\r\n/.test(mime), 'From first');
assert.ok(/\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/.test(mime), 'a non-ASCII subject is RFC 2047 encoded');
assert.ok(/Content-Transfer-Encoding: base64\r\n\r\n/.test(mime), 'body is base64 after a blank line');
assert.strictEqual(Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8'), '<p>héllo</p>', 'the body round-trips');

// The service-account JWT verifies with the key's public half and carries
// the gmail.send scope for the impersonated sender.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const jwt = serviceJwt('sa@proj.iam.gserviceaccount.com', pem.replace(/\n/g, '\\n'), 'hi@dripfantasy.com', 1_700_000_000);
const [h, c, s] = jwt.split('.');
const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
assert.strictEqual(claim.sub, 'hi@dripfantasy.com');
assert.strictEqual(claim.scope, 'https://www.googleapis.com/auth/gmail.send');
assert.strictEqual(claim.exp - claim.iat, 3600);
const v = createVerify('RSA-SHA256'); v.update(`${h}.${c}`);
assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')), 'the signature verifies (and \\n-escaped PEM is accepted)');

// Fail closed: no credentials, no mail.
assert.strictEqual(mailConfigured({}), false);
assert.strictEqual(mailConfigured({ GOOGLE_SA_EMAIL: 'a', GOOGLE_SA_PRIVATE_KEY: 'b' }), false);
assert.strictEqual(mailConfigured({ GOOGLE_SA_EMAIL: 'a', GOOGLE_SA_PRIVATE_KEY: 'b', GMAIL_SENDER: 'c' }), true);

console.log('PASS — the offboarding sweep tells before it removes, caps its mail, and its mails say what they must.');
