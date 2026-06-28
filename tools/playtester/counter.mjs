// Automated playtester — opponent-ROSTER-aware window counters. The blind rule lets
// the AI see which players the opponent HAS in each window (not their starters/metrics),
// and NUKE is now a viable drip counter (§6). So: meet the opponent's most drip-heavy
// window by sacrificing your weakest skill player there to a TD nuke. Paired A/B (same
// two rosters, home counters vs home honest, away fixed honest) isolates the counter's
// edge. Different rosters (a real matchup), not a mirror.
//
//   npx tsx tools/playtester/counter.mjs --week=1-14 --n=300
import { rng, useWeek, drawRoster, toLive, resolve, slugMeta, parseWeeks, mean, fmt } from './lib.mjs';
import { aiLineup } from '../../src/data/aiLineup.ts';
import { statsForSlug } from '../../src/data/players.ts';
import { hasSlate, windowForTeam } from '../../src/data/nflSlate.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 300);
const seed = Number(flags.seed ?? 717);

function dripYds(slug) {
  const { pos } = slugMeta(slug); const s = statsForSlug(slug, pos); const g = Math.max(1, s.games);
  if (pos === 'RB') return s.rushYds / g; if (pos === 'WR' || pos === 'TE') return s.recYds / g; return 0;
}
const proj = (slug) => { const { pos } = slugMeta(slug); return statsForSlug(slug, pos).ppr; };

// Opponent drip strength per window from THEIR roster (allowed: roster-by-window).
function oppDripByWindow(roster, week) {
  const m = new Map();
  if (!hasSlate(week)) return m;
  for (const s of roster) { const w = windowForTeam(week, slugMeta(s).team); if (w) m.set(w, (m.get(w) || 0) + dripYds(s)); }
  return m;
}

// Counter: in the opponent's most drip-heavy window (above `thresh`), flip the home
// lineup's weakest skill player there to `td` (prefer a TE — its nuke also kills the
// window's hot streaks). Returns possibly-modified picks.
function applyCounter(homePicks, oppRoster, week, thresh) {
  const opp = oppDripByWindow(oppRoster, week);
  let bestWin = null, bestV = thresh;
  for (const [w, v] of opp) if (v > bestV) { bestV = v; bestWin = w; }
  if (!bestWin) return homePicks;
  const inWin = homePicks.filter((p) => p.win === bestWin && ['RB', 'WR', 'TE'].includes(slugMeta(p.slug).pos));
  if (!inWin.length) return homePicks;
  const te = inWin.filter((p) => slugMeta(p.slug).pos === 'TE').sort((a, b) => proj(a.slug) - proj(b.slug))[0];
  const target = te || inWin.sort((a, b) => proj(a.slug) - proj(b.slug))[0]; // weakest skill player (TE first)
  return homePicks.map((p) => (p === target ? { ...p, metric: 'td' } : p));
}

const THRESHOLDS = [120, 160, 200, 240];
console.log(`\nOPPONENT-ROSTER-AWARE NUKE COUNTER — paired A/B vs honest — weeks ${weeks.join(',')}, ${N}/wk\n`);
const agg = Object.fromEntries(THRESHOLDS.map((t) => [t, { w: 0, t: 0, n: 0, dT: [], dC: [], fired: 0 }]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 401);
  for (let i = 0; i < N; i++) {
    const Rh = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const Ra = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const away = toLive(aiLineup(Ra, week));
    const baseHome = aiLineup(Rh, week);
    const ctrl = resolve(toLive(baseHome), away, week);
    for (const thresh of THRESHOLDS) {
      const counter = applyCounter(baseHome, Ra, week, thresh);
      const fired = counter.some((p, j) => p.metric !== baseHome[j].metric);
      const r = resolve(toLive(counter), away, week);
      const a = agg[thresh]; a.n++; a.dT.push(r.margin); a.dC.push(ctrl.margin);
      if (r.winner === 'home') a.w++; else if (r.winner === 'tie') a.t++;
      if (fired) a.fired++;
    }
  }
}

console.log('thresh'.padEnd(8) + 'homeWR'.padStart(9) + 'marginLift'.padStart(12) + 'firedRate'.padStart(11));
console.log('-'.repeat(40));
for (const [t, a] of Object.entries(agg)) {
  const lift = mean(a.dT) - mean(a.dC);
  console.log(t.padEnd(8) + (fmt(a.w / a.n * 100) + '%').padStart(9) + ((lift >= 0 ? '+' : '') + fmt(lift)).padStart(12) + (fmt(a.fired / a.n * 100) + '%').padStart(11));
}
console.log(`\nmarginLift>0 & homeWR>~50% on fired matchups ⇒ opponent-roster nuke counters add value.`);
