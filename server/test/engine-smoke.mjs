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

// ── THE POSSESSION GATE, through the worker's own seam (v0.339.5) ──────────
// A drip accrues per minute of OFFENSE. In this process the engine's possession
// comes from the game-feed store (realPossFor reads a baked cache only the
// client's HTTP fetch fills — the worker NEVER has it), so if injectWeekPlays'
// feed install ever disappears, drips silently revert to accruing on every
// game minute. That regression produced an 11.7 on a 32-yard receiver the
// engine settles at 5.5, and flipped a window battle. These assertions fail
// loudly instead. Exact values, because offSecs is exact interval overlap.
import { setLiveGameFeed, feedRowsToWeek, clearLiveGameFeeds } from '../../packages/core/src/data/gameFeed.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const PW = 900; // a week with no baked data — exactly the worker's live shape
// One 40-yard catch at 1:00 → drip rate 0.4 pts/min from c=60 to the whistle.
injectWeek(PW, { 'poss-wr': [{ c: 60, k: 'rec', y: 40, td: 0, ca: 0, tg: 1 }] });
const dripFinal = () => resolveWindow(
  { player: makePlayer('poss-wr', 'WR', 'DEN'), metricId: 'recyd' },
  { player: EMPTY, metricId: '' }, PW, 'poss gate').youFinal;

// NO feed installed: offSecs treats possession as unknown and the drip runs
// ungated — 59 min × 0.4 = 23.6. This is the worker's ENTIRE history pre-fix.
const ungated = dripFinal();
ok(ungated === 23.6, `no feed → ungated 23.6 (got ${ungated}) — every minute credited`);

// The feed the worker now installs: DEN@GB, GB on offense the first half and
// DEN the second. possFromPlays credits each span to whoever runs the NEXT
// play (the team a span leads INTO — check-poss §3), so the play at 1800
// being GB's gives GB [0,1800], and the play at 3600 being DEN's gives DEN
// [1800,3600]. The first fixture of this probe credited the halves backwards
// and DEN owned the whole game — 23.6 "gated", indistinguishable from the
// gate not running. Which is the argument for asserting exact numbers.
const fp = (c, tm) => ({ c, tm, drv: 0, dn: 1, dist: 10, yl: 50, yl2: 50, ty: 'Pass', txt: '', hs: 0, as: 0 });
setLiveGameFeed(PW, feedRowsToWeek([
  { key: 'DEN@GB', away: 'DEN', home: 'GB', plays: [fp(0, 'DEN'), fp(1800, 'GB'), fp(3600, 'DEN')], state: 'post' },
]));
const gated = dripFinal();
ok(gated === 12, `feed installed → gated 12.0 (got ${gated}) — 30 DEN-offense minutes × 0.4`);
ok(gated < ungated, 'THE POINT: the same catch banks less when possession is known — the worker now matches the web');

clearLiveGameFeeds();
ok(dripFinal() === 23.6, 'clearing the feed returns to the honest unknown-data fallback (soft degradation, not zero)');

// ── THE SEAL-AT-LOCK BOUNDARY (v0.341.1) ───────────────────────────────────
// `locked` is BOTH the edit-final flag and the RLS reveal flag. The DB's
// enforce_window_lock refuses edits from kickoff − 1h; the worker's sweep
// used to seal at kickoff — a blind hour where neither side could edit OR see,
// and the board read a fully-set, merely-hidden opponent as "NOT MATCHED UP".
// dueWindows now flips at the same instant as the DB. To the millisecond,
// because this boundary is when the reveal happens.
import { dueWindows } from '../src/lock.js';
import { LOCK_LEAD_MS } from '../../packages/core/src/data/nflSlate.ts';
{
  const K = 1_000_000_000_000;
  const wk = { sat: K, mnf: K + 7_200_000 };
  const at = (ms) => [...(dueWindows(wk, new Date(ms)) ?? [])].sort().join(',');
  ok(at(K - LOCK_LEAD_MS - 1) === '', 'one ms before the lock lead: nothing seals (still editable)');
  ok(at(K - LOCK_LEAD_MS) === 'sat', 'AT kickoff − 1h: the window seals — the same instant the DB stops edits');
  ok(at(K) === 'sat', 'at kickoff it is still (only) sat — sealing did not creep to later windows');
  ok(at(K + 7_200_000 - LOCK_LEAD_MS) === 'mnf,sat', 'the later window seals at ITS OWN lock, not the first one');
  ok(dueWindows(null, new Date(K)) === null, 'no kickoff map → null (callers treat unknown as seal-everything, pre-0058 behavior)');
}

if (fails) { console.error(`\n${fails} PROBE FAIL(s)`); process.exit(1); }
console.log('\nOK — the real engine resolved live-injected plays in Node, and drips gate on possession.');
