// Build a slug -> gsis_id crosswalk for every league-rostered player.
// Reads league rosters from src/data/league.ts and gsis IDs from season_ids.csv
// (pulled from Stathead get_player_season_stats). Reports any unmatched players.
// Run: node scripts/pbp/buildCrosswalk.mjs  -> writes scripts/pbp/crosswalk.json
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);

// normName MUST mirror src/data/players.ts exactly.
function normName(raw) {
  return raw
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const slugOf = (name) => normName(name).replace(/\s+/g, '-');

// ── Parse league rosters from league.ts (handles escaped apostrophes) ──
const leagueSrc = readFileSync(new URL('../../src/data/league.ts', here), 'utf8');
const rosterRe = /\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'(QB|RB|WR|TE|K|DEF)'\s*\]/g;
const leaguePlayers = [];
let m;
while ((m = rosterRe.exec(leagueSrc))) {
  const name = m[1].replace(/\\'/g, "'");
  leaguePlayers.push({ name, pos: m[2] });
}

// ── Index gsis IDs by normalized name (first wins, like STAT_INDEX) ──
const idsCsv = readFileSync(new URL('season_ids.csv', here), 'utf8').trim().split('\n');
idsCsv.shift(); // header
const byName = new Map();
for (const line of idsCsv) {
  const [name, pos, team, gsis] = line.split(',');
  const key = normName(name);
  if (!byName.has(key)) byName.set(key, { name, pos, team, gsis });
}

// ── Match ──
const crosswalk = {};
const unmatched = [];
for (const p of leaguePlayers) {
  const hit = byName.get(normName(p.name));
  if (hit) crosswalk[slugOf(p.name)] = { gsis: hit.gsis, team: hit.team, name: p.name, pos: p.pos };
  else unmatched.push(p);
}

writeFileSync(new URL('crosswalk.json', here), JSON.stringify(crosswalk, null, 2));
console.log(`league players: ${leaguePlayers.length}`);
console.log(`matched:        ${Object.keys(crosswalk).length}`);
console.log(`unmatched:      ${unmatched.length}`);
for (const u of unmatched) console.log(`  ✗ ${u.name} (${u.pos})`);
