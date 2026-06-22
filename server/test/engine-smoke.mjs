// Proof the worker can run the REAL Drip engine in Node: load a baked 2025 week,
// inject it the same way the worker will inject live_play, and resolve a head-to-head
// window through sim.ts:resolveSlot. Run: `npx tsx test/engine-smoke.mjs` from server/.
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek, resolveWindow, EMPTY } from '../src/engine.js';

const WEEK = 1;
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);
console.log(`injected week ${WEEK}: ${Object.keys(w.pbp).length} players`);

// A real head-to-head: two QBs, each scoring the QB "field general" style metric.
// (Slugs are the baked keys; metric ids come from src/data/metrics.ts.)
function run(youSlug, youPos, youTeam, youMetric, themSlug, themPos, themTeam, themMetric) {
  const you = { player: makePlayer(youSlug, youPos, youTeam), metricId: youMetric };
  const them = { player: makePlayer(themSlug, themPos, themTeam), metricId: themMetric };
  const r = resolveWindow(you, them, WEEK, `${youSlug} vs ${themSlug}`);
  console.log(`\n${youSlug} (${youMetric}) ${r.youFinal}  vs  ${themSlug} (${themMetric}) ${r.theirFinal}` +
    `  [real=${r.real}, events=${r.events.length}, youTds=${r.youTds}, theirTds=${r.theirTds}]`);
  for (const e of r.events.filter((e) => e.sig || e.effect).slice(0, 6)) {
    console.log(`   ${String(e.clock).padStart(4)} ${e.side.padEnd(5)} ${e.play.slice(0, 60)}${e.effect ? '  «' + e.effect.text + '»' : ''}`);
  }
  return r;
}

// Real Week-1 matchups: an RB pair scoring TD (NUKE — a TD wipes the opponent's
// bank), and a QB pair scoring passing yards.
run('saquon-barkley', 'RB', 'PHI', 'td', 'james-cook', 'RB', 'BUF', 'td');
run('josh-allen', 'QB', 'BUF', 'pass', 'jalen-hurts', 'QB', 'PHI', 'pass');

// Unopposed slot (vs EMPTY) — a player with no opponent should still bank.
const solo = resolveWindow({ player: makePlayer('saquon-barkley', 'RB', 'PHI'), metricId: 'rush' },
  { player: EMPTY, metricId: '' }, WEEK, 'unopposed');
console.log(`\nunopposed saquon-barkley: ${solo.youFinal}`);

console.log('\nOK — the real engine resolved live-injected plays in Node.');
