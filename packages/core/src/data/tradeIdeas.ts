// SUGGESTED TRADES (v0.720.0). Founder: "Let's get suggested trades in the
// trades chip. Look for team strengths and weaknesses across leagues to
// suggest fair trades that strengthen the player's team while taking players
// from other teams where they can afford to lose them (you have weak WRs and
// strong RBs, so a trade with a team with weak RBs and strong WRs makes
// sense). Or make trades that increase long-term dynasty value if your team
// is not contending with teams who are contenders that would help the other
// team win now."
//
// Three kinds, every one judged on BOTH rosters' best lineups (the board's own
// optimalLineup under the league's scoring), never on a player in isolation:
//
//   • FIT — one for one across positions: you give from a position you're
//     strong at, they give from one they're strong at, and each side's
//     starting lineup gets better. Fair BY CONSTRUCTION: a trade only one
//     side gains from is not suggested, nor one that hands you a clearly
//     better player (FIT_VALUE_RATIO), nor — in dynasty — one that moves much
//     long-term value either way. "Can afford to lose him" falls out
//     of the same arithmetic — a man whose leaving barely dents his team's
//     lineup is the one they can spare.
//   • REBUILD (dynasty, you're out of the race) — you give a player who helps
//     a contender NOW and get back younger dynasty value they aren't starting.
//   • BUY (dynasty, you're in the race) — the mirror: dynasty value you
//     aren't starting for a starter from a team that's out of it.
//
// Pure: the caller installs the league's scoring and hands in `valueOf`.
import { optimalLineup, type ClassicSlotDef, type SpotPlayer } from '../engine/classic';

export type TradeIdeaKind = 'fit' | 'rebuild' | 'buy';
export interface TradeIdeaPlayer { slug: string; name: string; pos: string }
export interface TradeIdea {
  kind: TradeIdeaKind;
  partner: number; partnerName: string;
  give: TradeIdeaPlayer[]; get: TradeIdeaPlayer[];
  /** Points per week each starting lineup changes by. */
  myGain: number; theirGain: number;
  /** Dynasty market value you gain (REBUILD/BUY: negative when you pay it). */
  dynGain: number | null;
  /** One line, in words: why it fits. */
  why: string;
}
export const TRADE_IDEA_LABEL: Record<TradeIdeaKind, string> = { fit: 'FITS BOTH TEAMS', rebuild: 'BUILD FOR LATER', buy: 'WIN NOW' };
export const TRADE_IDEAS_MAX = 3;
/** A FIT must move each lineup by at least this much (points per week). */
export const FIT_MIN_MINE = 1, FIT_MIN_THEIRS = 0.5;
/** REBUILD/BUY: the contender's lineup must gain this much, and the dynasty
 *  side must move at least REBUILD_DYN_MIN and at most half the asset it
 *  costs (a fleece is not a suggestion). */
export const NOW_MIN_GAIN = 1, REBUILD_DYN_MIN = 250;
/** FAIR, NOT A FLEECE: the player you get may project at most this much
 *  above the one you give (×, then + points a week) — a team doesn't hand
 *  over a clearly better player because its lineup also improves. */
export const FIT_VALUE_RATIO = 1.25, FIT_VALUE_SLACK = 1;
/** …and in a dynasty league a FIT moves at most this share of the dearer
 *  player's market value either way (or DYN_FIT_FLOOR): neither side bleeds
 *  long-term value for a lineup fix. */
export const DYN_FIT_SHARE = 0.25, DYN_FIT_FLOOR = 750;

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

export function lineupPoints(slots: ClassicSlotDef[], roster: SpotPlayer[], valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number): number {
  return optimalLineup(slots, roster, valueOf).spots.reduce((n, r) => n + (r.player ? valueOf(r.player, r.def) : 0), 0);
}

/** How strong each team is at each position: what its best lineup seats
 *  there, plus the next man up at half weight (depth counts, less). Rank 1 is
 *  the league's strongest. */
