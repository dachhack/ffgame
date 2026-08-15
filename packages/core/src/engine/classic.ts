// CLASSIC (normie) mode — traditional fantasy, played on Drip's live spine.
//
// A classic league (settings_json.game_mode, migration 0157) fields ONE weekly
// lineup — the nine slots every fantasy player already knows — and every
// starter scores STANDARD fantasy points across all their stats, live, play by
// play. No metrics, no drips, no window bonuses, no power-ups: the founder's
// "normie" setting for leagues that want fantasy exactly as they know it,
// still resolved in real time off the same play stream the drip game runs on.
//
// Storage: sealed_pick rows under the pseudo-window 'wk', roster_slot = the
// slot name below. The worker seals 'wk' at the week's first kickoff (the
// classic weekly lock; lock.js) and resolves through resolveClassicMatchup.
//
// Scoring (the standard everybody means by "normal"):
//   pass 0.04/yd, 4/TD, −2/INT · rush+rec 0.1/yd, 6/TD, −2 fumble lost
//   receptions ×PPR (league knob settings_json.ppr: 0 | 0.5 | 1; default 1)
//   K: FG 3 (<40) / 4 (40s) / 5 (50+), −1 miss · XP 1, −1 miss
//   DST: sack 1 · INT 2 · fumble rec 2 · TD 6 · safety 2 (no points-allowed
//   bracket — our stream is plays, not final scores; documented, not hidden)
import type { Player, Pos } from '../types';
import { playsForPlayer, type RawPlay } from './sim';

export interface ClassicSlotDef { slot: string; pos: Pos[] }
export const CLASSIC_SLOTS: ClassicSlotDef[] = [
  { slot: 'QB', pos: ['QB'] },
  { slot: 'RB1', pos: ['RB'] },
  { slot: 'RB2', pos: ['RB'] },
  { slot: 'WR1', pos: ['WR'] },
  { slot: 'WR2', pos: ['WR'] },
  { slot: 'TE', pos: ['TE'] },
  { slot: 'FLEX', pos: ['RB', 'WR', 'TE'] },
  { slot: 'K', pos: ['K'] },
  { slot: 'DEF', pos: ['DEF'] },
];
export const CLASSIC_WIN = 'wk';

/** One play's classic points. Positions outside the classic lineup (IDP) score
 *  their flat box line so a stray roster spot never silently zeroes. */
