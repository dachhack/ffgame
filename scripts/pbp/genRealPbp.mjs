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

// ── Per-team offensive possession intervals (game-elapsed seconds), for the
// possession-gated WR drip. A drive = a maximal run of same-posteam scrimmage
// plays (kickoffs excluded). poss[week][team] = [[startSec, endSec], ...]. ──
const poss = {};
for (const w of WEEKS) poss[w] = {};
for (const [gid, rows] of games) {
  const week = +gid.split('_')[1];
  if (!poss[week]) continue;
  const sorted = rows.map((d) => ({ t: d.posteam, pt: d.play_type, c: clockOf(Number(d.qtr), d.time) })).sort((a, b) => a.c - b.c);
  let cur = null, start = 0, last = 0;
  const flush = () => { if (cur && last > start) (poss[week][cur] ||= []).push([start, last]); };
  for (const p of sorted) {
    if (p.pt === 'kickoff' || !p.t) continue;
    if (p.t !== cur) { flush(); cur = p.t; start = p.c; }
    last = p.c;
  }
  flush();
}

// ── Real play time: per-game wall-clock baseline (first parseable time_of_day),
// so each play's `t` is integer seconds since that game's first snap. Drives
// real-time power-up gating (a delayed feed can't scoop a play already final in
// real time). When a game's rows have no time_of_day, `t` is simply omitted and
// the engine falls back to the game clock. ──
const gameStart = new Map(); // game_id -> epoch ms of earliest time_of_day
for (const [gid, rows] of games) {
  let min = Infinity;
  for (const d of rows) { const ms = Date.parse(d.time_of_day); if (Number.isFinite(ms) && ms < min) min = ms; }
  if (Number.isFinite(min)) gameStart.set(gid, min);
}
// Real-time offset (seconds since first snap) for a play row, or null.
const rtOf = (d) => {
  const base = gameStart.get(d.game_id);
  const ms = Date.parse(d.time_of_day);
  return base != null && Number.isFinite(ms) ? Math.max(0, Math.round((ms - base) / 1000)) : null;
};

// ── Attribute plays ──
const fmtName = (s) => String(s).replace(/^([A-Z])\.(?=\S)/, '$1. '); // "B.Aubrey" -> "B. Aubrey"
const kickerName = {}; // team abbr -> display name of its kicker
let playCount = 0;
for (const rows of games.values()) {
  for (const d of rows) {
    const week = Number(d.week);
    if (!pbp[week]) continue;
    const pt = d.play_type;
    const c = clockOf(Number(d.qtr), d.time);
    const rt = rtOf(d);
    const T = rt != null ? { t: rt } : {}; // spread into each play so real time rides along with the game clock
    const td = Number(d.touchdown) === 1;
    // Turnovers committed by the offense (for the turnover coin penalty). INT
    // thrown → passer. Fumble lost → the exact fumbler via `fumbled_1_player_id`
    // when present; otherwise fall back to play role (rusher on a run, receiver
    // on a caught pass, passer on a sack-strip). `to: 1` marks the committer.
    const intc = Number(d.interception) === 1;
    const fumLost = Number(d.fumble_lost) === 1;
    const fumbler = isSet(d.fumbled_1_player_id) ? d.fumbled_1_player_id : '';
    // Does `roleId` own the lost fumble? Exact id match, else role-default flag.
    const fumbledBy = (roleId, roleDefault) => fumLost && (fumbler ? fumbler === roleId : roleDefault);

    // Passer (QB) — completed pass adds passing yards; incomplete/sack = 0.
    if (pt === 'pass' && isSet(d.passer_player_id) && byGsis.has(d.passer_player_id)) {
      const caught = isSet(d.yards_after_catch);
      const y = caught ? Number(d.yards_gained) || 0 : 0;
      const to = intc || fumbledBy(d.passer_player_id, !caught) ? 1 : 0;
      push(week, byGsis.get(d.passer_player_id).slug, { c, ...T, k:'pass', y, td: caught && td ? 1 : 0, ca: 0, tg: 0, ...(to ? { to: 1 } : {}) });
      playCount++;
    }
    // Rusher — only true rushing plays (excludes kneels/spikes).
    if (pt === 'run' && isSet(d.rusher_player_id) && byGsis.has(d.rusher_player_id)) {
      const to = fumbledBy(d.rusher_player_id, true) ? 1 : 0;
      push(week, byGsis.get(d.rusher_player_id).slug, { c, ...T, k:'rush', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 0, tg: 0, ...(to ? { to: 1 } : {}) });
      playCount++;
    }
    // Receiver — reception vs incomplete target.
    if (pt === 'pass' && isSet(d.receiver_player_id) && byGsis.has(d.receiver_player_id)) {
      const caught = isSet(d.yards_after_catch);
      const to = caught && fumbledBy(d.receiver_player_id, true) ? 1 : 0;
      push(week, byGsis.get(d.receiver_player_id).slug, caught
        ? { c, ...T, k:'rec', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 1, tg: 1, ...(to ? { to: 1 } : {}) }
        : { c, ...T, k:'incomplete', y: 0, td: 0, ca: 0, tg: 1 });
      playCount++;
    }

    // ── Kicker — FG (by distance) and XP, keyed by the kicking team ("dal-k") ──
    if (pt === 'field_goal' && isSet(d.kicker_player_id)) {
      const slug = `${String(d.posteam).toLowerCase()}-k`;
      push(week, slug, { c, ...T, k:d.field_goal_result === 'made' ? 'fg' : 'fgmiss', y: Number(d.kick_distance) || 0, td: 0, ca: 0, tg: 0 });
      if (isSet(d.kicker_player_name)) kickerName[d.posteam] = fmtName(d.kicker_player_name);
      playCount++;
    }
    if (pt === 'extra_point' && isSet(d.kicker_player_id)) {
      const slug = `${String(d.posteam).toLowerCase()}-k`;
      push(week, slug, { c, ...T, k:d.extra_point_result === 'good' ? 'xp' : 'xpmiss', y: 0, td: 0, ca: 0, tg: 0 });
      if (isSet(d.kicker_player_name)) kickerName[d.posteam] = fmtName(d.kicker_player_name);
    }
    // ── Team defense — sacks, takeaways, def/ST TDs, safeties, keyed by defteam ("dal-dst") ──
    if (isSet(d.defteam)) {
      const slug = `${String(d.defteam).toLowerCase()}-dst`;
      if (Number(d.sack) === 1) push(week, slug, { c, ...T, k:'sack', y: 0, td: 0, ca: 0, tg: 0 });
      if (Number(d.interception) === 1) push(week, slug, { c, ...T, k:'int', y: 0, td: 0, ca: 0, tg: 0 });
      if (Number(d.fumble_lost) === 1 && d.fumble_recovery_1_team === d.defteam) push(week, slug, { c, ...T, k:'fumrec', y: 0, td: 0, ca: 0, tg: 0 });
      if (Number(d.safety) === 1) push(week, slug, { c, ...T, k:'safety', y: 0, td: 0, ca: 0, tg: 0 });
      if (isSet(d.td_team) && d.td_team === d.defteam) push(week, slug, { c, ...T, k:'dst_td', y: 0, td: 0, ca: 0, tg: 0 });
    }
  }
}

