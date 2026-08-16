// CLASSIC (normie) mode — traditional fantasy, played on Drip's live spine.
//
// A classic league (settings_json.game_mode, migration 0157) fields ONE weekly
// lineup and every starter scores standard fantasy points across all their
// stats, live, play by play. No metrics, no drips, no window bonuses, no
// power-ups: the founder's "normie" setting for leagues that want fantasy
// exactly as they know it, still resolved in real time off the same play
// stream the drip game runs on.
//
// Storage: sealed_pick rows under the pseudo-window 'wk', roster_slot = a
// generated slot name below. The worker seals 'wk' at the week's first
// kickoff (the classic weekly lock; lock.js) and resolves through
// resolveClassicMatchup.
//
// Since 0161 both halves are fully commissioner-shaped:
//   • the STARTING LINEUP is any combination of slot types
//     (settings_json.roster_classic, counts per type, frozen at draft);
//   • the SCORING is the full Sleeper/ESPN-style catalog
//     (settings_json.scoring_classic — ~36 knobs incl. the 5-bracket FG
//     ladder, return yards, TE premium, IDP line, and 300/400-yard passing +
//     100/200-yard rushing/receiving bonuses).
// This module owns every default; SQL stores sanitized overrides only.
import type { Player, Pos } from '../types';
import { playsForPlayer, type RawPlay } from './sim';
import { flagRulesFor } from '../data/commish';

export const CLASSIC_WIN = 'wk';

// ── The starting lineup (0161): slot types → generated slots ────────────────
// A lineup is COUNTS per slot type. Names generate as TYPE or TYPE+index
// (RB1, RB2 …) — with the default config this reproduces the original nine
// names exactly, so pre-0161 leagues' saved rows keep meaning what they meant.
export interface ClassicSlotDef { slot: string; type: string; pos: Pos[] }
export type ClassicRoster = Record<string, number>;

export const CLASSIC_SLOT_TYPES: { type: string; label: string; pos: Pos[] }[] = [
  { type: 'QB', label: 'QB', pos: ['QB'] },
  { type: 'RB', label: 'RB', pos: ['RB'] },
  { type: 'WR', label: 'WR', pos: ['WR'] },
  { type: 'TE', label: 'TE', pos: ['TE'] },
  { type: 'FLEX', label: 'FLEX (RB/WR/TE)', pos: ['RB', 'WR', 'TE'] },
  { type: 'SFLX', label: 'SUPERFLEX (QB/RB/WR/TE)', pos: ['QB', 'RB', 'WR', 'TE'] },
  { type: 'WRT', label: 'REC FLEX (WR/TE)', pos: ['WR', 'TE'] },
  { type: 'K', label: 'K', pos: ['K'] },
  { type: 'DEF', label: 'D/ST', pos: ['DEF'] },
  { type: 'DL', label: 'DL', pos: ['DL'] },
  { type: 'LB', label: 'LB', pos: ['LB'] },
  { type: 'DB', label: 'DB', pos: ['DB'] },
  { type: 'IDP', label: 'IDP FLEX (DL/LB/DB)', pos: ['DL', 'LB', 'DB'] },
];

export const DEFAULT_CLASSIC_ROSTER: ClassicRoster = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
export const CLASSIC_ROSTER_MAX = 20; // starters cap, mirrored by SQL's sanitize + the slot-cap trigger

/** The league's generated slot list, in catalog order. */
// ── The roster POSITION BUILDER (0163, founder's sketch) ────────────────────
// A builder league stores an ORDERED list of starting spots, each with its OWN
// eligible-position set (any combination) and best-ball flag — superseding the
// counts-per-type model and the separate best-ball name array. Slot names are
// positional (S1..Sn): the list is draft-frozen, so names never shift under
// stored rows.
export interface SlotSpec { pos: string[]; bb?: boolean }

