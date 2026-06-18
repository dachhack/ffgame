// Copy auto-saved get_play_by_play dumps from the MCP tool-results dir into
// scripts/pbp/raw/<game_id>.jsonl. Only files that look like the comprehensive
// pull (have a 2025_ game_id and a kicker_player_id column) are taken; newest
// mtime wins per game_id.
// Usage: node scripts/pbp/sweep.mjs <tool-results-dir>
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node sweep.mjs <tool-results-dir>'); process.exit(1); }
const rawDir = new URL('raw/', import.meta.url).pathname;

const best = new Map(); // game_id -> { file, mtime }
for (const fn of readdirSync(src)) {
  if (!fn.includes('get_play_by_play')) continue;
  const full = join(src, fn);
  let firstObj = null;
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const t = line.trim();
    if (t.startsWith('{')) { try { firstObj = JSON.parse(t); } catch {} break; }
  }
  if (!firstObj) continue;
  const gid = firstObj.game_id;
  if (!gid || !String(gid).startsWith('2025_')) continue;
  if (!('kicker_player_id' in firstObj)) continue; // skip skill-only/old probes
  const mtime = statSync(full).mtimeMs;
  const cur = best.get(gid);
  if (!cur || mtime > cur.mtime) best.set(gid, { file: full, mtime });
}

let n = 0;
for (const [gid, { file }] of best) {
  writeFileSync(join(rawDir, `${gid}.jsonl`), readFileSync(file, 'utf8'));
  n++;
}
console.log(`copied ${n} games into raw/`);
const weeks = {};
for (const gid of best.keys()) { const w = gid.split('_')[1]; weeks[w] = (weeks[w] || 0) + 1; }
console.log('by week:', Object.entries(weeks).sort().map(([w, c]) => `${w}:${c}`).join('  '));
