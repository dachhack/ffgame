// Validate the ESPN → RealPlay adapter against the committed baked nflverse data.
//
// The cheap correctness gate from the pilot plan: re-derive a 2025 week straight
// from ESPN's free feed, normalize through the adapter, and diff against
// public/pbp/wN.json (baked from nflverse structured ids). Plays are joined by
// (slug, pid) — ESPN's play-id suffix equals the nflverse play_id — so we can
// compare attribution play-for-play, not just season totals.
//
// Usage: node scripts/espn/validate.mjs [week]   (default week 1)
//
// Pass/fail gate: exits non-zero when any threshold is breached, so CI can
// catch real regressions in the adapter (e.g. ESPN schema drift). The baselines
// were sampled against weeks 1 + 5 of the 2025 season (~95% play match, ~99.5%
// attribution-exact, ~83% per-player points within 1.0); thresholds are set a
// few points below those to ride out normal noise without false alarms.
// Override any of them: --match=0.92 --attr=0.98 --pts=0.80 --returns=0.80
import { readFileSync } from 'node:fs';
import { gameToRealPlays, normName } from './espnAdapter.mjs';

const args = process.argv.slice(2);
const WEEK = Number(args.find((a) => !a.startsWith('--')) || 1);
const flag = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
};
const TH = {
  match: flag('match', 0.92),     // matched / baked plays w/ pid
  attr: flag('attr', 0.985),       // attribution-exact / matched
  pts: flag('pts', 0.80),         // (exact + close) / total players
  returns: flag('returns', 0.80), // returns yards-exact / matched
};

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

// index plays by (slug,pid). `return` plays aren't in wN.json (they live in
// src/data/returns.ts) — exclude them here and validate them separately below.
function indexByPid(obj) {
  const m = new Map();
  for (const [slug, plays] of Object.entries(obj)) for (const p of plays) if (p.pid != null && p.k !== 'return') m.set(`${slug}|${p.pid}`, p);
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

// ── Returns cross-check vs src/data/returns.ts (joined on slug,pid) ──
function loadReturns() {
  const src = readFileSync(new URL('../../src/data/returns.ts', import.meta.url), 'utf8');
  const i = src.indexOf('= {', src.indexOf('RETURN_PLAYS'));
  const j = src.lastIndexOf('};');
  return JSON.parse(src.slice(i + 2, j + 1)); // slug -> { week: [[c,y,td?,t?,pid?]] }
}
let retMatch = 0, retYdOk = 0, retBakedOnly = 0, retEspnOnly = 0;
try {
  const RET = loadReturns();
  const bRet = new Map(); // slug|pid -> yards
  for (const [slug, byWk] of Object.entries(RET)) for (const r of byWk[WEEK] ?? []) { const pid = r[4]; if (pid != null) bRet.set(`${slug}|${pid}`, r[1]); }
  const eRet = new Map();
  for (const [slug, plays] of Object.entries(espn)) for (const p of plays) if (p.k === 'return' && p.pid != null) eRet.set(`${slug}|${p.pid}`, p.y);
  for (const [key, y] of bRet) { const ey = eRet.get(key); if (ey == null) retBakedOnly++; else { retMatch++; if (ey === y) retYdOk++; } }
  for (const key of eRet.keys()) if (!bRet.has(key)) retEspnOnly++;
} catch (e) { console.log('returns cross-check skipped:', e.message); }

const pct = (n, d) => d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a';
console.log('\n── play-level join (slug,pid) ──');
console.log(`baked plays w/ pid: ${bIdx.size}  espn plays w/ pid: ${eIdx.size}`);
console.log(`matched: ${matched} (${pct(matched, bIdx.size)} of baked)`);
console.log(`  attribution exact (k+y+td): ${attrOk} (${pct(attrOk, matched)} of matched)`);
console.log(`  kind mismatch: ${kindMismatch}  yard mismatch: ${ydMismatch}  td mismatch: ${tdMismatch}`);
console.log(`baked-only (ESPN missed): ${bakedOnly}   espn-only (extra): ${espnOnly}`);
if (ydDiffs.length) console.log(`  yard-diff mean: ${(ydDiffs.reduce((a, b) => a + b, 0) / ydDiffs.length).toFixed(2)}`);
console.log('\n── returns (vs src/data/returns.ts) ──');
console.log(`matched: ${retMatch}  yards exact: ${retYdOk} (${pct(retYdOk, retMatch)})  baked-only: ${retBakedOnly}  espn-only: ${retEspnOnly}`);
console.log('\n── per-player points ──');
console.log(`exact(<0.05): ${ptExact}  close(<=1.0): ${ptClose}  off(>1.0): ${ptOff}  total ${slugsForPts.size}`);
if (missExamples.length) { console.log('\nmiss examples:'); for (const m of missExamples) console.log('  ' + m); }
if (ptExamples.length) { console.log('\npoint-off examples:'); for (const m of ptExamples) console.log('  ' + m); }

// ── Gate ──
const rates = {
  match: bIdx.size ? matched / bIdx.size : 1,
  attr: matched ? attrOk / matched : 1,
  pts: slugsForPts.size ? (ptExact + ptClose) / slugsForPts.size : 1,
  returns: retMatch ? retYdOk / retMatch : 1,
};
const fails = [];
for (const k of Object.keys(TH)) if (rates[k] < TH[k]) fails.push(`${k} ${(rates[k] * 100).toFixed(1)}% < floor ${(TH[k] * 100).toFixed(1)}%`);
console.log('\n── gate ──');
console.log(`match ${(rates.match * 100).toFixed(1)}%  attr ${(rates.attr * 100).toFixed(1)}%  pts ${(rates.pts * 100).toFixed(1)}%  returns ${(rates.returns * 100).toFixed(1)}%`);
if (fails.length) { console.log(`FAIL — ${fails.join(' · ')}`); process.exit(1); }
console.log('PASS');
