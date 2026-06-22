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

// slug -> { gsis, pos, name, sleeper? }  ==>  gsis -> { slug, pos }, plus
// slug -> pos and slug -> sleeper id for the generated runtime maps.
const crosswalk = JSON.parse(readFileSync(new URL('crosswalk.json', here), 'utf8'));
const byGsis = new Map();
const slugPos = {};
const slugSleeper = {};
for (const [slug, info] of Object.entries(crosswalk)) {
  byGsis.set(info.gsis, { slug, pos: info.pos });
  slugPos[slug] = info.pos;
  if (info.sleeper) slugSleeper[slug] = String(info.sleeper);
}
// slug -> { team: snapCount } — a player's 2025 team(s) by play count; the
// majority becomes their team for windowing (handles mid-season trades sanely).
const slugTeams = {};
const bumpTeam = (slug, team) => { if (!team) return; (slugTeams[slug] ||= {})[team] = (slugTeams[slug][team] || 0) + 1; };

function clockOf(qtr, mmss) {
  const [m, s] = String(mmss).split(':').map(Number);
  const rem = m * 60 + s;
  // Overtime (qtr ≥ 5): 10-minute periods running past 60:00, so OT plays keep
  // their real game-elapsed clock instead of being squashed onto 59:59.
  if (qtr >= 5) return 3600 + (qtr - 5) * 600 + (600 - rem);
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - rem)));
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

// ── Per-game kickoff (first snap), floored to the nearest 5 minutes, so the
// schedule card can show the real start time. Keyed by team (both teams). ──
const kick = {};
for (const w of WEEKS) kick[w] = {};
for (const [gid, ms] of gameStart) {
  const [, wwStr, away, home] = gid.split('_');
  const week = +wwStr;
  if (!kick[week]) continue;
  const floored = Math.floor(ms / 300000) * 300000;
  kick[week][away] = floored; kick[week][home] = floored;
}

// ── Per-game active-wall timeline (cumulative real wall-seconds in play vs game
// clock, with quarter/half breaks excluded), sampled per game-minute. Keyed by
// team — both teams of a game share the one timeline. Drives REAL CLOCK drip. ──
const wall = {};
for (const w of WEEKS) wall[w] = {};
for (const [gid, rows] of games) {
  const [, wwStr, away, home] = gid.split('_');
  const week = +wwStr;
  if (!wall[week]) continue;
  const base = gameStart.get(gid);
  if (base == null) continue;
  const plays = [];
  for (const d of rows) {
    const ms = Date.parse(d.time_of_day);
    if (!Number.isFinite(ms) || d.qtr == null || d.time == null) continue;
    plays.push({ c: clockOf(Number(d.qtr), d.time), t: Math.max(0, (ms - base) / 1000), q: Number(d.qtr) });
  }
  if (plays.length < 2) continue;
  plays.sort((a, b) => a.c - b.c || a.t - b.t);
  const cMap = new Map(); cMap.set(0, 0);
  let cum = 0; let prev = { t: 0, q: 1 };
  for (const p of plays) { cum += p.q === prev.q ? Math.max(0, p.t - prev.t) : 0; cMap.set(p.c, cum); prev = p; } // pause across quarter/half
  const pts = [...cMap.entries()].map(([c, wv]) => ({ c, w: wv })).sort((a, b) => a.c - b.c);
  const maxC = pts[pts.length - 1].c;
  const interp = (x) => { if (x <= pts[0].c) return pts[0].w; for (let i = 1; i < pts.length; i++) { if (x <= pts[i].c) { const a = pts[i - 1], b = pts[i], s = b.c - a.c; return s > 0 ? a.w + ((x - a.c) / s) * (b.w - a.w) : b.w; } } return pts[pts.length - 1].w; };
  const arr = []; const minutes = Math.floor(maxC / 60) + 1;
  for (let m = 0; m <= minutes; m++) arr.push(Math.round(interp(m * 60)));
  wall[week][away] = arr; wall[week][home] = arr;
}

