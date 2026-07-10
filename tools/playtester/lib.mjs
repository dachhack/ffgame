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
import { aiLineup, aiLiveBuffs, wantsComboDrip, defaultAiMetric, aiTargetedPlays, aiBattlePlan, AI_STACKS } from '../../src/data/aiLineup.ts';
import { slugMeta } from '../../src/data/slugMeta.ts';
import { hasSlate, windowForTeam } from '../../src/data/nflSlate.ts';
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
export const WALLET_SEED = 100, EXTRA_SLOT_CAP = 2; // season-start balance (mirrors wallet_seed())
export function aiLoadout(slugs, key, week, wallet = WALLET_SEED, stacks = AI_STACKS) {
  let bal = wallet;
  const owned = new Set(), buffs = new Set();
  const targeted = { rivalry: false, ghost: false, don: false, herring: false };
  let extra = 0;
  // Mirror server/src/lock.js:aiBudgetPass — RETRAINED order (findings §17), by
  // measured lift-per-coin: first amp → RIVALRY (2.80/10c) → remaining amps →
  // then the CONDITIONAL STACKS (§18) when the wallet still allows AND the
  // lineup creates the situation: Air Raid (no Field General to waste it on) →
  // Double-or-Nothing on its top slot → GHOST on an open base slot → combodrip
  // → Red Herring on a genuinely cheap decoy → extra slots.
  // Amplifiers are capacity-limited (0063): an amp beyond capacity needs the
  // Second/Third Amp unlock bought first; skip the amp if that isn't affordable.
  const AMPS = new Set(['momentum', 'garbage-time', 'overtime']);
  const ampCap = () => 1 + (buffs.has('amp-2') ? 1 : 0) + (buffs.has('amp-2') && buffs.has('amp-3') ? 1 : 0);
  const amps = aiLiveBuffs(key, week);
  const plan = aiBattlePlan(aiLineup(slugs, week), week); // blind read of its own lineup
  const raidFits = (stacks.raid || stacks.raidFirst) && !plan.fgDeployed;
  const desired = [];
  if (raidFits && stacks.raidFirst) desired.push('unlock-pass-td10'); // §16 raid-then-amp order
  desired.push(amps[0]);
  if (stacks.twinFg && plan.twinQbWin) desired.push('fg-stack');      // Twin Generals situation
  desired.push('rivalry', ...amps.slice(1));
  if (raidFits && !stacks.raidFirst) desired.push('unlock-pass-td10');
  if (stacks.don && plan.topSlot) desired.push('don');
  if (plan.ghost) desired.push('ghost');
  if (slugs.some((s) => wantsComboDrip(s, slugMeta(s).pos))) desired.push('unlock-combo-drip');
  if (stacks.herring && plan.decoyWr) desired.push('herring');
  const PLAY_ID = { don: 'double-or-nothing', herring: 'red-herring', rivalry: 'rivalry', ghost: 'ghost' };
  for (const item of desired) {
    if (PLAY_ID[item]) {
      const price = powerupById(PLAY_ID[item])?.price ?? 9999;
      if (bal >= price) { bal -= price; targeted[item] = true; }
      continue;
    }
    if (AMPS.has(item) && [...buffs].filter((b) => AMPS.has(b)).length >= ampCap()) {
      const need = buffs.has('amp-2') ? 'amp-3' : 'amp-2';
      const needPrice = powerupById(need)?.price ?? 9999;
      // Capacity only pays off with the amp on top — skip both unless BOTH fit.
      if (bal < needPrice + (powerupById(item)?.price ?? 9999)) continue;
      bal -= needPrice; buffs.add(need);
    }
    const price = powerupById(item)?.price ?? 9999;
    if (bal >= price) { bal -= price; (item.startsWith('unlock-') ? owned : buffs).add(item); }
  }
  // fg-stack is a BUFF for the engine (windowFgMult stack) but the lineup
  // builder also needs to see it (it flips the second QB onto fg) — mirror it
  // into the owned set the aiLineup calls receive.
  if (buffs.has('fg-stack')) owned.add('fg-stack');
  for (let i = extra; i < EXTRA_SLOT_CAP; i++) {
    const price = powerupById('extra-slot')?.price ?? 80;
    if (bal >= price) { bal -= price; extra = i + 1; } else break;
  }
  // Extra slots stack INTO the rivalry window when that stack is on (§18) — the
  // matchup builder honors preferWin while the side's bench can fill it.
  const preferWin = stacks.stackExtras && targeted.rivalry ? plan.rivalry : null;
  return { owned, buffs, extra, targeted, preferWin, spent: wallet - bal, wallet: bal };
}

/** LiveExtras for a side's BOUGHT battle plays, targeted blind off its own built
 *  lineup (aiBattlePlan). Undefined when nothing was bought / no target. */
