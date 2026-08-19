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
import { flagRulesFor, flagFor } from '../data/commish';
import { golfValue, zeroFill } from './golf';
import { scopedAdjustFor } from './leagueScoring';
import { projectedPoints } from './projScoring';
import { normTeam } from '../data/slugMeta';
import { hasSlate, nflGameForTeam } from '../data/nflSlate';

export const CLASSIC_WIN = 'wk';

// ── The starting lineup (0161): slot types → generated slots ────────────────
// A lineup is COUNTS per slot type. Names generate as TYPE or TYPE+index
// (RB1, RB2 …) — with the default config this reproduces the original nine
// names exactly, so pre-0161 leagues' saved rows keep meaning what they meant.
export interface ClassicSlotDef { slot: string; type: string; pos: Pos[]; flt?: SlotFilter; label?: string; zeroPts?: number | null }
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
// 0172: a spot may also carry its OWN allowable-player filter — a team
// whitelist and/or a tenure window (years_exp; 0 = rookie) — so a league can
// run "an RB slot only for rookies". Filters gate who may FILL the spot
// (picker + best-ball fill); they never shrink the draft pool.
export interface SlotFilter {
  teams?: string[] | null; min_exp?: number | null; max_exp?: number | null;
  /** COMMISSIONER FLAGS as a condition (v0.300.0, founder: "allow flags as a
   *  condition for position filters"). Only a player wearing one of these
   *  flags may fill the spot — the spot-level twin of a scoped bonus's flag
   *  scope, and the thing that makes "a spot only your franchise tag can
   *  stand in" expressible. Matched on the label, case-insensitively. */
  flags?: string[] | null;
}
/** `label` (0174) is the commissioner's own name for the spot ("Only NFC
 *  Players") — PRESENTATION ONLY. Eligibility is still pos + the filter, so a
 *  label can never make a spot behave differently than it reads. */
/** `zero_pts` (v0.303.0) is THE ZERO-FILL RULE on this spot: an unfilled spot,
 *  or one whose player scores nothing, banks this many points instead. Mutually
 *  exclusive with `bb` — the founder's rule verbatim ("these spots can't also
 *  be best ball"), and it could hardly be otherwise: a best-ball spot fills
 *  itself from whoever is left, so "unfilled" is not a state it has. */
export interface SlotSpec extends SlotFilter { pos: string[]; bb?: boolean; label?: string; zero_pts?: number | null }

export function classicSlotsFromSpec(spec?: SlotSpec[] | null): ClassicSlotDef[] | null {
  if (!Array.isArray(spec) || !spec.length) return null;
  return spec.slice(0, CLASSIC_ROSTER_MAX).map((s, i) => {
    const pos = [...new Set((s.pos ?? []).map((p) => String(p).toUpperCase()))] as Pos[];
    // A spot whose eligibility matches a catalog type keeps that type's label.
    const known = CLASSIC_SLOT_TYPES.find((t) => t.pos.length === pos.length && t.pos.every((p) => pos.includes(p)));
    const d: ClassicSlotDef = { slot: `S${i + 1}`, type: known?.type ?? pos.join('/'), pos };
    // The commissioner's own name for the spot wins over the derived type
    // wherever a slot is DISPLAYED — `type` stays derived so nothing that
    // keys off it changes meaning.
    if (s.label?.trim()) d.label = s.label.trim();
    // Per-spot allowable-player filter (0172) rides along to the pickers + fill.
    // The zero-fill rule (v0.303.0) rides along to the resolver and the board.
    // Never on a best-ball spot: the two are mutually exclusive by definition.
    if (s.zero_pts != null && !s.bb) d.zeroPts = s.zero_pts;
    if (s.teams?.length || s.min_exp != null || s.max_exp != null || s.flags?.length) {
      d.flt = {
        teams: s.teams ?? null, min_exp: s.min_exp ?? null, max_exp: s.max_exp ?? null,
        flags: s.flags ?? null,
      };
    }
    return d;
  });
}

/** WHICH POSITIONS THIS LEAGUE CAN ACTUALLY ROSTER (v0.302.0, founder: "no
 *  kickers if there is no kicker spot on the roster"). The union of what every
 *  starting spot accepts — a bench player who can never start anywhere is a
 *  player the league has no use for, so the bench doesn't widen the set. This
 *  is the same derivation 0195 gave `league_pos_cap` server-side, kept in step
 *  on purpose: the waiver wire should not offer a player the server would
 *  refuse to let you sign.
 *
 *  Null means NO RESTRICTION — a drip league, or a classic league with no
 *  lineup spec, plays the whole board. */
