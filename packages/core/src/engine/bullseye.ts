// BULLSEYE (v0.643.0, founder: "have your players try to get as close as
// possible to a final total and/or totals for each spot are assigned (even
// numbers 5, 10, 15, 20) randomly by the CPU" — "for classic mode").
//
// A classic-league SETTING, modelled on golf (golf.ts, 0200): one per-league
// install that changes what a starter's points MEAN, read through one module
// so the resolver, the auto-slot, the AI seats, the best-ball fill and both
// boards can never disagree about it. Spec: docs/bullseye.md.
//
// THE CARD. Each week the league is dealt a target per starting spot — a
// positive multiple of 5 drawn per spot TYPE (§4 of the spec) from a seed of
// (league, week), so the worker, a board that has not yet seen the published
// rows, a re-run and a probe all deal the same numbers. The TOTAL variant
// publishes only the card's sum and scores the lineup as one dart; the slot
// card is still dealt underneath so every fill can aim spot by spot.
//
// THE DART. distance = |points − target|; a spot banks
//   max(0, radius − distance) + (distance ≤ radius/20 ? radius : 0)
// — continuous so "closer" is always better and ties stay rare, capped so a
// 40-point explosion aimed at a 10 costs no more than a 20 would, and a
// bullseye (inside half a point at radius 10) doubles the spot.
//
// A ZERO SCORES NOTHING. A spot whose player posts 0.0 is a MISS whatever the
// target, or a 5 is solved by starting an injured player. Same philosophy as
// golf's "a zero is an absence, not a low score". A spot carrying the
// zero-fill rule banks its fill first and throws the dart with the fill.
//
// Platform-free and dependency-free on purpose: classic.ts imports THIS (the
// install, the score), never the other way round, so there is no cycle.
import type { ClassicResult, ClassicSlotScore, ClassicScoring } from './classic';
import { DEFAULT_CLASSIC_SCORING, normalizeClassicScoring, scoringFor, slotEligiblePos } from './classic';
import { scoreProjLine, scoreKickLine, scoreDstLine } from './projScoring';

export type BullseyeVariant = 'slots' | 'total';
export interface BullseyeConfig { variant: BullseyeVariant; radius: number }

export const BULLSEYE_RADIUS = 10;
export const BULLSEYE_RADIUS_MIN = 2;
export const BULLSEYE_RADIUS_MAX = 50;

/** The league's bullseye setting, normalised — null when off. SQL stores the
 *  sanitized variant + radius; this owns the defaults (the classic rule:
 *  "this module owns every default; SQL stores sanitized overrides only"). */
export function bullseyeConfigOf(mode?: { bullseye?: string | null; bullseye_radius?: number | null } | null): BullseyeConfig | null {
  const v = mode?.bullseye;
  if (v !== 'slots' && v !== 'total') return null;
  const r = Number(mode?.bullseye_radius);
  const radius = Number.isFinite(r) && r >= BULLSEYE_RADIUS_MIN && r <= BULLSEYE_RADIUS_MAX ? Math.round(r) : BULLSEYE_RADIUS;
  return { variant: v, radius };
}

// ── The deal ────────────────────────────────────────────────────────────────
// Per spot TYPE, [target, weight]. Weighted toward the middle so a card is
// rarely all 20s or all 5s; never 0 (see the guardrail above). A spot whose
// eligibility matches no catalog type (a custom mix) falls back by its first
// eligible position, then to the plain set.
export const BULLSEYE_DRAWS: Record<string, [number, number][]> = {
  QB:   [[15, 2], [20, 3], [25, 3], [30, 1]],
  SFLX: [[10, 2], [15, 3], [20, 3], [25, 1]],
  RB:   [[5, 2], [10, 3], [15, 3], [20, 1]],
  WR:   [[5, 2], [10, 3], [15, 3], [20, 1]],
  FLEX: [[5, 2], [10, 3], [15, 3], [20, 1]],
  WRT:  [[5, 2], [10, 3], [15, 3], [20, 1]],
  TE:   [[5, 3], [10, 3], [15, 1]],
  K:    [[5, 2], [10, 3], [15, 1]],
  DEF:  [[5, 3], [10, 3], [15, 1]],
  DL:   [[5, 3], [10, 3], [15, 1]],
  LB:   [[5, 3], [10, 3], [15, 1]],
  DB:   [[5, 3], [10, 3], [15, 1]],
  IDP:  [[5, 3], [10, 3], [15, 1]],
  RET:  [[5, 3], [10, 1]],
};
const PLAIN_DRAW: [number, number][] = [[5, 1], [10, 1], [15, 1]];

