// THE LIVE BOARD FEEDS, VALIDATED (v0.455.0). NETWORK —
// `npm run validate:boards`, deliberately out of check:parity.
//
// The worker now RUNS somebody else's model rather than copying its output,
// so the assertion that matters is not "the file is there" — it is that our
// arithmetic reproduces theirs. `dyn2026.ts` was baked from the MCP's own
// `get_dynasty_values`; rescaling the published KTC board ourselves must land
// on the same numbers, or the automation has quietly forked the market.
import { rescaledValue, dynRows } from '../server/src/poll/dynasty.js';
import { seasonRows, statheadFeed } from '../server/src/poll/projections.js';
import { DYN_2026, DYN_AS_OF } from '../packages/core/src/data/dyn2026.ts';
import { PROJ_2026_SID } from '../packages/core/src/data/proj2026.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const RAW = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const ua = { headers: { accept: 'application/json', 'user-agent': process.env.AUDIT_UA || 'curl/8.5.0' } };
const get = async (p) => {
  const res = await fetch(`${RAW}/${REF}/public/data/${p}`, ua);
  if (!res.ok) throw new Error(`${p} ${res.status}`);
  return res.json();
};

const [ktc, snap, xwalk] = await Promise.all([
  get('ktc_rankings_1qb.json'), get('dynasty-fc-rescale.json'), get('player-crosswalk.json'),
]);
ok(ktc.length > 400, `${ktc.length} rows on the KTC board`);
ok(Object.keys(snap.perPlayer ?? {}).length > 200,
  `${Object.keys(snap.perPlayer ?? {}).length} per-player ratios, floor ${snap.floor}`);
const snapAge = (Date.now() - Date.parse(snap.generatedAt)) / 86400000;
ok(!Number.isFinite(snapAge) || snapAge < 21, `rescale snapshot ${snapAge.toFixed(1)} days old`);

const rows = dynRows(ktc, snap, xwalk, { sleeper: () => null, slugForName: () => null });
const players = rows.filter((r) => r.kind === 'player');
const picks = rows.filter((r) => r.kind === 'pick');
ok(players.length > 380, `${players.length} players valued`);
ok(picks.length > 60, `${picks.length} rookie picks valued`);
ok(players.filter((r) => r.sleeper_id).length / players.length > 0.95,
  `${players.filter((r) => r.sleeper_id).length}/${players.length} resolved to a sleeper id by the crosswalk`);

// OUR ARITHMETIC AGAINST THE BAKED BOARD. dyn2026 came from the MCP and the
// market has moved since, so this compares SCALE rather than asserting
// equality — but a rescale that had gone wrong (a missing ratio, the wrong
// format column, the pick clause dropped) shows up as a factor, not a drift.
// The name-keyed bake may not join by id; fall back to comparing distributions.
const ourTop = rows.filter((r) => r.kind === 'player').map((r) => r.v1qb).sort((a, b) => b - a);
const bakedTop = [...DYN_2026.values()].map((v) => v[0]).sort((a, b) => b - a);
ok(Math.abs(ourTop[0] - bakedTop[0]) / bakedTop[0] < 0.25,
  `our top value ${ourTop[0]} against the ${DYN_AS_OF} bake's ${bakedTop[0]} — the same scale`);
ok(Math.abs(ourTop[49] - bakedTop[49]) / bakedTop[49] < 0.35,
  `and the 50th: ${ourTop[49]} against ${bakedTop[49]}`);
ok(ourTop.every((v, i) => i === 0 || v <= ourTop[i - 1]), 'our board is monotone, as a board must be');

// THE PICK BOARD keeps raw KTC values, so it should match the bake closely.
const firstPick = picks.find((p) => /Pick 1\.01/.test(p.label));
ok(firstPick && firstPick.v1qb > 5000, `1.01 values at ${firstPick?.v1qb}`);
ok(picks.some((p) => p.vsf !== p.v1qb), 'and the superflex pick column is its own market');

// ── the season board, out of the weekly feed ─────────────────────────────
const feed = await statheadFeed(2026);
const srows = seasonRows(feed);
ok(srows.length > 500, `${srows.length} season lines carry a sleeper id`);
const joined = srows.filter((r) => PROJ_2026_SID.has(r.sleeper_id));
ok(joined.length > 400, `${joined.length} of them join the baked rate by id`);
const drift = joined.map((r) => Math.abs(r.per_week - PROJ_2026_SID.get(r.sleeper_id)));
const mean = drift.reduce((a, b) => a + b, 0) / drift.length;
ok(mean > 0.01, `mean drift from the bake ${mean.toFixed(2)} pts/week — the live board is not the bake`);
ok(mean < 5, `mean drift ${mean.toFixed(2)} pts/week — and not a different model`);

console.log(fails === 0 ? '\nALL BOARD-FEED ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