export function leagueEligiblePos(mode?: { roster?: ClassicRoster | null; slots?: SlotSpec[] | null } | null): Set<string> | null {
  const hasSpec = Array.isArray(mode?.slots) && mode.slots.length > 0;
  const hasCounts = !!mode?.roster && Object.keys(mode.roster).length > 0;
  if (!hasSpec && !hasCounts) return null;
  const out = new Set<string>();
  for (const d of leagueSlotDefs(mode)) for (const p of slotEligiblePos(d.pos)) out.add(p.toUpperCase());
  return out.size ? out : null;
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

// Positions whose "players" are team units — a tenure window is meaningless
// for them, so they pass it (the 0171 pool-filter rule, kept per-slot).
const TEAM_UNIT_POS = new Set(['K', 'DEF', 'HC', 'P']);

/** May this player FILL this spot? Position eligibility plus the spot's own
 *  filter (0172): team whitelist applies to everyone (team units included);
 *  the tenure window skips team units, and a player whose tenure is unknown
 *  can't prove eligibility while a bound is set — same no-guess rule the
 *  pool-level filter follows. */
export function slotAllows(
  d: { pos: string[]; flt?: SlotFilter | null },
  p: { id?: string; pos: string; team?: string | null; exp?: number | null },
): boolean {
  if (!slotEligiblePos(d.pos).includes(p.pos)) return false;
  const f = d.flt;
  if (!f) return true;
  if (f.teams?.length && !f.teams.some((t) => t.toUpperCase() === (p.team ?? '').toUpperCase())) return false;
  // A FLAG CONDITION (v0.300.0). Same no-guess rule as tenure: without an id
  // there is no flag to read, so the player cannot prove he qualifies.
  if (f.flags?.length) {
    const lab = p.id ? flagFor(p.id) : null;
    if (!lab) return false;
    const low = lab.trim().toLowerCase();
    if (!f.flags.some((x) => x.trim().toLowerCase() === low)) return false;
  }
  if ((f.min_exp != null || f.max_exp != null) && !TEAM_UNIT_POS.has(p.pos)) {
    if (p.exp == null) return false;
    if (f.min_exp != null && p.exp < f.min_exp) return false;
    if (f.max_exp != null && p.exp > f.max_exp) return false;
  }
  return true;
}

/** What to CALL a spot on screen: the commissioner's label when they wrote
 *  one (0174), else the derived eligibility label. */
export const slotDisplayName = (d: { label?: string; pos: string[] }): string =>
  d.label?.trim() || slotSpecLabel(d.pos);

/** The display name TRIMMED FOR A BADGE (v0.289.0) — the parenthetical
 *  eligibility dropped, so every spot chip is a short word and a column of them
 *  can be one fixed width:
 *
 *    "FLEX (RB/WR/TE)"          -> "FLEX"
 *    "SUPERFLEX (QB/RB/WR/TE)"  -> "SUPERFLEX"
 *    "FLEX (RB/WR/TE) 2"        -> "FLEX 2"      (the duplicate index survives)
 *    "NFC Flex"                 -> "NFC Flex"    (a commissioner's own name)
 *
 *  Nothing is lost by dropping it: the row underneath already prints the
 *  player's actual position, ⚖ ROSTER SETTINGS lists what each spot accepts,
 *  and `slotAcceptsLabel` still spells it out for the places that want the long
 *  form (the draft room, the spot editor). This exists because the full label
 *  made ONE chip three times the width of its neighbours, which pushed that
 *  row's player out of the column every other row shared. */
export const slotBadgeLabel = (name: string): string =>
  name.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || name;

/** Display label for a spot's eligibility ("FLEX (RB/WR/TE)" or "QB/RB/K"). */
export function slotSpecLabel(pos: string[]): string {
  const up = pos.map((p) => p.toUpperCase());
  const known = CLASSIC_SLOT_TYPES.find((t) => t.pos.length === up.length && t.pos.every((p) => up.includes(p as Pos)));
  return known ? known.label : up.join('/');
}

/** A spot's own player filter (0172) in a few characters: "KC/BUF",
 *  "ROOKIES ONLY", "2–5 YRS". Empty when the spot filters on nothing. */
export function slotFilterLabel(f?: SlotFilter | null): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.teams?.length) parts.push(f.teams.join('/'));
  if (f.min_exp != null || f.max_exp != null) {
    parts.push(f.max_exp === 0 ? 'ROOKIES ONLY' : `${f.min_exp ?? 0}–${f.max_exp ?? '30'} YRS`);
  }
  if (f.flags?.length) parts.push(`⚑ ${f.flags.join('/')}`);
  return parts.join(' · ');
}

/** What a spot ACCEPTS, for the line under its name — the half of eligibility
 *  the name doesn't already say. A commissioner's own label (0174) is free
 *  text, so "Only NFC Players" tells you nothing about which POSITIONS may
 *  stand there; the derived label always does, and repeating it would be
 *  noise. Filters (0172) are never in either, so they always show. */
export function slotAcceptsLabel(d: { label?: string; pos: string[]; flt?: SlotFilter | null }): string {
  return [d.label?.trim() ? d.pos.map((p) => p.toUpperCase()).join('/') : '', slotFilterLabel(d.flt)]
    .filter(Boolean).join(' · ');
}

/** Display names for a WHOLE lineup, disambiguated. Under the position builder
 *  every RB spot is named "RB" (the counts model generated RB1/RB2 instead), so
 *  a lineup with two of anything would show two identical rows and a manager
 *  couldn't tell which one they were setting. Repeats — and only repeats — get
 *  a trailing index, in the league's own spot order. */
export function slotDisplayNames(slots: { label?: string; pos: string[] }[]): string[] {
  const names = slots.map(slotDisplayName);
  const total = new Map<string, number>();
  for (const n of names) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => {
    if ((total.get(n) ?? 0) < 2) return n;
    const i = (seen.get(n) ?? 0) + 1;
    seen.set(n, i);
    return `${n} ${i}`;
  });
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
export function classicPoints(player: Player, week: number, sc?: number | Partial<ClassicScoring>, scoreAs?: Pos, slot?: string | null): number {
  const { plays } = playsForPlayer(player, week);
  return classicPointsFrom(plays, player, sc, scoreAs, slot);
}

