// A STASHED INVITE DIES WITH THE SESSION (v0.540.0).
//
// A shared link (?code= / ?commish= / ?dfs= / a SOLO- pass) stashes its code
// in storage so it survives the sign-in round trip. It used to outlive
// sign-out too, so the next account to sign up in that browser opened on the
// previous person's pre-filled join form. That is how a fresh App Review
// account ended up on the waiting list of a full league it was never invited
// to. Pinned here: signOut() clears every stashed code, even when the auth
// call itself fails, and touches nothing else.
import { setPlatform } from '../packages/core/src/platform';

const mem = new Map();
setPlatform({
  storage: { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, remove: (k) => { mem.delete(k); } },
  // No Supabase config: the client can't be built, so the SDK half of
  // signOut() fails — the stash must be gone regardless.
  env: () => undefined,
  isDev: false,
  assetUrl: (p) => p,
  url: { query: () => new URLSearchParams(), hash: () => '', redirectBase: () => '', referrer: () => '' },
  openUrl: () => {},
  detectSessionInUrl: false,
});
const { signOut, STASHED_INVITE_KEYS } = await import('../packages/core/src/data/liveApi');

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

ok('the four link stashes are the ones cleared',
  JSON.stringify([...STASHED_INVITE_KEYS].sort()) === JSON.stringify(['dripCommishCode', 'dripDfsCode', 'dripInviteCode', 'dripSoloPass']),
  STASHED_INVITE_KEYS);

for (const k of STASHED_INVITE_KEYS) mem.set(k, 'ABCD1234');
mem.set('dripTheme', 'midnight'); // a preference: must survive
await signOut().catch(() => {});  // the SDK half may throw without config
for (const k of STASHED_INVITE_KEYS) ok(`${k} cleared on sign-out`, !mem.has(k), mem.get(k));
ok('unrelated preferences survive sign-out', mem.get('dripTheme') === 'midnight', mem.get('dripTheme'));

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL SIGN-OUT INVITE ASSERTIONS PASSED');
