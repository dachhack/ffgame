// Automated playtester — STEP 4: AI iteration (measure, don't guess).
//
// Pits candidate AI policies against the CURRENT shipping policy on a MIRROR roster
// (same players both sides, both BLIND — no hindsight), so the margin is the pure
// policy edge, not roster luck. The adversary (§3) showed the one clear blind-legal
// win is Combo Drip: the 20/20-ypg gate is too conservative and the buy is mis-ordered
// vs the higher-EV offensive buffs. Here we sweep the combodrip threshold + buy order
// and report each candidate's win-rate / avg margin vs current — to choose the change
// before touching src/data/aiLineup.ts, then re-run adversary.mjs to confirm the edge
// shrinks.
//
//   npx tsx tools/playtester/iterate.mjs --week=1-14 --n=120
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';
import { aiLiveBuffs } from '../../src/data/aiLineup.ts';
import { statsForSlug } from '../../src/data/players.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 120);
const seed = Number(flags.seed ?? 808);
const SEED_COIN = 100, price = (id) => powerupById(id)?.price ?? 0;

/** Does a player clear a candidate combodrip gate (per-game rush & rec floors)? */
function meetsCombo(slug, pos, [rmin, cmin]) {
  if (pos !== 'RB' && pos !== 'WR') return false;
  const s = statsForSlug(slug, pos), g = Math.max(1, s.games);
  return s.rushYds / g >= rmin && s.recYds / g >= cmin;
}

// A policy turns a roster + wallet into a blind loadout. params:
//   combo: [rushYpg, recYpg] gate (null = never buy combodrip)
//   items(key, week, hasDual): ordered priority list of buys ('combodrip' or a buff id).
// Buys in priority order while affordable (carry-over wallet starts at the season seed).
function policy(R, week, key, params) {
  let bal = SEED_COIN;
  const owned = new Set(), buffs = new Set();
  const duals = R.filter((s) => params.combo && meetsCombo(s, slugMeta(s).pos, params.combo));
  for (const it of params.items(key, week, duals.length > 0)) {
    if (it === 'combodrip') { if (duals.length && !owned.has('unlock-combo-drip') && bal >= 65) { bal -= 65; owned.add('unlock-combo-drip'); } }
    else { const p = price(it); if (!buffs.has(it) && bal >= p) { bal -= p; buffs.add(it); } }
  }
  let extra = 0; for (let i = 0; i < 2; i++) { if (bal >= 80) { bal -= 80; extra++; } else break; }
  const comboSet = owned.has('unlock-combo-drip') ? new Set(duals) : new Set();
  return { owned, buffs, extra, metricOverride: (p) => (comboSet.has(p.player?.id ?? p.slug) ? 'combodrip' : null), nCombo: comboSet.size, nBuff: buffs.size };
}

// 'current' = the shipping logic: combodrip first, then a RANDOM 3-buff draw (which
// often surfaces the dead defensive buffs, §2). EV candidates buy the proven offensive
// buffs (momentum/overtime/garbage-time) explicitly instead.
const EV = ['momentum', 'overtime', 'garbage-time'];
const CURRENT = { name: 'current [20/20, rand buffs]', combo: [20, 20], items: (k, w) => ['combodrip', ...aiLiveBuffs(k, w)] };
const CANDIDATES = [
  CURRENT,
  { name: 'EV-buffs, no combo       ', combo: null, items: () => EV },
  { name: 'EV-buffs then combo[20]  ', combo: [20, 20], items: () => [...EV, 'combodrip'] },
  { name: 'EV-buffs then combo[10/6]', combo: [10, 6], items: () => [...EV, 'combodrip'] },
  { name: 'combo[20] then EV-buffs  ', combo: [20, 20], items: () => ['combodrip', ...EV] },
  { name: 'combo[10/6] then EV-buffs', combo: [10, 6], items: () => ['combodrip', ...EV] },
  { name: 'momentum only            ', combo: null, items: () => ['momentum'] },
  { name: 'EV+combo[10/6], drop rand', combo: [10, 6], items: () => ['momentum', 'overtime', 'combodrip', 'garbage-time'] },
];

console.log(`\nAI POLICY A/B vs current (mirror roster, both blind) — ${N} draws/week · weeks ${weeks.join(',')}\n`);

const agg = CANDIDATES.map(() => ({ wins: 0, ties: 0, n: 0, margins: [], combo: [] }));
for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 4099);
  for (let i = 0; i < N; i++) {
    const R = drawRoster(rand, c);
    const cur = policy(R, week, `t${i}`, CURRENT);
    for (let k = 0; k < CANDIDATES.length; k++) {
      const cand = policy(R, week, `t${i}`, CANDIDATES[k]);
      // home = candidate, away = current, identical roster → margin is policy edge.
      const { homePicks, awayPicks } = buildMatchup(R, R, week, { owned: cand.owned, extra: cand.extra, metricOverride: cand.metricOverride }, { owned: cur.owned, extra: cur.extra, metricOverride: cur.metricOverride });
      const r = resolve(homePicks, awayPicks, week, cand.buffs, cur.buffs);
      const a = agg[k]; a.n++; a.margins.push(r.margin); a.combo.push(cand.nCombo);
      if (r.winner === 'home') a.wins++; else if (r.winner === 'tie') a.ties++;
    }
  }
}

console.log('policy'.padEnd(28) + 'winVsCur'.padStart(10) + 'avgMargin'.padStart(11) + 'combodrip/lineup'.padStart(18));
console.log('-'.repeat(67));
CANDIDATES.forEach((cand, k) => {
  const a = agg[k];
  console.log(cand.name.padEnd(28) + (fmt(a.wins / a.n * 100) + '%').padStart(10) + ((mean(a.margins) >= 0 ? '+' : '') + fmt(mean(a.margins))).padStart(11) + fmt(mean(a.combo), 2).padStart(18));
});
console.log('\n(win-rate vs current > 50% and avg margin > 0 ⇒ the candidate is a strict blind improvement)');
