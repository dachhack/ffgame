// When a classic weekly pick seals (classicSealAt, lock.js). #1028: an EMPTY
// spot used to take the week-wide rule and seal at Thursday's kickoff, so a
// manager with an open spot could not fill it on Friday — the database would
// have allowed the write, but a sealed row is un-writable. Run from server/:
//   npx tsx test/classic-seal.mjs
import assert from 'node:assert';
import { classicSealAt, teamKickoffs } from '../src/lock.js';

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

// #1095 (v0.597.0): the slate says LA, the pool (Sleeper) says LAR. Stafford
// sealed at Thursday's kickoff for a Sunday game two weeks running.
const wk4 = teamKickoffs([
  { home: 'CLE', away: 'PIT', kickoff: '2026-10-02T00:15:00Z' },
  { home: 'PHI', away: 'LA', kickoff: '2026-10-04T17:00:00Z' },
  { home: 'WAS', away: 'IND', kickoff: '2026-10-04T13:30:00Z' },
]);
const RAMS = Date.parse('2026-10-04T17:00:00Z');
assert.strictEqual(classicSealAt('matthew-stafford', 'LAR', wk4), RAMS, 'a Rams player (pool LAR, slate LA) seals at the Rams kickoff');
assert.strictEqual(classicSealAt('puka-nacua', 'LA', wk4), RAMS, '…and so does LA');
assert.strictEqual(classicSealAt('some-commander', 'WSH', wk4), Date.parse('2026-10-04T13:30:00Z'), 'WSH finds WAS');
assert.strictEqual(teamKickoffs([{ home: 'LAR', away: 'SF', kickoff: '2026-10-04T20:05:00Z' }]).LA, Date.parse('2026-10-04T20:05:00Z'), 'a slate that says LAR keys as LA');

console.log('PASS — classic picks seal at the right kickoff.');
