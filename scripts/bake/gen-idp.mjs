// Generates packages/core/src/data/projIdp2026.ts from the three staged CSVs.
import fs from 'node:fs';

const DIR = '/tmp/claude-0/-home-user-ffgame/0e94e5db-b189-5c21-97f7-a6f9a982d5d2/scratchpad';

// Mirrors normName() in packages/core/src/data/players.ts exactly.
const normName = (s) => s.toLowerCase()
  .replace(/[.']/g, '')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const rows = [];
for (const pos of ['lb', 'dl', 'db']) {
  const lines = fs.readFileSync(`${DIR}/idp-${pos}.csv`, 'utf8').trim().split('\n').slice(1);
  // weeks_10plus_tackle arrived in MCP 1.0.87, after the first bake, and is
  // staged separately so a refresh of one does not silently half-update the
  // other. Joined on (name, sleeper_id) — the pair, not either alone, because
  // three names repeat and 74 rows have no id.
  const w10 = new Map();
  for (const l of fs.readFileSync(`${DIR}/w10-${pos}.csv`, 'utf8').trim().split('\n').slice(1)) {
    const c = l.split(',');
    w10.set(`${c[0]}|${c[1]}`, Number(c[2]) || 0);
  }
  for (const l of lines) {
    const c = l.split(',');
    const n = (i) => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };
    const jk = `${c[0]}|${c[2].trim()}`;
    if (!w10.has(jk)) throw new Error(`BAKE REFUSED: no weeks_10plus_tackle for ${jk} (${pos})`);
    rows.push({
      pos: pos.toUpperCase(), name: c[0], team: c[1], id: c[2].trim(),
      slug: normName(c[0]).replace(/\s+/g, '-'),
      tk: n(3), solo: n(4), tfl: n(5), sack: n(6), qbh: n(7), pd: n(8),
      int: n(9), ff: n(10), fr: n(11), td: n(12), saf: n(13), w2: n(14), w3: n(15), pp: n(16),
      w10: w10.get(jk),
    });
    w10.delete(jk);
  }
  if (w10.size) throw new Error(`BAKE REFUSED: ${w10.size} unmatched w10 row(s) in ${pos}: ${[...w10.keys()].slice(0, 3)}`);
}

// ── Assertions the generator refuses to emit without ────────────────────────
const fail = (m) => { throw new Error('BAKE REFUSED: ' + m); };
if (rows.length !== 963) fail(`expected 963 rows, got ${rows.length}`);
if (rows.some((r) => r.saf !== 0)) fail('a safety is non-zero — the dropped column is no longer dead');
if (rows.some((r) => r.solo > r.tk + 0.001)) fail('solo tackles exceed total tackles');
if (rows.some((r) => !r.slug)) fail('a row slugged to empty');
const ids = rows.filter((r) => r.id).map((r) => r.id);
if (new Set(ids).size !== ids.length) fail('a Sleeper id appears twice');
// Every colliding slug must be resolvable by id, or the collision is unfixable.
const bySlug = new Map();
for (const r of rows) { const a = bySlug.get(r.slug) ?? []; a.push(r); bySlug.set(r.slug, a); }
const collided = [...bySlug].filter(([, v]) => v.length > 1);
for (const [s, v] of collided) {
  if (v.some((r) => !r.id)) fail(`slug ${s} collides but a colliding row has no Sleeper id`);
}
// StatHead's own roll-up must reproduce from the components we keep.
let resid = 0, worst = 0;
for (const r of rows) {
  const d = (r.tk + r.sack * 2 + r.int * 3 + r.fr * 2 + r.td * 6) - r.pp;
  resid += d; if (Math.abs(d) > Math.abs(worst)) worst = d;
}
const mean = resid / rows.length;
if (Math.abs(mean) > 0.25 || Math.abs(worst) > 0.75) fail(`reconciliation drifted: mean ${mean}, worst ${worst}`);
// A threshold COUNT is bounded by the season and by its own component: you
// cannot clear "10+ in a game" more often than you play, nor more often than
// your whole season's tackles divided by ten.
for (const r of rows) {
  if (!(r.w10 >= 0 && r.w10 <= 17)) fail(`${r.name} has ${r.w10} 10+-tackle games`);
  if (r.w10 > r.tk / 10 + 0.02) fail(`${r.name}: ${r.w10} 10+ games exceeds ${r.tk} season tackles`);
}

// ── Emit ────────────────────────────────────────────────────────────────────
const num = (v) => (v === 0 ? '0' : String(Number(v.toFixed(2))));
rows.sort((a, b) => a.slug.localeCompare(b.slug) || (a.id || '').localeCompare(b.id || ''));
const csv = rows.map((r) => [
  r.slug, r.id, num(r.tk), num(r.solo), num(r.tfl), num(r.sack), num(r.qbh),
  num(r.pd), num(r.int), num(r.ff), num(r.fr), num(r.td), num(r.w2), num(r.w3), num(r.w10),
].join(',')).join('\n');

const stats = {
  rows: rows.length,
  lb: rows.filter((r) => r.pos === 'LB').length,
  dl: rows.filter((r) => r.pos === 'DL').length,
  db: rows.filter((r) => r.pos === 'DB').length,
  noId: rows.filter((r) => !r.id).length,
  collisions: collided.length,
  meanResid: mean.toFixed(3),
  worstResid: worst.toFixed(2),
  w10Total: rows.reduce((a, r) => a + r.w10, 0).toFixed(1),
  w10Nonzero: rows.filter((r) => r.w10 > 0).length,
  w10Max: Math.max(...rows.map((r) => r.w10)),
};
fs.writeFileSync(`${DIR}/idp-body.csv`, csv);
fs.writeFileSync(`${DIR}/idp-stats.json`, JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
console.log('collisions:');
for (const [s, v] of collided) console.log(' ', s, v.map((r) => `${r.name}/${r.pos}/${r.team}/${r.id}`).join(' | '));
console.log('csv bytes:', csv.length);
