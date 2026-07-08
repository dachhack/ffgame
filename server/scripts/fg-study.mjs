// FIELD GENERAL STUDY — is a QB on `fg` (banks 0, multiplies your window's
// drips by 1 + 0.006 × cumulative pass yds) worth more than the same QB on
// flat `pass` points? A/B: identical lineups except the QB metric, resolved
// as FULL WINDOWS (resolveLiveMatchup) so the cross-slot multiplier is real.
//
//   cd server && npm run study:fg
//   WEEKS=1,2,3 npm run study:fg
//
// Sweeps: supporting cast size (1–3 drip teammates) × opponent style
// (drips that don't deny vs erasers/resets that gut drip banks).
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek, resolveLiveMatchup } from '../src/engine.js';
import { STAT_PLAYERS, normName } from '../../src/data/players.ts';

const slugOf = (n) => normName(n).replace(/\s+/g, '-');
const WEEKS = (process.env.WEEKS ?? '1,2,3,5,7,9,11,13').split(',').map(Number);

const pool = (pos, n) => STAT_PLAYERS.filter((p) => p.pos === pos)
  .sort((a, b) => b.ppr - a.ppr).slice(0, n)
  .map((p) => ({ slug: slugOf(p.name), team: p.team, pos }));

const QBS = pool('QB', 8), WRS = pool('WR', 10), RBS = pool('RB', 10);

// cast/opponent builders: cast size = # of drip teammates alongside the QB
const CASTS = [1, 2, 3];
const OPP_STYLES = {
  passive: (wr, rb, wr2) => [
    { pos: 'QB', m: 'pass' }, { p: wr, m: 'recyd' }, { p: rb, m: 'rush' }, { p: wr2, m: 'recyd' },
  ],
  denial: (wr, rb, wr2) => [
    { pos: 'QB', m: 'pass' }, { p: wr, m: 'rec' }, { p: rb, m: 'rec' }, { p: wr2, m: 'tgt' },
  ],
};

// res[castSize][style] = { n, fg, pass, fgWins (fg beats pass), fgH2H, passH2H }
const res = {};

for (const week of WEEKS) {
  let w;
  try { w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${week}.json`, import.meta.url))); }
  catch { continue; }
  injectWeek(week, w.pbp, w.points);
  const has = (p) => (w.pbp[p.slug] ?? []).length > 3;
  const qbs = QBS.filter(has).slice(0, 4);
  const wrs = WRS.filter(has), rbs = RBS.filter(has);
  if (wrs.length < 6 || rbs.length < 4 || qbs.length < 2) continue;

  for (const [qi, qb] of qbs.entries()) {
    for (const cast of CASTS) {
      // my drips + a DISTINCT opponent set (offset picks so nobody plays himself)
      const myWr = wrs[qi % 3], myWr2 = wrs[(qi % 3) + 3], myRb = rbs[qi % 2];
      const opQb = qbs[(qi + 1) % qbs.length];
      const opWr = wrs[(qi + 1) % 3], opWr2 = wrs[((qi + 1) % 3) + 3], opRb = rbs[(qi + 1) % 2];
      const mk = (pl) => makePlayer(pl.slug, pl.pos, pl.team);
      const myCast = [
        { win: 'w', slot: 's1', player: mk(myWr), metricId: 'recyd' },
        ...(cast >= 2 ? [{ win: 'w', slot: 's2', player: mk(myRb), metricId: 'rush' }] : []),
        ...(cast >= 3 ? [{ win: 'w', slot: 's3', player: mk(myWr2), metricId: 'recyd' }] : []),
      ];
      for (const [style, build] of Object.entries(OPP_STYLES)) {
        const oppRaw = build(opWr, opRb, opWr2).slice(0, cast + 1);
        const opp = oppRaw.map((o, i) => ({
          win: 'w', slot: `s${i}`,
          player: o.pos === 'QB' ? mk(opQb) : mk(o.p),
          metricId: o.m,
        }));
        const A = [{ win: 'w', slot: 's0', player: mk(qb), metricId: 'fg' }, ...myCast];
        const B = [{ win: 'w', slot: 's0', player: mk(qb), metricId: 'pass' }, ...myCast];
        const rA = resolveLiveMatchup(A, opp, week);
        const rB = resolveLiveMatchup(B, opp, week);
        const cell = ((res[cast] ??= {})[style] ??= { n: 0, fg: 0, pass: 0, fgWins: 0, fgH2H: 0, passH2H: 0 });
        cell.n++; cell.fg += rA.home; cell.pass += rB.home;
        if (rA.home > rB.home) cell.fgWins++;
        if (rA.home > rA.away) cell.fgH2H++;
        if (rB.home > rB.away) cell.passH2H++;
      }
    }
  }
}

console.log('FIELD GENERAL vs PASSING — same lineup, full-window resolution');
console.log('cast = drip teammates in the window alongside the QB\n');
console.log('cast  opponent   n    avg FG total  avg PASS total   FG better   H2H win FG / PASS');
for (const cast of CASTS) {
  for (const style of Object.keys(OPP_STYLES)) {
    const c = res[cast]?.[style];
    if (!c) continue;
    console.log(
      `  ${cast}   ${style.padEnd(8)} ${String(c.n).padStart(3)}   ${(c.fg / c.n).toFixed(1).padStart(10)}   ${(c.pass / c.n).toFixed(1).padStart(12)}   ${(100 * c.fgWins / c.n).toFixed(0).padStart(7)}%   ${(100 * c.fgH2H / c.n).toFixed(0).padStart(6)}% / ${(100 * c.passH2H / c.n).toFixed(0)}%`);
  }
}
console.log('\nreading: "FG better" = share of lineups where the fg config out-scored');
console.log('the pass config; H2H = share that beat the opponent lineup outright.');
