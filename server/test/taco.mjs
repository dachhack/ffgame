// THE TACO LOCKER's clock (v0.647.0): once per board week, from Thursday
// 9 AM Eastern, catching up through Monday; never Tuesday or Wednesday;
// never twice. Pure; no database.
// Run from server/:  npx tsx test/taco.mjs
import assert from 'node:assert';
import { etClock, tacoDue, tacoLine, TACO_HOUR_ET } from '../src/taco.js';

// 2026-10-08 is a Thursday. Eastern is UTC−4 in October (EDT).
const T = (iso) => Date.parse(iso);
assert.deepStrictEqual(etClock(T('2026-10-08T12:59:00Z')), { dow: 4, hour: 8 }, '8:59 AM ET Thursday');
assert.deepStrictEqual(etClock(T('2026-10-08T13:00:00Z')), { dow: 4, hour: 9 }, '9:00 AM ET Thursday');
assert.deepStrictEqual(etClock(T('2026-10-07T13:00:00Z')), { dow: 3, hour: 9 }, 'Wednesday');
assert.deepStrictEqual(etClock(T('2026-10-12T03:30:00Z')), { dow: 0, hour: 23 }, '11:30 PM ET Sunday (Monday UTC)');
assert.strictEqual(TACO_HOUR_ET, 9);

const WEEK = 5;
assert.strictEqual(tacoDue(T('2026-10-08T12:59:00Z'), WEEK, null), false, 'not before nine on Thursday');
assert.strictEqual(tacoDue(T('2026-10-08T13:00:00Z'), WEEK, null), true, 'due at nine');
assert.strictEqual(tacoDue(T('2026-10-08T13:00:00Z'), WEEK, 4), true, 'last set a week ago → due');
assert.strictEqual(tacoDue(T('2026-10-08T13:00:00Z'), WEEK, 5), false, 'already set this week → never twice');
assert.strictEqual(tacoDue(T('2026-10-08T13:00:00Z'), WEEK, '5'), false, 'the stamp may arrive as text');
assert.strictEqual(tacoDue(T('2026-10-06T13:00:00Z'), WEEK, null), false, 'Tuesday is the manager\'s');
assert.strictEqual(tacoDue(T('2026-10-07T23:00:00Z'), WEEK, null), false, 'Wednesday too');
assert.strictEqual(tacoDue(T('2026-10-09T13:00:00Z'), WEEK, null), true, 'Friday: a worker that was down on Thursday catches up');
assert.strictEqual(tacoDue(T('2026-10-11T17:00:00Z'), WEEK, null), true, 'Sunday: still catches up (kicked-off players stand, lock.js)');
assert.strictEqual(tacoDue(T('2026-10-13T02:00:00Z'), WEEK, null), true, 'Monday night');
assert.strictEqual(tacoDue(T('2026-10-13T13:00:00Z'), WEEK + 1, 5), false, 'Tuesday, the week rolled: not until Thursday');
assert.strictEqual(tacoDue(T('2026-10-15T13:00:00Z'), WEEK + 1, 5), true, 'next Thursday at nine: due again');

assert.strictEqual(tacoLine('Taco Time Titans', 5), '🌮 Taco Locker set Taco Time Titans\'s lineup for week 5 — the best projected starters, the way an AI team\'s are set.');
console.log('taco locker tests passed');