// ── Points ──
// Skill: PPR (mirrors the validated Week-4 build). K: FG 3/4/5 by distance + XP 1.
// DST: sack 1, INT 3, fumble rec 2, def/ST TD 6, safety 2 (the MET-catalog "earn" rule).
const points = {};
for (const w of WEEKS) {
  points[w] = {};
  for (const [slug, plays] of Object.entries(pbp[w])) {
    let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0, sp = 0;
    for (const p of plays) {
      if (p.k === 'pass') { passYds += p.y; if (p.td) passTd++; }
      else if (p.k === 'rush') { rushYds += p.y; if (p.td) rushTd++; }
      else if (p.k === 'rec') { rec++; recYds += p.y; if (p.td) recTd++; }
      else if (p.k === 'fg') sp += p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
      else if (p.k === 'xp') sp += 1;
      else if (p.k === 'sack') sp += 1;
      else if (p.k === 'int') sp += 3;
      else if (p.k === 'fumrec') sp += 2;
      else if (p.k === 'dst_td') sp += 6;
      else if (p.k === 'safety') sp += 2;
    }
    plays.sort((a, b) => a.c - b.c);
    points[w][slug] = Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4 + sp) * 10) / 10;
  }
}

// ── K/DST registry: season totals + display names, to drive roster assignment ──
const kSeason = {}, dSeason = {};
for (const w of WEEKS) for (const [slug, pts] of Object.entries(points[w])) {
  if (slug.endsWith('-k')) kSeason[slug] = (kSeason[slug] || 0) + pts;
  else if (slug.endsWith('-dst')) dSeason[slug] = (dSeason[slug] || 0) + pts;
}
const kickers = Object.entries(kSeason).map(([slug, pts]) => ({ slug, team: slug.slice(0, -2).toUpperCase(), name: kickerName[slug.slice(0, -2).toUpperCase()] || slug, pts: Math.round(pts * 10) / 10 })).sort((a, b) => b.pts - a.pts);
const dsts = Object.entries(dSeason).map(([slug, pts]) => ({ slug, team: slug.slice(0, -4).toUpperCase(), pts: Math.round(pts * 10) / 10 })).sort((a, b) => b.pts - a.pts);
writeFileSync(new URL('kdst_registry.json', here), JSON.stringify({ kickers, dsts }, null, 2));

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
  writeFileSync(new URL(`w${w}.json`, pubDir), JSON.stringify({ pbp: pbp[w], points: points[w], poss: poss[w] }));
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