/** The same scoring, over plays you already hold (v0.284.0).
 *
 *  `classicPoints` reads the week's plays from the engine's module cache, which
 *  the LIVE BOARD owns — one week at a time, installed by whichever screen is
 *  showing it. A player card wanting a season's game log cannot use that: it
 *  would have to install eighteen weeks over the top of the board's, and the
 *  board would then score the wrong week. So the card fetches just this
 *  player's rows and scores them HERE.
 *
 *  Deliberately the same body, not a second implementation: a game log that
 *  disagreed with the board about what a week was worth would be worse than no
 *  game log at all. `classicPoints` is now a two-line wrapper over it. */
export function classicPointsFrom(plays: RawPlay[], player: Player, sc?: number | Partial<ClassicScoring>, scoreAs?: Pos, slot?: string | null): number {
  const s = normalizeClassicScoring(sc);
  const pos = scoreAs ?? player.pos;
  let raw = 0, passYds = 0, rushYds = 0, recYds = 0, carries = 0, tackles = 0, cmps = 0, sacks = 0, pds = 0;
  let punts = 0, puntYds = 0;
  // Touchdowns he actually scored — only for a scoped rule's per-TD bonus
  // (0145). Counted from the same plays the points came from, so the two can
  // never disagree about what a touchdown was.
  let tds = 0;
  for (const p of plays) {
    raw += classicScorePlay(p, pos, s);
    if (p.td || p.kind === 'dst_td') tds++;
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
  // Two layers on top of the stat table, in the order a commissioner would
  // read them: the player's own flag (0144), then any SCOPED rules he matches
  // (0145 — "rookies ×1.5", "every Cowboy +2"). Scoped rules reach 🏈 NORMAL
  // leagues as of v0.277.0; before that they were drip-only, and a classic
  // league's rules simply sat dormant. Multipliers multiply, points add, and
  // a per-TD bonus pays on every touchdown he scored — the same arithmetic
  // sim.ts applies on the drip side, so one rule means one thing in both modes.
  const fr = flagRulesFor(player.id);
  const sa = scopedAdjustFor(player, { slot });
  return round1(raw * (fr.bonusMult ?? 1) * sa.mult + (fr.bonusPts ?? 0) + sa.pts + tds * sa.td);
}

export interface ClassicPick { slot: string; player: Player }
/** `slug` is null only for an UNFILLED spot carrying a zero-fill rule
 *  (v0.303.0): the spot scores, so it has to appear, but nobody played it. */
export interface ClassicSlotScore { win: string; side: 'home' | 'away'; slot: string; slug: string | null; metric: null; score: number }
export interface ClassicResult {
  home: number; away: number;
  slots: ClassicSlotScore[];
  states: { window: string; home: number; away: number }[];
}

/** BEST BALL (0159): fill the flagged slots with the highest-scoring eligible
 *  roster players NOT manually started — the founder's rule verbatim. Any
 *  stored pick in a best-ball slot is ignored (the slot fills itself), and a
 *  best-ball slot never blocks a manual pick: the manual set is what reserves
 *  players. Since v0.250.0 the fill is EXACT (assignByValue via
 *  bestballFillBy) rather than most-specific-first greedy — see the docblock
 *  there for the 0172 counterexample that retired the greedy. RET spots (0171)
 *  still rank candidates by RETURN production, which is exactly why the fill
 *  needs per-pair values. */
export function bestballFill(manual: ClassicPick[], bestball: string[], roster: Player[], week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicPick[] {
  // RET spots (0171) rank candidates by their RETURN production, since that's
  // all the spot will bank. Memoised per player, because a roster's worth of
  // classicPoints calls is the expensive part of this.
  const score = new Map<string, number>();
  const retScore = new Map<string, number>();
  return bestballFillBy(manual, bestball, roster, slots, (p, d) => {
    // Keyed by SPOT as well as player (v0.300.0): a scoped rule can pay
    // differently in different spots, so one player can be worth two numbers.
    const m = isRetSlot(d.pos) ? retScore : score;
    const key = `${d.slot}|${p.id}`;
    if (!m.has(key)) m.set(key, classicPoints(p, week, sc, isRetSlot(d.pos) ? 'RET' : undefined, d.slot));
    return m.get(key) ?? 0;
  });
}

/** The best-ball fill with the RANKING left to the caller — the same algorithm
 *  `bestballFill` runs, differing only in what "best" means.
 *
 *  It exists because a best-ball spot is EMPTY until somebody plays, so before
 *  kickoff the board showed those spots blank and left them out of the
 *  projected total — understating a best-ball team by however many spots it
 *  auto-fills. Pre-kickoff the boards rank by PROJECTION instead, which
 *  previews the lineup best ball will actually field.
 *
 *  Everything that decides WHO IS ELIGIBLE stays here, in one place, so the
 *  preview and the real fill can never disagree about anything except the
 *  number they sort on:
 *    • a player started MANUALLY elsewhere is out — the manual set is what
 *      reserves players (the founder's rule, verbatim since 0159);
 *    • a no_start flag (0144) binds the auto-fill too — the DB trigger only
 *      guards manual writes, so the exclusion has to live here;
 *    • one player fills at most one spot.
 *
 *  HOW THE FILL DECIDES (v0.250.0) — exact, not greedy. From 0159 to v0.249.0
 *  this walked spots most-specific-first, each taking its best remaining
 *  player, on the argument that "every flex's eligibility is a superset of the
 *  dedicated slots it follows". That was true when written and stopped being
 *  true the day 0172 let a spot carry its own player filter: spots
 *  [RB, FLEX(rookies only)] with a rookie RB worth 20 and a veteran RB worth
 *  18 — RB is more specific, went first, took the rookie, and the rookies-only
 *  flex was left holding a veteran it cannot legally seat. 20 points where 38
 *  was available, in the RESOLVER, every week.
 *
 *  Nor can this ride `optimalLineup`: that greedy needs each player to be
 *  worth ONE number, and a RET spot (0171) values him by return production
 *  while a flex values him in full. Per-pair values are a general assignment
 *  problem, so the fill runs `assignByValue` — every spot that CAN fill does,
 *  and among full fills the total is maximal. Equal-total arrangements are
 *  then canonicalized toward the old shape (the more specific spot keeps the
 *  bigger name), so the exact fill never LOOKS different from the greedy one
 *  except where the greedy was leaving points on the table. */
export function bestballFillBy(
  manual: ClassicPick[],
  bestball: string[],
  roster: Player[],
  slots: ClassicSlotDef[],
  valueOf: (p: Player, d: ClassicSlotDef) => number,
): ClassicPick[] {
  const bb = new Set(bestball);
  if (!bb.size) return [];
  const started = new Set(manual.filter((p) => !bb.has(p.slot)).map((p) => p.player.id));
  const cands = roster.filter((p) => !started.has(p.id) && !flagRulesFor(p.id).noStart);
  // Most-specific-first is no longer what decides who wins a player — but it
  // is still the ORDER the fills return in and the direction ties settle, so
  // the panel reads the same as it always has.
  const order = [...slots]
    .filter((d) => bb.has(d.slot))
    .sort((a, b) => a.pos.length - b.pos.length || (a.flt ? 0 : 1) - (b.flt ? 0 : 1));
  if (!order.length || !cands.length) return [];
  // The value matrix — evaluated once per pair; valueOf may be classicPoints.
  const w = order.map((d) => cands.map((c) => {
    if (!slotAllows(d, c)) return -Infinity;
    const v = valueOf(c, d);
    // GOLF (v0.303.0): the fill takes the LOWEST scorer there. Re-expressing
    // the value keeps this search — and its tie canonicalization below —
    // exactly as written; only what "more valuable" means changes.
    return golfValue(Number.isFinite(v) ? v : 0);
  }));
  const heldBy = assignByValue(order.length, cands.length, w);
  // Canonicalize ties: when two spots could swap occupants at the SAME total,
  // give the more specific (earlier) spot the more valuable player — the
  // arrangement the greedy always produced, so a dedicated RB spot shows the
  // star and the flex shows the leftover rather than the other way round.
  for (let pass = 0; pass < order.length; pass++) {
    let swapped = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const pi = heldBy[i], pj = heldBy[j];
        if (pi < 0 || pj < 0) continue;
        const cross = w[i][pj] + w[j][pi];
        if (!Number.isFinite(cross)) continue;
        if (Math.abs(cross - (w[i][pi] + w[j][pj])) < 1e-9 && w[i][pj] > w[i][pi] + 1e-9) {
          heldBy[i] = pj; heldBy[j] = pi; swapped = true;
        }
      }
    }
    if (!swapped) break;
  }
  const fills: ClassicPick[] = [];
  order.forEach((d, i) => { if (heldBy[i] >= 0) fills.push({ slot: d.slot, player: cands[heldBy[i]] }); });
  return fills;
}