export function classicScorePlay(play: RawPlay, pos: Pos, ppr: number): number {
  if (pos === 'K') {
    if (play.kind === 'fg') return play.yards < 40 ? 3 : play.yards < 50 ? 4 : 5;
    if (play.kind === 'fgmiss') return -1;
    if (play.kind === 'xp') return 1;
    if (play.kind === 'xpmiss') return -1;
    return 0;
  }
  if (pos === 'DEF') {
    if (play.kind === 'sack') return 1;
    if (play.kind === 'int') return 2;
    if (play.kind === 'fumrec') return 2;
    if (play.kind === 'dst_td') return 6;
    if (play.kind === 'safety') return 2;
    return 0;
  }
  if (pos === 'DL' || pos === 'LB' || pos === 'DB') {
    if (play.kind === 'tackle') return 1;
    if (play.kind === 'sack') return 2;
    if (play.kind === 'int') return 3;
    if (play.kind === 'fumrec') return 2;
    if (play.kind === 'dst_td') return 6;
    if (play.kind === 'safety') return 2;
    return 0;
  }
  // Skill positions: every stat counts, all at once — the whole point of classic.
  let pts = 0;
  if (play.kind === 'pass') pts += play.yards * 0.04 + (play.td ? 4 : 0);
  if (play.kind === 'rush') pts += play.yards * 0.1 + (play.td ? 6 : 0);
  if (play.catch) pts += ppr + play.yards * 0.1 + (play.td ? 6 : 0);
  if (play.kind === 'return' && play.td) pts += 6;
  if (play.turnover) pts -= 2; // INT thrown or fumble lost
  return pts;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A player's classic week total off the live/baked play stream. */
export function classicPoints(player: Player, week: number, ppr = 1): number {
  const { plays } = playsForPlayer(player, week);
  return round1(plays.reduce((s, p) => s + classicScorePlay(p, player.pos, ppr), 0));
}

export interface ClassicPick { slot: string; player: Player }
export interface ClassicSlotScore { win: string; side: 'home' | 'away'; slot: string; slug: string; metric: null; score: number }
export interface ClassicResult {
  home: number; away: number;
  slots: ClassicSlotScore[];
  states: { window: string; home: number; away: number }[];
}

/** BEST BALL (0159): fill the flagged slots with the highest-scoring eligible
 *  roster players NOT manually started — the founder's rule verbatim. Any
 *  stored pick in a best-ball slot is ignored (the slot fills itself), and a
 *  best-ball slot never blocks a manual pick: the manual set is what reserves
 *  players. Dedicated slots fill before FLEX so the superset slot chases the
 *  leftovers — greedy is optimal here because FLEX's eligibility contains
 *  every other skill slot's. Ties break toward roster order (stable). */
export function bestballFill(manual: ClassicPick[], bestball: string[], roster: Player[], week: number, ppr = 1): ClassicPick[] {
  const bb = new Set(bestball);
  if (!bb.size) return [];
  const started = new Set(manual.filter((p) => !bb.has(p.slot)).map((p) => p.player.id));
  const cands = roster.filter((p) => !started.has(p.id));
  const score = new Map(cands.map((p) => [p.id, classicPoints(p, week, ppr)]));
  const order = [...CLASSIC_SLOTS.filter((d) => d.slot !== 'FLEX'), ...CLASSIC_SLOTS.filter((d) => d.slot === 'FLEX')];
  const used = new Set<string>();
  const fills: ClassicPick[] = [];
  for (const d of order) {
    if (!bb.has(d.slot)) continue;
    let best: Player | null = null;
    for (const c of cands) {
      if (used.has(c.id) || !d.pos.includes(c.pos)) continue;
      if (!best || (score.get(c.id) ?? 0) > (score.get(best.id) ?? 0)) best = c;
    }
    if (best) { used.add(best.id); fills.push({ slot: d.slot, player: best }); }
  }
  return fills;
}

/** One side of a classic matchup. `bestball` + `roster` drive the auto-fill;
 *  without them the side is fully manual (the 0157 behavior, unchanged). */
export interface ClassicSide { picks: ClassicPick[]; roster?: Player[]; bestball?: string[] }

/** A side's EFFECTIVE lineup: manual picks (best-ball slots' stored rows
 *  ignored) + the best-ball fills. Exported so the boards can render exactly
 *  what the resolver scores. */
export function classicLineup(s: ClassicSide, week: number, ppr = 1): ClassicPick[] {
  const bb = new Set(s.bestball ?? []);
  const manual = s.picks.filter((p) => !bb.has(p.slot));
  return [...manual, ...bestballFill(manual, s.bestball ?? [], s.roster ?? [], week, ppr)];
}

/** Resolve one classic matchup: each starter's standard points, summed —
 *  nothing else. Slot order follows CLASSIC_SLOTS so both boards render the
 *  lineup in the shape everyone expects. */
export function resolveClassicMatchup(home: ClassicSide, away: ClassicSide, week: number, ppr = 1): ClassicResult {
  const order = new Map(CLASSIC_SLOTS.map((s, i) => [s.slot, i]));
  const side = (s: ClassicSide, which: 'home' | 'away') => {
    const rows = classicLineup(s, week, ppr)
      .sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99))
      .map((p) => ({
        win: CLASSIC_WIN, side: which, slot: p.slot, slug: p.player.id, metric: null as null,
        score: classicPoints(p.player, week, ppr),
      }));
    return { rows, total: round1(rows.reduce((s2, r) => s2 + r.score, 0)) };
  };
  const h = side(home, 'home'), a = side(away, 'away');
  return {
    home: h.total, away: a.total,
    slots: [...h.rows, ...a.rows],
    states: [{ window: CLASSIC_WIN, home: h.total, away: a.total }],
  };
}
