// ── SHOTGUN WEDDING: WHICH 2-FOR-2 (v0.653.0, rebuilt v0.654.1) ─────────────
//
// Founder: "after each weekly matchup early AM Tuesday the CPU creates a fair,
// 4 total player trade from opposing teams." docs/shotgun-wedding.md §2.
//
// This is the decision half, pure like vampireBite.ts: two active rosters in,
// one 2-for-2 out, no database and no clock. The worker
// (server/src/shotgun.js) values the players and files the answer through
// shotgun_propose (0453).
//
// ── WHY IT WAS REBUILT ───────────────────────────────────────────────────────
// v0.653.0 matched the two sides' TOTALS of value over replacement. The first
// preview on a real league (founder: "Those are really bad trades") showed
// what that lets through: CeeDee Lamb plus a throw-in for two mid-tier
// players (a star-for-depth consolidation that only balances on paper), two
// starting quarterbacks for a tight end and a running back (a 1-QB, 8-team
// league prices quarterbacks near zero over replacement), and each team's
// best players dragged in because the draw favoured the weightiest deals.
//
// ── THE RULES NOW ────────────────────────────────────────────────────────────
//   1. LIKE FOR LIKE. Both sides send the same positions (RB+WR for RB+WR),
//      and each player is paired with one of his own position on the other
//      side. Skill positions only (RB, WR, TE); a quarterback only when both
//      teams roster a spare one; never a kicker or a defense.
//   2. FAIR PLAYER BY PLAYER. Each pair is within PAIR_PPG points per game
//      (one, widened to WIDE_PPG only when nothing fits at one). Totals can't
//      hide a star behind a throw-in when every pair has to match.
//   3. NOT THE STARS. Each team's top two players by points per game are off
//      the table.
//   4. STARTER-LEVEL ONLY. A player must start for his team, or sit within a
//      point a game of its weakest skill starter. Nobody is handed two
//      benchwarmers, and nobody's bench filler is the price.
//   5. BOTH LINEUPS HOLD. Neither team's best starting lineup may lose more
//      than LINEUP_PPG a week, nor go from fielding a spot to not.
//   6. HEALTHY. Nobody ruled out (IR, out, PUP, suspended) is forced to move.
//
// Among what passes, the closest matches win; one of the closest few is drawn
// with a seeded RNG (league · week · matchup), so a re-run files the same
// wedding and two weeks don't repeat the same shape. No pass → no wedding:
// an empty week beats a bad trade.
import type { ClassicSlotDef, SpotPlayer } from './classic';
import { optimalLineup } from './classic';

export interface WeddingPlayer extends SpotPlayer {
  /** Projected points per game in the league's scoring (0 when unknown). */
  ppg: number;
  /** Rest-of-season points: ppg × games left (null when games left is unknown). */
  ros?: number | null;
  /** Ruled out (IR, out, PUP, suspended): never forced to move. */
  out?: boolean;
}

export interface WeddingPlan {
  homeGives: [string, string];
  awayGives: [string, string];
  /** Points per game each side sends. */
  homePpg: number;
  awayPpg: number;
  /** The widest gap between two paired players, in points per game. */
  worstPair: number;
  /** The pair band the plan was found at. */
  band: number;
}

export const PAIR_PPG = 1;
export const WIDE_PPG = 1.5;
export const LINEUP_PPG = 1;
const STARS = 2;
const SKILL = new Set(['RB', 'WR', 'TE']);

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

/** The best lineup a roster can field: points a game and spots filled. */
function lineup(slots: ClassicSlotDef[], roster: WeddingPlayer[]): { ppg: number; filled: number } {
  if (!slots.length) return { ppg: 0, filled: 0 };
  const spots = optimalLineup(slots, roster, (p) => p.ppg).spots;
  return { ppg: spots.reduce((n, r) => n + (r.player ? r.player.ppg : 0), 0), filled: spots.filter((r) => r.player).length };
}