// ── Which SPOT will a drafted player fill? (draft room's TEAMS panel) ────────
// The draft room used to list a team's picks as R1..R12. What a manager
// actually wants to know mid-draft is "what does my LINEUP look like" — the
// picks against the starting spots they will occupy, under the commissioner's
// own labels.
//
// This is an ASSIGNMENT problem, not a relabel. Since 0172 a spot carries its
// own player filter and since 0174 its own name, so eligibility sets OVERLAP
// without nesting: a player can be legal for several spots, and two spots can
// each be legal for a player the other needs. A first-fit walk therefore
// strands starters on the bench beside an empty spot they were eligible for —
// e.g. spots [FLEX, RB] and picks [RB1, WR1]: first-fit hands FLEX to RB1, and
// WR1 (FLEX-only) benches while RB sits empty. The panel would be showing a
// lineup that the league will not field, which is worse than R1..R12.
//
// So: MAXIMUM BIPARTITE MATCHING (Kuhn's augmenting paths). Never leaves a
// spot empty that some legal arrangement could fill, and never benches a
// player some legal arrangement could start. Two deliberate tie-breaks make it
// deterministic and honest about draft priority:
//   • players are processed in DRAFT ORDER, and Kuhn's never un-matches a
//     matched player — only moves them — so an earlier pick can never be
//     benched to seat a later one;
//   • a player takes a FREE eligible spot (in the league's own spot order)
//     before disturbing anyone, so RB1/RB2 land in RB/FLEX rather than being
//     shuffled through an augmenting path into FLEX/RB.
// Pure and score-free: at draft time nobody's points exist yet, so this answers
// only "who is legal where", the half of the question that is knowable. Once
// the season starts `bestballFill` does the score-driven half on top of the
// same `slotAllows` eligibility.
export interface SpotPlayer { id: string; pos: string; team?: string | null; exp?: number | null }
/** One starting spot and its occupant — `null` when nothing on the roster is
 *  legal for it yet (an unfilled spot is information, not an error). */
export interface SpotRow { def: ClassicSlotDef; player: SpotPlayer | null }
export interface SpotAssignment { spots: SpotRow[]; bench: SpotPlayer[] }

