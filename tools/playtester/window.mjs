// Automated playtester — window-level optimization: is the AI's Field General
// decision (the main in-window synergy) tuned right? A QB on `fg` scores 0 but
// multiplies its window's drips, so flipping it trades the QB's flat points for a
// drip boost. The current rule is blunt — "flip if ≥2 drip teammates." Here we A/B
// candidate FG rules (count- and projected-yard-weighted) vs that rule on a MIRROR
// roster (both blind), to see if a smarter per-window decision wins before shipping it.
//
//   npx tsx tools/playtester/window.mjs --week=1-14 --n=200
import { rng, useWeek, drawRoster, toLive, resolve, slugMeta, parseWeeks, mean, fmt } from './lib.mjs';
import { aiLineup } from '../../src/data/aiLineup.ts';
import { statsForSlug } from '../../src/data/players.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 200);
const seed = Number(flags.seed ?? 313);

const DRIP_METRICS = new Set(['rush', 'recyd', 'combodrip', 'retyd']);
// Projected per-game drip yards a Field General would multiply for this player.
function dripYds(slug) {
  const { pos } = slugMeta(slug); const s = statsForSlug(slug, pos); const g = Math.max(1, s.games);
  if (pos === 'RB') return s.rushYds / g;
  if (pos === 'WR' || pos === 'TE') return s.recYds / g;
  return 0;
}

// Re-decide each window's QB metric (fg vs pass) per a policy, starting from a clean
// base (all QBs on pass). policy(drips) → true to flip the QB to Field General.
function applyFg(basePicks, policy) {
  const picks = basePicks.map((p) => ({ ...p, metric: slugMeta(p.slug).pos === 'QB' ? 'pass' : p.metric }));
  const byWin = new Map();
  for (const p of picks) { if (!byWin.has(p.win)) byWin.set(p.win, []); byWin.get(p.win).push(p); }
  for (const group of byWin.values()) {
    const qb = group.find((p) => slugMeta(p.slug).pos === 'QB');
    if (!qb) continue;
    const drips = group.filter((p) => p !== qb && DRIP_METRICS.has(p.metric)).map((p) => dripYds(p.slug));
    if (policy(drips)) qb.metric = 'fg';
  }
  return toLive(picks);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const POLICIES = {
  'never':      (d) => false,
  'count>=1':   (d) => d.length >= 1,
  'count>=2*':  (d) => d.length >= 2,   // current shipping rule
  'count>=3':   (d) => d.length >= 3,
  'yds>=40':    (d) => sum(d) >= 40,
  'yds>=70':    (d) => sum(d) >= 70,
  'yds>=100':   (d) => sum(d) >= 100,
  'yds>=140':   (d) => sum(d) >= 140,
};
const CURRENT = 'count>=2*';

console.log(`\nFIELD GENERAL policy A/B vs current (${CURRENT}) — mirror roster, blind — weeks ${weeks.join(',')}, ${N}/wk\n`);
const agg = Object.fromEntries(Object.keys(POLICIES).map((k) => [k, { w: 0, t: 0, n: 0, m: [], fg: 0, slots: 0 }]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 277);
  for (let i = 0; i < N; i++) {
    const roster = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const base = aiLineup(roster, week);
    const away = applyFg(base, POLICIES[CURRENT]);
    for (const [name, pol] of Object.entries(POLICIES)) {
      const home = applyFg(base, pol);
      const r = resolve(home, away, week);
      const a = agg[name]; a.n++; a.m.push(r.margin);
      if (r.winner === 'home') a.w++; else if (r.winner === 'tie') a.t++;
      a.fg += home.filter((p) => p.metricId === 'fg').length; a.slots += 1;
    }
  }
}

console.log('FG policy'.padEnd(13) + 'winVsCur'.padStart(10) + 'avgMargin'.padStart(11) + 'fg/lineup'.padStart(11));
console.log('-'.repeat(45));
for (const [name, a] of Object.entries(agg)) {
  console.log(name.padEnd(13) + (fmt(a.w / a.n * 100) + '%').padStart(10) + ((mean(a.m) >= 0 ? '+' : '') + fmt(mean(a.m))).padStart(11) + fmt(a.fg / a.slots, 2).padStart(11));
}
console.log(`\n>50% & +margin ⇒ a better per-window Field General rule than the current count>=2.`);