export function classicSlotsFromSpec(spec?: SlotSpec[] | null): ClassicSlotDef[] | null {
  if (!Array.isArray(spec) || !spec.length) return null;
  return spec.slice(0, CLASSIC_ROSTER_MAX).map((s, i) => {
    const pos = [...new Set((s.pos ?? []).map((p) => String(p).toUpperCase()))] as Pos[];
    // A spot whose eligibility matches a catalog type keeps that type's label.
    const known = CLASSIC_SLOT_TYPES.find((t) => t.pos.length === pos.length && t.pos.every((p) => pos.includes(p)));
    return { slot: `S${i + 1}`, type: known?.type ?? pos.join('/'), pos };
  });
}

/** One resolver for "what are this league's slots": builder spec wins, then
 *  the 0161 counts, then the default nine. */
export function leagueSlotDefs(mode?: { roster?: ClassicRoster | null; slots?: SlotSpec[] | null } | null): ClassicSlotDef[] {
  return classicSlotsFromSpec(mode?.slots) ?? classicSlots(mode?.roster);
}

/** The league's best-ball slot names: per-spot flags for a builder league,
 *  else the 0159 name array. */
export function leagueBestball(mode?: { bestball?: string[] | null; slots?: SlotSpec[] | null } | null): string[] {
  const fromSpec = (mode?.slots ?? []).flatMap((s, i) => (s?.bb ? [`S${i + 1}`] : []));
  if (Array.isArray(mode?.slots) && mode.slots.length) return fromSpec; // builder league: spec is authoritative (even all-off)
  return mode?.bestball ?? [];
}

/** Display label for a spot's eligibility ("FLEX (RB/WR/TE)" or "QB/RB/K"). */
export function slotSpecLabel(pos: string[]): string {
  const up = pos.map((p) => p.toUpperCase());
  const known = CLASSIC_SLOT_TYPES.find((t) => t.pos.length === up.length && t.pos.every((p) => up.includes(p as Pos)));
  return known ? known.label : up.join('/');
}

export function classicSlots(roster?: ClassicRoster | null): ClassicSlotDef[] {
  const cfg = roster && Object.keys(roster).length ? roster : DEFAULT_CLASSIC_ROSTER;
  const out: ClassicSlotDef[] = [];
  for (const t of CLASSIC_SLOT_TYPES) {
    const n = Math.max(0, Math.min(6, Math.floor(Number(cfg[t.type]) || 0)));
    for (let i = 0; i < n; i++) out.push({ slot: n === 1 ? t.type : `${t.type}${i + 1}`, type: t.type, pos: t.pos });
  }
  return out.slice(0, CLASSIC_ROSTER_MAX);
}

/** The original nine — the default config's slots, kept for callers that
 *  predate custom rosters. */
export const CLASSIC_SLOTS: ClassicSlotDef[] = classicSlots();

/** Compact lineup shape for previews: "1QB·2RB·2WR·1TE·1FLEX·1K·1DEF". */
export function rosterLabel(roster?: ClassicRoster | null): string {
  const cfg = roster && Object.keys(roster).length ? roster : DEFAULT_CLASSIC_ROSTER;
  return CLASSIC_SLOT_TYPES
    .filter((t) => (Number(cfg[t.type]) || 0) > 0)
    .map((t) => `${Math.floor(Number(cfg[t.type]))}${t.type}`)
    .join('·');
}