/** Kuhn's maximum bipartite matching over (spots × players), returning
 *  spot index → player index (-1 = nobody). Players are seated IN THE ORDER
 *  GIVEN, and the algorithm never un-seats anyone it has already seated — it
 *  only moves them along an augmenting path. That property is what makes the
 *  caller's ordering meaningful, and both callers exploit it: `assignSpots`
 *  feeds draft order so an earlier pick can't be benched for a later one, and
 *  `optimalLineup` feeds descending value so a better player can't be benched
 *  for a worse one. */
function matchSpots(slots: ClassicSlotDef[], players: SpotPlayer[]): number[] {
  // Eligible spot indices per player, in the league's spot order.
  const legal = players.map((p) => slots.flatMap((d, i) => (slotAllows(d, p) ? [i] : [])));
  const heldBy: number[] = new Array(slots.length).fill(-1);   // spot index → player index
  const seen: boolean[] = new Array(slots.length).fill(false);
  const seat = (pi: number): boolean => {
    // Free spots first: a player only displaces someone when they must.
    for (const si of legal[pi]) {
      if (!seen[si] && heldBy[si] === -1) { seen[si] = true; heldBy[si] = pi; return true; }
    }
    for (const si of legal[pi]) {
      if (seen[si]) continue;
      seen[si] = true;
      const held = heldBy[si];   // loop 1 already took any free spot; -1 can't happen, but never recurse on it
      if (held === -1 || seat(held)) { heldBy[si] = pi; return true; }
    }
    return false;
  };
  for (let pi = 0; pi < players.length; pi++) { seen.fill(false); seat(pi); }
  return heldBy;
}

/** Maximum-cardinality, maximum-value assignment with a PER-PAIR value —
 *  `w[si][pi]`, `-Infinity` = ineligible. Returns spot index → player index
 *  (-1 = unfilled).
 *
 *  This exists because `optimalLineup`'s matroid greedy needs each player to
 *  be worth the SAME number in every spot, and best ball breaks that: a RET
 *  spot (0171) values a player by his RETURN production while a flex values
 *  him in full, so "how good is he" has no single answer — it depends where
 *  he stands. That is a general assignment problem, and the method is
 *  SUCCESSIVE MOST-PROFITABLE AUGMENTING PATHS: grow the matching one spot at
 *  a time, always along the alternating path that adds the most value. The
 *  classic flow argument gives the invariant that pays for the loop: after k
 *  augmentations the matching is the most valuable one OF SIZE k, so the
 *  final matching is the most valuable one of MAXIMUM size. That lexicographic
 *  order — fill every spot you can, THEN maximize value — is best ball's own
 *  promise (0159): a flagged spot fills itself; it never stands empty to
 *  protect a total. (It also seats a negative-scoring player in an otherwise
 *  empty spot, exactly as the old fill did.)
 *
 *  Bellman–Ford rather than Dijkstra-with-potentials: unseating a player is a
 *  negative edge, the boards are at most ~20×~30, and the dumb-but-correct
 *  version is microseconds here. The epsilon on each relaxation stops float
 *  noise from re-improving a path forever; the round cap bounds it absolutely
 *  (a simple alternating path claims at most one new player per round). */
function assignByValue(nSlots: number, nPlayers: number, w: number[][]): number[] {
  const heldBy: number[] = new Array(nSlots).fill(-1);   // spot → player
  const seatOf: number[] = new Array(nPlayers).fill(-1); // player → spot
  for (;;) {
    // gain[pi]: the best profit of an alternating path that ends by seating
    // player pi at spot via[pi]. Paths START at a free spot…
    const gain: number[] = new Array(nPlayers).fill(-Infinity);
    const via: number[] = new Array(nPlayers).fill(-1);
    for (let si = 0; si < nSlots; si++) {
      if (heldBy[si] !== -1) continue;
      for (let pi = 0; pi < nPlayers; pi++) {
        if (w[si][pi] > gain[pi]) { gain[pi] = w[si][pi]; via[pi] = si; }
      }
    }
    // …and continue through SEATED players: claiming a seated player frees his
    // spot, which then claims somebody else — losing his value there, gaining
    // the newcomer's.
    for (let round = 0; round < nPlayers; round++) {
      let moved = false;
      for (let pi = 0; pi < nPlayers; pi++) {
        const si = seatOf[pi];
        if (si === -1 || gain[pi] === -Infinity) continue;
        const base = gain[pi] - w[si][pi];
        for (let pk = 0; pk < nPlayers; pk++) {
          const g = base + w[si][pk];
          if (g > gain[pk] + 1e-9) { gain[pk] = g; via[pk] = si; moved = true; }
        }
      }
      if (!moved) break;
    }
    // The path ends on a FREE player — the augmentation that grows the
    // matching. No reachable free player = no augmenting path = done.
    let end = -1;
    for (let pi = 0; pi < nPlayers; pi++) {
      if (seatOf[pi] === -1 && gain[pi] > -Infinity && (end === -1 || gain[pi] > gain[end])) end = pi;
    }
    if (end === -1) return heldBy;
    // Walk the path backwards, reseating as we go: each spot on it takes the
    // player the path gave it, displacing its old occupant one step down.
    for (let q = end, guard = 0; guard <= nPlayers; guard++) {
      const s = via[q];
      const old = heldBy[s];
      heldBy[s] = q; seatOf[q] = s;
      if (old === -1) break;
      q = old;
    }
  }
}