export function drawSetFor(d: { type?: string; pos: string[] }): [number, number][] {
  return BULLSEYE_DRAWS[d.type ?? ''] ?? BULLSEYE_DRAWS[d.pos?.[0] ?? ''] ?? PLAIN_DRAW;
}

// ── ANCHORED TO THE LEAGUE'S OWN SCORING (spec §11 → shipped) ───────────────
// The sets above are tuned for full PPR and the stock catalog. A 20 for a WR
// means something else in standard scoring, and a 6-point-passing-TD league
// makes a QB's 25 a different ask. So each set is SCALED by what the league's
// catalog pays a TYPICAL season at that position against the stock catalog —
// a canonical stat line per position, scored under both, the ratio applied to
// every target and rounded back to a multiple of 5 (never below 5). Derived
// from the catalog alone, never from live data, so the deal stays
// reproducible from settings: the worker, a board and a probe scale alike.
// The lines are round, mid-tier seasons (per 17 games), not any one player.
const TYPICAL: Record<string, { passYd: number; passTd: number; int: number; rushYd: number; rushTd: number; rec: number; recYd: number; recTd: number }> = {
  QB: { passYd: 3800, passTd: 25, int: 10, rushYd: 250, rushTd: 3, rec: 0, recYd: 0, recTd: 0 },
  RB: { passYd: 0, passTd: 0, int: 0, rushYd: 950, rushTd: 7, rec: 40, recYd: 300, recTd: 2 },
  WR: { passYd: 0, passTd: 0, int: 0, rushYd: 20, rushTd: 0, rec: 70, recYd: 950, recTd: 6 },
  TE: { passYd: 0, passTd: 0, int: 0, rushYd: 0, rushTd: 0, rec: 55, recYd: 600, recTd: 4 },
};
const TYPICAL_K = { fga0: 7, fgm0: 7, fga30: 9, fgm30: 8.5, fga40: 9.5, fgm40: 7.5, fga50: 7, fgm50: 4.5, xpa: 38, xpm: 36 };
const TYPICAL_DST = { paPg: 21, sack: 40, int: 12, fumRec: 8, defTd: 3, stTd: 1, safety: 1 };
// Which typical line a spot type is priced by.
const PRICED_AS: Record<string, string> = { QB: 'QB', SFLX: 'QB', RB: 'RB', WR: 'WR', FLEX: 'WR', WRT: 'WR', TE: 'TE', K: 'K', DEF: 'DEF' };

/** Per spot type, how much the league's catalog pays a typical season at that
 *  position against the stock catalog. 1 for every type when the catalog is
 *  stock, or for types with no typical line (IDP, RET, a custom mix). */
export function bullseyeScaleOf(catalog?: number | Partial<ClassicScoring> | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (catalog == null) return out;
  const sc = normalizeClassicScoring(catalog);
  const ratio = (mine: number, base: number): number => (base > 0 && mine > 0 ? mine / base : 1);
  for (const [type, by] of Object.entries(PRICED_AS)) {
    let r = 1;
    if (by === 'K') r = ratio(scoreKickLine(TYPICAL_K, scoringFor(sc, 'K')), scoreKickLine(TYPICAL_K, DEFAULT_CLASSIC_SCORING));
    else if (by === 'DEF') r = ratio(scoreDstLine(TYPICAL_DST, scoringFor(sc, 'DEF')), scoreDstLine(TYPICAL_DST, DEFAULT_CLASSIC_SCORING));
    else r = ratio(scoreProjLine(TYPICAL[by], by, scoringFor(sc, by)), scoreProjLine(TYPICAL[by], by, DEFAULT_CLASSIC_SCORING));
    if (Math.abs(r - 1) > 1e-9) out[type] = r;
  }
  return out;
}

/** A draw set scaled by the league's ratio for the spot, every target rounded
 *  back to a multiple of 5 (never below 5); targets that round together pool
 *  their weights. Identity at ratio 1. */
export function scaledDraw(draw: [number, number][], ratio: number): [number, number][] {
  if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-9) return draw;
  const pooled = new Map<number, number>();
  for (const [t, w] of draw) {
    const st = Math.max(5, Math.round((t * ratio) / 5) * 5);
    pooled.set(st, (pooled.get(st) ?? 0) + w);
  }
  return [...pooled.entries()].sort((a, b) => a[0] - b[0]);
}

// mulberry32 over an FNV-1a string hash — the pods' own seeded RNG
// (server/src/pods.js), copied rather than imported because core is
// platform-free and the worker is not.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hashStr(seed);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weighted(draw: [number, number][], u: number): number {
  const total = draw.reduce((s, [, w]) => s + w, 0);
  let x = u * total;
  for (const [v, w] of draw) { x -= w; if (x < 0) return v; }
  return draw[draw.length - 1][0];
}