// ── Commissioner-editable scoring (0160, widened 0161) ──────────────────────
// Every number the classic scorer uses, as a league setting. Overrides live in
// settings_json.scoring_classic (sanitized + clamped in SQL, same camelCase
// keys); this module alone knows the defaults. `ppr` still rides
// settings_json.ppr (the dedicated RECEPTIONS control); normalizeClassicScoring
// folds it in. The 300/400 + 100/200 bonuses STACK (Sleeper's behavior) and
// are computed on the player's week totals.
export interface ClassicScoring {
  passYd: number; passTd: number; int: number; pass300: number; pass400: number;
  pass40: number; passTd40: number; passTd50: number;
  passCmp: number; passInc: number; passAtt: number; cmp25: number; qbSacked: number;
  passFd: number; rushFd: number; recFd: number;
  fdQb: number; fdRb: number; fdWr: number; fdTe: number;
  pass2pt: number; rush2pt: number; rec2pt: number;
  rushYd: number; rushTd: number; rush100: number; rush200: number;
  rush40: number; rushTd40: number; rushTd50: number; carries20: number;
  recYd: number; recTd: number; ppr: number; teRec: number; rec100: number; rec200: number;
  rbRec: number; wrRec: number; targetPt: number;
  recB0: number; recB5: number; recB10: number; recB20: number; recB30: number; recB40: number;
  recTd40: number; recTd50: number;
  rr100: number; rr200: number;
  fumble: number; retYd: number; retTd: number;
  fg0: number; fg20: number; fg30: number; fg40: number; fg50: number; fg60: number;
  fgYd: number; fgYd30: number; fgMiss: number; xp: number; xpMiss: number;
  sack: number; dstInt: number; fumRec: number; dstTd: number; safety: number;
  idpTackle: number; idpSack: number; idpInt: number; idpFr: number; idpTd: number; idpSafety: number;
  idpTackle10: number;
}
export const DEFAULT_CLASSIC_SCORING: ClassicScoring = {
  passYd: 0.04, passTd: 4, int: -2, pass300: 0, pass400: 0,
  pass40: 0, passTd40: 0, passTd50: 0,
  passCmp: 0, passInc: 0, passAtt: 0, cmp25: 0, qbSacked: 0,
  passFd: 0, rushFd: 0, recFd: 0,
  fdQb: 0, fdRb: 0, fdWr: 0, fdTe: 0,
  // 2-pt conversions default to Sleeper's 2 — only flag-aware rows (0166 live
  // feed onward) carry `twoPt`, so no historical total moves.
  pass2pt: 2, rush2pt: 2, rec2pt: 2,
  rushYd: 0.1, rushTd: 6, rush100: 0, rush200: 0,
  rush40: 0, rushTd40: 0, rushTd50: 0, carries20: 0,
  recYd: 0.1, recTd: 6, ppr: 1, teRec: 0, rec100: 0, rec200: 0,
  rbRec: 0, wrRec: 0, targetPt: 0,
  recB0: 0, recB5: 0, recB10: 0, recB20: 0, recB30: 0, recB40: 0,
  recTd40: 0, recTd50: 0,
  rr100: 0, rr200: 0,
  fumble: -2, retYd: 0, retTd: 6,
  // fg60 defaults to fg50's value so a 60-yarder scores exactly what it did
  // before the band existed — the knob is there for Sleeper's 6, not forced.
  fg0: 3, fg20: 3, fg30: 3, fg40: 4, fg50: 5, fg60: 5,
  fgYd: 0, fgYd30: 0, fgMiss: -1, xp: 1, xpMiss: -1,
  sack: 1, dstInt: 2, fumRec: 2, dstTd: 6, safety: 2,
  idpTackle: 1, idpSack: 2, idpInt: 3, idpFr: 2, idpTd: 6, idpSafety: 2,
  idpTackle10: 0,
};
/** Editor metadata, grouped the way Sleeper/ESPN group their settings pages. */
export const CLASSIC_SCORING_SECTIONS: { section: string; fields: { key: keyof ClassicScoring; label: string; perYard?: boolean }[] }[] = [
  { section: 'PASSING', fields: [
    { key: 'passYd', label: 'PASS YD', perYard: true }, { key: 'passTd', label: 'PASS TD' }, { key: 'int', label: 'INT' },
    { key: 'pass300', label: '300+ YD GAME' }, { key: 'pass400', label: '400+ YD GAME' },
    { key: 'pass40', label: '40+ YD COMP' }, { key: 'passTd40', label: '40+ YD TD' }, { key: 'passTd50', label: '50+ YD TD' },
    { key: 'passCmp', label: 'COMPLETION' }, { key: 'passInc', label: 'INCOMPLETE' }, { key: 'passAtt', label: 'ATTEMPT' },
    { key: 'cmp25', label: '25+ CMP GAME' }, { key: 'qbSacked', label: 'QB SACKED' },
    { key: 'passFd', label: '1ST DOWN' }, { key: 'pass2pt', label: '2-PT PASS' },
  ] },
  { section: 'RUSHING', fields: [
    { key: 'rushYd', label: 'RUSH YD', perYard: true }, { key: 'rushTd', label: 'RUSH TD' },
    { key: 'rush100', label: '100+ YD GAME' }, { key: 'rush200', label: '200+ YD GAME' },
    { key: 'rush40', label: '40+ YD RUSH' }, { key: 'rushTd40', label: '40+ YD TD' }, { key: 'rushTd50', label: '50+ YD TD' },
    { key: 'carries20', label: '20+ CARRY GAME' },
    { key: 'rushFd', label: '1ST DOWN' }, { key: 'rush2pt', label: '2-PT RUSH' },
  ] },
  { section: 'RECEIVING', fields: [
    { key: 'recYd', label: 'REC YD', perYard: true }, { key: 'recTd', label: 'REC TD' }, { key: 'teRec', label: 'TE CATCH BONUS' },
    { key: 'rbRec', label: 'RB CATCH BONUS' }, { key: 'wrRec', label: 'WR CATCH BONUS' }, { key: 'targetPt', label: 'TARGET' },
    { key: 'rec100', label: '100+ YD GAME' }, { key: 'rec200', label: '200+ YD GAME' },
    { key: 'recB0', label: 'REC 0-4 YD' }, { key: 'recB5', label: 'REC 5-9 YD' }, { key: 'recB10', label: 'REC 10-19 YD' },
    { key: 'recB20', label: 'REC 20-29 YD' }, { key: 'recB30', label: 'REC 30-39 YD' }, { key: 'recB40', label: 'REC 40+ YD' },
    { key: 'recTd40', label: '40+ YD TD' }, { key: 'recTd50', label: '50+ YD TD' },
    { key: 'recFd', label: '1ST DOWN' }, { key: 'rec2pt', label: '2-PT CATCH' },
  ] },
  { section: 'COMBINED RUSH + REC', fields: [
    { key: 'rr100', label: '100+ YD GAME' }, { key: 'rr200', label: '200+ YD GAME' },
  ] },
  { section: 'FIRST DOWNS BY POSITION', fields: [
    { key: 'fdQb', label: 'QB' }, { key: 'fdRb', label: 'RB' }, { key: 'fdWr', label: 'WR' }, { key: 'fdTe', label: 'TE' },
  ] },
  { section: 'TURNOVERS & RETURNS', fields: [
    { key: 'fumble', label: 'FUMBLE LOST' }, { key: 'retYd', label: 'RETURN YD', perYard: true }, { key: 'retTd', label: 'RETURN TD' },
  ] },
  { section: 'KICKING', fields: [
    { key: 'fg0', label: 'FG 0-19' }, { key: 'fg20', label: 'FG 20-29' }, { key: 'fg30', label: 'FG 30-39' },
    { key: 'fg40', label: 'FG 40-49' }, { key: 'fg50', label: 'FG 50-59' }, { key: 'fg60', label: 'FG 60+' },
    { key: 'fgYd', label: 'PER FG YD', perYard: true }, { key: 'fgYd30', label: 'PER FG YD >30', perYard: true },
    { key: 'fgMiss', label: 'FG MISS' }, { key: 'xp', label: 'XP' }, { key: 'xpMiss', label: 'XP MISS' },
  ] },
  { section: 'TEAM DEFENSE', fields: [
    { key: 'sack', label: 'SACK' }, { key: 'dstInt', label: 'INT' }, { key: 'fumRec', label: 'FUM REC' },
    { key: 'dstTd', label: 'TD' }, { key: 'safety', label: 'SAFETY' },
  ] },
  { section: 'IDP', fields: [
    { key: 'idpTackle', label: 'TACKLE' }, { key: 'idpSack', label: 'SACK' }, { key: 'idpInt', label: 'INT' },
    { key: 'idpFr', label: 'FUM REC' }, { key: 'idpTd', label: 'TD' }, { key: 'idpSafety', label: 'SAFETY' },
    { key: 'idpTackle10', label: '10+ TACKLE GAME' },
  ] },
];
/** Flat field list — the 0160 editors and the SQL sanitizer key off it. */
export const CLASSIC_SCORING_FIELDS: { key: keyof ClassicScoring; label: string; perYard?: boolean }[] =
  CLASSIC_SCORING_SECTIONS.flatMap((s) => s.fields);

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

