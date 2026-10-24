// When a classic weekly pick seals (classicSealAt, lock.js). #1028: an EMPTY
// spot used to take the week-wide rule and seal at Thursday's kickoff, so a
// manager with an open spot could not fill it on Friday — the database would
// have allowed the write, but a sealed row is un-writable. Run from server/:
//   npx tsx test/classic-seal.mjs
import assert from 'node:assert';
import { classicSealAt, teamKickoffs, playerKickoff } from '../src/lock.js';

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
// Unknown team keeps the stricter week-wide rule.
assert.strictEqual(classicSealAt('mystery', null, kicks), THU, 'an unplaceable slug seals at the first kickoff');
// A BYE the league's pool knows has no kickoff to be late for (v0.732.3,
// founder: "Why can't I move guys on bye out of roster spots?"): open to the
// last kickoff, as the database's classic_pick_lock always had it.
assert.strictEqual(classicSealAt('bye-guy', 'DAL', kicks, true), MNF, 'a pooled bye seals at the last kickoff, not Thursday');
// …but a bye known only from the baked bio is invisible to the database,
// which still holds it to Thursday — so the worker does too.
assert.strictEqual(classicSealAt('bye-guy', 'DAL', kicks), THU, 'an unpooled bye seals at the first kickoff');

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

// THE AI'S RAILS ON A COLLEGE WEEK (v0.732.8, Devy Test 1: "CPU managers
// playing out players?"). A college player's pool team is blank; his game is
// his school's, not the week's first (a Tuesday MAC game).
const TUE = Date.UTC(2026, 9, 20, 23, 0);
const SAT = Date.UTC(2026, 9, 24, 19, 30);
const cfb = { TOL: TUE, AUB: SAT, UTAH: SAT };
const schools = new Map([['c-111', 'AUB'], ['c-222', 'TOL']]);
assert.strictEqual(playerKickoff('c-111', '', cfb, TUE, schools, 208), SAT, 'an Auburn player kicks off with Auburn, Saturday');
assert.strictEqual(playerKickoff('c-222', '', cfb, TUE, schools, 208), TUE, 'a Toledo player kicks off Tuesday');
assert.strictEqual(playerKickoff('c-999', '', cfb, TUE, schools, 208), TUE, 'a school we cannot place keeps the first kickoff');
// An NFL week never reads a school (codes collide: Houston vs the Texans).
assert.strictEqual(playerKickoff('c-111', '', { AUB: SAT }, TUE, schools, 7), TUE, 'NFL week: the school is not the team');
assert.strictEqual(playerKickoff('josh-allen', 'BUF', { BUF: SUN }, THU, schools, 7), SUN, 'an NFL player is his team, as before');

console.log('PASS — classic picks seal at the right kickoff.');