/** Who on this roster may be married off (rules 1, 3, 4, 6). */
export function weddingCandidates(slots: ClassicSlotDef[], roster: WeddingPlayer[], qbOk: boolean): WeddingPlayer[] {
  const healthy = roster.filter((p) => !p.out && p.ppg > 0);
  const stars = new Set([...healthy].sort((a, b) => b.ppg - a.ppg || a.id.localeCompare(b.id)).slice(0, STARS).map((p) => p.id));
  const starters = slots.length ? optimalLineup(slots, roster, (p) => (p.out ? 0 : p.ppg)).spots.map((r) => r.player).filter(Boolean) as WeddingPlayer[] : [];
  const skillStarters = starters.filter((p) => SKILL.has(p.pos));
  const floor = skillStarters.length ? Math.min(...skillStarters.map((p) => p.ppg)) - 1 : 0;
  const startIds = new Set(starters.map((p) => p.id));
  return healthy.filter((p) => !stars.has(p.id)
    && (SKILL.has(p.pos) || (p.pos === 'QB' && qbOk))
    && (startIds.has(p.id) || p.ppg >= floor));
}

/** Pair two same-shape sides player to player, best with best. */
function matchPairs(h: [WeddingPlayer, WeddingPlayer], a: [WeddingPlayer, WeddingPlayer]): number | null {
  const key = (xs: WeddingPlayer[]) => xs.map((p) => p.pos).sort().join('+');
  if (key(h) !== key(a)) return null;
  const hs = [...h].sort((x, y) => x.pos.localeCompare(y.pos) || y.ppg - x.ppg);
  const as = [...a].sort((x, y) => x.pos.localeCompare(y.pos) || y.ppg - x.ppg);
  return Math.max(Math.abs(hs[0].ppg - as[0].ppg), Math.abs(hs[1].ppg - as[1].ppg));
}

/**
 * The wedding for one matchup, or null when no trade passes every rule.
 * `home` and `away` are the two ACTIVE rosters, valued by the worker.
 */
export function weddingPlan(opts: {
  slots: ClassicSlotDef[];
  home: WeddingPlayer[];
  away: WeddingPlayer[];
  seed: string;
}): WeddingPlan | null {
  const { slots, home, away } = opts;
  const qbs = (r: WeddingPlayer[]) => r.filter((p) => p.pos === 'QB' && !p.out && p.ppg > 0).length;
  const qbOk = qbs(home) >= 2 && qbs(away) >= 2;
  const hc = weddingCandidates(slots, home, qbOk);
  const ac = weddingCandidates(slots, away, qbOk);
  if (hc.length < 2 || ac.length < 2) return null;
  const hBase = lineup(slots, home); const aBase = lineup(slots, away);

  for (const band of [PAIR_PPG, WIDE_PPG]) {
    const fits: { hg: [WeddingPlayer, WeddingPlayer]; ag: [WeddingPlayer, WeddingPlayer]; gap: number; sum: number; key: string }[] = [];
    for (const hg of pairsOf(hc)) {
      for (const ag of pairsOf(ac)) {
        const gap = matchPairs(hg, ag);
        if (gap == null || gap > band) continue;
        const hIds = new Set(hg.map((p) => p.id)); const aIds = new Set(ag.map((p) => p.id));
        const hNext = lineup(slots, home.filter((p) => !hIds.has(p.id)).concat(ag));
        const aNext = lineup(slots, away.filter((p) => !aIds.has(p.id)).concat(hg));
        if (hNext.filled < hBase.filled || aNext.filled < aBase.filled) continue;
        if (hBase.ppg - hNext.ppg > LINEUP_PPG || aBase.ppg - aNext.ppg > LINEUP_PPG) continue;
        fits.push({ hg, ag, gap, sum: hg[0].ppg + hg[1].ppg + ag[0].ppg + ag[1].ppg,
          key: [...hg, ...ag].map((p) => p.id).join('|') });
      }
    }
    if (!fits.length) continue;
    // Closest first; among equals the weightier, then by name for a total order.
    fits.sort((x, y) => x.gap - y.gap || y.sum - x.sum || x.key.localeCompare(y.key));
    const head = fits.slice(0, Math.min(4, fits.length));
    const f = head[Math.floor(rng(opts.seed)() * head.length)];
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      homeGives: [f.hg[0].id, f.hg[1].id], awayGives: [f.ag[0].id, f.ag[1].id],
      homePpg: r1(f.hg[0].ppg + f.hg[1].ppg), awayPpg: r1(f.ag[0].ppg + f.ag[1].ppg),
      worstPair: r1(f.gap), band,
    };
  }
  return null;
}
