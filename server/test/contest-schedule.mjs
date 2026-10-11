// THE ROUND-ROBIN (v0.670.0). Founder: "Head-to-head records and a round-robin
// schedule next." Pure: over n−1 rounds everyone plays everyone once, nobody
// twice, home and away alternate, an odd count sits one out, and the same
// inputs always give the same pairs. Run from server/: npx tsx test/contest-schedule.mjs
import { __setClientForTest } from '../src/supabase.js';
__setClientForTest({});
const { roundRobinPairs, pairPodSeats } = await import('../src/pods.js');

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const seats = [1, 2, 3, 4, 5, 6, 7, 8];
const first = 3;
const met = new Map();   // "a|b" → weeks met
const weeks = [];
for (let w = first; w < first + 7; w++) {
  const pairs = roundRobinPairs('L1', w, seats, first);
  weeks.push(pairs);
  for (const [a, b] of pairs) { const k = [a, b].sort((x, y) => x - y).join('|'); met.set(k, [...(met.get(k) ?? []), w]); }
}
ok('every week pairs all eight seats into four games', weeks.every((p) => p.length === 4 && new Set(p.flat()).size === 8), weeks);
ok('over seven rounds everyone plays everyone exactly once', met.size === 28 && [...met.values()].every((v) => v.length === 1), [...met.entries()].filter(([, v]) => v.length !== 1));
const again = roundRobinPairs('L1', first + 7, seats, first);
ok('the eighth week starts the cycle over', JSON.stringify(again) === JSON.stringify(weeks[0]));
ok('the same inputs always deal the same pairs', JSON.stringify(roundRobinPairs('L1', 5, seats, first)) === JSON.stringify(roundRobinPairs('L1', 5, [...seats].reverse(), first)));
ok('two leagues do not run in step', JSON.stringify(roundRobinPairs('L1', first, seats, first)) !== JSON.stringify(roundRobinPairs('L2', first, seats, first)) || JSON.stringify(roundRobinPairs('L1', first + 1, seats, first)) !== JSON.stringify(roundRobinPairs('L2', first + 1, seats, first)));
// Home and away: the fixed seat is home one round and away the next.
const homeOf = (pairs, seat) => pairs.some(([h]) => h === seat);
ok('home and away alternate round to round', homeOf(weeks[0], 1) !== homeOf(weeks[1], 1) && homeOf(weeks[1], 1) !== homeOf(weeks[2], 1), weeks.slice(0, 3));
// An odd league: one seat sits out each week, a different one each round.
const odd = [1, 2, 3, 4, 5];
const byes = [];
for (let w = 0; w < 5; w++) { const p = roundRobinPairs('L3', w, odd, 0); ok(`odd week ${w}: two games, one bye`, p.length === 2 && new Set(p.flat()).size === 4, p); byes.push(odd.find((s) => !p.flat().includes(s))); }
ok('an odd league gives every seat exactly one bye in a cycle', new Set(byes).size === 5, byes);
ok('fewer than two seats: no games', roundRobinPairs('L4', 1, [7], 1).length === 0);
// The shuffle still exists for drip pods.
ok('the drip pod shuffle is untouched', pairPodSeats('P', 1, [1, 2, 3, 4, 5, 6]).length === 3);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
