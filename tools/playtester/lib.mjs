// Automated playtester — shared engine harness (build-plan step 1 substrate).
//
// Drives the PURE, deterministic Drip engine headlessly the way the worker does
// (server/src/engine.js → src/engine/*.ts under tsx): inject a baked week's plays,
// build two lineups, resolve the full H2H, read { home, away, coin, states, slots }.
// No Supabase, no Sleeper, no network — everything seeds off (slug, week) + hashes,
// so a given (rosters, week, seed) always resolves identically. That reproducibility
// is the whole point: every finding the aggregator/adversary surfaces is re-runnable.
//
// This module is the substrate; harness.mjs (honest-field meta) and aggregate.mjs
// (single-lever A/B) are thin CLIs over it. Run anything that imports it under tsx.
import { readFileSync } from 'node:fs';
import { injectWeek, resolveLiveMatchup, makePlayer } from '../../server/src/engine.js';
import { aiLineup, aiLiveBuffs, wantsComboDrip } from '../../src/data/aiLineup.ts';
import { slugMeta } from '../../src/data/slugMeta.ts';
import { statsForSlug } from '../../src/data/players.ts';
import { powerupById } from '../../src/data/powerups.ts';

export { slugMeta, powerupById };

// ── Seeded RNG (mulberry32) — reproducible draws, no Math.random ─────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Baked-week loader + player pool (cached; re-injects on each use so the active
//    synthetic week always matches the week being resolved) ───────────────────
const _cache = new Map();
export function useWeek(week) {
  let c = _cache.get(week);
  if (!c) {
    const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${week}.json`, import.meta.url), 'utf8'));
    const pool = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
    const proj = new Map();
    for (const slug of Object.keys(w.pbp)) {
      const m = slugMeta(slug);
      if (!pool[m.pos]) continue;
      pool[m.pos].push(slug);
      proj.set(slug, statsForSlug(slug, m.pos).ppr || 0);
    }
    c = { pbp: w.pbp, points: w.points ?? {}, pool, proj };
    _cache.set(week, c);
  }
  injectWeek(week, c.pbp, c.points); // make THIS week the active synthetic feed
  return c;
}

/** Parse a `--week=1` or `--week=1-14` spec into a list of weeks. */
export function parseWeeks(spec) {
  if (spec == null) return [1];
  const s = String(spec);
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (m) { const out = []; for (let w = +m[1]; w <= +m[2]; w++) out.push(w); return out; }
  return s.split(',').map(Number).filter(Boolean);
}

// ── Roster generation ────────────────────────────────────────────────────────
// A plausible fantasy starting roster, drawn from the week's real player pool.
// Skill positions are projection-weighted (managers start their studs); K/DEF are
// uniform. 9 starters across QB/RB/WR/TE/K/DEF → aiLineup slate-gates 8 into the
// window grid and benches the rest (so extra-slot stacking has material).
const DEFAULT_COUNTS = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };

function weightedIndex(rand, cand, proj, weighted) {
  if (!weighted) return Math.floor(rand() * cand.length);
  let total = 0;
  const w = cand.map((s) => { const v = Math.max(0.5, proj.get(s) || 0.5); total += v; return v; });
  let r = rand() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return w.length - 1;
}

export function drawRoster(rand, c, counts = DEFAULT_COUNTS) {
  const out = [];
  for (const [pos, n] of Object.entries(counts)) {
    const cand = [...c.pool[pos]];
    const weighted = pos !== 'K' && pos !== 'DEF';
    for (let i = 0; i < n && cand.length; i++) {
      out.push(cand.splice(weightedIndex(rand, cand, c.proj, weighted), 1)[0]);
    }
  }
  return out;
}

// ── AiPick → LivePick adapter (resolveLiveMatchup wants Player objects) ───────
export function toLive(picks) {
  return picks.map((p) => {
    const m = slugMeta(p.slug);
    return { win: p.win, slot: p.slot, player: makePlayer(p.slug, m.pos, m.team), metricId: p.metric };
  });
}

// ── AI loadout — a pure mirror of server/src/lock.js:aiBudgetPass (no DB) ─────
// Seeds a 150-coin wallet and buys BLIND in priority order: combo-drip if the
// roster has a dual-threat, then up to 3 in-slot buffs from the deterministic
// aiLiveBuffs draw, then extra slots up to the cap — spending only what it can
// afford. Returns { owned, buffs, extra } to feed aiLineup + resolveLiveMatchup.
const WALLET_SEED = 150, EXTRA_SLOT_CAP = 2;
export function aiLoadout(slugs, key, week) {
  let bal = WALLET_SEED;
  const owned = new Set(), buffs = new Set();
  let extra = 0;
  const desired = [];
  if (slugs.some((s) => wantsComboDrip(s, slugMeta(s).pos))) desired.push('unlock-combo-drip');
  for (const b of aiLiveBuffs(key, week)) desired.push(b);
  for (const item of desired) {
    const price = powerupById(item)?.price ?? 9999;
    if (bal >= price) { bal -= price; (item.startsWith('unlock-') ? owned : buffs).add(item); }
  }
  for (let i = extra; i < EXTRA_SLOT_CAP; i++) {
    const price = powerupById('extra-slot')?.price ?? 80;
    if (bal >= price) { bal -= price; extra = i + 1; } else break;
  }
  return { owned, buffs, extra, spent: WALLET_SEED - bal };
}

// ── Build one side's resolved picks, with optional lever overrides ───────────
// owned/extra flow into aiLineup (they change which metrics/slots it fields);
// metricOverride(pick, pos) → a metric id to force on that pick (or null to keep).
export function buildSide(roster, week, { owned = new Set(), extra = 0, metricOverride = null } = {}) {
  let picks = aiLineup(roster, week, owned, extra);
  if (metricOverride) {
    picks = picks.map((p) => {
      const over = metricOverride(p, slugMeta(p.slug).pos);
      return over ? { ...p, metric: over } : p;
    });
  }
  return toLive(picks);
}

// ── Resolve + enrich ─────────────────────────────────────────────────────────
/** Resolve a full matchup from already-built LivePicks and per-side buff sets,
 *  and annotate the raw LiveResult with the signals the aggregator scans. */
export function resolve(homePicks, awayPicks, week, homeBuffs = new Set(), awayBuffs = new Set()) {
  useWeek(week);
  const res = resolveLiveMatchup(homePicks, awayPicks, week, { homeBuffs, awayBuffs });
  const margin = round(res.home - res.away);
  // Biggest single slot score on either side — a proxy for a "blowup" play
  // (TE-TD nuke wiping a bank to a huge relative swing, FG×FG stacks, etc.).
  let topSlot = null;
  for (const s of res.slots) if (!topSlot || s.score > topSlot.score) topSlot = s;
  return {
    ...res, margin,
    winner: margin > 0 ? 'home' : margin < 0 ? 'away' : 'tie',
    topSlot: topSlot ? topSlot.score : 0,
    topSlotInfo: topSlot,
    blowup: Math.max(res.home, res.away),
  };
}

/** One fully-honest matchup (both sides field the shipping AI's real loadout). */
export function honestMatch(rand, week, key = 'm') {
  const c = useWeek(week);
  const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
  const hl = aiLoadout(hr, `${key}:home`, week), al = aiLoadout(ar, `${key}:away`, week);
  const home = buildSide(hr, week, { owned: hl.owned, extra: hl.extra });
  const away = buildSide(ar, week, { owned: al.owned, extra: al.extra });
  const r = resolve(home, away, week, hl.buffs, al.buffs);
  return { ...r, homeRoster: hr, awayRoster: ar, homeLoad: hl, awayLoad: al };
}

export const round = (n) => Math.round(n * 10) / 10;

// ── Tiny stats helpers ───────────────────────────────────────────────────────
export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
export function pct(xs, p) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
export function fmt(n, d = 1) { return Number(n).toFixed(d); }
