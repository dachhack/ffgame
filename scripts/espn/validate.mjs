// Validate the ESPN → RealPlay adapter against the committed baked nflverse data.
//
// The cheap correctness gate from the pilot plan: re-derive a 2025 week straight
// from ESPN's free feed, normalize through the adapter, and diff against
// public/pbp/wN.json (baked from nflverse structured ids). Plays are joined by
// (slug, pid) — ESPN's play-id suffix equals the nflverse play_id — so we can
// compare attribution play-for-play, not just season totals.
//
// Usage: node scripts/espn/validate.mjs [week]   (default week 1)
import { readFileSync } from 'node:fs';
import { gameToRealPlays, normName } from './espnAdapter.mjs';

const WEEK = Number(process.argv[2] || 1);

// Crosswalk-backed slug resolver: ESPN displayName -> contract slug. Production
// would join ESPN athlete-id -> Sleeper espn_id -> slug (stable, no name fuzz);
// here we approximate with the committed crosswalk by exact normalized name, with
// an initial+lastname fallback for nickname variants ("Joshua" vs "Josh").
const crosswalk = JSON.parse(readFileSync(new URL('../pbp/crosswalk.json', import.meta.url)));
const byExact = new Map(); const byInitLast = new Map();
for (const [slug, info] of Object.entries(crosswalk)) {
  const n = normName(info.name);
  byExact.set(n, slug);
  const parts = n.split(' ');
  if (parts.length >= 2) {
    const key = `${parts[0][0]} ${parts.slice(1).join(' ')}`;
    if (!byInitLast.has(key)) byInitLast.set(key, slug); else byInitLast.set(key, null); // null = ambiguous
  }
}
function resolveSlug(displayName) {
  const n = normName(displayName);
  if (byExact.has(n)) return byExact.get(n);
  const parts = n.split(' ');
  if (parts.length >= 2) {
    const key = `${parts[0][0]} ${parts.slice(1).join(' ')}`;
    const s = byInitLast.get(key);
    if (s) return s;
  }
  return null; // adapter falls back to slugOf(displayName)
}
const SB = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2025&seasontype=2&week=${WEEK}`;
const SUM = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${url}`);
}

const sb = await getJson(SB);
const events = (sb.events ?? []).map((e) => e.id);
console.log(`week ${WEEK}: ${events.length} games`);

// Build the week from ESPN.
const espn = {};
for (const id of events) {
  const sum = await getJson(SUM(id));
  const g = gameToRealPlays(sum, resolveSlug);
  for (const [slug, plays] of Object.entries(g)) (espn[slug] ||= []).push(...plays);
}
for (const s of Object.keys(espn)) espn[s].sort((a, b) => a.c - b.c);

// Baked truth.
const baked = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url))).pbp;

// ── Compare ──
const SKILL = (s) => !s.endsWith('-k') && !s.endsWith('-dst');
const bakedSlugs = new Set(Object.keys(baked));
const espnSlugs = new Set(Object.keys(espn));

let matched = 0, attrOk = 0, kindMismatch = 0, ydMismatch = 0, tdMismatch = 0;
let bakedOnly = 0, espnOnly = 0;
const ydDiffs = [];
const missExamples = [];

// index baked plays by (slug,pid)
function indexByPid(obj) {
  const m = new Map();
  for (const [slug, plays] of Object.entries(obj)) for (const p of plays) if (p.pid != null) m.set(`${slug}|${p.pid}`, p);
  return m;
}
const bIdx = indexByPid(baked), eIdx = indexByPid(espn);

for (const [key, bp] of bIdx) {
  const ep = eIdx.get(key);
  if (!ep) { bakedOnly++; if (missExamples.length < 8) missExamples.push(`baked-only ${key} k=${bp.k} y=${bp.y}`); continue; }
  matched++;
  let ok = true;
  if (ep.k !== bp.k) { kindMismatch++; ok = false; }
  if (ep.y !== bp.y) { ydMismatch++; ydDiffs.push(Math.abs(ep.y - bp.y)); ok = false; }
  if (ep.td !== bp.td) { tdMismatch++; ok = false; }
  if (ok) attrOk++;
}
for (const key of eIdx.keys()) if (!bIdx.has(key)) espnOnly++;

// Per-player point recompute from ESPN plays, vs baked points, as a coarse check.
function pts(plays) {
  let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0, sp = 0;
  for (const p of plays) {
    if (p.k === 'pass') { passYds += p.y; if (p.td) passTd++; }
    else if (p.k === 'rush') { rushYds += p.y; if (p.td) rushTd++; }
    else if (p.k === 'rec') { rec++; recYds += p.y; if (p.td) recTd++; }
    else if (p.k === 'fg') sp += p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
    else if (p.k === 'xp') sp += 1; else if (p.k === 'sack') sp += 1;
    else if (p.k === 'int') sp += 3; else if (p.k === 'fumrec') sp += 2;
    else if (p.k === 'dst_td') sp += 6; else if (p.k === 'safety') sp += 2;
  }
  return Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4 + sp) * 10) / 10;
}
const bakedPts = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url))).points;
let ptExact = 0, ptClose = 0, ptOff = 0; const ptExamples = [];
const slugsForPts = new Set([...bakedSlugs, ...espnSlugs]);
for (const s of slugsForPts) {
  const a = pts(espn[s] ?? []); const b = bakedPts[s] ?? 0;
  const d = Math.abs(a - b);
  if (d < 0.05) ptExact++; else if (d <= 1.0) ptClose++; else { ptOff++; if (ptExamples.length < 12) ptExamples.push(`${s}: espn ${a} vs baked ${b}`); }
}

const pct = (n, d) => d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a';
console.log('\n── play-level join (slug,pid) ──');
console.log(`baked plays w/ pid: ${bIdx.size}  espn plays w/ pid: ${eIdx.size}`);
console.log(`matched: ${matched} (${pct(matched, bIdx.size)} of baked)`);
console.log(`  attribution exact (k+y+td): ${attrOk} (${pct(attrOk, matched)} of matched)`);
console.log(`  kind mismatch: ${kindMismatch}  yard mismatch: ${ydMismatch}  td mismatch: ${tdMismatch}`);
console.log(`baked-only (ESPN missed): ${bakedOnly}   espn-only (extra): ${espnOnly}`);
if (ydDiffs.length) console.log(`  yard-diff mean: ${(ydDiffs.reduce((a, b) => a + b, 0) / ydDiffs.length).toFixed(2)}`);
console.log('\n── per-player points ──');
console.log(`exact(<0.05): ${ptExact}  close(<=1.0): ${ptClose}  off(>1.0): ${ptOff}  total ${slugsForPts.size}`);
if (missExamples.length) { console.log('\nmiss examples:'); for (const m of missExamples) console.log('  ' + m); }
if (ptExamples.length) { console.log('\npoint-off examples:'); for (const m of ptExamples) console.log('  ' + m); }