/** One play's classic points (threshold bonuses are added in classicPoints —
 *  they're week-total facts, not play facts). */
export function classicScorePlay(play: RawPlay, pos: Pos, sc: ClassicScoring): number {
  if (pos === 'K') {
    if (play.kind === 'fg') {
      const band = play.yards < 20 ? sc.fg0 : play.yards < 30 ? sc.fg20 : play.yards < 40 ? sc.fg30 : play.yards < 50 ? sc.fg40 : play.yards < 60 ? sc.fg50 : sc.fg60;
      return band + play.yards * sc.fgYd + Math.max(0, play.yards - 30) * sc.fgYd30;
    }
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
    if (play.kind === 'tackle') return sc.idpTackle;
    if (play.kind === 'sack') return sc.idpSack;
    if (play.kind === 'int') return sc.idpInt;
    if (play.kind === 'fumrec') return sc.idpFr;
    if (play.kind === 'dst_td') return sc.idpTd;
    if (play.kind === 'safety') return sc.idpSafety;
    return 0;
  }
  // Skill positions: every stat counts, all at once — the whole point of classic.
  // Distance bonuses key on YARDS, so incompletions/sacks (baked as 0-yd pass
  // rows) can never trip them; the 40/50 TD bonuses STACK, house style.
  // A 2-pt conversion row (0166, own kinds) carries no yardage/reception
  // credit — the NFL awards no stats for the try — just the 2-pt knob.
  if (play.kind === 'tp_pass') return sc.pass2pt;
  if (play.kind === 'tp_rush') return sc.rush2pt;
  if (play.kind === 'tp_rec') return sc.rec2pt;
  let pts = 0;
  if (play.kind === 'pass') {
    pts += play.yards * sc.passYd + (play.td ? sc.passTd : 0);
    if (play.yards >= 40) pts += sc.pass40 + (play.td ? sc.passTd40 : 0);
    if (play.yards >= 50 && play.td) pts += sc.passTd50;
    // Truth flags (0166): exactly one of cmp/inc/skd on flag-aware QB rows;
    // legacy rows carry none and score none of these — never a wrong guess.
    if (play.skd) pts += sc.qbSacked;
    if (play.cmp || play.inc) pts += sc.passAtt;
    if (play.cmp) pts += sc.passCmp;
    if (play.inc) pts += sc.passInc;
    if (play.fd) pts += sc.passFd;
  }
  if (play.kind === 'rush') {
    pts += play.yards * sc.rushYd + (play.td ? sc.rushTd : 0);
    if (play.yards >= 40) pts += sc.rush40 + (play.td ? sc.rushTd40 : 0);
    if (play.yards >= 50 && play.td) pts += sc.rushTd50;
    if (play.fd) pts += sc.rushFd;
  }
  if (play.catch) {
    pts += sc.ppr + (pos === 'TE' ? sc.teRec : pos === 'RB' ? sc.rbRec : pos === 'WR' ? sc.wrRec : 0)
        + play.yards * sc.recYd + (play.td ? sc.recTd : 0);
    pts += play.yards < 5 ? sc.recB0 : play.yards < 10 ? sc.recB5 : play.yards < 20 ? sc.recB10
        : play.yards < 30 ? sc.recB20 : play.yards < 40 ? sc.recB30 : sc.recB40;
    if (play.yards >= 40 && play.td) pts += sc.recTd40;
    if (play.yards >= 50 && play.td) pts += sc.recTd50;
    if (play.fd) pts += sc.recFd;
  }
  // Per-position first-down bonus (Sleeper's MISC section) stacks on the stat
  // first down — both sides of a completed pass earn theirs independently.
  if (play.fd) pts += pos === 'QB' ? sc.fdQb : pos === 'RB' ? sc.fdRb : pos === 'WR' ? sc.fdWr : pos === 'TE' ? sc.fdTe : 0;
  // ESPN-style per-target points (founder's ask) — pays on every target,
  // caught or not: rec rows and incomplete-target rows both carry the flag.
  if (play.target) pts += sc.targetPt;
  if (play.kind === 'return') pts += play.yards * sc.retYd + (play.td ? sc.retTd : 0);
  if (play.turnover) pts += play.kind === 'pass' ? sc.int : sc.fumble; // INT thrown vs fumble lost
  return pts;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A player's classic week total off the live/baked play stream: play points +
 *  the stacking yardage bonuses (300/400 pass, 100/200 rush/rec — a week is
 *  one game for almost every player, matching Sleeper's per-game bonuses).
 *  The commissioner's flag rules (0144) apply exactly as in drip: bonus_mult
 *  scales the points, bonus_pts lands flat on the final. Requires the flag
 *  cache installed (setLeagueFlags) — both resolvers and both boards keep it. */
export function classicPoints(player: Player, week: number, sc?: number | Partial<ClassicScoring>): number {
  const s = normalizeClassicScoring(sc);
  const { plays } = playsForPlayer(player, week);
  let raw = 0, passYds = 0, rushYds = 0, recYds = 0, carries = 0, tackles = 0, cmps = 0;
  for (const p of plays) {
    raw += classicScorePlay(p, player.pos, s);
    if (p.kind === 'pass') passYds += p.yards;
    if (p.kind === 'rush') { rushYds += p.yards; carries++; }
    if (p.catch && p.kind !== 'tp_rec') recYds += p.yards;
    if (p.cmp) cmps++;
    if (p.kind === 'tackle') tackles++;
  }
  if (passYds >= 300) raw += s.pass300;
  if (passYds >= 400) raw += s.pass400;
  if (rushYds >= 100) raw += s.rush100;
  if (rushYds >= 200) raw += s.rush200;
  if (recYds >= 100) raw += s.rec100;
  if (recYds >= 200) raw += s.rec200;
  if (rushYds + recYds >= 100) raw += s.rr100;
  if (rushYds + recYds >= 200) raw += s.rr200;
  if (carries >= 20) raw += s.carries20;
  if (cmps >= 25) raw += s.cmp25;
  if (tackles >= 10) raw += s.idpTackle10;
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
 *  players. Slots fill MOST-SPECIFIC FIRST (fewest eligible positions), so
 *  dedicated spots take their best before any flex chases the leftovers —
 *  greedy is optimal because every flex's eligibility is a superset of the
 *  dedicated slots it follows. Ties break toward roster order (stable). */
export function bestballFill(manual: ClassicPick[], bestball: string[], roster: Player[], week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicPick[] {
  const bb = new Set(bestball);
  if (!bb.size) return [];
  const started = new Set(manual.filter((p) => !bb.has(p.slot)).map((p) => p.player.id));
  // A no_start flag (0144) binds the auto-fill too: the DB trigger only guards
  // manual writes, so the exclusion has to live here — same reasoning as the
  // drip auto-lineup's noStart set.
  const cands = roster.filter((p) => !started.has(p.id) && !flagRulesFor(p.id).noStart);
  const score = new Map(cands.map((p) => [p.id, classicPoints(p, week, sc)]));
  const order = [...slots].sort((a, b) => a.pos.length - b.pos.length);
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
export function classicLineup(s: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicPick[] {
  const bb = new Set(s.bestball ?? []);
  const manual = s.picks.filter((p) => !bb.has(p.slot));
  return [...manual, ...bestballFill(manual, s.bestball ?? [], s.roster ?? [], week, sc, slots)];
}

/** Resolve one classic matchup: each starter's points, summed — nothing else.
 *  Slot order follows the league's configured lineup so both boards render
 *  the shape the commissioner built. */
export function resolveClassicMatchup(home: ClassicSide, away: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicResult {
  const scoring = normalizeClassicScoring(sc);
  const order = new Map(slots.map((s, i) => [s.slot, i]));
  const side = (s: ClassicSide, which: 'home' | 'away') => {
    const rows = classicLineup(s, week, scoring, slots)
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