export function positionStrength(slots: ClassicSlotDef[], rosters: Map<number, SpotPlayer[]>, valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number):
  Map<number, Record<string, { pts: number; rank: number }>> {
  const raw = new Map<number, Record<string, number>>();
  for (const [rid, roster] of rosters) {
    const lu = optimalLineup(slots, roster, valueOf);
    const rec: Record<string, number> = {};
    for (const pos of POSITIONS) {
      const seated = lu.spots.filter((s) => s.player?.pos === pos).reduce((n, s) => n + valueOf(s.player!, s.def), 0);
      const next = lu.bench.filter((p) => p.pos === pos).map((p) => valueOf(p)).sort((a, b) => b - a)[0] ?? 0;
      rec[pos] = seated + next / 2;
    }
    raw.set(rid, rec);
  }
  const out = new Map<number, Record<string, { pts: number; rank: number }>>();
  for (const rid of raw.keys()) out.set(rid, {});
  for (const pos of POSITIONS) {
    const order = [...raw.entries()].sort((a, b) => b[1][pos] - a[1][pos]);
    order.forEach(([rid, rec], i) => { out.get(rid)![pos] = { pts: rec[pos], rank: i + 1 }; });
  }
  return out;
}

/** Contending: the top half of the table by wins, then points for. */
export function contenders(standings: { roster_id: number; wins: number; losses: number; ties?: number; pf: number }[]): Set<number> {
  const order = standings.slice().sort((a, b) => (b.wins + (b.ties ?? 0) / 2) - (a.wins + (a.ties ?? 0) / 2) || b.pf - a.pf);
  return new Set(order.slice(0, Math.ceil(order.length / 2)).map((s) => s.roster_id));
}