export function assignSpots(slots: ClassicSlotDef[], players: SpotPlayer[]): SpotAssignment {
  const heldBy = matchSpots(slots, players);
  const started = new Set(heldBy.filter((pi) => pi >= 0));
  return {
    spots: slots.map((d, si) => ({ def: d, player: heldBy[si] >= 0 ? players[heldBy[si]] : null })),
    bench: players.filter((_, pi) => !started.has(pi)),   // draft order, unchanged
  };
}

// ── The BEST lineup these players can field (v0.247.0) ──────────────────────
// `assignSpots` answers "who is LEGAL where" — the draft-room question, asked
// before anyone has points. Setting a lineup asks the harder one: of all the
// legal arrangements, WHICH SCORES MOST. Those are different problems, and the
// obvious answer to the second is wrong.
//
// The obvious answer was `bestballFillBy`'s until v0.250.0: walk the spots
// most-specific-first and give each its best remaining player. Its comment
// explained why that is optimal — "every flex's eligibility is a superset of
// the dedicated slots it follows" — and that WAS true when it was written.
// Since 0172 it isn't: a spot carries its own player filter, so a narrow
// spot's candidates are no longer a subset of a wide one's. Spots
// [RB, FLEX(rookies only)] with a rookie RB projected 20 and a veteran RB
// projected 18: RB is the more specific spot, goes first, takes the rookie —
// and the rookies-only flex is left with a veteran it cannot legally seat.
// 20 points, when 38 was available. (bestballFillBy now runs an exact
// assignment too — assignByValue — because RET spots give it PER-SLOT values
// this matroid greedy cannot carry.)
//
// So this is a MAXIMUM-WEIGHT assignment, and it has a clean exact answer that
// costs one sort on top of the matching we already do. The sets of players that
// can be started SIMULTANEOUSLY are the independent sets of a transversal
// matroid, and greedy is optimal on a matroid: walk players best-first and keep
// each one whose addition leaves the set still startable. `matchSpots` is
// exactly that test — it seats a player iff an augmenting path exists, and never
// un-seats anyone — so feeding it players in descending value order IS the
// greedy, and the result is provably the highest-scoring legal lineup. Because
// every value is non-negative it is also a MAXIMUM-SIZE one: no spot sits empty
// that some arrangement could have filled.
//
// `valueOf` is the caller's, exactly as in `bestballFillBy` — projections
// before kickoff, real points after — so this never has an opinion about what
// "best" means, only about how to arrange it.
// Generic in the player type so a caller holding full engine `Player`s gets
// `Player`s back — `classicLineup` needs the real objects to score, and a cast
// at the boundary would be a lie the compiler stopped checking.
export function optimalLineup<T extends SpotPlayer>(
  slots: ClassicSlotDef[],
  players: T[],
  valueOf: (p: T) => number,
): { spots: { def: ClassicSlotDef; player: T | null }[]; bench: T[] } {
  // Value once per player: `matchSpots` is called on the sorted list, and a
  // comparator that re-derives a projection per comparison is the expensive
  // half of this on a full roster.
  // GOLF (v0.303.0): "best" means LOWEST there, so the value is re-expressed
  // rather than the search rewritten — inverting here means every caller of
  // optimalLineup inherits it and none of them can forget.
  const val = players.map((p) => golfValue(valueOf(p) || 0));
  // Ties break toward the input order (stable), so two players a league values
  // identically always land the same way round.
  const order = players.map((_, i) => i).sort((a, b) => val[b] - val[a] || a - b);
  const byValue = order.map((i) => players[i]);
  const heldBy = matchSpots(slots, byValue);
  const started = new Set(heldBy.filter((pi) => pi >= 0).map((pi) => order[pi]));
  return {
    spots: slots.map((d, si) => ({ def: d, player: heldBy[si] >= 0 ? byValue[heldBy[si]] : null })),
    bench: players.filter((_, i) => !started.has(i)),   // input order, unchanged
  };
}

// ── AUTO-SLOT: the lineup a team starts the week with (v0.247.0) ────────────
// A classic team used to begin every week EMPTY, and a manager who never opened
// the app scored an honest zero. Normal fantasy doesn't work that way: your
// lineup is already set — optimally, from what you own — and you adjust it.
//
// The whole design rests on one distinction: a spot with NO STORED ROW has
// never been decided, while a spot holding a NULL is a manager who deliberately
// emptied it. Only the first kind gets filled. That is what makes auto-slot
// safe to re-run every worker tick and safe to run on both the worker and the
// board: it can add a decision, never overwrite one.
//
//   • spots that already have a row are left exactly as they are — including
//     the ones a manager cleared;
//   • players standing in those spots are RESERVED, so the fill can't start
//     someone twice;
//   • best-ball spots are skipped entirely — they fill themselves at scoring
//     time and a stored row there is ignored anyway (0159);
//   • a no_start flag (0144) binds this the same way it binds the best-ball
//     fill, because the DB trigger only guards a manager's own writes.
export function autoSlotPlan(
  slots: ClassicSlotDef[],
  bestball: string[],
  stored: Record<string, string | null | undefined>,
  roster: SpotPlayer[],
  valueOf: (p: SpotPlayer) => number,
): { slot: string; player: string }[] {
  const bb = new Set(bestball);
  const open = slots.filter((d) => !bb.has(d.slot) && !Object.prototype.hasOwnProperty.call(stored, d.slot));
  if (!open.length) return [];
  const taken = new Set(Object.entries(stored)
    .filter(([slot, slug]) => slug && !bb.has(slot)).map(([, slug]) => slug as string));
  const cands = roster.filter((p) => !taken.has(p.id) && !flagRulesFor(p.id).noStart);
  if (!cands.length) return [];
  return optimalLineup(open, cands, valueOf).spots
    .flatMap((r) => (r.player ? [{ slot: r.def.slot, player: r.player.id }] : []));
}

