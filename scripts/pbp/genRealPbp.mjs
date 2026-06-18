// Build-time generator (v2): bakes real 2025 play-by-play for ALL 14 weeks into
// src/data/realPbp.ts, keyed by league player slug. Reads raw per-game PBP dumps
// (Stathead MCP get_play_by_play, one file per game) and a slug->gsis crosswalk.
//
// Attribution is by nflverse gsis_id per play role (passer/rusher/receiver) — no
// name matching, no namesake cleanup. Completion is detected via yards_after_catch
// (a number on catches, empty/null on incompletions and sacks).
//
// Usage: node scripts/pbp/genRealPbp.mjs [RAW_DIR]
//   RAW_DIR defaults to ./scripts/pbp/raw — drop the saved game files there
//   (any extension). Only rows with game_id starting "2025_" are used; games are
//   de-duped by game_id (last file wins).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url);
const RAW_DIR = process.argv[2] || join(new URL(here).pathname, 'raw');
const WEEKS = Array.from({ length: 14 }, (_, i) => i + 1);

// slug -> { gsis, team, name, pos }  ==>  gsis -> { slug, pos }
const crosswalk = JSON.parse(readFileSync(new URL('crosswalk.json', here), 'utf8'));
const byGsis = new Map();
for (const [slug, info] of Object.entries(crosswalk)) byGsis.set(info.gsis, { slug, pos: info.pos });

function clockOf(qtr, mmss) {
  const [m, s] = String(mmss).split(':').map(Number);
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - (m * 60 + s))));
}
const isSet = (v) => v !== '' && v !== null && v !== undefined;

// week -> slug -> RealPlay[]
const pbp = {};
for (const w of WEEKS) pbp[w] = {};
const push = (week, slug, play) => {
  (pbp[week][slug] ||= []).push(play);
};

// ── Load + de-dupe raw game files ──
const games = new Map(); // game_id -> array of play objects
let files = [];
try { files = readdirSync(RAW_DIR); } catch { console.error(`RAW_DIR not found: ${RAW_DIR}`); process.exit(1); }
for (const fn of files) {
  const text = readFileSync(join(RAW_DIR, fn), 'utf8');
  const rows = [];
  let gid = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (!d.game_id || !String(d.game_id).startsWith('2025_')) { gid = null; break; }
    gid = d.game_id;
    rows.push(d);
  }
  if (gid && rows.length) games.set(gid, rows);
}

// ── Attribute plays ──
let playCount = 0;
for (const rows of games.values()) {
  for (const d of rows) {
    const week = Number(d.week);
    if (!pbp[week]) continue;
    const pt = d.play_type;
    const c = clockOf(Number(d.qtr), d.time);
    const td = Number(d.touchdown) === 1;

    // Passer (QB) — completed pass adds passing yards; incomplete/sack = 0.
    if (pt === 'pass' && isSet(d.passer_player_id) && byGsis.has(d.passer_player_id)) {
      const caught = isSet(d.yards_after_catch);
      const y = caught ? Number(d.yards_gained) || 0 : 0;
      push(week, byGsis.get(d.passer_player_id).slug, { c, k: 'pass', y, td: caught && td ? 1 : 0, ca: 0, tg: 0 });
      playCount++;
    }
    // Rusher — only true rushing plays (excludes kneels/spikes).
    if (pt === 'run' && isSet(d.rusher_player_id) && byGsis.has(d.rusher_player_id)) {
      push(week, byGsis.get(d.rusher_player_id).slug, { c, k: 'rush', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 0, tg: 0 });
      playCount++;
    }
    // Receiver — reception vs incomplete target.
    if (pt === 'pass' && isSet(d.receiver_player_id) && byGsis.has(d.receiver_player_id)) {
      const caught = isSet(d.yards_after_catch);
      push(week, byGsis.get(d.receiver_player_id).slug, caught
        ? { c, k: 'rec', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 1, tg: 1 }
        : { c, k: 'incomplete', y: 0, td: 0, ca: 0, tg: 1 });
      playCount++;
    }

    // ── K / DEF (activates once MCP exposes kicker/defense columns) ──
    // Kicker:  d.kicker_player_id, d.kick_distance, d.field_goal_result, d.extra_point_result
    // Defense: d.sack, d.interception, d.fumble_lost, d.safety, d.td_team, d.return_touchdown
    // (keyed by team, since K/DEF are not roster slugs). TODO once columns land.
  }
}

// ── Points (PPR, mirrors the validated Week-4 build) ──
const points = {};
for (const w of WEEKS) {
  points[w] = {};
  for (const [slug, plays] of Object.entries(pbp[w])) {
    let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0;
    for (const p of plays) {
      if (p.k === 'pass') { passYds += p.y; if (p.td) passTd++; }
      else if (p.k === 'rush') { rushYds += p.y; if (p.td) rushTd++; }
      else if (p.k === 'rec') { rec++; recYds += p.y; if (p.td) recTd++; }
    }
    plays.sort((a, b) => a.c - b.c);
    points[w][slug] = Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4) * 10) / 10;
  }
}

// ── Emit: per-week JSON assets (lazy-loaded) + a tiny generated week index ──
// A week ships as "real" only when ALL its expected games are present, so we
// never field a partial week (some players real, some simulated).
const expected = readFileSync(new URL('expected.txt', here), 'utf8').trim().split('\n').filter(Boolean);
const expByWeek = {}, presentByWeek = {};
for (const gid of expected) { const w = +gid.split('_')[1]; expByWeek[w] = (expByWeek[w] || 0) + 1; }
for (const gid of games.keys()) { const w = +gid.split('_')[1]; presentByWeek[w] = (presentByWeek[w] || 0) + 1; }
const weeksWithData = WEEKS.filter((w) => Object.keys(pbp[w]).length > 0 && (presentByWeek[w] || 0) >= (expByWeek[w] ?? Infinity));
const incomplete = WEEKS.filter((w) => (presentByWeek[w] || 0) > 0 && (presentByWeek[w] || 0) < (expByWeek[w] ?? Infinity));
if (incomplete.length) console.log(`skipped (incomplete): ${incomplete.map((w) => `w${w} ${presentByWeek[w]}/${expByWeek[w]}`).join(', ')}`);
const pubDir = new URL('../../public/pbp/', here);
mkdirSync(pubDir, { recursive: true });
for (const w of weeksWithData) {
  writeFileSync(new URL(`w${w}.json`, pubDir), JSON.stringify({ pbp: pbp[w], points: points[w] }));
}
writeFileSync(new URL('../../src/data/realWeeks.ts', here),
  '// AUTO-GENERATED by scripts/pbp/genRealPbp.mjs — do not edit by hand.\n' +
  '// Weeks with baked real 2025 play-by-play (per-week JSON in public/pbp/wN.json).\n' +
  `export const REAL_WEEKS = new Set<number>([${weeksWithData.join(', ')}]);\n`);

// ── Report ──
console.log(`games parsed: ${games.size}`);
console.log(`plays attributed: ${playCount}`);
for (const w of weeksWithData) {
  const slugs = Object.keys(pbp[w]);
  console.log(`  week ${String(w).padStart(2)}: ${String(slugs.length).padStart(3)} players`);
}
