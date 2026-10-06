// THE DEPTH CHART ON THE CARD (v0.640.0), pinned offline: the grouping a
// player card draws from the 0293 cache, and the name a row prints for a slug
// no pool can look up.
import { setDepthChart, depthChartFor, depthForTeam, hasDepthChart, clearDepthChart } from '../packages/core/src/data/playerDepth.ts';
import { nameFromSlug } from '../packages/core/src/data/players.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

clearDepthChart();
ok(!hasDepthChart() && depthChartFor('DET').length === 0, 'no chart loaded: no groups, no throw');

setDepthChart([
  { slug: 'sam-laporta', team: 'det', pos: 'te', depth: 1 },
  { slug: 'jahmyr-gibbs', team: 'DET', pos: 'RB', depth: 2 },
  { slug: 'david-montgomery', team: 'DET', pos: 'RB', depth: 1 },
  { slug: 'jared-goff', team: 'DET', pos: 'QB', depth: 1 },
  { slug: 'amon-ra-st-brown', team: 'DET', pos: 'WR', depth: 1 },
  { slug: 'taylor-decker', team: 'DET', pos: 'OL', depth: 1 },
  { slug: 'geno-smith', team: 'LV', pos: 'QB', depth: 1 },
  { slug: 'nobody', team: 'DET', pos: 'RB', depth: Number.NaN },
]);
const det = depthChartFor('det');
ok(det.map((g) => g.pos).join(',') === 'QB,RB,WR,TE', 'groups in lineup order, only the positions with rows (OL is not a group), case-blind team');
ok(det[1].rows.map((r) => r.slug).join(',') === 'david-montgomery,jahmyr-gibbs', 'each group deepest-first, starter at the top');
ok(!det.some((g) => g.rows.some((r) => r.slug === 'nobody')), 'a row without a rank is not on the chart');
ok(!det.some((g) => g.rows.some((r) => r.slug === 'geno-smith')), "another team's man is not on it");
ok(depthForTeam('DET').length === 6, 'the flat list still carries the line (projected box reads it)');
ok(nameFromSlug('amon-ra-st-brown') === 'Amon Ra St Brown' && nameFromSlug('jared-goff') === 'Jared Goff', 'a row names its man from the slug when no pool can');

console.log(fails === 0 ? '\nALL DEPTH-CARD ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
