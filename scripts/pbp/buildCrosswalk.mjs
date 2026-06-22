// Build a slug -> {gsis, pos, name, sleeper} crosswalk for the full skill-player
// universe, so the PBP generator bakes real play-by-play for a wide net. Two
// sources, merged by slug:
//   • season_ids.csv      — Stathead season-stats pull (name,pos,team,gsis)
//   • crosswalk_extra.csv — Stathead get_player_crosswalk (pos,gsis,name,sleeper)
//     adds depth players beyond the season-stats top-100/pos AND the Sleeper id.
// Team is intentionally omitted here — genRealPbp.mjs derives each slug's 2025
// team from the play-by-play (authoritative, and immune to offseason team moves).
// league.ts rosters are read only for a coverage report.
// Run: node scripts/pbp/buildCrosswalk.mjs  -> writes scripts/pbp/crosswalk.json
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

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

// ── Collect source rows {name, pos, gsis, sleeper?} from both files ──
const rows = [];
const readCsv = (file, map) => {
  let txt; try { txt = readFileSync(new URL(file, here), 'utf8'); } catch { return; }
  const lines = txt.trim().split('\n'); lines.shift(); // header
  for (const line of lines) { const r = map(line.split(',')); if (r) rows.push(r); }
};
// season_ids.csv: name,pos,team,gsis_id
readCsv('season_ids.csv', ([name, pos, , gsis]) => name && SKILL.has(pos) && gsis ? { name, pos, gsis, sleeper: '' } : null);
// crosswalk_extra.csv: position,gsis_id,display_name,sleeper_id
readCsv('crosswalk_extra.csv', ([pos, gsis, name, sleeper]) => name && SKILL.has(pos) && gsis ? { name, pos, gsis, sleeper: (sleeper || '').trim() } : null);

// ── Merge by slug (first wins; later rows only fill in a missing sleeper id) ──
const crosswalk = {};
let withSleeper = 0;
for (const { name, pos, gsis, sleeper } of rows) {
  const slug = slugOf(name);
  if (!crosswalk[slug]) {
    crosswalk[slug] = { gsis, pos, name, ...(sleeper ? { sleeper } : {}) };
    if (sleeper) withSleeper++;
  } else if (sleeper && !crosswalk[slug].sleeper) {
    crosswalk[slug].sleeper = sleeper; withSleeper++;
  }
}

writeFileSync(new URL('crosswalk.json', here), JSON.stringify(crosswalk, null, 2));
console.log(`source rows:     ${rows.length}`);
console.log(`crosswalk slugs: ${Object.keys(crosswalk).length} (${withSleeper} with sleeper id)`);

// ── Coverage report: any league-rostered player we still can't bake? ──
const unmatched = leaguePlayers.filter((p) => !crosswalk[slugOf(p.name)]);
console.log(`league players:  ${leaguePlayers.length}, covered: ${leaguePlayers.length - unmatched.length}, unmatched: ${unmatched.length}`);
for (const u of unmatched) console.log(`  ✗ ${u.name} (${u.pos})`);
