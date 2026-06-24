// feedlog — dump the live-feed play-by-play log for selected players, from the
// baked week data (public/pbp/wN.json) that the live sim drips into live_play.
// This is the exact, time-ordered feed the live board animates from, so it's a
// faithful preview of "what's streaming" without needing the DB.
//
// Usage (from repo root):
//   node scripts/feedlog.mjs                       # top 16 scorers, week 1, full logs
//   node scripts/feedlog.mjs --week=4 --top=24     # top 24 of week 4
//   node scripts/feedlog.mjs josh-allen ja-marr-chase saquon-barkley
//   node scripts/feedlog.mjs --pos=QB,RB --top=10  # filter by position
//   node scripts/feedlog.mjs --team=KC             # everyone on a team
//   node scripts/feedlog.mjs --top=16 --json       # structured JSON (for piping)
//
// Selectors combine: explicit slugs win; otherwise --pos/--team filter the pool,
// then --top=N takes the highest scorers (default 16).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── args ──────────────────────────────────────────────────────────────────────
const flags = {}; const slugs = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) flags[m[1]] = m[2] ?? true; else slugs.push(a);
}
const week = Number(flags.week ?? 1);
const top = Number(flags.top ?? 16);
const posFilter = flags.pos ? String(flags.pos).toUpperCase().split(',') : null;
const teamFilter = flags.team ? String(flags.team).toUpperCase().split(',') : null;

// ── data ──────────────────────────────────────────────────────────────────────
const data = JSON.parse(readFileSync(resolve(ROOT, `public/pbp/w${week}.json`), 'utf8'));
const PBP = data.pbp; const POINTS = data.points ?? {};

// Parse the two generated TS maps as text (no TS toolchain needed).
const parseMap = (file, re) => {
  const out = {}; const txt = readFileSync(resolve(ROOT, file), 'utf8');
  for (const m of txt.matchAll(re)) out[m[1]] = m[2];
  return out;
};
const HEADSHOTS = parseMap('src/data/headshots.ts', /"([a-z0-9-]+)":\s*"([^"]+)"/g);
const META = {};
{
  const txt = readFileSync(resolve(ROOT, 'src/data/bakedSlugs.ts'), 'utf8');
  for (const m of txt.matchAll(/"([a-z0-9-]+)":\{"pos":"([^"]+)","team":"([^"]+)"\}/g))
    META[m[1]] = { pos: m[2], team: m[3] };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const round = (n) => Math.round(n * 10) / 10;
const name = (slug) => slug.split('-').map((w) => {
  if (w.length <= 2) return w.toUpperCase();                  // aj, cj, dk, jj…
  if (w.startsWith('mc')) return 'Mc' + w[2].toUpperCase() + w.slice(3);
  return w[0].toUpperCase() + w.slice(1);
}).join(' ');

const KIND = { pass: 'pass', rush: 'rush', rec: 'catch', fg: 'field goal', xp: 'XP',
  sack: 'sack', int: 'INT', fumrec: 'fum rec', dst_td: 'DEF TD', safety: 'safety', incomplete: 'incomplete' };

// PPR delta for one play — mirrors server/src/simulate.js:baseScore exactly so the
// running total lands on the baked season points.
function delta(p) {
  if (p.k === 'pass') return p.y * 0.04 + (p.td ? 4 : 0);
  if (p.k === 'rush') return p.y * 0.1 + (p.td ? 6 : 0);
  if (p.k === 'rec') return 1 + p.y * 0.1 + (p.td ? 6 : 0);
  if (p.k === 'fg') return p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
  if (p.k === 'xp' || p.k === 'sack') return 1;
  if (p.k === 'int') return 3; if (p.k === 'fumrec') return 2;
  if (p.k === 'dst_td') return 6; if (p.k === 'safety') return 2;
  return 0;
}

// ── selection ─────────────────────────────────────────────────────────────────
let chosen;
if (slugs.length) {
  chosen = slugs;
} else {
  let pool = Object.keys(PBP);
  if (posFilter) pool = pool.filter((s) => posFilter.includes(META[s]?.pos));
  if (teamFilter) pool = pool.filter((s) => teamFilter.includes(META[s]?.team));
  pool.sort((a, b) => (POINTS[b] ?? 0) - (POINTS[a] ?? 0));
  chosen = pool.slice(0, top);
}

// ── output ────────────────────────────────────────────────────────────────────
if (flags.json) {
  const dump = chosen.map((slug) => {
    const evs = (PBP[slug] ?? []).slice().sort((a, b) => (a.t ?? a.c ?? 0) - (b.t ?? b.c ?? 0));
    let run = 0;
    return {
      slug, name: name(slug), pos: META[slug]?.pos ?? '?', team: META[slug]?.team ?? '?',
      points: POINTS[slug] ?? null, headshot: HEADSHOTS[slug] ?? null,
      plays: evs.map((p) => { const d = delta(p); run += d; return { at: p.t ?? p.c ?? 0, kind: p.k, yards: p.y, td: !!p.td, pts: round(d), running: round(run) }; }),
    };
  });
  console.log(JSON.stringify(dump, null, 2));
  process.exit(0);
}

console.log(`\n  LIVE FEED — week ${week} · ${chosen.length} players · full play-by-play`);
console.log(`  (t+ = delivery time since kickoff — the order the live board animates)\n`);
for (const slug of chosen) {
  const meta = META[slug] ?? { pos: '?', team: '?' };
  const evs = (PBP[slug] ?? []).slice().sort((a, b) => (a.t ?? a.c ?? 0) - (b.t ?? b.c ?? 0));
  console.log(`${'─'.repeat(58)}`);
  console.log(`  ${name(slug)}  ·  ${meta.pos} ${meta.team}  ·  ${evs.length} plays  ·  ${POINTS[slug] ?? '—'} pts`);
  console.log(`  ${HEADSHOTS[slug] ?? '(no headshot)'}`);
  console.log(`${'─'.repeat(58)}`);
  let run = 0;
  for (const p of evs) {
    const d = delta(p); run += d;
    const yd = ['pass', 'rush', 'rec', 'fg'].includes(p.k) ? `${String(p.y).padStart(3)} yd` : '      ';
    const td = p.td ? '  TD' : '    ';
    const dly = d ? `${d > 0 ? '+' : ''}${round(d)}`.padStart(5) : '   · ';
    console.log(`   t+${fmtClock(p.t ?? p.c ?? 0).padStart(6)}  ${KIND[p.k].padEnd(10)} ${yd}${td}   ${dly} → ${String(round(run)).padStart(5)}`);
  }
  console.log('');
}