export interface BullseyeCard {
  /** slot id → target, in the league's spot order. */
  targets: Record<string, number>;
  /** The card's sum — the TOTAL variant's one target. */
  total: number;
}

/** Deal the week's card. Deterministic in (leagueId, week, the spots in
 *  order): the same inputs always deal the same card. */
export function dealBullseyeCard(
  leagueId: string, week: number, slots: { slot: string; type?: string; pos: string[] }[],
  /** The league's scoring catalog (leagueCatalogOf) — anchors the sets to
   *  what the league actually pays. Omitted: the stock sets. */
  catalog?: number | Partial<ClassicScoring> | null,
): BullseyeCard {
  const next = rng(`bullseye|${leagueId}|${week}`);
  const scale = bullseyeScaleOf(catalog);
  const targets: Record<string, number> = {};
  let total = 0;
  for (const d of slots) {
    const set = drawSetFor(d);
    const r = scale[d.type ?? ''] ?? scale[PRICED_AS[d.pos?.[0] ?? ''] ? (d.pos?.[0] ?? '') : ''] ?? 1;
    const t = weighted(scaledDraw(set, r), next());
    targets[d.slot] = t;
    total += t;
  }
  return { targets, total };
}

/** A published card (the bullseye_card rows) back into the engine's shape.
 *  The 'TOTAL' row, when present, is the sum; otherwise it is summed here. */
export function cardFromRows(rows: { slot: string; target: number | string }[] | null | undefined): BullseyeCard | null {
  if (!rows?.length) return null;
  const targets: Record<string, number> = {};
  let total: number | null = null;
  for (const r of rows) {
    const t = Number(r.target);
    if (!Number.isFinite(t)) continue;
    if (r.slot === 'TOTAL') total = t;
    else targets[r.slot] = t;
  }
  if (!Object.keys(targets).length && total == null) return null;
  return { targets, total: total ?? Object.values(targets).reduce((s, t) => s + t, 0) };
}

/** The rows to publish for a card — one per spot plus the TOTAL. */
export function cardRows(card: BullseyeCard): { slot: string; target: number }[] {
  return [...Object.entries(card.targets).map(([slot, target]) => ({ slot, target })), { slot: 'TOTAL', target: card.total }];
}

// ── The dart ────────────────────────────────────────────────────────────────
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The band a bullseye has to land in: radius / 20 (half a point at 10). */
export const bullseyeBand = (radius: number): number => radius / 20;

/** What a dart banks. A zero is a miss (see the module docblock); so is a
 *  spot with no target. */
export function ringScore(points: number, target: number | null | undefined, radius: number): number {
  if (target == null || !Number.isFinite(target)) return 0;
  if (!Number.isFinite(points) || Math.abs(points) < 1e-9) return 0;
  const dist = Math.abs(points - target);
  const base = Math.max(0, radius - dist);
  return round1(base + (dist <= bullseyeBand(radius) + 1e-9 ? radius : 0));
}

export type RingLabel = 'BULLSEYE' | 'INNER' | 'OUTER' | 'EDGE' | 'MISS';
/** The label the boards print on a dart: BULLSEYE inside the band, INNER
 *  within a fifth of the radius (2 at 10), OUTER within half (5 at 10), EDGE
 *  anywhere that still scores, MISS at or beyond the radius. */
export function ringLabel(dist: number, radius: number): RingLabel {
  if (dist <= bullseyeBand(radius) + 1e-9) return 'BULLSEYE';
  if (dist <= radius / 5 + 1e-9) return 'INNER';
  if (dist <= radius / 2 + 1e-9) return 'OUTER';
  if (dist < radius) return 'EDGE';
  return 'MISS';
}

/** What a PROJECTION is worth in a spot with this target — the per-pair value
 *  every fill ranks by under the install (spec §8). A projection of nothing
 *  (bye, ruled out, unknown) is a certain miss and ranks last; a spot with no
 *  target is worth the projection itself, so a fill with no card behaves as
 *  it always has. Can go negative: the assignment fills every spot it can and
 *  THEN maximises, so a certain miss still seats rather than leaving a hole. */
export function aimValue(proj: number, target: number | null | undefined, radius: number): number {
  if (target == null || !Number.isFinite(target)) return proj;
  if (!Number.isFinite(proj) || proj <= 0) return CERTAIN_MISS;
  return radius - Math.abs(proj - target);
}
// Finite, so the assignment can still seat him in an otherwise empty spot;
// far below any live projection's value, so he never beats one — a 30 aimed
// at a 5 is also a miss, but he at least showed up.
const CERTAIN_MISS = -1_000_000;

