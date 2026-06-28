// Automated playtester — do the DEFENSIVE buffs earn their cost against a NUKER?
// §2/§4 found counter-nuke / insurance / floodgates / ot-shield dead vs the honest
// field (nobody nuked). Now that NUKE actually kills a slot (§6), re-price them against
// an opponent that nukes. Away is a "strong nuker" — its skill players who score a TD
// this week are flipped to `td` so the nukes land — and home (the victim, the `you`
// side that counter-nuke/insurance protect) arms one defensive buff. Paired A/B vs an
// unbuffed home isolates each buff's value; compare lift-per-coin to the offensive buffs.
//
//   npx tsx tools/playtester/defense.mjs --week=1-14 --n=200
import { readFileSync } from 'node:fs';
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';
import { aiLineup } from '../../src/data/aiLineup.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 200);
const seed = Number(flags.seed ?? 1212);
const price = (id) => powerupById(id)?.price ?? 0;

// Players who scored a TD in a given week (so a `td` nuke metric actually fires).
const tdCache = new Map();
function tdScorers(week) {
  if (!tdCache.has(week)) {
    const d = JSON.parse(readFileSync(new URL(`../../public/pbp/w${week}.json`, import.meta.url), 'utf8'));
    const s = new Set();
    for (const [slug, plays] of Object.entries(d.pbp)) if (plays.some((p) => p.td)) s.add(slug);
    tdCache.set(week, s);
  }
  return tdCache.get(week);
}

// Build the away NUKER: honest lineup, but every skill starter who scored a TD this
// week is flipped to `td`. `homeLoad`/`awayLoad` go through buildMatchup so extra
// slots stay symmetric; here neither side buys extra.
function nukerAway(Ra, week) {
  const td = tdScorers(week);
  return { metricOverride: (p) => (td.has(p.slug) && ['RB', 'WR', 'TE'].includes(slugMeta(p.slug).pos) ? 'td' : null) };
}

const DEF_BUFFS = ['counter-nuke', 'insurance', 'floodgates', 'ot-shield'];
console.log(`\nDEFENSIVE BUFFS vs a NUKER — paired A/B (home victim) — weeks ${weeks.join(',')}, ${N}/wk\n`);
const agg = Object.fromEntries(DEF_BUFFS.map((b) => [b, { w: 0, n: 0, dT: [], dC: [] }]));
let nukerAdv = 0, nN = 0; // how much the nuker beats an unbuffed honest home (context)

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 619);
  const awayL = nukerAway(null, week);
  for (let i = 0; i < N; i++) {
    const Rh = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const Ra = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const { homePicks, awayPicks } = buildMatchup(Rh, Ra, week, {}, awayL);
    const ctrl = resolve(homePicks, awayPicks, week);           // unbuffed home vs nuker
    nukerAdv += -ctrl.margin; nN++;                              // nuker's edge over honest home
    for (const b of DEF_BUFFS) {
      const r = resolve(homePicks, awayPicks, week, new Set([b]), new Set());
      const a = agg[b]; a.n++; a.dT.push(r.margin); a.dC.push(ctrl.margin);
      if (r.winner === 'home') a.w++;
    }
  }
}

console.log(`context — a TD-landing nuker beats an unbuffed honest home by avg ${fmt(nukerAdv / nN)} pts\n`);
console.log('buff'.padEnd(14) + 'cost'.padStart(6) + 'homeWR'.padStart(9) + 'marginLift'.padStart(12) + 'pts/10c'.padStart(9) + '  verdict');
console.log('-'.repeat(62));
for (const b of DEF_BUFFS) {
  const a = agg[b];
  const lift = mean(a.dT) - mean(a.dC);
  const perCoin = lift / (price(b) / 10);
  const v = perCoin >= 2 ? 'STRONG vs nukers' : perCoin >= 1 ? 'earns its cost' : lift < 1 ? 'still DEAD' : 'weak';
  console.log(b.padEnd(14) + String(price(b)).padStart(6) + (fmt(a.w / a.n * 100) + '%').padStart(9) + ('+' + fmt(lift)).padStart(12) + fmt(perCoin, 2).padStart(9) + '  ' + v);
}
console.log(`\n(offensive-buff yardstick from §2: momentum/overtime/garbage ≈ +14 margin for 60–75 coin ≈ 2 pts/10c)`);