export function aiExtras(load, picks, week) {
  const t = load?.targeted;
  if (!t || !(t.rivalry || t.ghost || t.don || t.herring)) return undefined;
  const plan = aiBattlePlan(picks.map((p) => ({ win: p.win, slot: p.slot, slug: p.player.id, metric: p.metricId })), week);
  const ex = {};
  if (t.rivalry && plan.rivalry) ex.rivalry = [plan.rivalry];
  if (t.ghost && plan.ghost) ex.ghost = [plan.ghost];
  if (t.don && plan.topSlot) { const [win, slot] = plan.topSlot.split('|'); ex.don = { win, slot }; }
  if (t.herring && plan.decoyWr) ex.redHerring = [plan.decoyWr];
  return Object.keys(ex).length ? ex : undefined;
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

// ── Coordinated matchup builder — SYMMETRIC extra slots ──────────────────────
// Extra Slot adds a slot to a window "for you AND your opponent": a bought slot is
// CONTESTED, not unopposed. So we build both lineups together — each buyer picks
// its deepest-bench windows, and EVERY created slot is filled by BOTH sides from
// their own bench (or left empty if a side is thin there). This is the correct
// model (the unilateral "buildSide(extra)" over-credits the buyer with the 15-coin
// unopposed bounty + a free best-ball slot, which the symmetric slot denies).
//   load = { owned?:Set, extra?:int, metricOverride?:fn } per side.
function sideLineup(roster, week, load, c) {
  let picks = aiLineup(roster, week, load.owned ?? new Set(), 0); // base 8 — extra handled below
  if (load.metricOverride) picks = picks.map((p) => { const o = load.metricOverride(p, slugMeta(p.slug).pos); return o ? { ...p, metric: o } : p; });
  const slotted = new Set(picks.map((p) => p.slug));
  const bench = [];
  for (const slug of roster) {
    if (slotted.has(slug)) continue;
    const { pos, team } = slugMeta(slug);
    const win = hasSlate(week) ? windowForTeam(week, team) : null;
    if (!win) continue; // bye / no slate → unfieldable this week
    bench.push({ slug, pos, win, proj: c.proj.get(slug) || 0 });
  }
  bench.sort((a, b) => b.proj - a.proj); // best bench fielded first
  return { picks: [...picks], bench, extra: load.extra ?? 0 };
}

function deepestWindows(bench, n, prefer = null) {
  const avail = new Map();
  for (const b of bench) avail.set(b.win, (avail.get(b.win) || 0) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    // stackExtras (§18): point bought slots INTO the preferred (rivalry) window
    // first, while the bench can still fill it — then fall back to deepest.
    if (prefer && (avail.get(prefer) || 0) > 0) { out.push(prefer); avail.set(prefer, avail.get(prefer) - 1); continue; }
    let best = null, bc = 0;
    for (const [w, k] of avail) if (k > bc) { best = w; bc = k; }
    if (!best) break;
    out.push(best); avail.set(best, avail.get(best) - 1);
  }
  return out;
}

export function buildMatchup(homeRoster, awayRoster, week, homeLoad = {}, awayLoad = {}) {
  const c = useWeek(week);
  const H = sideLineup(homeRoster, week, homeLoad, c);
  const A = sideLineup(awayRoster, week, awayLoad, c);

  // Union the two buyers' chosen windows; each gets x0,x1,… and BOTH sides fill it.
  const winCounts = new Map();
  for (const w of [...deepestWindows(H.bench, H.extra, homeLoad.preferWin), ...deepestWindows(A.bench, A.extra, awayLoad.preferWin)]) winCounts.set(w, (winCounts.get(w) || 0) + 1);
  const byWin = (s) => { const m = new Map(); for (const b of s.bench) { if (!m.has(b.win)) m.set(b.win, []); m.get(b.win).push(b); } return m; };
  const hbw = byWin(H), abw = byWin(A);
  for (const [w, count] of winCounts) {
    for (let k = 0; k < count; k++) {
      const slot = `x${k}`;
      const hp = (hbw.get(w) || []).shift();
      const ap = (abw.get(w) || []).shift();
      if (hp) H.picks.push({ win: w, slot, slug: hp.slug, metric: defaultAiMetric(hp.pos) });
      if (ap) A.picks.push({ win: w, slot, slug: ap.slug, metric: defaultAiMetric(ap.pos) });
    }
  }
  return { homePicks: toLive(H.picks), awayPicks: toLive(A.picks) };
}

// ── Resolve + enrich ─────────────────────────────────────────────────────────
/** Resolve a full matchup from already-built LivePicks and per-side buff sets,
 *  and annotate the raw LiveResult with the signals the aggregator scans.
 *  `extras` = { home?: LiveExtras, away?: LiveExtras } — the targeted power-up
 *  payloads (rivalry / jinx / grudge / lead-change / red-herring / don / ghost /
 *  bye-steal / surge / cold-snap / napalm / bunker / emp), keyed `win|slot`. */
export function resolve(homePicks, awayPicks, week, homeBuffs = new Set(), awayBuffs = new Set(), extras = undefined) {
  useWeek(week);
  const res = resolveLiveMatchup(homePicks, awayPicks, week, { homeBuffs, awayBuffs }, extras);
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

/** One fully-honest matchup (both sides field the shipping AI's real loadout,
 *  with extra slots resolved symmetrically and any bought battle plays armed). */
export function honestMatch(rand, week, key = 'm') {
  const c = useWeek(week);
  const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
  const hl = aiLoadout(hr, `${key}:home`, week), al = aiLoadout(ar, `${key}:away`, week);
  const { homePicks, awayPicks } = buildMatchup(hr, ar, week, { owned: hl.owned, extra: hl.extra }, { owned: al.owned, extra: al.extra });
  const hx = aiExtras(hl, homePicks, week), ax = aiExtras(al, awayPicks, week);
  const r = resolve(homePicks, awayPicks, week, hl.buffs, al.buffs, hx || ax ? { home: hx, away: ax } : undefined);
  return { ...r, homeRoster: hr, awayRoster: ar, homeLoad: hl, awayLoad: al };
}

export const round = (n) => Math.round(n * 10) / 10;

// ── Tiny stats helpers ───────────────────────────────────────────────────────
export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
export function pct(xs, p) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
export function fmt(n, d = 1) { return Number(n).toFixed(d); }