// ── The per-league install (the golf contract) ──────────────────────────────
// The client installs it when a board loads and clears it on exit; the worker
// sets it synchronously before EACH classic matchup's resolve and each
// league's auto-slot, UNCONDITIONALLY (a module global only set when true
// leaves the previous league's card standing over the next one).
let inst: { cfg: BullseyeConfig; card: BullseyeCard } | null = null;

export function setLeagueBullseye(cfg: BullseyeConfig | null | undefined, card: BullseyeCard | null | undefined): void {
  inst = cfg && card ? { cfg, card } : null;
}
export function clearLeagueBullseye(): void { inst = null; }
/** The installed setting + card, null when this league does not play it. */
export function leagueBullseye(): { cfg: BullseyeConfig; card: BullseyeCard } | null { return inst; }
/** The installed target for a spot, undefined when none is installed. */
export function bullseyeTargetFor(slot: string): number | undefined { return inst?.card.targets[slot]; }
export const bullseyeRadius = (): number => inst?.cfg.radius ?? BULLSEYE_RADIUS;

// ── Applying the card to a resolved matchup ─────────────────────────────────
export interface Dart { target: number; dist: number; ring: number }
export interface BullseyeSummary {
  variant: BullseyeVariant; radius: number;
  /** Per side: the lineup's raw points, the number it was aiming at (the
   *  card's sum in both variants), how far off, and the side's ring total. */
  home: Dart & { points: number }; away: Dart & { points: number };
}

/** Re-score a classic result under a card. Slot rows KEEP their raw `score`
 *  (the player's real points — what the row shows) and gain `aim`; the side
 *  totals and the 'wk' state become ring totals. Pure: returns a new result. */
export function applyBullseye(r: ClassicResult, card: BullseyeCard, cfg: BullseyeConfig, slotCount: number): ClassicResult {
  const side = (which: 'home' | 'away'): { rows: ClassicSlotScore[]; dart: Dart & { points: number } } => {
    const mine = r.slots.filter((s) => s.side === which);
    const points = round1(mine.reduce((s, x) => s + x.score, 0));
    if (cfg.variant === 'total') {
      // One dart for the whole lineup, radius scaled to the lineup — rows
      // carry no per-spot aim, because no spot was aiming at anything alone.
      const radius = cfg.radius * Math.max(1, slotCount);
      const ring = ringScore(points, card.total, radius);
      return { rows: mine, dart: { target: card.total, dist: round1(Math.abs(points - card.total)), ring, points } };
    }
    let ring = 0;
    const rows = mine.map((x) => {
      const target = card.targets[x.slot];
      if (target == null) return x;
      const rs = ringScore(x.score, target, cfg.radius);
      ring += rs;
      return { ...x, aim: { target, dist: round1(Math.abs(x.score - target)), ring: rs } };
    });
    return { rows, dart: { target: card.total, dist: round1(Math.abs(points - card.total)), ring: round1(ring), points } };
  };
  const h = side('home'), a = side('away');
  return {
    home: h.dart.ring, away: a.dart.ring,
    slots: [...h.rows, ...a.rows],
    states: r.states.map((s) => ({ ...s, home: h.dart.ring, away: a.dart.ring })),
    bullseye: { variant: cfg.variant, radius: cfg.radius, home: h.dart, away: a.dart },
  };
}

/** Rank a week's teams by ring total — the "weekly ranked" read, shared by
 *  the boards and the week board. Ties keep the input order. */
export function rankByRing<T extends { ring: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.map((r, i) => ({ r, i })).sort((x, y) => y.r.ring - x.r.ring || x.i - y.i);
  let rank = 0, prev: number | null = null;
  return sorted.map(({ r }, i) => {
    if (prev === null || r.ring !== prev) { rank = i + 1; prev = r.ring; }
    return { ...r, rank };
  });
}

// ── The wire's FIT (spec §9 → shipped) ──────────────────────────────────────
/** Where a free agent would land on this week's card: the spot he is
 *  eligible for whose target his projection sits closest to, with the
 *  distance. Null with no projection, no card, or no spot that takes him —
 *  the chip then simply doesn't print. Rows with the same projection fit the
 *  same spot, so the wire reads "who lands on my 5". */
export function bullseyeFit(
  pos: string, proj: number, slots: { slot: string; pos: string[] }[], card: BullseyeCard | null | undefined, radius: number,
): { slot: string; target: number; dist: number; ring: number } | null {
  if (!card || !(proj > 0)) return null;
  let best: { slot: string; target: number; dist: number; ring: number } | null = null;
  for (const d of slots) {
    const target = card.targets[d.slot];
    if (target == null || !slotEligiblePos(d.pos).includes(pos)) continue;
    const dist = Math.round(Math.abs(proj - target) * 10) / 10;
    if (!best || dist < best.dist) best = { slot: d.slot, target, dist, ring: ringScore(proj, target, radius) };
  }
  return best;
}
