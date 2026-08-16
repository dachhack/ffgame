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

/** Player positions eligible to FILL a spot (0171). RET is a slot identity —
 *  any ball-carrier can man it (and scores return-only there); HC/P spots take
 *  the team pseudo-players. Everything else is literal. */
export function slotEligiblePos(specPos: string[]): string[] {
  const out = new Set<string>();
  for (const p of specPos) {
    if (p === 'RET') { out.add('RB'); out.add('WR'); out.add('TE'); out.add('FB'); }
    else out.add(p);
  }
  return [...out];
}

/** True when a spot scores return-only (its spec is exactly [RET]). */
export const isRetSlot = (specPos: string[]): boolean => specPos.length === 1 && specPos[0] === 'RET';

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
  fumble: number; retYd: number; retTd: number; krYd: number; prYd: number;
  fumbleAny: number; fumRecTd: number; qbPick6: number;
  fg0: number; fg20: number; fg30: number; fg40: number; fg50: number; fg60: number;
  fgYd: number; fgYd30: number; fgMiss: number; xp: number; xpMiss: number;
  fgM0: number; fgM20: number; fgM30: number; fgM40: number; fgM50: number; fgM60: number;
  sack: number; dstInt: number; fumRec: number; dstTd: number; safety: number; dstBlk: number; dstFf: number;
  dstQbHit: number; dstPd: number; dstIntRetYd: number; dstFumRetYd: number;
  paPt: number; pa0: number; pa1: number; pa7: number; pa14: number; pa21: number; pa28: number; pa35: number;
  yaPt: number; ya100: number; ya199: number; ya299: number; ya349: number; ya399: number;
  ya449: number; ya499: number; ya549: number; ya550: number;
  idpTackle: number; idpSack: number; idpInt: number; idpFr: number; idpTd: number; idpSafety: number;
  idpTackle10: number; idpSolo: number; idpAst: number; idpTfl: number; idpFf: number;
  idpQbHit: number; idpPd: number;
  idpSackYd: number; idpIntRetYd: number; idpFumRetYd: number;
  idpIntRetTd50: number; idpFumRetTd50: number; idpSack2: number; idpPd3: number;
  stTackle: number; stFf: number; stFr: number;
  hcWin: number; hcLoss: number; hcTie: number; hcPts: number;
  hcWm1: number; hcWm5: number; hcWm10: number; hcWm15: number; hcWm20: number; hcWm25: number;
  hcLm1: number; hcLm5: number; hcLm10: number; hcLm15: number; hcLm20: number; hcLm25: number;
  hc3dc: number; hc4dc: number; hc2pt: number;
  puntPt: number; puntYd: number;
  pta44: number; pta42: number; pta40: number; pta38: number; pta36: number; pta34: number; pta33: number;
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
  fumble: -2, retYd: 0, retTd: 6, krYd: 0, prYd: 0,
  // fumRecTd defaults to Sleeper's 6 — only new 'frtd' rows carry the kind.
  fumbleAny: 0, fumRecTd: 6, qbPick6: 0,
  // fg60 defaults to fg50's value so a 60-yarder scores exactly what it did
  // before the band existed — the knob is there for Sleeper's 6, not forced.
  fg0: 3, fg20: 3, fg30: 3, fg40: 4, fg50: 5, fg60: 5,
  fgYd: 0, fgYd30: 0, fgMiss: -1, xp: 1, xpMiss: -1,
  fgM0: 0, fgM20: 0, fgM30: 0, fgM40: 0, fgM50: 0, fgM60: 0,
  sack: 1, dstInt: 2, fumRec: 2, dstTd: 6, safety: 2, dstBlk: 2, dstFf: 1,
  dstQbHit: 0, dstPd: 0, dstIntRetYd: 0, dstFumRetYd: 0,
  // Points-allowed brackets default to Sleeper's ladder — only 0167 pa rows
  // (emitted at game FINAL) can carry the kind, so no historical total moves;
  // going forward this is the standard DEF scoring every normie expects.
  paPt: 0, pa0: 10, pa1: 7, pa7: 4, pa14: 1, pa21: 0, pa28: -1, pa35: -4,
  yaPt: 0, ya100: 0, ya199: 0, ya299: 0, ya349: 0, ya399: 0,
  ya449: 0, ya499: 0, ya549: 0, ya550: 0,
  idpTackle: 1, idpSack: 2, idpInt: 3, idpFr: 2, idpTd: 6, idpSafety: 2,
  idpTackle10: 0, idpSolo: 0, idpAst: 0, idpTfl: 0, idpFf: 0,
  idpQbHit: 0, idpPd: 0,
  idpSackYd: 0, idpIntRetYd: 0, idpFumRetYd: 0,
  idpIntRetTd50: 0, idpFumRetTd50: 0, idpSack2: 0, idpPd3: 0,
  // ST FF/FR default to Sleeper's 1 — new-emission kinds on ST plays only.
  stTackle: 0, stFf: 1, stFr: 1,
  // Head coach + punter (0171): every knob defaults 0 — the admin's position
  // flags gate the positions, the commissioner opts into the values.
  hcWin: 0, hcLoss: 0, hcTie: 0, hcPts: 0,
  hcWm1: 0, hcWm5: 0, hcWm10: 0, hcWm15: 0, hcWm20: 0, hcWm25: 0,
  hcLm1: 0, hcLm5: 0, hcLm10: 0, hcLm15: 0, hcLm20: 0, hcLm25: 0,
  hc3dc: 0, hc4dc: 0, hc2pt: 0,
  puntPt: 0, puntYd: 0,
  pta44: 0, pta42: 0, pta40: 0, pta38: 0, pta36: 0, pta34: 0, pta33: 0,
};
/** Editor metadata, grouped the way Sleeper/ESPN group their settings pages. */
export const CLASSIC_SCORING_SECTIONS: { section: string; fields: { key: keyof ClassicScoring; label: string; perYard?: boolean }[] }[] = [
  { section: 'PASSING', fields: [
    { key: 'passYd', label: 'PASS YD', perYard: true }, { key: 'passTd', label: 'PASS TD' }, { key: 'int', label: 'INT' },
    { key: 'pass300', label: '300+ YD GAME' }, { key: 'pass400', label: '400+ YD GAME' },
    { key: 'pass40', label: '40+ YD COMP' }, { key: 'passTd40', label: '40+ YD TD' }, { key: 'passTd50', label: '50+ YD TD' },
    { key: 'passCmp', label: 'COMPLETION' }, { key: 'passInc', label: 'INCOMPLETE' }, { key: 'passAtt', label: 'ATTEMPT' },
    { key: 'cmp25', label: '25+ CMP GAME' }, { key: 'qbSacked', label: 'QB SACKED' },
    { key: 'passFd', label: '1ST DOWN' }, { key: 'pass2pt', label: '2-PT PASS' }, { key: 'qbPick6', label: 'PICK-6 THROWN' },
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
    { key: 'fumble', label: 'FUMBLE LOST' }, { key: 'fumbleAny', label: 'FUMBLE (ANY)' }, { key: 'fumRecTd', label: 'FUM REC TD' },
    { key: 'retYd', label: 'RETURN YD', perYard: true }, { key: 'retTd', label: 'RETURN TD' },
    { key: 'krYd', label: 'KICK RET YD', perYard: true }, { key: 'prYd', label: 'PUNT RET YD', perYard: true },
  ] },
  { section: 'SPECIAL TEAMS PLAYER', fields: [
    { key: 'stTackle', label: 'SOLO TACKLE' }, { key: 'stFf', label: 'FORCED FUMBLE' }, { key: 'stFr', label: 'FUM RECOVERY' },
  ] },
  { section: 'KICKING', fields: [
    { key: 'fg0', label: 'FG 0-19' }, { key: 'fg20', label: 'FG 20-29' }, { key: 'fg30', label: 'FG 30-39' },
    { key: 'fg40', label: 'FG 40-49' }, { key: 'fg50', label: 'FG 50-59' }, { key: 'fg60', label: 'FG 60+' },
    { key: 'fgYd', label: 'PER FG YD', perYard: true }, { key: 'fgYd30', label: 'PER FG YD >30', perYard: true },
    { key: 'fgMiss', label: 'FG MISS' }, { key: 'xp', label: 'XP' }, { key: 'xpMiss', label: 'XP MISS' },
    { key: 'fgM0', label: 'MISS 0-19' }, { key: 'fgM20', label: 'MISS 20-29' }, { key: 'fgM30', label: 'MISS 30-39' },
    { key: 'fgM40', label: 'MISS 40-49' }, { key: 'fgM50', label: 'MISS 50-59' }, { key: 'fgM60', label: 'MISS 60+' },
  ] },
  { section: 'TEAM DEFENSE', fields: [
    { key: 'sack', label: 'SACK' }, { key: 'dstInt', label: 'INT' }, { key: 'fumRec', label: 'FUM REC' },
    { key: 'dstTd', label: 'TD' }, { key: 'safety', label: 'SAFETY' }, { key: 'dstBlk', label: 'BLOCKED KICK' },
    { key: 'dstFf', label: 'FORCED FUMBLE' }, { key: 'dstQbHit', label: 'QB HIT' }, { key: 'dstPd', label: 'PASS DEFENDED' },
    { key: 'dstIntRetYd', label: 'INT RET YD', perYard: true }, { key: 'dstFumRetYd', label: 'FUM RET YD', perYard: true },
  ] },
  { section: 'POINTS ALLOWED', fields: [
    { key: 'paPt', label: 'PER PT ALLOWED' },
    { key: 'pa0', label: 'PA 0' }, { key: 'pa1', label: 'PA 1-6' }, { key: 'pa7', label: 'PA 7-13' },
    { key: 'pa14', label: 'PA 14-20' }, { key: 'pa21', label: 'PA 21-27' }, { key: 'pa28', label: 'PA 28-34' },
    { key: 'pa35', label: 'PA 35+' },
  ] },
  { section: 'YARDAGE ALLOWED', fields: [
    { key: 'yaPt', label: 'PER YD ALLOWED' },
    { key: 'ya100', label: '< 100 YD' }, { key: 'ya199', label: '100-199' }, { key: 'ya299', label: '200-299' },
    { key: 'ya349', label: '300-349' }, { key: 'ya399', label: '350-399' }, { key: 'ya449', label: '400-449' },
    { key: 'ya499', label: '450-499' }, { key: 'ya549', label: '500-549' }, { key: 'ya550', label: '550+' },
  ] },
  { section: 'HEAD COACH', fields: [
    { key: 'hcWin', label: 'WIN' }, { key: 'hcLoss', label: 'LOSS' }, { key: 'hcTie', label: 'TIE' },
    { key: 'hcPts', label: 'PER PT SCORED' },
    { key: 'hc3dc', label: '3RD DOWN CONV' }, { key: 'hc4dc', label: '4TH DOWN CONV' }, { key: 'hc2pt', label: '2-PT CONV' },
    { key: 'hcWm1', label: 'WIN BY 1-4' }, { key: 'hcWm5', label: 'WIN BY 5-9' }, { key: 'hcWm10', label: 'WIN BY 10-14' },
    { key: 'hcWm15', label: 'WIN BY 15-19' }, { key: 'hcWm20', label: 'WIN BY 20-24' }, { key: 'hcWm25', label: 'WIN BY 25+' },
    { key: 'hcLm1', label: 'LOSS BY 1-4' }, { key: 'hcLm5', label: 'LOSS BY 5-9' }, { key: 'hcLm10', label: 'LOSS BY 10-14' },
    { key: 'hcLm15', label: 'LOSS BY 15-19' }, { key: 'hcLm20', label: 'LOSS BY 20-24' }, { key: 'hcLm25', label: 'LOSS BY 25+' },
  ] },
  { section: 'PUNTING', fields: [
    { key: 'puntPt', label: 'PUNT' }, { key: 'puntYd', label: 'PUNT YD', perYard: true },
    { key: 'pta44', label: 'AVG 44+' }, { key: 'pta42', label: 'AVG 42-43.9' }, { key: 'pta40', label: 'AVG 40-41.9' },
    { key: 'pta38', label: 'AVG 38-39.9' }, { key: 'pta36', label: 'AVG 36-37.9' }, { key: 'pta34', label: 'AVG 34-35.9' },
    { key: 'pta33', label: 'AVG < 34' },
  ] },
  { section: 'IDP', fields: [
    { key: 'idpTackle', label: 'TACKLE' }, { key: 'idpSolo', label: 'SOLO BONUS' }, { key: 'idpAst', label: 'ASSIST BONUS' },
    { key: 'idpTfl', label: 'TACKLE FOR LOSS' }, { key: 'idpSack', label: 'SACK' }, { key: 'idpFf', label: 'FORCED FUMBLE' },
    { key: 'idpQbHit', label: 'QB HIT' }, { key: 'idpPd', label: 'PASS DEFENDED' },
    { key: 'idpInt', label: 'INT' }, { key: 'idpFr', label: 'FUM REC' }, { key: 'idpTd', label: 'TD' },
    { key: 'idpSafety', label: 'SAFETY' }, { key: 'idpSackYd', label: 'SACK YD', perYard: true },
    { key: 'idpIntRetYd', label: 'INT RET YD', perYard: true }, { key: 'idpFumRetYd', label: 'FUM RET YD', perYard: true },
    { key: 'idpIntRetTd50', label: '50+ INT RET TD' }, { key: 'idpFumRetTd50', label: '50+ FUM RET TD' },
    { key: 'idpTackle10', label: '10+ TACKLE GAME' }, { key: 'idpSack2', label: '2+ SACK GAME' }, { key: 'idpPd3', label: '3+ PD GAME' },
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
    if (play.kind === 'fgmiss') {
      // Distance-banded miss penalties (0170) stack on the flat miss; rows
      // with no recorded distance take only the flat knob.
      const y = play.yards;
      return sc.fgMiss + (y <= 0 ? 0
        : y < 20 ? sc.fgM0 : y < 30 ? sc.fgM20 : y < 40 ? sc.fgM30 : y < 50 ? sc.fgM40 : y < 60 ? sc.fgM50 : sc.fgM60);
    }
    if (play.kind === 'xp') return sc.xp;
    if (play.kind === 'xpmiss') return sc.xpMiss;
    return 0;
  }
  if (pos === 'DEF') {
    if (play.kind === 'sack') return sc.sack;
    if (play.kind === 'int') return sc.dstInt + play.yards * sc.dstIntRetYd;
    if (play.kind === 'fumrec') return sc.fumRec + play.yards * sc.dstFumRetYd;
    if (play.kind === 'dst_td') return sc.dstTd;
    if (play.kind === 'safety') return sc.safety;
    if (play.kind === 'blk') return sc.dstBlk;
    if (play.kind === 'ff') return sc.dstFf;
    if (play.kind === 'qbhit') return sc.dstQbHit;
    if (play.kind === 'pd') return sc.dstPd;
    // (int/fumrec above gained return-yardage rates in 0170 — see the early
    // returns; DEF rows carry return yards in `y` on flag-aware data.)
    // Team brackets (0167): one pa + one ya game-summary row per DEF at final,
    // y = points / total yards allowed. Bracket + per-unit rate, Sleeper-style.
    if (play.kind === 'pa') {
      const y = play.yards;
      return (y <= 0 ? sc.pa0 : y <= 6 ? sc.pa1 : y <= 13 ? sc.pa7 : y <= 20 ? sc.pa14
            : y <= 27 ? sc.pa21 : y <= 34 ? sc.pa28 : sc.pa35) + y * sc.paPt;
    }
    if (play.kind === 'ya') {
      const y = play.yards;
      return (y < 100 ? sc.ya100 : y < 200 ? sc.ya199 : y < 300 ? sc.ya299 : y < 350 ? sc.ya349
            : y < 400 ? sc.ya399 : y < 450 ? sc.ya449 : y < 500 ? sc.ya499 : y < 550 ? sc.ya549 : sc.ya550) + y * sc.yaPt;
    }
    return 0;
  }
  // Head coach pseudo-player (0171, "xxx-hc"): conversions live per play,
  // result + points at FINAL (the hc_res margin picks the win/loss brackets).
  if (pos === 'HC') {
    if (play.kind === 'hc_3dc') return sc.hc3dc;
    if (play.kind === 'hc_4dc') return sc.hc4dc;
    if (play.kind === 'hc_2pt') return sc.hc2pt;
    if (play.kind === 'hc_pts') return play.yards * sc.hcPts;
    if (play.kind === 'hc_res') {
      const m = play.yards;
      if (m === 0) return sc.hcTie;
      const a = Math.abs(m);
      const br = a <= 4 ? 0 : a <= 9 ? 1 : a <= 14 ? 2 : a <= 19 ? 3 : a <= 24 ? 4 : 5;
      return m > 0
        ? sc.hcWin + [sc.hcWm1, sc.hcWm5, sc.hcWm10, sc.hcWm15, sc.hcWm20, sc.hcWm25][br]
        : sc.hcLoss + [sc.hcLm1, sc.hcLm5, sc.hcLm10, sc.hcLm15, sc.hcLm20, sc.hcLm25][br];
    }
    return 0;
  }
  // Punter pseudo-player (0171, "xxx-p"): per punt + per yard; the ESPN-style
  // punt-average bands are week totals — classicPoints applies them.
  if (pos === 'P') {
    if (play.kind === 'punt') return sc.puntPt + play.yards * sc.puntYd;
    return 0;
  }
  // RET is a SLOT identity, not a player position (0171): a player scored "as
  // RET" banks return production only — everything else on their day is mute.
  if (pos === 'RET') {
    if (play.kind === 'return') {
      return play.yards * (sc.retYd + (play.rk === 'kr' ? sc.krYd : play.rk === 'pr' ? sc.prYd : 0))
           + (play.td ? sc.retTd : 0);
    }
    return 0;
  }
  if (pos === 'DL' || pos === 'LB' || pos === 'DB') {
    // 0168: the solo/assist premium layers on the base per-tackle point; a
    // split sack credit (hf) scores half; TFL and FF are their own events.
    if (play.kind === 'tackle') return sc.idpTackle + (play.tt === 's' ? sc.idpSolo : play.tt === 'a' ? sc.idpAst : 0);
    if (play.kind === 'tfl') return sc.idpTfl;
    if (play.kind === 'ff') return sc.idpFf;
    if (play.kind === 'qbhit') return sc.idpQbHit;
    if (play.kind === 'pd') return sc.idpPd;
    // 0170: sack yards ride `y` on individual sack rows (halved when split at
    // emission); INT/fumble recoveries carry return yards + the 50+ TD bonus.
    if (play.kind === 'sack') return sc.idpSack * (play.hf ? 0.5 : 1) + play.yards * sc.idpSackYd;
    if (play.kind === 'int') return sc.idpInt + play.yards * sc.idpIntRetYd + (play.td && play.yards >= 50 ? sc.idpIntRetTd50 : 0);
    if (play.kind === 'fumrec') return sc.idpFr + play.yards * sc.idpFumRetYd + (play.td && play.yards >= 50 ? sc.idpFumRetTd50 : 0);
    if (play.kind === 'dst_td') return sc.idpTd;
    if (play.kind === 'safety') return sc.idpSafety;
    if (play.kind === 'st_tkl') return play.tt === 's' ? sc.stTackle : 0;
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
    if (play.pick6) pts += sc.qbPick6;
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
  // 0170: fumble events + special-teams contributions for offense-rostered
  // players (gunners and coverage men are usually WRs/RBs/TEs).
  if (play.kind === 'fum') pts += sc.fumbleAny;              // any fumble, kept or lost
  if (play.kind === 'frtd') pts += sc.fumRecTd;              // own-team recovery TD
  if (play.kind === 'st_tkl' && play.tt === 's') pts += sc.stTackle;
  if (play.kind === 'ff') pts += sc.stFf;                    // ST/coverage forced fumble
  if (play.kind === 'fumrec') pts += sc.stFr;                // ST recovery (muffed punt)
  // ESPN-style per-target points (founder's ask) — pays on every target,
  // caught or not: rec rows and incomplete-target rows both carry the flag.
  if (play.target) pts += sc.targetPt;
  // Returns: the combined retYd rate everywhere, plus the KR/PR split rates on
  // flag-aware rows (0167) — legacy return rows score the combined knob only.
  if (play.kind === 'return') {
    pts += play.yards * (sc.retYd + (play.rk === 'kr' ? sc.krYd : play.rk === 'pr' ? sc.prYd : 0))
         + (play.td ? sc.retTd : 0);
  }
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
export function classicPoints(player: Player, week: number, sc?: number | Partial<ClassicScoring>, scoreAs?: Pos): number {
  const s = normalizeClassicScoring(sc);
  const pos = scoreAs ?? player.pos;
  const { plays } = playsForPlayer(player, week);
  let raw = 0, passYds = 0, rushYds = 0, recYds = 0, carries = 0, tackles = 0, cmps = 0, sacks = 0, pds = 0;
  let punts = 0, puntYds = 0;
  for (const p of plays) {
    raw += classicScorePlay(p, pos, s);
    if (p.kind === 'pass') passYds += p.yards;
    if (p.kind === 'rush') { rushYds += p.yards; carries++; }
    if (p.catch && p.kind !== 'tp_rec') recYds += p.yards;
    if (p.cmp) cmps++;
    if (p.kind === 'tackle') tackles++;
    if (p.kind === 'sack') sacks += p.hf ? 0.5 : 1;
    if (p.kind === 'pd') pds++;
    if (p.kind === 'punt') { punts++; puntYds += p.yards; }
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
  // IDP-gated game bonuses (0170) — a team DEF racks up 2+ sacks most weeks,
  // so these fire only for individual defenders.
  if (pos === 'DL' || pos === 'LB' || pos === 'DB') {
    if (sacks >= 2) raw += s.idpSack2;
    if (pds >= 3) raw += s.idpPd3;
  }
  // Punter average bands (0171, ESPN's ladder) — a week-total fact.
  if (pos === 'P' && punts > 0) {
    const avg = puntYds / punts;
    raw += avg >= 44 ? s.pta44 : avg >= 42 ? s.pta42 : avg >= 40 ? s.pta40 : avg >= 38 ? s.pta38
         : avg >= 36 ? s.pta36 : avg >= 34 ? s.pta34 : s.pta33;
  }
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
  // RET spots (0171) rank candidates by their RETURN production, since that's
  // all the spot will bank.
  const retScore = new Map<string, number>();
  const order = [...slots].sort((a, b) => a.pos.length - b.pos.length);
  const used = new Set<string>();
  const fills: ClassicPick[] = [];
  for (const d of order) {
    if (!bb.has(d.slot)) continue;
    const ret = isRetSlot(d.pos);
    const elig = slotEligiblePos(d.pos);
    const scoreOf = (id: string, pl: Player): number => {
      if (!ret) return score.get(id) ?? 0;
      if (!retScore.has(id)) retScore.set(id, classicPoints(pl, week, sc, 'RET'));
      return retScore.get(id) ?? 0;
    };
    let best: Player | null = null;
    for (const c of cands) {
      if (used.has(c.id) || !elig.includes(c.pos)) continue;
      if (!best || scoreOf(c.id, c) > scoreOf(best.id, best)) best = c;
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
  // RET spots (0171) score their occupant as a RETURNER — return production
  // only — no matter what else the player did that day.
  const specOf = new Map(slots.map((s) => [s.slot, s.pos as string[]]));
  const side = (s: ClassicSide, which: 'home' | 'away') => {
    const rows = classicLineup(s, week, scoring, slots)
      .sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99))
      .map((p) => ({
        win: CLASSIC_WIN, side: which, slot: p.slot, slug: p.player.id, metric: null as null,
        score: classicPoints(p.player, week, scoring, isRetSlot(specOf.get(p.slot) ?? []) ? 'RET' : undefined),
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
