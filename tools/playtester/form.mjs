// Automated playtester — does RECENT FORM (trailing weekly stats) beat the current
// AI's season-projection player selection? A measure-first proof before wiring live
// 2025 weekly stats (Stathead) into the worker.
//
// The baked PBP (public/pbp/wN.json) IS per-player, per-week 2025 data, so we can
// build a trailing-form predictor here with NO hindsight (weeks 1..N-1 → week N) and
// A/B it against season projection on a MIRROR 17-man roster (same players both sides,
// both blind). Margin = the selection-policy edge.
//
//   npx tsx tools/playtester/form.mjs --from=4 --to=14 --n=200 --lookback=3
import { readFileSync } from 'node:fs';
import { rng, useWeek, drawRoster, resolve, toLive, slugMeta, mean, fmt } from './lib.mjs';
import { WINDOWS } from '../../src/data/metrics.ts';
import { hasSlate, windowForTeam } from '../../src/data/nflSlate.ts';
import { statsForSlug } from '../../src/data/players.ts';
import { defaultAiMetric } from '../../src/data/aiLineup.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const FROM = Number(flags.from ?? 4), TO = Number(flags.to ?? 14);
const N = Number(flags.n ?? 200), LB = Number(flags.lookback ?? 3);
const seed = Number(flags.seed ?? 555);

// ── Weekly box scores from baked PBP (cached) ────────────────────────────────
const boxCache = new Map(); // week -> Map(slug -> box)
function weekBoxes(w) {
  if (!boxCache.has(w)) {
    const d = JSON.parse(readFileSync(new URL(`../../public/pbp/w${w}.json`, import.meta.url), 'utf8'));
    const m = new Map();
    for (const [slug, plays] of Object.entries(d.pbp)) {
      const b = { rushYds: 0, recYds: 0, rec: 0, tds: 0, passYds: 0 };
      for (const p of plays) {
        if (p.k === 'rush') b.rushYds += p.y; else if (p.k === 'rec') { b.recYds += p.y; b.rec++; } else if (p.k === 'pass') b.passYds += p.y;
        if (p.td) b.tds++;
      }
      m.set(slug, b);
    }
    boxCache.set(w, m);
  }
  return boxCache.get(w);
}
const boxPts = (b) => 0.1 * b.rushYds + 0.1 * b.recYds + 0.5 * b.rec + 6 * b.tds + 0.04 * b.passYds;
const boxOf = (slug, w) => weekBoxes(w).get(slug) || null;

// Trailing form: mean fantasy proxy over the last LB *played* weeks before `week`.
// No hindsight — strictly weeks < target. Falls back to season per-game if no history.
function formScore(slug, week) {
  const xs = [];
  for (let w = week - 1; w >= 1 && xs.length < LB; w--) { const b = boxOf(slug, w); if (b) xs.push(boxPts(b)); }
  if (xs.length) return mean(xs);
  const { pos } = slugMeta(slug); const s = statsForSlug(slug, pos); return s.ppr / Math.max(1, s.games);
}
// Season-TO-DATE (all weeks before target, equal weight) — also NO hindsight. The
// fair baseline for "does recency beat the full prior sample?". Falls back to the
// full-season projection only when there's no prior data yet.
function toDateScore(slug, week) {
  const xs = [];
  for (let w = 1; w < week; w++) { const b = boxOf(slug, w); if (b) xs.push(boxPts(b)); }
  if (xs.length) return mean(xs);
  const { pos } = slugMeta(slug); const s = statsForSlug(slug, pos); return s.ppr / Math.max(1, s.games);
}
// Full-season totals (statsForSlug) — this is what the AI uses today, but in the baked
// harness it is mild HINDSIGHT (includes the target + future weeks). Reference ceiling.
function seasonScore(slug) { const { pos } = slugMeta(slug); const s = statsForSlug(slug, pos); return s.ppr / Math.max(1, s.games); }

// ── Build a lineup by selecting the top-scoring eligible players per window ───
// Identical metric logic both sides (pos default + a light FG read) so the ONLY
// difference between policies is WHO gets fielded — isolating the selection edge.
function selectLineup(roster, week, scoreFn) {
  const picks = [];
  for (const w of WINDOWS) {
    const elig = roster.filter((s) => hasSlate(week) && windowForTeam(week, slugMeta(s).team) === w.id);
    elig.sort((a, b) => scoreFn(b, week) - scoreFn(a, week));
    const start = elig.slice(0, w.slots);
    // light FG: if the window has a QB and ≥2 non-QB drip starters, flip the QB to fg.
    const drips = start.filter((s) => { const p = slugMeta(s).pos; return p === 'RB' || p === 'WR' || p === 'TE'; }).length;
    for (let i = 0; i < start.length; i++) {
      const { pos } = slugMeta(start[i]);
      const metric = (pos === 'QB' && drips >= 2) ? 'fg' : defaultAiMetric(pos);
      picks.push({ win: w.id, slot: String(i), slug: start[i], metric });
    }
  }
  return toLive(picks);
}

// ── A/B: form selection vs season-projection selection, mirror roster ────────
const ROSTER = { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 };
console.log(`\nFORM vs SEASON player selection (mirror, blind, lookback ${LB}w) — weeks ${FROM}-${TO}, ${N}/wk\n`);

let formWins = 0, ties = 0, n = 0; const margins = [];
let fVsHind = 0, hindN = 0; // form vs the full-season-hindsight ceiling (context)
let predHit = 0, predN = 0; // sanity: does trailing form rank week-N production right?
for (let week = FROM; week <= TO; week++) {
  const c = useWeek(week);
  const rand = rng(seed + week * 131);
  for (let i = 0; i < N; i++) {
    const roster = drawRoster(rand, c, ROSTER);
    const home = selectLineup(roster, week, formScore);     // recent form (no hindsight)
    const away = selectLineup(roster, week, toDateScore);   // season-to-date (no hindsight)
    const r = resolve(home, away, week);
    n++; margins.push(r.margin);
    if (r.winner === 'home') formWins++; else if (r.winner === 'tie') ties++;
    // context: form vs the full-season-hindsight ceiling.
    const rh = resolve(selectLineup(roster, week, formScore), selectLineup(roster, week, seasonScore), week);
    if (rh.winner !== 'tie') { hindN++; if (rh.winner === 'home') fVsHind++; }
    // sanity: for a random eligible pair, does higher form → higher actual week-N pts?
    if (roster.length >= 2) {
      const a = roster[i % roster.length], b = roster[(i + 1) % roster.length];
      const fa = formScore(a, week), fb = formScore(b, week);
      const pa = boxOf(a, week) ? boxPts(boxOf(a, week)) : 0, pb = boxOf(b, week) ? boxPts(boxOf(b, week)) : 0;
      if (fa !== fb && pa !== pb) { predN++; if ((fa > fb) === (pa > pb)) predHit++; }
    }
  }
}

console.log(`form (last ${LB}w) vs season-to-date — both no-hindsight:`);
console.log(`  form win-rate:        ${fmt(formWins / n * 100)}%   avg margin ${mean(margins) >= 0 ? '+' : ''}${fmt(mean(margins))}   (ties ${ties})`);
console.log(`  form predictive sanity: ${fmt(predHit / Math.max(1, predN) * 100)}% of pairs ranked right vs actual week-N (50% = no signal)`);
console.log(`  context — form vs full-season HINDSIGHT ceiling: ${fmt(fVsHind / Math.max(1, hindN) * 100)}% (expected <50%: hindsight wins)`);
console.log(`\n>50% form win-rate ⇒ recency beats the full prior sample ⇒ live weekly stats add value over a static projection.`);
