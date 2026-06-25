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
//   node scripts/feedlog.mjs --top=16 --html > feed.html   # visual contact sheet
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

if (flags.html) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const card = (slug) => {
    const meta = META[slug] ?? { pos: '?', team: '?' };
    const evs = (PBP[slug] ?? []).slice().sort((a, b) => (a.t ?? a.c ?? 0) - (b.t ?? b.c ?? 0));
    let run = 0; const series = [];
    const rows = evs.map((p) => {
      const d = delta(p); run += d; series.push(run);
      const yd = ['pass', 'rush', 'rec', 'fg'].includes(p.k) ? `${p.y} yd` : '';
      const cls = p.td ? ' td' : d < 0 ? ' neg' : '';
      const dly = d ? `${d > 0 ? '+' : ''}${round(d)}` : '·';
      return `<tr class="row${cls}"><td class="t">${fmtClock(p.t ?? p.c ?? 0)}</td><td class="k">${esc(KIND[p.k])}${p.td ? ' <span class="b">TD</span>' : ''}</td><td class="y">${yd}</td><td class="d">${dly}</td><td class="r">${round(run)}</td></tr>`;
    }).join('');
    // running-total sparkline
    const max = Math.max(1, ...series);
    const w = 220, h = 34;
    const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1) * w).toFixed(1)},${(h - v / max * (h - 3) - 1).toFixed(1)}`).join(' ');
    const spark = series.length > 1
      ? `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>` : '';
    const img = HEADSHOTS[slug]
      ? `<img src="${esc(HEADSHOTS[slug])}" alt="${esc(name(slug))}" loading="lazy"/>`
      : `<div class="noimg">${esc(meta.pos)}</div>`;
    return `<section class="card">
      <header>
        <div class="shot">${img}</div>
        <div class="who">
          <div class="nm">${esc(name(slug))}</div>
          <div class="meta"><span class="pos ${esc(meta.pos)}">${esc(meta.pos)}</span> ${esc(meta.team)} · ${evs.length} plays</div>
        </div>
        <div class="tot">${POINTS[slug] ?? '—'}<span>pts</span></div>
      </header>
      ${spark}
      <table>${rows}</table>
    </section>`;
  };
  const POS_COLORS = { QB: '#e87', RB: '#7c9', WR: '#6bd', TE: '#db6', K: '#aaa', DEF: '#b8a' };
  const posCss = Object.entries(POS_COLORS).map(([p, c]) => `.pos.${p}{background:${c}22;color:${c};border-color:${c}66}`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Live feed — week ${week}</title>
<style>
:root{--bg:#0c0e12;--surface:#14171d;--bd:#262b34;--text:#e7ebf0;--dim:#8a93a0;--faint:#5a626d;--you:#6bd1ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 ui-sans-serif,system-ui,sans-serif;padding:20px}
h1{font-size:15px;font-weight:700;margin:0 0 2px}
.sub{color:var(--faint);font-size:11px;margin-bottom:18px;font-family:ui-monospace,monospace}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--surface);border:1px solid var(--bd);border-left:3px solid var(--you);border-radius:10px;padding:12px;overflow:hidden}
.card header{display:flex;align-items:center;gap:10px}
.shot{width:46px;height:46px;border-radius:50%;overflow:hidden;background:#0a0c10;flex:none;border:1px solid var(--bd)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top}
.noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--faint);font-weight:700;font-size:11px}
.who{flex:1;min-width:0}
.nm{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{color:var(--dim);font-size:10.5px;font-family:ui-monospace,monospace;margin-top:2px}
.pos{display:inline-block;padding:0 5px;border-radius:4px;border:1px solid var(--bd);font-weight:700;font-size:9px;letter-spacing:.04em}
${posCss}
.tot{font-size:22px;font-weight:800;color:var(--you);line-height:1;text-align:right}
.tot span{display:block;font-size:8.5px;color:var(--faint);font-weight:700;letter-spacing:.1em}
.spark{width:100%;height:34px;margin:8px 0 2px;display:block}
.spark polyline{fill:none;stroke:var(--you);stroke-width:1.5;opacity:.85;vector-effect:non-scaling-stroke}
table{width:100%;border-collapse:collapse;margin-top:6px;font-family:ui-monospace,monospace;font-size:10.5px}
.row td{padding:2px 4px;border-top:1px solid #1c2129;white-space:nowrap}
.t{color:var(--faint)} .k{color:var(--dim);width:99%} .y{color:var(--text);text-align:right}
.d{color:var(--faint);text-align:right} .r{color:var(--text);text-align:right;font-weight:700}
.row.td .k,.row.td .r{color:var(--you)} .row.td .b{background:var(--you);color:#06121a;border-radius:3px;padding:0 3px;font-size:8.5px;font-weight:800;margin-left:4px}
.row.neg .d{color:#d77}
</style></head><body>
<h1>Live feed — week ${week}</h1>
<div class="sub">${chosen.length} players · t+ = delivery time since kickoff (the order the live board animates) · running total is PPR</div>
<div class="grid">${chosen.map(card).join('')}</div>
</body></html>`;
  console.log(html);
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
