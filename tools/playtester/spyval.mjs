// Automated playtester — SPY INFORMATION VALUE (findings §20).
//
// Spy (◎40) is pure information: reveal the opponent's sealed pick at one slate
// slot — their PLAYER or their METRIC — before that window kicks off. The lever
// battery can't price information, so this driver measures the value of the
// best HONEST response to each reveal:
//   home spies the away side's TOP-PROJECTED slot (scout-informed slot choice —
//   you know their pool, not their placement, so this is a mild upper bound),
//   then re-picks ITS OWN metric at that same slot to the projection-best
//   counter given what was revealed. No hindsight: the response is chosen in
//   PROJECTION mode (historical expectation), then the real week resolves.
// Arms:
//   • reveal-metric — know their metric; assume their body is the window pool's
//     top-projected player.
//   • reveal-player — know their player; assume the metric is that player's
//     projection-best pick (what an honest opponent usually fields).
//   • reveal-both  — know the exact (player, metric): the info-value CEILING
//     (a real Spy only reveals ONE dimension per purchase).
//
//   npx tsx tools/playtester/spyval.mjs --week=1-14 --n=120
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';
import { resolveSlot, EMPTY_PLAYER } from '../../src/engine/sim.ts';
import { METRICS } from '../../src/data/metrics.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 120);
const seed = Number(flags.seed ?? 2929);

const SKILL = new Set(['RB', 'WR', 'TE']);
const key = (p) => `${p.win}|${p.slot}`;
function topPick(picks, c, filter = () => true) {
  let best = null, bp = -Infinity;
  for (const p of picks) { if (!filter(p)) continue; const v = c.proj.get(p.player.id) ?? 0; if (v > bp) { bp = v; best = p; } }
  return best;
}
const openMetrics = (pos) => (METRICS[pos] ?? METRICS.WR).filter((m) => !m.lock).map((m) => m.id);

/** Projection-best metric for a player standalone (what an honest side fields). */
function bestSoloMetric(player, week) {
  let best = null, bs = -Infinity;
  for (const mid of openMetrics(player.pos)) {
    if (mid === 'fg' || mid === 'underdog') continue; // coordination/comeback picks — never the honest solo default
    const r = resolveSlot({ player, metricId: mid }, { player: EMPTY_PLAYER, metricId: 'none' }, week, '', { projection: true });
    if (r.youFinal > bs) { bs = r.youFinal; best = mid; }
  }
  return best;
}

/** Home's projection-best COUNTER metric at its own slot vs an assumed opponent. */
function bestCounter(homePlayer, assumed, week) {
  let best = null, be = -Infinity;
  for (const mid of openMetrics(homePlayer.pos)) {
    if (mid === 'fg') continue;
    const r = resolveSlot({ player: homePlayer, metricId: mid }, assumed, week, '', { projection: true });
    const edge = r.youFinal - r.theirFinal;
    if (edge > be) { be = edge; best = mid; }
  }
  return best;
}

// reveal→jinx-td: the BET-AIMING use of information — jinx the spied slot ONLY
// when the reveal shows a TD-nuke metric ('td'), the pick Jinx punishes hardest
// (negates the first TD, nuke and all). Cost when it fires = spy + jinx.
const ARMS = ['reveal-metric', 'reveal-player', 'reveal-both', 'reveal→jinx-td'];
console.log(`\nSPY INFORMATION VALUE — ${N} paired matchups/week · weeks ${weeks.join(',')} · seed ${seed}\n`);

const stats = new Map(ARMS.map((a) => [a, { d: [], wins: 0, n: 0, changed: 0, miss: 0 }]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 4079);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    const { homePicks, awayPicks } = buildMatchup(hr, ar, week, {}, {});
    const ctrl = resolve(homePicks, awayPicks, week);
    // Spy target: away's top-projected skill slot. Home must have its own pick
    // there to respond (a reveal you can't act on is worthless in this model).
    const target = topPick(awayPicks, c, (p) => SKILL.has(p.player.pos));
    const mine = target ? homePicks.find((p) => key(p) === key(target)) : null;
    for (const arm of ARMS) {
      const st = stats.get(arm);
      if (arm === 'reveal→jinx-td') {
        if (!target) { st.miss++; continue; }
        st.n++;
        const fire = target.metricId === 'td'; // the reveal says their slot nukes
        if (fire) st.changed++;
        const r = fire ? resolve(homePicks, awayPicks, week, new Set(), new Set(), { home: { jinx: [key(target)] } }) : ctrl;
        st.d.push(r.margin - ctrl.margin);
        if (r.margin > 0) st.wins++;
        continue;
      }
      if (!target || !mine) { st.miss++; continue; }
      const assumed = arm === 'reveal-both' ? { player: target.player, metricId: target.metricId }
        : arm === 'reveal-metric'
          ? { player: (topPick(awayPicks.filter((p) => p.win === target.win && SKILL.has(p.player.pos)), c) ?? target).player, metricId: target.metricId }
          : { player: target.player, metricId: bestSoloMetric(target.player, week) };
      const counter = bestCounter(mine.player, assumed, week);
      st.n++;
      if (counter && counter !== mine.metricId) st.changed++;
      const treated = counter && counter !== mine.metricId
        ? homePicks.map((p) => (p === mine ? { ...p, metricId: counter } : p))
        : homePicks;
      const r = counter && counter !== mine.metricId ? resolve(treated, awayPicks, week) : ctrl;
      st.d.push(r.margin - ctrl.margin);
      if (r.margin > 0) st.wins++;
    }
  }
}

const price = powerupById('spy')?.price ?? 40;
console.log('arm'.padEnd(16) + 'homeWR'.padStart(8) + 'marginLift'.padStart(12) + 'pts/10c'.padStart(9) + 'changed%'.padStart(10) + 'apply%'.padStart(8));
console.log('-'.repeat(64));
for (const arm of ARMS) {
  const st = stats.get(arm);
  const lift = mean(st.d);
  const wr = st.n ? (st.wins / st.n) * 100 : 0;
  console.log(arm.padEnd(16) + (fmt(wr) + '%').padStart(8) + ((lift >= 0 ? '+' : '') + fmt(lift)).padStart(12)
    + fmt(lift / (price / 10), 2).padStart(9) + (fmt(st.changed / Math.max(1, st.n) * 100, 0) + '%').padStart(10)
    + (fmt(st.n / Math.max(1, st.n + st.miss) * 100, 0) + '%').padStart(8));
}
console.log(`\nSpy costs ◎${price} and reveals ONE dimension. changed% = pairings where the reveal`);
console.log('actually changed a decision (a flipped counter-metric, or a fired jinx). Unchanged');
console.log('responses are honest zero-value peeks. reveal-both is the metric-counter ceiling a');
console.log('single Spy cannot reach; reveal→jinx-td is the bet-aiming use (cost spy+jinx when fired).');
