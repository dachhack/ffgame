// The scheduler's season policy (index.js contextsFor). Pure, so it runs with no
// network and no database — which matters, since ESPN is unreachable from CI.
//
// What it pins down: preseason and the regular season COEXIST (they used to be
// mutually exclusive process modes), preseason keeps its +100 board-week
// namespace so the two can never collide, and leaving PILOT_SEASON_TYPE UNSET is
// the configuration that does the right thing — the old flag, left set past the
// opener, would have stopped the regular season from ever locking or resolving
// while the logs looked healthy.
import { contextsFor } from '../src/index.js';

let fails = 0;
const eq = (a, b, msg) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x === y) return console.log('PASS ', msg);
  console.log('FAIL ', msg, '\n  expected', y, '\n  got     ', x);
  fails++;
};
const board = (cs) => cs.map((c) => `${c.seasonType === 1 ? 'pre' : 'reg'}:${c.espnWeek}→${c.espnWeek + c.offset}`);

// August: ESPN reports preseason week 3; Sleeper's regular week is still 1.
eq(board(contextsFor(null, 1, 3)), ['pre:3→103', 'reg:1→1'],
  'preseason + regular run together, preseason first');

// Preseason over — ESPN stops reporting a preseason week.
eq(board(contextsFor(null, 1, null)), ['reg:1→1'],
  'no preseason week → regular season only');

// ESPN parked past the last loaded preseason week.
eq(board(contextsFor(null, 2, 9)), ['reg:2→2'],
  'preseason week beyond the loaded range is ignored');

// Mid-season: nothing preseason about it.
eq(board(contextsFor(null, 11, null)), ['reg:11→11'], 'week 11 regular only');

// The escape hatch still pins to exactly one context.
eq(board(contextsFor(1, 1, 2)), ['pre:2→102'], 'forced preseason = that context alone');
eq(board(contextsFor(2, 7, 3)), ['reg:7→7'], 'forced regular ignores preseason');

// The regression that motivated the refactor: with the flag unset, the regular
// season is ALWAYS present, so no preseason state can switch it off.
for (const pre of [null, 1, 2, 3, 4, 99]) {
  const cs = contextsFor(null, 5, pre);
  if (!cs.some((c) => c.seasonType === 2 && c.offset === 0)) {
    console.log('FAIL  regular-season context missing for preWeek =', pre); fails++;
  }
}
console.log('PASS  regular season survives every preseason state');

// Board weeks never collide: preseason is namespaced above every real week.
const same = contextsFor(null, 4, 4);
const weeks = same.map((c) => c.espnWeek + c.offset);
eq(new Set(weeks).size, weeks.length, 'preseason wk4 and regular wk4 land on different board weeks');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS — week contexts');
process.exit(fails ? 1 : 0);
