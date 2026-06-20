// Inject a per-game ACTIVE-WALL timeline into the existing public/pbp/wN.json
// files (adds a `wall` field; leaves pbp/points/poss + realWeeks.ts untouched).
//
// For each game we have every play's game clock (qtr+time → game-elapsed `c`) and
// real wall-clock (`time_of_day`). "Active wall" = cumulative real seconds while
// the game is IN PLAY — i.e. within-quarter real time. The gap between the last
// play of a quarter and the first of the next (quarter/half break) contributes
// zero, so drip pauses at every quarter and the half. We sample the cumulative
// at each game-minute mark; runtime interpolates. Keyed by team (both teams of a
// game share the one timeline) so the engine can look it up by player.team.
//
// Usage: node scripts/pbp/genWall.mjs [RAW_DIR]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url);
const RAW_DIR = process.argv[2] || join(new URL(here).pathname, 'raw');
const WEEKS = Array.from({ length: 14 }, (_, i) => i + 1);

function clockOf(qtr, mmss) {
  const [m, s] = String(mmss).split(':').map(Number);
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - (m * 60 + s))));
}

// ── Load + de-dupe raw game files (same convention as genRealPbp.mjs) ──
const games = new Map(); // game_id -> rows
let files = [];
try { files = readdirSync(RAW_DIR); } catch { console.error(`RAW_DIR not found: ${RAW_DIR}`); process.exit(1); }
for (const fn of files) {
  const text = readFileSync(join(RAW_DIR, fn), 'utf8');
  const rows = []; let gid = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let d; try { d = JSON.parse(t); } catch { continue; }
    if (!d.game_id || !String(d.game_id).startsWith('2025_')) { gid = null; break; }
    gid = d.game_id; rows.push(d);
  }
  if (gid && rows.length) games.set(gid, rows);
}

// ── Per-game active-wall timeline, sampled per game-minute ──
const wallByWeek = {};
for (const w of WEEKS) wallByWeek[w] = {};
for (const [gid, rows] of games) {
  const [, wwStr, away, home] = gid.split('_');
  const week = +wwStr;
  if (!wallByWeek[week]) continue;
  // game wall-clock baseline = earliest time_of_day
  let base = Infinity;
  for (const d of rows) { const ms = Date.parse(d.time_of_day); if (Number.isFinite(ms) && ms < base) base = ms; }
  if (!Number.isFinite(base)) continue; // no real timestamps → skip (engine falls back)
  // plays: (game clock c, real seconds t, quarter q)
  const plays = [];
  for (const d of rows) {
    const ms = Date.parse(d.time_of_day);
    if (!Number.isFinite(ms) || d.qtr == null || d.time == null) continue;
    plays.push({ c: clockOf(Number(d.qtr), d.time), t: Math.max(0, (ms - base) / 1000), q: Number(d.qtr) });
  }
  if (plays.length < 2) continue;
  plays.sort((a, b) => a.c - b.c || a.t - b.t);
  // cumulative active wall: within-quarter real gaps; cross-quarter gaps (breaks) = 0
  const cMap = new Map(); // c -> cumulative active wall seconds (last play at c wins)
  let cum = 0; let prev = { c: 0, t: 0, q: 1 };
  cMap.set(0, 0);
  for (const p of plays) {
    cum += p.q === prev.q ? Math.max(0, p.t - prev.t) : 0; // pause across quarter/half
    cMap.set(p.c, cum);
    prev = p;
  }
  const pts = [...cMap.entries()].map(([c, wv]) => ({ c, w: wv })).sort((a, b) => a.c - b.c);
  const maxC = pts[pts.length - 1].c;
  const interp = (x) => {
    if (x <= pts[0].c) return pts[0].w;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].c) { const a = pts[i - 1], b = pts[i]; const s = b.c - a.c; return s > 0 ? a.w + ((x - a.c) / s) * (b.w - a.w) : b.w; }
    }
    return pts[pts.length - 1].w;
  };
  const minutes = Math.floor(maxC / 60) + 1;
  const arr = [];
  for (let m = 0; m <= minutes; m++) arr.push(Math.round(interp(m * 60)));
  // both teams of the game share the one game timeline
  wallByWeek[week][away] = arr;
  wallByWeek[week][home] = arr;
}

// ── Merge into existing week files ──
const pubDir = new URL('../../public/pbp/', here);
let touched = 0;
for (const w of WEEKS) {
  const url = new URL(`w${w}.json`, pubDir);
  if (!existsSync(url)) continue;
  const data = JSON.parse(readFileSync(url, 'utf8'));
  data.wall = wallByWeek[w];
  writeFileSync(url, JSON.stringify(data));
  const teams = Object.keys(wallByWeek[w]).length;
  console.log(`  week ${String(w).padStart(2)}: wall for ${teams} teams`);
  touched++;
}
console.log(`games parsed: ${games.size}; week files updated: ${touched}`);
