// Scores-only feeds for the college games the worker doesn't poll (v0.560.1).
// Founder: "Looks good but missing a lot of CFB scores" — only games with a
// rostered school got a game_feed row. Run from server/:
//   npx tsx test/college-scores.mjs
import assert from 'node:assert';
import { scoreOnlyRows } from '../src/poll/collegeScores.js';
import { feedScore } from '../../packages/core/src/data/gameFeed.ts';

const g = (id, away, home, state, as, hs, short = 'Final') => ({
  eventId: id, away, home, state, awayScore: as, homeScore: hs,
  status: { name: state === 'post' ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', detail: short, short, period: 4, clock: '0:00' },
});
const games = [
  g('1', 'UIW', 'TXST', 'post', 17, 42),
  g('2', 'UL', 'CLT', 'in', 14, 10, '8:12 - 3rd'),
  g('3', 'OU', 'UGA', 'post', 13, 41),          // polled: a rostered school
  g('4', 'KENN', 'ARST', 'pre', null, null),    // not started
  g('5', 'USM', 'TULN', 'post', 20, 27),        // already has a FULL row
  g('6', 'MTSU', 'JXST', 'post', 31, 24),       // lite row, unchanged
  g('7', 'BOIS', 'WMU', 'post', 32, 7),         // lite row, score moved
];
const polled = new Set(['3']);
const existing = new Map([
  ['5', { state: 'post', status: { short: 'Final' } }],
  ['6', { state: 'post', status: { short: 'Final', lite: true, score: { away: 31, home: 24 } } }],
  ['7', { state: 'in', status: { short: '2:00 - 4th', lite: true, score: { away: 25, home: 7 } } }],
]);
const rows = scoreOnlyRows(205, games, polled, existing, 'T');
const ids = rows.map((r) => r.game_id).sort();
assert.deepStrictEqual(ids, ['1', '2', '7'], `wrote ${ids}`);
console.log('PASS  started, unpolled games get a row; polled, unstarted, full and unchanged ones do not');
const r1 = rows.find((r) => r.game_id === '1');
assert.strictEqual(r1.key, 'UIW@TXST');
assert.deepStrictEqual(r1.plays, []);
assert.strictEqual(r1.state, 'post');
assert.deepStrictEqual(r1.status.score, { away: 17, home: 42 });
assert.strictEqual(r1.status.lite, true);
console.log('PASS  a row is keyed AWAY@HOME, has no plays, and carries the score as a lite status');
assert.strictEqual(rows.find((r) => r.game_id === '2').state, 'in');
console.log('PASS  a live game is written live');

// The apps read the score from the last play, else the scoreboard's.
assert.deepStrictEqual(feedScore({ plays: [], status: r1.status }), { as: 17, hs: 42 });
assert.deepStrictEqual(feedScore({ plays: [{ c: 10, as: 7, hs: 3 }], status: r1.status }), { as: 7, hs: 3 });
assert.strictEqual(feedScore({ plays: [], status: null }), null);
console.log('PASS  feedScore: the last play, else the scoreboard, else nothing');
console.log('ALL COLLEGE-SCORES TESTS PASSED');
