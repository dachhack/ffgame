// Guard for OFFENSIVE POSSESSION INTERVALS (v0.339.2).
//
// Founder: "does the app drip every game minute, not every team offense
// minute?" — it did, and so did the web. A drip metric is DEFINED as accruing
// "while your team has the ball", and `sim.offSecs` gates it on intervals from
// `realPossFor`, which reads the baked week cache that only genRealPbp.mjs
// writes. No live path ever filled it, so live games hit
// `if (!intervals.length) return t1 - t0` and every drip accrued on every game
// minute. The fallback was meant for unknown data and had become the normal
// case in-season, over-crediting every drip in every live window.
//
// Nothing about that was visible on screen: the number was simply too big, and
// only two clients disagreeing surfaced it at all. So the derivation is pinned
// here rather than trusted.
// Run: npx tsx scripts/check-poss.mjs
import { possFromPlays } from '../packages/core/src/data/gameFeed.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

// Only the fields the rule reads. If it starts depending on more, this fixture
// stops representing reality and should be updated deliberately.
const play = (c, tm, extra = {}) => ({ c, tm, drv: 0, dn: 1, dist: 10, yl: 50, yl2: 50, ty: 'Pass', txt: '', hs: 0, as: 0, ...extra });

// ── 1. A drive is ONE merged interval, not one per play ───────────────────
{
  const p = possFromPlays([play(0, 'DEN'), play(30, 'DEN'), play(60, 'DEN'), play(90, 'DEN')]);
  ok(JSON.stringify(p.DEN) === JSON.stringify([[0, 90]]),
    'four consecutive DEN plays merge into a single [0,90] interval');
  ok(Object.keys(p).length === 1, 'and nobody else is credited');
}

// ── 2. THE POINT: each team only gets its own time ────────────────────────
{
  const p = possFromPlays([
    play(0, 'DEN'), play(60, 'DEN'),      // DEN has it 0–60
    play(120, 'GB'), play(180, 'GB'),     // GB has it 60–180
    play(240, 'DEN'),                     // DEN again 180–240
  ]);
  ok(JSON.stringify(p.DEN) === JSON.stringify([[0, 60], [180, 240]]), 'DEN gets 0–60 and 180–240');
  ok(JSON.stringify(p.GB) === JSON.stringify([[60, 180]]), 'GB gets 60–180');
  const den = p.DEN.reduce((n, [a, b]) => n + (b - a), 0);
  const gb = p.GB.reduce((n, [a, b]) => n + (b - a), 0);
  ok(den + gb === 240, 'every second between the first and last play is credited exactly once');
  ok(den === 120 && gb === 120, 'and split the way the plays say, not evenly by accident');
}

// ── 3. The span belongs to whoever runs the NEXT play ─────────────────────
// Deliberately keyed off the next play's `tm` rather than this play's `tm2`:
// tm2 only appears when possession flips, so a feed omitting it on a turnover
// would credit a whole drive to the wrong side.
{
  const p = possFromPlays([play(0, 'DEN'), play(60, 'GB', { to: 1 })]);
  ok(JSON.stringify(p.GB) === JSON.stringify([[0, 60]]),
    'the span before a turnover-recovering play is credited to the recovering team');
  ok(p.DEN === undefined, 'and NOT to the team that ran the earlier play');
}

// A feed that omits tm2 entirely must still split correctly — the regression
// this keying exists to prevent.
{
  const withTm2 = possFromPlays([play(0, 'DEN', { tm2: 'GB' }), play(60, 'GB')]);
  const without = possFromPlays([play(0, 'DEN'), play(60, 'GB')]);
  ok(JSON.stringify(withTm2) === JSON.stringify(without),
    'the result does not depend on tm2 being present at all');
}

// ── 4. The live tail is credited to NOBODY ────────────────────────────────
// The game has not been played past the last play. Crediting the tail is how a
// live drip would drift ahead of the game again.
{
  const p = possFromPlays([play(0, 'DEN'), play(60, 'DEN')]);
  const total = Object.values(p).flat().reduce((n, [a, b]) => n + (b - a), 0);
  ok(total === 60, 'time after the final play is credited to nobody');
}

// ── 5. Out-of-order and degenerate feeds ──────────────────────────────────
{
  const sorted = possFromPlays([play(120, 'GB'), play(0, 'DEN'), play(60, 'DEN')]);
  ok(JSON.stringify(sorted.DEN) === JSON.stringify([[0, 60]])
    && JSON.stringify(sorted.GB) === JSON.stringify([[60, 120]]),
    'plays arriving out of clock order are sorted before the walk');
  ok(JSON.stringify(possFromPlays([])) === '{}', 'an empty feed yields no intervals rather than throwing');
  ok(JSON.stringify(possFromPlays([play(0, 'DEN')])) === '{}',
    'a single play yields no interval — there is no span yet');
  ok(JSON.stringify(possFromPlays([play(0, 'DEN'), play(0, 'GB')])) === '{}',
    'two plays at the same clock yield no zero-length interval');
  ok(JSON.stringify(possFromPlays([play(0, ''), play(60, '')])) === '{}',
    'a feed with no possession team credits nobody (offSecs then treats it as unknown)');
}

// ── 6. WHAT IT MEANS FOR A DRIP, end to end ───────────────────────────────
// The bug in one assertion: a 14-yard receiver on a 0.01/yd rate, in a game
// where his team held the ball half the time.
{
  const p = possFromPlays([
    play(0, 'DEN'), play(600, 'GB'), play(1200, 'DEN'), play(1800, 'GB'),
  ]);
  const denSecs = p.DEN.reduce((n, [a, b]) => n + (b - a), 0);
  ok(denSecs === 600, 'DEN held the ball for 600 of the 1800 elapsed seconds');
  const rate = 14 * 0.01;                       // pts per MINUTE
  const gated = rate * (denSecs / 60);
  const ungated = rate * (1800 / 60);
  ok(Math.abs(gated - 1.4) < 1e-9, 'gated: 10 offensive minutes = 1.4 pts');
  ok(Math.abs(ungated - 4.2) < 1e-9, 'ungated: 30 game minutes = 4.2 pts — THREE TIMES the real figure');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL POSSESSION ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
