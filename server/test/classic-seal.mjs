// When a classic weekly pick seals (classicSealAt, lock.js). #1028: an EMPTY
// spot used to take the week-wide rule and seal at Thursday's kickoff, so a
// manager with an open spot could not fill it on Friday — the database would
// have allowed the write, but a sealed row is un-writable. Run from server/:
//   npx tsx test/classic-seal.mjs
import assert from 'node:assert';
import { classicSealAt } from '../src/lock.js';

const THU = Date.UTC(2026, 8, 25, 0, 15);
const SUN = Date.UTC(2026, 8, 27, 17, 0);
const MNF = Date.UTC(2026, 8, 29, 0, 15);
const kicks = { GB: THU, ATL: THU, KC: SUN, NYJ: MNF };

// An empty spot stays open to the week's last kickoff.
assert.strictEqual(classicSealAt(null, null, kicks), MNF, 'an empty spot seals at the last kickoff');
assert.ok(classicSealAt(null, null, kicks) > THU, 'not at Thursday');
// A player seals at his own team's kickoff.
assert.strictEqual(classicSealAt('some-chief', 'KC', kicks), SUN, 'a Sunday player seals Sunday');
assert.strictEqual(classicSealAt('some-packer', 'GB', kicks), THU, 'a Thursday player seals Thursday');
// Unknown team or a bye keeps the stricter week-wide rule.
assert.strictEqual(classicSealAt('mystery', null, kicks), THU, 'an unplaceable slug seals at the first kickoff');
assert.strictEqual(classicSealAt('bye-guy', 'DAL', kicks), THU, 'a bye seals at the first kickoff');

console.log('PASS — classic picks seal at the right kickoff.');
