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
import { flagRulesFor } from '../data/commish';

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

// ── Commissioner-editable scoring (0160) ────────────────────────────────────
// Every number the classic scorer uses, as a league setting. Defaults are the
// standard everybody means by "normal fantasy"; the commissioner's overrides
// live in settings_json.scoring_classic (sanitized + clamped in SQL, same
// camelCase keys), and BOTH resolvers normalize through this one object.
// `ppr` still rides settings_json.ppr (the dedicated RECEPTIONS control);
// normalizeClassicScoring folds it in.
export interface ClassicScoring {
  passYd: number; passTd: number; int: number;
  rushYd: number; rushTd: number;
  recYd: number; recTd: number; ppr: number;
  fumble: number; retTd: number;
  fg0: number; fg40: number; fg50: number; fgMiss: number; xp: number; xpMiss: number;
  sack: number; dstInt: number; fumRec: number; dstTd: number; safety: number;
}
export const DEFAULT_CLASSIC_SCORING: ClassicScoring = {
  passYd: 0.04, passTd: 4, int: -2,
  rushYd: 0.1, rushTd: 6,
  recYd: 0.1, recTd: 6, ppr: 1,
  fumble: -2, retTd: 6,
  fg0: 3, fg40: 4, fg50: 5, fgMiss: -1, xp: 1, xpMiss: -1,
  sack: 1, dstInt: 2, fumRec: 2, dstTd: 6, safety: 2,
};
/** Editor metadata, in display order — one row per knob on both hosts. */
export const CLASSIC_SCORING_FIELDS: { key: keyof ClassicScoring; label: string; perYard?: boolean }[] = [
  { key: 'passYd', label: 'PASS YD', perYard: true }, { key: 'passTd', label: 'PASS TD' }, { key: 'int', label: 'INT' },
  { key: 'rushYd', label: 'RUSH YD', perYard: true }, { key: 'rushTd', label: 'RUSH TD' },
  { key: 'recYd', label: 'REC YD', perYard: true }, { key: 'recTd', label: 'REC TD' },
  { key: 'fumble', label: 'FUMBLE' }, { key: 'retTd', label: 'RETURN TD' },
  { key: 'fg0', label: 'FG <40' }, { key: 'fg40', label: 'FG 40-49' }, { key: 'fg50', label: 'FG 50+' },
  { key: 'fgMiss', label: 'FG MISS' }, { key: 'xp', label: 'XP' }, { key: 'xpMiss', label: 'XP MISS' },
  { key: 'sack', label: 'SACK' }, { key: 'dstInt', label: 'DST INT' }, { key: 'fumRec', label: 'FUM REC' },
  { key: 'dstTd', label: 'DST TD' }, { key: 'safety', label: 'SAFETY' },
];

/** Accepts the legacy bare-PPR shorthand, a partial override object, or
 *  nothing — always answers with the full scoring table. */
export function normalizeClassicScoring(x?: number | Partial<ClassicScoring> | null): ClassicScoring {
  if (typeof x === 'number') return { ...DEFAULT_CLASSIC_SCORING, ppr: x };
  const out = { ...DEFAULT_CLASSIC_SCORING };
  for (const f of CLASSIC_SCORING_FIELDS) {
    const v = Number((x as Partial<ClassicScoring> | null | undefined)?.[f.key]);
    if (Number.isFinite(v)) out[f.key] = v;
  }
  const p = Number((x as Partial<ClassicScoring> | null | undefined)?.ppr);
  if (Number.isFinite(p)) out.ppr = p;
  return out;
}

/** One play's classic points. Positions outside the classic lineup (IDP) score
 *  their flat box line so a stray roster spot never silently zeroes. */
export function classicScorePlay(play: RawPlay, pos: Pos, sc: ClassicScoring): number {
  if (pos === 'K') {
    if (play.kind === 'fg') return play.yards < 40 ? sc.fg0 : play.yards < 50 ? sc.fg40 : sc.fg50;
    if (play.kind === 'fgmiss') return sc.fgMiss;
    if (play.kind === 'xp') return sc.xp;
    if (play.kind === 'xpmiss') return sc.xpMiss;
    return 0;
  }
  if (pos === 'DEF') {
    if (play.kind === 'sack') return sc.sack;
    if (play.kind === 'int') return sc.dstInt;
    if (play.kind === 'fumrec') return sc.fumRec;
    if (play.kind === 'dst_td') return sc.dstTd;
    if (play.kind === 'safety') return sc.safety;
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
  if (play.kind === 'pass') pts += play.yards * sc.passYd + (play.td ? sc.passTd : 0);
  if (play.kind === 'rush') pts += play.yards * sc.rushYd + (play.td ? sc.rushTd : 0);
  if (play.catch) pts += sc.ppr + play.yards * sc.recYd + (play.td ? sc.recTd : 0);
  if (play.kind === 'return' && play.td) pts += sc.retTd;
  if (play.turnover) pts += play.kind === 'pass' ? sc.int : sc.fumble; // INT thrown vs fumble lost
  return pts;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A player's classic week total off the live/baked play stream. The
 *  commissioner's flag rules (0144) apply here exactly as in drip: bonus_mult
 *  scales the play points, bonus_pts lands flat on the final. Requires the
 *  flag cache installed (setLeagueFlags) — both resolvers and both boards
 *  already maintain it. */
export function classicPoints(player: Player, week: number, sc?: number | Partial<ClassicScoring>): number {
  const s = normalizeClassicScoring(sc);
  const { plays } = playsForPlayer(player, week);
  const raw = plays.reduce((sum, p) => sum + classicScorePlay(p, player.pos, s), 0);
  const fr = flagRulesFor(player.id);
  return round1(raw * (fr.bonusMult ?? 1) + (fr.bonusPts ?? 0));
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
export function bestballFill(manual: ClassicPick[], bestball: string[], roster: Player[], week: number, sc?: number | Partial<ClassicScoring>): ClassicPick[] {
  const bb = new Set(bestball);
  if (!bb.size) return [];
  const started = new Set(manual.filter((p) => !bb.has(p.slot)).map((p) => p.player.id));
  // A no_start flag (0144) binds the auto-fill too: the DB trigger only guards
  // manual writes, so the exclusion has to live here — same reasoning as the
  // drip auto-lineup's noStart set.
  const cands = roster.filter((p) => !started.has(p.id) && !flagRulesFor(p.id).noStart);
  const score = new Map(cands.map((p) => [p.id, classicPoints(p, week, sc)]));
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
export function classicLineup(s: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>): ClassicPick[] {
  const bb = new Set(s.bestball ?? []);
  const manual = s.picks.filter((p) => !bb.has(p.slot));
  return [...manual, ...bestballFill(manual, s.bestball ?? [], s.roster ?? [], week, sc)];
}

/** Resolve one classic matchup: each starter's standard points, summed —
 *  nothing else. Slot order follows CLASSIC_SLOTS so both boards render the
 *  lineup in the shape everyone expects. */
export function resolveClassicMatchup(home: ClassicSide, away: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>): ClassicResult {
  const scoring = normalizeClassicScoring(sc);
  const order = new Map(CLASSIC_SLOTS.map((s, i) => [s.slot, i]));
  const side = (s: ClassicSide, which: 'home' | 'away') => {
    const rows = classicLineup(s, week, scoring)
      .sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99))
      .map((p) => ({
        win: CLASSIC_WIN, side: which, slot: p.slot, slug: p.player.id, metric: null as null,
        score: classicPoints(p.player, week, scoring),
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