export function tradeIdeasOf(input: {
  slots: ClassicSlotDef[];
  /** Every seat's ACTIVE players (taxi/IR/out don't trade here). */
  rosters: Map<number, SpotPlayer[]>;
  me: number;
  /** Season value per week under the league's scoring (0 for IR). */
  valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number;
  names: (slug: string) => string;
  teamName: (rosterId: number) => string;
  standings?: { roster_id: number; wins: number; losses: number; ties?: number; pf: number }[];
  /** Dynasty league: its market (league format). Absent → FIT only. */
  dyn?: Record<string, number> | null;
  /** Players their owners won't move (a commissioner's no-trade flag). */
  locked?: (slug: string) => boolean;
  max?: number;
}): TradeIdea[] {
  const { slots, rosters, me, valueOf } = input;
  const mine = rosters.get(me);
  if (!mine?.length || rosters.size < 2) return [];
  const free = (p: SpotPlayer) => !input.locked?.(p.id);
  const strength = positionStrength(slots, rosters, valueOf);
  const n = rosters.size;
  const myS = strength.get(me)!;
  const base = new Map<number, number>();
  for (const [rid, r] of rosters) base.set(rid, lineupPoints(slots, r, valueOf));
  const swapGain = (rid: number, out: SpotPlayer, inn: SpotPlayer) =>
    lineupPoints(slots, rosters.get(rid)!.filter((p) => p.id !== out.id).concat(inn), valueOf) - base.get(rid)!;
  const tp = (p: SpotPlayer): TradeIdeaPlayer => ({ slug: p.id, name: input.names(p.id), pos: p.pos });
  const ideas: TradeIdea[] = [];

  // ── FIT: strong-for-weak, both lineups better ──
  for (const [rid, theirs] of rosters) {
    if (rid === me) continue;
    const thS = strength.get(rid)!;
    let best: TradeIdea | null = null;
    for (const g of mine) {
      if (!free(g) || !(POSITIONS as readonly string[]).includes(g.pos)) continue;
      for (const r of theirs) {
        if (!free(r) || r.pos === g.pos || !(POSITIONS as readonly string[]).includes(r.pos)) continue;
        // My surplus is their need, and theirs is mine.
        if (!(myS[g.pos].rank < thS[g.pos].rank && thS[r.pos].rank < myS[r.pos].rank)) continue;
        if (valueOf(r) > valueOf(g) * FIT_VALUE_RATIO + FIT_VALUE_SLACK) continue;
        if (input.dyn) {
          const a = Number(input.dyn[g.id]) || 0, b = Number(input.dyn[r.id]) || 0;
          if (Math.abs(b - a) > Math.max(DYN_FIT_FLOOR, Math.max(a, b) * DYN_FIT_SHARE)) continue;
        }
        const myGain = swapGain(me, g, r);
        if (myGain < FIT_MIN_MINE) continue;
        const theirGain = swapGain(rid, r, g);
        if (theirGain < FIT_MIN_THEIRS) continue;
        const score = Math.min(myGain, theirGain * 2) + myGain / 4;
        if (best && score <= (best as TradeIdea & { score: number }).score) continue;
        best = Object.assign({
          kind: 'fit' as const, partner: rid, partnerName: input.teamName(rid), give: [tp(g)], get: [tp(r)],
          myGain: r1(myGain), theirGain: r1(theirGain), dynGain: input.dyn ? (input.dyn[r.id] ?? 0) - (input.dyn[g.id] ?? 0) : null,
          why: `Your ${r.pos} ${ordinal(myS[r.pos].rank)}, ${g.pos} ${ordinal(myS[g.pos].rank)} of ${n} · theirs ${r.pos} ${ordinal(thS[r.pos].rank)}, ${g.pos} ${ordinal(thS[g.pos].rank)}`,
        }, { score });
      }
    }
    if (best) ideas.push(best);
  }

  // ── REBUILD / BUY (dynasty): now for later, with whoever is on the other clock ──
  const dyn = input.dyn && Object.keys(input.dyn).length ? input.dyn : null;
  if (dyn && input.standings?.length) {
    const inRace = contenders(input.standings);
    const iContend = inRace.has(me);
    const dv = (p: SpotPlayer) => Number(dyn[p.id]) || 0;
    const myStarters = new Set(optimalLineup(slots, mine, valueOf).spots.flatMap((s) => (s.player ? [s.player.id] : [])));
    for (const [rid, theirs] of rosters) {
      if (rid === me || inRace.has(rid) === iContend) continue;   // the other clock only
      const theirStarters = new Set(optimalLineup(slots, theirs, valueOf).spots.flatMap((s) => (s.player ? [s.player.id] : [])));
      let best: (TradeIdea & { score: number }) | null = null;
      for (const g of mine) {
        if (!free(g)) continue;
        for (const r of theirs) {
          if (!free(r)) continue;
          if (!iContend) {
            // REBUILD: my starter → their lineup; their unstarted future → me.
            if (!myStarters.has(g.id) || theirStarters.has(r.id)) continue;
            const gain = dv(r) - dv(g);
            if (gain < REBUILD_DYN_MIN || gain > Math.max(REBUILD_DYN_MIN * 2, dv(g) / 2)) continue;
            const theirGain = swapGain(rid, r, g);
            if (theirGain < NOW_MIN_GAIN) continue;
            const score = gain / 500 + theirGain;
            if (best && score <= best.score) continue;
            best = { kind: 'rebuild', partner: rid, partnerName: input.teamName(rid), give: [tp(g)], get: [tp(r)],
              myGain: r1(swapGain(me, g, r)), theirGain: r1(theirGain), dynGain: gain,
              why: `They're contending and he starts for them · you add ${Math.round(gain)} dynasty value`, score };
          } else {
            // BUY: my unstarted future → them; their starter → my lineup.
            if (myStarters.has(g.id) || !theirStarters.has(r.id)) continue;
            const cost = dv(g) - dv(r);
            if (cost < REBUILD_DYN_MIN || cost > Math.max(REBUILD_DYN_MIN * 2, dv(g) / 2)) continue;
            const myGain = swapGain(me, g, r);
            if (myGain < NOW_MIN_GAIN) continue;
            const score = myGain - cost / 1000;
            if (best && score <= best.score) continue;
            best = { kind: 'buy', partner: rid, partnerName: input.teamName(rid), give: [tp(g)], get: [tp(r)],
              myGain: r1(myGain), theirGain: r1(swapGain(rid, r, g)), dynGain: -cost,
              why: `They're out of the race · they add ${Math.round(cost)} dynasty value`, score };
          }
        }
      }
      if (best) ideas.push(best);
    }
  }

  // Each kind by what it is for: a FIT or a BUY by your lineup's gain, a
  // REBUILD by the dynasty value it adds (500 ≈ a point a week).
  const key = (t: TradeIdea) => (t.kind === 'rebuild' ? (t.dynGain ?? 0) / 500 : t.myGain);
  return ideas
    .sort((a, b) => key(b) - key(a))
    .slice(0, input.max ?? TRADE_IDEAS_MAX)
    .map(({ score: _s, ...x }: TradeIdea & { score?: number }) => x);
}