// ── Per-game end clock (max game-elapsed second over all plays), so the UI can
// show FINAL at each game's real end — including overtime — even when a window's
// shared clock runs past a game that ended in regulation. Keyed by team. ──
const ends = {};
for (const w of WEEKS) ends[w] = {};
for (const [gid, rows] of games) {
  const [, wwStr, away, home] = gid.split('_');
  const week = +wwStr;
  if (!ends[week]) continue;
  let mx = 0;
  for (const d of rows) { if (d.qtr != null && d.time != null) { const c = clockOf(Number(d.qtr), d.time); if (c > mx) mx = c; } }
  ends[week][away] = mx; ends[week][home] = mx;
}

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
    const T = { ...(rt != null ? { t: rt } : {}), ...(d.play_id != null ? { pid: Number(d.play_id) } : {}) }; // real time + play_id ride along with the game clock
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
      const slug = byGsis.get(d.passer_player_id).slug;
      push(week, slug, { c, ...T, k:'pass', y, td: caught && td ? 1 : 0, ca: 0, tg: 0, ...(to ? { to: 1 } : {}) });
      bumpTeam(slug, d.posteam);
      playCount++;
    }
    // Rusher — only true rushing plays (excludes kneels/spikes).
    if (pt === 'run' && isSet(d.rusher_player_id) && byGsis.has(d.rusher_player_id)) {
      const to = fumbledBy(d.rusher_player_id, true) ? 1 : 0;
      const slug = byGsis.get(d.rusher_player_id).slug;
      push(week, slug, { c, ...T, k:'rush', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 0, tg: 0, ...(to ? { to: 1 } : {}) });
      bumpTeam(slug, d.posteam);
      playCount++;
    }
    // Receiver — reception vs incomplete target.
    if (pt === 'pass' && isSet(d.receiver_player_id) && byGsis.has(d.receiver_player_id)) {
      const caught = isSet(d.yards_after_catch);
      const to = caught && fumbledBy(d.receiver_player_id, true) ? 1 : 0;
      const slug = byGsis.get(d.receiver_player_id).slug;
      push(week, slug, caught
        ? { c, ...T, k:'rec', y: Number(d.yards_gained) || 0, td: td ? 1 : 0, ca: 1, tg: 1, ...(to ? { to: 1 } : {}) }
        : { c, ...T, k:'incomplete', y: 0, td: 0, ca: 0, tg: 1 });
      bumpTeam(slug, d.posteam);
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
// never field a partial week (some players real, some simulated). expected.txt
// is optional (it's regenerable from a full pull); without it, every week that
// has data ships — fine when raw/ came from a complete per-week pull.
let expected = [];
try { expected = readFileSync(new URL('expected.txt', here), 'utf8').trim().split('\n').filter(Boolean); }
catch { console.log('no expected.txt — shipping every week that has data'); }
const expByWeek = {}, presentByWeek = {};
for (const gid of expected) { const w = +gid.split('_')[1]; expByWeek[w] = (expByWeek[w] || 0) + 1; }
for (const gid of games.keys()) { const w = +gid.split('_')[1]; presentByWeek[w] = (presentByWeek[w] || 0) + 1; }
const weeksWithData = WEEKS.filter((w) => Object.keys(pbp[w]).length > 0 && (presentByWeek[w] || 0) >= (expByWeek[w] ?? Infinity));
const incomplete = WEEKS.filter((w) => (presentByWeek[w] || 0) > 0 && (presentByWeek[w] || 0) < (expByWeek[w] ?? Infinity));
if (incomplete.length) console.log(`skipped (incomplete): ${incomplete.map((w) => `w${w} ${presentByWeek[w]}/${expByWeek[w]}`).join(', ')}`);
const pubDir = new URL('../../public/pbp/', here);
mkdirSync(pubDir, { recursive: true });
for (const w of weeksWithData) {
  writeFileSync(new URL(`w${w}.json`, pubDir), JSON.stringify({ pbp: pbp[w], points: points[w], poss: poss[w], wall: wall[w], ends: ends[w], kick: kick[w] }));
}
writeFileSync(new URL('../../src/data/realWeeks.ts', here),
  '// AUTO-GENERATED by scripts/pbp/genRealPbp.mjs — do not edit by hand.\n' +
  '// Weeks with baked real 2025 play-by-play (per-week JSON in public/pbp/wN.json).\n' +
  `export const REAL_WEEKS = new Set<number>([${weeksWithData.join(', ')}]);\n`);

// ── Runtime maps: bakedSlugs (skill slug -> pos + 2025 team) and sleeperSlug
// (Sleeper id -> slug), for the live-league builder. Only emit skill slugs that
// actually recorded a play (so a loaded player resolves to real PBP, not empty).
const playedSlugs = new Set();
for (const w of weeksWithData) for (const slug of Object.keys(pbp[w])) if (!slug.endsWith('-k') && !slug.endsWith('-dst')) playedSlugs.add(slug);
const majorityTeam = (slug) => {
  const t = slugTeams[slug]; if (!t) return 'NFL';
  return Object.entries(t).sort((a, b) => b[1] - a[1])[0][0];
};
const baked = {};
const sleeper = {};
for (const slug of [...playedSlugs].sort()) {
  if (!slugPos[slug]) continue; // skill slug without a crosswalk pos (shouldn't happen)
  baked[slug] = { pos: slugPos[slug], team: majorityTeam(slug) };
  if (slugSleeper[slug]) sleeper[slugSleeper[slug]] = slug;
}
writeFileSync(new URL('../../src/data/bakedSlugs.ts', here),
  '// AUTO-GENERATED by scripts/pbp/genRealPbp.mjs — do not edit by hand.\n' +
  '// Skill slugs with baked real 2025 play-by-play (public/pbp/wN.json), with the\n' +
  '// position and majority 2025 NFL team. A loaded Sleeper player matched to one\n' +
  '// of these reuses that real PBP; everyone else is synthesized.\n' +
  `export const BAKED_SLUGS: Record<string, { pos: string; team: string }> = ${JSON.stringify(baked)};\n`);
writeFileSync(new URL('../../src/data/sleeperSlug.ts', here),
  '// AUTO-GENERATED by scripts/pbp/genRealPbp.mjs — do not edit by hand.\n' +
  '// Sleeper player id -> baked PBP slug, for exact (non-name-fuzzy) matching when\n' +
  '// building a live Sleeper league.\n' +
  `export const SLEEPER_SLUG: Record<string, string> = ${JSON.stringify(sleeper)};\n`);
console.log(`bakedSlugs: ${Object.keys(baked).length} skill slugs (${Object.keys(sleeper).length} with sleeper id)`);

// ── Report ──
console.log(`games parsed: ${games.size}`);
console.log(`plays attributed: ${playCount}`);
for (const w of weeksWithData) {
  const slugs = Object.keys(pbp[w]);
  console.log(`  week ${String(w).padStart(2)}: ${String(slugs.length).padStart(3)} players`);
}
