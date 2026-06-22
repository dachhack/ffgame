// Build a slug -> gsis_id crosswalk for EVERY skill player in season_ids.csv
// (the full pulled universe — not just league-rostered players), so the PBP
// generator bakes real play-by-play for a wide net. gsis IDs come from
// season_ids.csv (pulled from Stathead get_player_season_stats); league rosters
// (src/data/league.ts) are read only for a coverage report.
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

// ── Build the crosswalk from EVERY season_ids row (slug-keyed; byName already
// deduped normalized-name collisions, first wins) ──
const crosswalk = {};
for (const { name, pos, team, gsis } of byName.values()) {
  crosswalk[slugOf(name)] = { gsis, team, name, pos };
}

writeFileSync(new URL('crosswalk.json', here), JSON.stringify(crosswalk, null, 2));
console.log(`season_ids players: ${byName.size}`);
console.log(`crosswalk slugs:    ${Object.keys(crosswalk).length}`);

// ── Coverage report: any league-rostered player we still can't bake? ──
const unmatched = leaguePlayers.filter((p) => !crosswalk[slugOf(p.name)]);
console.log(`league players:     ${leaguePlayers.length}, covered: ${leaguePlayers.length - unmatched.length}, unmatched: ${unmatched.length}`);
for (const u of unmatched) console.log(`  ✗ ${u.name} (${u.pos})`);
