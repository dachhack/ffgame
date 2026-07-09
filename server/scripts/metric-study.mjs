// METRIC BALANCE STUDY — is each position's metric menu a real decision, or
// does one choice dominate? Runs the REAL engine (src/engine/sim.ts) over the
// baked 2025 play-by-play: same-position head-to-head duels across every
// metric pairing for the top players at each position.
//
//   cd server && npm run study            (defaults: 8 weeks × top 6 per pos)
//   WEEKS=1,2,3 POOL=4 npm run study      (quicker pass)
//
// Reads: duel win-rate matrix, unopposed value, best-response mix, and the
// share of player-weeks where each metric is the best overall pick. A healthy
// menu has no row that wins everywhere and no metric stuck at ~0% best-overall.
// Single-slot scope: cross-slot metrics (QB Field General, K Banker/Negation,
// DEF Suppress) bank 0 here by design — their value lives outside the slot.
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek, resolveWindow, EMPTY } from '../src/engine.js';
import { STAT_PLAYERS, normName } from '../../src/data/players.ts';

const slugOf = (n) => normName(n).replace(/\s+/g, '-');
const WEEKS = (process.env.WEEKS ?? '1,2,3,5,7,9,11,13').split(',').map(Number);
const POOL_N = Number(process.env.POOL ?? 6);
const METRICS = {
  QB: ['pass', 'rush'],                  // fg banks 0 in-slot (window multiplier)
  RB: ['rush', 'carries', 'rec', 'td', 'duel'],
  WR: ['recyd', 'rec', 'tgt', 'td', 'duel'],
  TE: ['recyd', 'tgt', 'rec', 'td'],
};

const pools = {};
for (const pos of Object.keys(METRICS)) {
  pools[pos] = STAT_PLAYERS.filter((p) => p.pos === pos)
    .sort((a, b) => b.ppr - a.ppr).slice(0, 14)
    .map((p) => ({ slug: slugOf(p.name), team: p.team, name: p.name }));
}

const agg = {}, bestResp = {}, bestOverall = {}, solo = {};

for (const week of WEEKS) {
  let w;
  try { w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${week}.json`, import.meta.url))); }
  catch { continue; }
  injectWeek(week, w.pbp, w.points);
  for (const pos of Object.keys(METRICS)) {
    const ms = METRICS[pos];
    const avail = pools[pos].filter((p) => (w.pbp[p.slug] ?? []).length > 3).slice(0, POOL_N);
    for (const p of avail) for (const m of ms) {
      const r = resolveWindow({ player: makePlayer(p.slug, pos, p.team), metricId: m }, { player: EMPTY, metricId: '' }, week, '');
      const s = ((solo[pos] ??= {})[m] ??= { n: 0, sum: 0 });
      s.n++; s.sum += r.youFinal;
    }
    for (const A of avail) for (const B of avail) {
      if (A.slug === B.slug) continue;
      const margins = {};
      for (const ma of ms) {
        margins[ma] = {};
        for (const mb of ms) {
          const r = resolveWindow(
            { player: makePlayer(A.slug, pos, A.team), metricId: ma },
            { player: makePlayer(B.slug, pos, B.team), metricId: mb }, week, '');
          const cell = (((agg[pos] ??= {})[ma] ??= {})[mb] ??= { n: 0, my: 0, wins: 0 });
          cell.n++; cell.my += r.youFinal;
          if (r.youFinal > r.theirFinal) cell.wins++;
          margins[ma][mb] = r.youFinal - r.theirFinal;
        }
      }
      for (const mb of ms) {
        let best = ms[0];
        for (const ma of ms) if (margins[ma][mb] > margins[best][mb]) best = ma;
        const br = ((bestResp[pos] ??= {})[mb] ??= {});
        br[best] = (br[best] ?? 0) + 1;
      }
      let bestAvg = -1e9, bestM = ms[0];
      for (const ma of ms) {
        const avg = ms.reduce((s, mb) => s + margins[ma][mb], 0) / ms.length;
        if (avg > bestAvg) { bestAvg = avg; bestM = ma; }
      }
      const bo = (bestOverall[pos] ??= {});
      bo[bestM] = (bo[bestM] ?? 0) + 1;
    }
  }
}

const f = (x) => x.toFixed(1);
for (const pos of Object.keys(METRICS)) {
  const ms = METRICS[pos];
  console.log(`\n===== ${pos} =====`);
  console.log('unopposed avg pts: ' + ms.map((m) => `${m}=${f(solo[pos][m].sum / solo[pos][m].n)}`).join('  '));
  console.log('win rate % (row = my metric, col = theirs):');
  console.log('        ' + ms.map((m) => m.padStart(8)).join(''));
  for (const ma of ms) console.log(ma.padEnd(8) + ms.map((mb) => { const c = agg[pos][ma][mb]; return (100 * c.wins / c.n).toFixed(0).padStart(8); }).join(''));
  console.log('best response (col = their metric):');
  for (const mb of ms) {
    const br = bestResp[pos][mb]; const tot = Object.values(br).reduce((a, b) => a + b, 0);
    console.log(`  vs ${mb.padEnd(8)}: ` + ms.map((m) => `${m}=${(100 * (br[m] ?? 0) / tot).toFixed(0)}%`).join('  '));
  }
  const bo = bestOverall[pos]; const tot = Object.values(bo).reduce((a, b) => a + b, 0);
  console.log('best overall pick share: ' + ms.map((m) => `${m}=${(100 * (bo[m] ?? 0) / tot).toFixed(0)}%`).join('  '));
  const dead = ms.filter((m) => ((bo[m] ?? 0) / tot) < 0.05);
  const dom = ms.filter((ma) => ms.every((mb) => ma === mb || (agg[pos][ma][mb].wins / agg[pos][ma][mb].n) >= 0.6));
  if (dead.length) console.log(`⚠ near-dead metrics (<5% best): ${dead.join(', ')}`);
  if (dom.length) console.log(`⚠ dominant metrics (≥60% win vs every rival): ${dom.join(', ')}`);
  if (!dead.length && !dom.length) console.log('✓ menu looks like a real decision');
}