// ── Moving a player between spots (the picker's other half) ────────────────
// The picker used to offer only BENCH players, which made the obvious move —
// "put my TE in the flex" — a two-step dance: empty the TE spot, then fill the
// flex. Offering a player who is already starting somewhere raises a question
// the UI must answer the same way on both hosts, so the answer lives here.
//
// SWAP IF YOU CAN, MOVE IF YOU MUST. If the player I'm bringing in currently
// holds another spot, that spot needs filling, and the natural filler is
// whoever I'm displacing — but only if he is LEGAL there. A running back
// displaced from a flex cannot be dropped into a TE spot, and doing it anyway
// would write a lineup the resolver won't field. So:
//   • target spot's occupant is eligible for the vacated spot → SWAP them;
//   • otherwise → MOVE, and the vacated spot is left EMPTY rather than filled
//     with someone who cannot legally stand there.
// Either way the vacated spot is explicitly written, because "he moved out of
// S3" is a change to S3 that has to reach the server.
export interface SpotMove { slot: string; player: string | null }

export function planSpotMove(
  slots: ClassicSlotDef[],
  lineup: Record<string, string | null | undefined>,
  target: string,
  incoming: string,
  eligible: (slot: string, slug: string) => boolean,
): SpotMove[] {
  const from = slots.find((d) => d.slot !== target && lineup[d.slot] === incoming)?.slot ?? null;
  const displaced = lineup[target] ?? null;
  if (!from) return [{ slot: target, player: incoming }];
  return [
    { slot: target, player: incoming },
    { slot: from, player: displaced && eligible(from, displaced) ? displaced : null },
  ];
}

/** One side of a classic matchup. `bestball` + `roster` drive the auto-fill;
 *  without them the side is fully manual (the 0157 behavior, unchanged).
 *
 *  `hasLineup` answers "does this side have STORED ROWS", which is not the same
 *  question as "does `picks` have entries": callers filter picks down to rows
 *  holding a player, so a manager who deliberately emptied every spot arrives
 *  here looking identical to a seat that never had a lineup at all. The
 *  unmanaged-seat fallback below turns on exactly that distinction, so it has
 *  to be passed rather than inferred. Omitted → inferred from `picks`, which is
 *  right for every caller that has no rows to speak of. */
export interface ClassicSide {
  picks: ClassicPick[]; roster?: Player[]; bestball?: string[]; hasLineup?: boolean;
  /** Slugs provably ruled out (injury O/IR) for this week — the caller's own
   *  evidence (the worker reads injury_status). Feeds the unmanaged seat's
   *  value function; never a guess, so absent means no claim. */
  ruledOut?: Set<string>;
}

// ── What a player is WORTH to an auto-fill (v0.252.0) ───────────────────────
// PROJ_2026 is a SEASON constant — it does not know that week 7 is a player's
// bye or that he was ruled Out on Friday. Every auto-fill that ranked by it
// raw would happily seat a 20-point projection who is guaranteed to score
// zero: the worker's Tuesday auto-slot, the boards' on-open fill, the
// best-ball preview, and the unmanaged seat's computed lineup — which is the
// worst of them, because no manager exists to fix it.
//
// AND IT DOES NOT KNOW THE LEAGUE'S RULES EITHER (v0.310.0). That was the same
// bug in a second coat: a league paying 6 for a passing touchdown, or a TE
// premium, ranked its candidates by STOCK PPR, so auto-slot could seat the
// wrong player on a seat with no manager to correct it. The value now runs
// through `projectedPoints`, which is the number the board shows for the same
// player — so the fill and the board cannot disagree about who is better.
//
// It passes NO SLOT, on purpose. This ranks a player before anyone knows which
// spot he lands in, and `scopedAdjustFor` already defines the honest answer for
// that: a spot-scoped rule stands aside where there is no spot. Position-scoped
// rules and the whole catalog still apply, which is the part that reorders a
// roster. A caller with no `pos` on its rows keeps every catalog knob except
// the position reception premium — degraded, never zero.
//
// So the fills rank by THIS: the projection, zeroed when the player provably
// cannot score. Two zeroes, both under the house no-guess rule (the same one
// isBye and slotAllows follow):
//   • BYE — a KNOWN team absent from a LOADED slate. An unknown team is never
//     a bye, and an empty slate zeroes nobody. Teams normalize on BOTH sides,
//     because the pool says LAR/WSH/JAC where the slate says LA/WAS/JAX, and
//     an un-normalized compare would bench every Rams player as a phantom bye.
//   • RULED OUT — only through the caller's own predicate. Deliberately NOT
//     injuryFor by default: that helper falls back to the BAKED 2025 report
//     when no live feed is installed and the season was never set, which is
//     exactly the server's resting state — the worker would have benched 2026
//     players for last year's injuries. No predicate, no claim. (Q and D stay
//     at full value even with a predicate available: doubtful players play
//     often enough that auto-benching them would overrule real decisions.)
//
// `slate` rows are the caller's own (the board's liveSlate, the worker's tick
// slate). Omitted, the module slate answers — the runtime override the worker
// installs each tick, else the baked 2025 slate, which is correct for exactly
// the 2025 replay path that uses it.
export function slateAwareProj(
  week: number,
  slate?: { home?: string | null; away?: string | null }[] | null,
  ruledOut?: (slug: string) => boolean,
): (p: { id: string; pos?: string | null; team?: string | null }) => number {
  const onBye = (team: string | null | undefined): boolean => {
    const t = normTeam(team ?? '');
    if (!t) return false;                          // unknown team: no claim
    if (Array.isArray(slate)) {
      if (!slate.length) return false;             // unloaded slate: no claim
      return !slate.some((g) => normTeam(g.home ?? '') === t || normTeam(g.away ?? '') === t);
    }
    return hasSlate(week) && !nflGameForTeam(week, t);
  };
  return (p) => {
    if (ruledOut?.(p.id)) return 0;
    if (onBye(p.team)) return 0;
    return projectedPoints({ id: p.id, pos: p.pos ?? '', team: p.team });
  };
}

