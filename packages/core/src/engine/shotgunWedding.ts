// ── SHOTGUN WEDDING: WHICH 2-FOR-2 (v0.653.0) ───────────────────────────────
//
// Founder: "after each weekly matchup early AM Tuesday the CPU creates a fair,
// 4 total player trade from opposing teams." docs/shotgun-wedding.md.
//
// This is the decision half, pure like vampireBite.ts: two active rosters in,
// one 2-for-2 out, no database and no clock. The worker
// (server/src/shotgun.js) values the players and files the answer through
// shotgun_propose (0453).
//
// ── WHAT "FAIR" MEANS ────────────────────────────────────────────────────────
//   • Each player's VALUE is his season points over replacement in the
//     league's own scoring — the trade grader's number (data/tradeGrade), so
//     a wedding the CPU calls fair is one the app's trade grade prints as
//     "Close to even" too. The worker computes it; this file only compares.
//   • A pair is fair when the two sides' totals sit inside the grader's even
//     band, evenBand(a, b): twelve points or twelve per cent of the deal,
//     whichever is wider.
//   • Every player in it is worth something (value > 0). Swapping two bench
//     bodies for two others is a trade nobody notices. Only when a side has
//     fewer than two players over replacement does the plan fall back to raw
//     season points for both sides, so a thin roster still gets married.
//   • It never leaves a team unable to field a spot it could field before —
//     trading away the only quarterback is a forfeit, not a wedding.
//
// ── WHICH FAIR PAIR ──────────────────────────────────────────────────────────
// Among the fair pairs, the weightier ones: the top quarter by total value,
// so a wedding moves players people care about. One is drawn from those with
// a seeded RNG (league · week · matchup), so the same inputs always give the
// same wedding — a re-run of the worker files nothing different — while two
// leagues, or two weeks, don't get the same shape of trade.
import type { ClassicSlotDef, SpotPlayer } from './classic';
import { optimalLineup } from './classic';
import { evenBand } from '../data/tradeGrade';

export interface WeddingPlayer extends SpotPlayer {
  /** Season points over replacement (the trade grader's value). */
  value: number;
  /** Raw season points — the fallback scale for a thin roster. */
  points: number;
}

export interface WeddingPlan {
  homeGives: [string, string];
  awayGives: [string, string];
  /** What each side SENDS, on the scale the plan judged by. */
  homeValue: number;
  awayValue: number;
  /** 'value' (over replacement) or 'points' (the thin-roster fallback). */
  scale: 'value' | 'points';
}

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

const pairsOf = <T,>(xs: T[]): [T, T][] => {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
};

/** How many starting spots a roster can fill. */
function filled(slots: ClassicSlotDef[], roster: SpotPlayer[]): number {
  if (!slots.length) return 0;
  return optimalLineup(slots, roster, () => 1).spots.filter((r) => r.player).length;
}

/**
 * The wedding for one matchup, or null when no fair 2-for-2 exists.
 * `home` and `away` are the two ACTIVE rosters, valued by the worker.
 */
export function weddingPlan(opts: {
  slots: ClassicSlotDef[];
  home: WeddingPlayer[];
  away: WeddingPlayer[];
  seed: string;
}): WeddingPlan | null {
  const { slots, home, away } = opts;
  const tiers: ('value' | 'points')[] = ['value', 'points'];
  for (const scale of tiers) {
    const v = (p: WeddingPlayer) => (scale === 'value' ? p.value : p.points);
    const h = home.filter((p) => v(p) > 0);
    const a = away.filter((p) => v(p) > 0);
    if (h.length < 2 || a.length < 2) continue;
    const hp = pairsOf(h); const ap = pairsOf(a);
    const fair: { hg: [WeddingPlayer, WeddingPlayer]; ag: [WeddingPlayer, WeddingPlayer]; hv: number; av: number }[] = [];
    for (const hg of hp) {
      const hv = v(hg[0]) + v(hg[1]);
      for (const ag of ap) {
        const av = v(ag[0]) + v(ag[1]);
        if (Math.abs(hv - av) <= evenBand(hv, av)) fair.push({ hg, ag, hv, av });
      }
    }
    if (!fair.length) continue;
    // Weightiest first; ties by closeness, then by name, so the order is total.
    const key = (f: (typeof fair)[number]) => f.hg.map((p) => p.id).concat(f.ag.map((p) => p.id)).join('|');
    fair.sort((x, y) => (y.hv + y.av) - (x.hv + x.av)
      || Math.abs(x.hv - x.av) - Math.abs(y.hv - y.av)
      || key(x).localeCompare(key(y)));
    const top = Math.max(1, Math.ceil(fair.length / 4));
    const r = rng(opts.seed);
    const head = fair.slice(0, top);
    for (let i = head.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [head[i], head[j]] = [head[j], head[i]]; }
    const order = head.concat(fair.slice(top));
    const hBase = filled(slots, home); const aBase = filled(slots, away);
    for (const f of order) {
      const hIds = new Set(f.hg.map((p) => p.id)); const aIds = new Set(f.ag.map((p) => p.id));
      const hNext = home.filter((p) => !hIds.has(p.id)).concat(f.ag);
      const aNext = away.filter((p) => !aIds.has(p.id)).concat(f.hg);
      if (filled(slots, hNext) < hBase || filled(slots, aNext) < aBase) continue;
      return {
        homeGives: [f.hg[0].id, f.hg[1].id], awayGives: [f.ag[0].id, f.ag[1].id],
        homeValue: Math.round(f.hv * 10) / 10, awayValue: Math.round(f.av * 10) / 10, scale,
      };
    }
  }
  return null;
}
