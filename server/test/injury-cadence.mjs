// The injury poll's clock (v0.561.2). Founder: "Let's poll every 10 minutes.
// Sometimes there are last minute inactives." — both sources, on a game day.
// Run from server/:  npx tsx test/injury-cadence.mjs
import assert from 'node:assert';
import { injuryPollEvery, sleeperInjuryTtl } from '../src/index.js';

const MIN = 60_000, H = 3600_000;
const now = Date.parse('2026-09-27T16:30:00Z');             // Sunday 12:30 ET
const at = (ms, state = 'pre') => ({ kickoffMs: now + ms, state });

// Sunday, the 1 PM games 30 min out: the near ramp, both sides fast.
assert.strictEqual(injuryPollEvery([at(30 * MIN)], now), 3 * MIN);
assert.strictEqual(sleeperInjuryTtl([at(30 * MIN)], now), 10 * MIN);
// Early games live, the 4:25s 3h off: the game-day clock, now 10 min (was 1h).
assert.strictEqual(injuryPollEvery([at(-90 * MIN, 'in'), at(3 * H)], now), 10 * MIN);
assert.strictEqual(sleeperInjuryTtl([at(-90 * MIN, 'in'), at(3 * H)], now), 10 * MIN);
console.log('PASS  a game day polls ESPN and re-reads Sleeper every 10 minutes (3 near kickoff)');
// A Wednesday, the next game Thursday night: off-day clocks.
assert.strictEqual(injuryPollEvery([at(60 * H)], now), 3 * H);
assert.strictEqual(sleeperInjuryTtl([at(60 * H)], now), undefined);
console.log('PASS  an off day keeps 3h / Sleeper\'s own 6h');
console.log('ALL INJURY-CADENCE TESTS PASSED');