// ── The seat nobody manages (v0.248.0) ─────────────────────────────────────
// `sealed_pick.app_user_id` is `not null references app_user(id)`, so a seat
// with no claimed manager has NOWHERE to store a lineup. The worker's auto-slot
// therefore cannot reach one, and in the founder's own leagues that is seven
// seats out of eight — every one of them fielding nothing and losing 0–x every
// week while its roster sat on the bench.
//
// It doesn't need a row. `PROJ_2026` is a baked constant, so "the best lineup
// this roster can field" is the SAME ANSWER all week — which means it can be
// computed at scoring time instead of stored, and the boards and the resolver
// reach it through this one function and cannot disagree. (The one thing that
// would move it is re-baking proj2026.ts mid-week; nothing is frozen against
// that, and freezing it would need the row we haven't got.)
//
// It fires only when the side has NO STORED ROWS. A seat the worker has written
// is a managed seat, and everything it stored — including a spot cleared on
// purpose — stands exactly as stored. So this can never overrule a manager; it
// only speaks for seats that have no manager to overrule.
function unmanagedStart(s: ClassicSide, slots: ClassicSlotDef[], bb: Set<string>, week: number): ClassicPick[] {
  const roster = s.roster ?? [];
  if (!roster.length) return [];
  const open = slots.filter((d) => !bb.has(d.slot));
  const cands = roster.filter((p) => !flagRulesFor(p.id).noStart);
  // Slate-aware (v0.252.0): a bye or ruled-out player is worth zero here, so
  // the computed lineup benches him for the best healthy body — the one
  // correction no manager exists to make on this seat.
  const value = slateAwareProj(week, undefined, s.ruledOut ? (slug) => s.ruledOut!.has(slug) : undefined);
  return optimalLineup(open, cands, value)
    .spots.flatMap((r) => (r.player ? [{ slot: r.def.slot, player: r.player }] : []));
}

/** A side's EFFECTIVE lineup: manual picks (best-ball slots' stored rows
 *  ignored) + the best-ball fills. Exported so the boards can render exactly
 *  what the resolver scores. */
export function classicLineup(s: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicPick[] {
  const bb = new Set(s.bestball ?? []);
  const manual = s.picks.filter((p) => !bb.has(p.slot));
  // An unmanaged seat's auto-lineup takes the MANUAL side of the contract: it
  // reserves its players against the best-ball fill exactly as a set lineup
  // would, so one player can't be started twice.
  const stored = s.hasLineup ?? s.picks.length > 0;
  const started = stored ? manual : unmanagedStart(s, slots, bb, week);
  return [...started, ...bestballFill(started, s.bestball ?? [], s.roster ?? [], week, sc, slots)];
}

/** Resolve one classic matchup: each starter's points, summed — nothing else.
 *  Slot order follows the league's configured lineup so both boards render
 *  the shape the commissioner built. */
export function resolveClassicMatchup(home: ClassicSide, away: ClassicSide, week: number, sc?: number | Partial<ClassicScoring>, slots: ClassicSlotDef[] = CLASSIC_SLOTS): ClassicResult {
  const scoring = normalizeClassicScoring(sc);
  // Slot order is now the walk order (v0.303.0) rather than a sort key: rows
  // are produced FROM `slots`, so they come out in the league's shape already.
  // RET spots (0171) score their occupant as a RETURNER — return production
  // only — no matter what else the player did that day.
  const specOf = new Map(slots.map((s) => [s.slot, s.pos as string[]]));
  const side = (s: ClassicSide, which: 'home' | 'away') => {
    const filled = new Map(classicLineup(s, week, scoring, slots).map((p) => [p.slot, p.player]));
    // THE ZERO-FILL RULE (v0.303.0) is why this walks the SLOTS rather than the
    // picks: a spot nobody filled now scores, so it has to produce a row. A
    // spot with no rule and no player produces nothing, exactly as before.
    const rows: ClassicSlotScore[] = [];
    for (const d of slots) {
      const player = filled.get(d.slot);
      const raw = player
        ? classicPoints(player, week, scoring, isRetSlot(specOf.get(d.slot) ?? []) ? 'RET' : undefined, d.slot)
        : 0;
      // The resolver runs on FINAL numbers, so every spot is settled here.
      const score = zeroFill(raw, d.zeroPts);
      if (!player && score === 0) continue;
      rows.push({ win: CLASSIC_WIN, side: which, slot: d.slot, slug: player?.id ?? null, metric: null, score });
    }
    return { rows, total: round1(rows.reduce((s2, r) => s2 + r.score, 0)) };
  };
  const h = side(home, 'home'), a = side(away, 'away');
  return {
    home: h.total, away: a.total,
    slots: [...h.rows, ...a.rows],
    states: [{ window: CLASSIC_WIN, home: h.total, away: a.total }],
  };
}
