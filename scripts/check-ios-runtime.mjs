// DOES THIS CHANGE NEED AN iPHONE BUILD? (v0.656.3)
//
// Founder: "Can you let me know when the changes we make require an iPhone
// rebuild. Looks like that has to go through and approval process so I'd
// rather not do that unless necessary."
//
// An over-the-air update reaches an iPhone only when the app's iOS native
// fingerprint equals the build's runtime. This computes today's iOS
// fingerprint and compares it with apps/mobile/ios-build-runtime.txt (the
// newest TestFlight build) and apps/mobile/ios-legacy-runtimes.txt (older
// builds still served). Same fingerprint → updates reach iPhones, no build.
// Different → the change moved the native app on iOS: an iPhone build is
// needed, unless the move isn't native on iOS (an Android-only app.json edit),
// in which case listing the current build's runtime in ios-legacy-runtimes.txt
// bridges it — see apps/mobile/README.md.
//
// Run: npm run check:ios-runtime   (exit 1 when an iPhone build is needed)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const mobile = `${root}apps/mobile`;
const hashes = (file) => readFileSync(`${mobile}/${file}`, 'utf8').split('\n')
  .map((l) => (l.match(/^([0-9a-f]{40})/) ?? [])[1]).filter(Boolean);

const out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', 'ios'], { cwd: mobile, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const now = JSON.parse(out).hash;
const built = hashes('ios-build-runtime.txt')[0];
const legacy = hashes('ios-legacy-runtimes.txt');

console.log(`iOS runtime of this checkout: ${now}`);
console.log(`newest iPhone build (TestFlight): ${built ?? 'unknown'}`);
if (now === built) {
  console.log('\n✓ NO iPHONE BUILD NEEDED — this change reaches iPhones over the air.');
  process.exit(0);
}
if (legacy.includes(now)) {
  console.log('\n✓ NO iPHONE BUILD NEEDED — this runtime is served to older builds (ios-legacy-runtimes.txt).');
  process.exit(0);
}
console.log(`
⚠ iPHONE BUILD NEEDED — this change moves the iOS native fingerprint, so its
  updates will NOT reach the iPhones on build ${built?.slice(0, 8) ?? '?'} until a new iPhone build ships.
  · If the change is truly native on iOS (a new native package, an Expo or
    React Native upgrade, iOS permissions or plugins): request an iOS build
    (apps/mobile/ios-build-request.txt) and record the new runtime in
    apps/mobile/ios-build-runtime.txt.
  · If it is NOT native on iOS (an Android-only app.json edit, like the Oct 4
    widget text): it can be bridged without a build — keep the old fingerprint
    serving by listing ${built?.slice(0, 8) ?? 'the current build'} in ios-legacy-runtimes.txt.
  Tell the founder either way, in plain words, before merging.`);
process.exit(1);
