// Known-answer test for server/src/webpush.js against RFC 8291 Appendix A —
// the spec publishes a full worked example (fixed keys, fixed salt, expected
// ciphertext), so the encryptor can be proven byte-exact without a browser.
// Also round-trips a VAPID JWT signature. Run: node scripts/webpush-vector-test.mjs
import { createECDH, createPublicKey, verify } from 'node:crypto';
import { encrypt, vapidKeys } from '../server/src/webpush.js';

let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  got  ${got}\n  want ${want}`}`);
};

// ── RFC 8291 Appendix A vector ──────────────────────────────────────────────
const uaPublic = Buffer.from('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'base64url');
const authSecret = Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url');
const asPrivate = Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url');
const salt = Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url');
const plaintext = Buffer.from('When I grow up, I want to be a watermelon');
const expected =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlml'
  + 'MoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4'
  + 'Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

const ecdh = createECDH('prime256v1');
ecdh.setPrivateKey(asPrivate);
check('RFC 8291 A: as_public matches vector', ecdh.getPublicKey().toString('base64url'),
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
const body = encrypt(plaintext, uaPublic, authSecret, { ecdh, salt });
check('RFC 8291 A: full aes128gcm body byte-exact', body.toString('base64url'), expected);

// ── VAPID: derived public key + verifiable ES256 signature ──────────────────
// Throwaway scalar for the test (any 32-byte value below the curve order).
process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 7).toString('base64url');
const keys = vapidKeys();
check('VAPID: public key is a 65-byte uncompressed point', `${keys.publicKey.length},${keys.publicKey[0]}`, '65,4');
const { default: wp } = await import('../server/src/webpush.js');
void wp;
// Reach the JWT through a real (failing) send would need network; sign directly.
const { sign } = await import('node:crypto');
const unsigned = 'header.payload';
const sig = sign('sha256', Buffer.from(unsigned), { key: keys.jwtKey, dsaEncoding: 'ieee-p1363' });
const pubKey = createPublicKey({
  key: { kty: 'EC', crv: 'P-256', x: keys.publicKey.subarray(1, 33).toString('base64url'), y: keys.publicKey.subarray(33, 65).toString('base64url') },
  format: 'jwk',
});
check('VAPID: ES256 signature verifies with derived public key',
  String(verify('sha256', Buffer.from(unsigned), { key: pubKey, dsaEncoding: 'ieee-p1363' }, sig)), 'true');
check('VAPID: signature is raw r||s (64 bytes, not DER)', String(sig.length), '64');

console.log(fail ? `${fail} FAILED` : 'ALL WEBPUSH VECTOR TESTS PASS');
process.exit(fail ? 1 : 0);
