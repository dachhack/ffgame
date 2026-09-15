// Mint a VAPID keypair for web push (v0.392.0).
//
// Prints the PUBLIC key to paste into src/app/webPush.ts (VAPID_PUBLIC_KEY)
// and the PRIVATE key to paste into the VAPID_PRIVATE_KEY repository secret
// (Settings → Secrets and variables → Actions); deploy-worker.yml stages that
// secret to Fly on the next worker deploy. The worker derives the public key
// from the private one, so the pair can never disagree — but the committed
// public key must be THIS pair's, or every browser subscription is made under
// a key the server cannot sign for. Rotating invalidates existing browser
// subscriptions; webPushState() re-subscribes them silently on the next visit.
// Run: node scripts/webpush-keygen.mjs
import { createECDH } from 'node:crypto';
const e = createECDH('prime256v1');
e.generateKeys();
const b64u = (b) => Buffer.from(b).toString('base64url');
console.log('VAPID_PUBLIC_KEY  (commit in src/app/webPush.ts):');
console.log('  ' + b64u(e.getPublicKey()));
console.log('VAPID_PRIVATE_KEY (repo secret, never committed):');
console.log('  ' + b64u(e.getPrivateKey()));
