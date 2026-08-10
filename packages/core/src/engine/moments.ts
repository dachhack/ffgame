import type { PbpEvent } from '../types';

// ── Moments — the drama layer over the engine's event stream ────────────────
//
// Pure classification + extraction of the beats a viewer experiences as DRAMA:
// nukes, counter-nukes, shutdowns, erases, hot ignitions, in-slot lead flips,
// walk-off flips and photo finishes. One source of truth, shared by:
//   • the live board's moment banners (src/screens/Matchup.tsx)
//   • the week-recap top-moments strip (src/screens/MatchupFinal.tsx)
//   • the drama audit (tools/playtester/drama.mjs)
//
// The engine reuses effect type 'nuke' for several distinct beats (and for
// turnovers, which wipe nothing); the effect TEXT is the stable discriminator —
// every branch below matches a literal push site in src/engine/sim.ts.

export type MomentKind =
  | 'nuke'        // TD under a nuke metric wiped the opponent's bank (+ blackout)
  | 'counter'     // counter-nuke reflected the wipe back onto the attacker
  | 'shutdown'    // K NEG 6th kick negated the matched opponent
  | 'carrywipe'   // WR/TE carry wipe (unlock) zeroed the opponent
  | 'tenuke'      // TE TD knocked an opposing drip's rate (cross-slot)
  | 'erase'       // a catch erased a window of the opponent's recent scoring
  | 'hot'         // a drip ignited HOT (2×)
  | 'flip'        // the slot lead changed hands mid-game
  | 'walkoff'     // ...in the final 5 game-minutes
  | 'photo';      // the slot finished within 3 points

export interface EventKind { kind: MomentKind | 'turnover'; pts: number }

/** Classify one engine event's dramatic beat (null = not a drama beat).
 *  `pts` is the magnitude the beat swung (wiped / negated / erased points). */
export function classifyEvent(e: PbpEvent): EventKind | null {
  const t = e.effect?.text ?? '';
  if (e.effect?.type === 'nuke') {
    if (t.startsWith('✕ TURNOVER')) return { kind: 'turnover', pts: 0 };
    if (t.startsWith('✕ SHUTDOWN')) return { kind: 'shutdown', pts: wipedPts(t) };
    if (t.startsWith('✕ CARRY WIPE')) return { kind: 'carrywipe', pts: wipedPts(t) };
    if (t.startsWith('DRIP NUKED')) return { kind: 'tenuke', pts: 0 };
    if (t.startsWith('✕ TD') || t.startsWith('✕ NUKE')) return { kind: 'nuke', pts: wipedPts(t) };
    return null;
  }
  if (e.effect?.type === 'erase' && t.startsWith('ERASE −')) return { kind: 'erase', pts: erasedPts(t) };
  // wentHot marks the event `coin`; the only other coin source is a nuke-type effect.
  if (e.coin) return { kind: 'hot', pts: 0 };
  return null;
}

/** Whether a nuke-class beat was reflected by counter-nuke (the suffix sim.ts appends). */
export const wasCountered = (e: PbpEvent): boolean => (e.effect?.text ?? '').includes('↩ COUNTER-NUKE');

const wipedPts = (t: string): number => {
  const m = /wiped(?: drip)? ([\d.]+)|negated ([\d.]+)|WIPE −([\d.]+)/.exec(t);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
};
const erasedPts = (t: string): number => {
  const m = /ERASE −([\d.]+)/.exec(t);
  return m ? Number(m[1]) : 0;
};

export interface Moment {
  kind: MomentKind;
  clock: number;              // game seconds within the slot's window
  win: string;                // window id ('tnf' | 'early' | ...)
  slotKey: string;
  side: 'you' | 'their';      // the side that DID the thing (benefits from it)
  icon: string;
  title: string;
  detail: string;             // plain-English, names included — screenshot-ready
  magnitude: number;          // ranking weight for the recap (≈ points swung)
}

const ICONS: Record<MomentKind, string> = {
  nuke: '💥', counter: '↩️', shutdown: '✕', carrywipe: '💥', tenuke: '📉',
  erase: '🩸', hot: '🔥', flip: '⇄', walkoff: '🚨', photo: '📸',
};

/** Accent color per moment kind (theme-var based, same palette as the log FX). */
export const MOMENT_COLOR: Record<MomentKind, string> = {
  nuke: 'var(--fx-nuke, #FF4F62)', carrywipe: 'var(--fx-nuke, #FF4F62)', shutdown: 'var(--fx-nuke, #FF4F62)',
  counter: 'var(--fx-mult, #C58BFF)', tenuke: 'var(--fx-reset, #5BC0EB)', erase: 'var(--fx-erase, #FF8A3D)',
  hot: 'var(--fx-streak, #36D399)', flip: 'var(--warn, #F4C95D)', walkoff: 'var(--warn, #F4C95D)', photo: 'var(--you, #36D399)',
};

export interface SlotNames { you: string; their: string }

/** Extract the dramatic moments of one resolved slot, in clock order.
 *  `reg` = regulation seconds (3600 real weeks / 3300 synthetic). */
export function slotMoments(events: PbpEvent[], names: SlotNames, win: string, slotKey: string, reg = 3600): Moment[] {
  const out: Moment[] = [];
  const actorName = (side: 'you' | 'their') => (side === 'you' ? names.you : names.their);
  const victimName = (side: 'you' | 'their') => (side === 'you' ? names.their : names.you);

  let lead: 1 | -1 | 0 = 0;
  let lastYou = 0, lastTheir = 0;
  for (const e of events) {
    const c = classifyEvent(e);
    if (c && c.kind !== 'turnover') {
      const side = c.kind === 'tenuke' ? (e.side === 'you' ? 'their' : 'you') : e.side; // tenuke events sit on the VICTIM's side
      const base: Omit<Moment, 'kind' | 'title' | 'detail' | 'magnitude' | 'icon'> = { clock: e.clock, win, slotKey, side };
      switch (c.kind) {
        case 'nuke':
        case 'carrywipe':
          if (wasCountered(e)) {
            const other = side === 'you' ? 'their' : 'you';
            out.push({ ...base, side: other, kind: 'counter', icon: ICONS.counter, title: 'COUNTER-NUKE', magnitude: c.pts + 14, detail: `${actorName(side)}’s nuke reflected — ${victimName(side)} shrugs it off and ${actorName(side)} is wiped instead` });
          } else {
            out.push({ ...base, kind: c.kind, icon: ICONS[c.kind], title: c.kind === 'nuke' ? 'NUKE' : 'CARRY WIPE', magnitude: c.pts + 10, detail: c.pts >= 5 ? `${actorName(side)} wipes ${victimName(side)}’s ${c.pts.toFixed(1)} banked — slot blacked out 10 min` : `${actorName(side)} detonates on ${victimName(side)} — slot blacked out 10 min` });
          }
          break;
        case 'shutdown':
          out.push({ ...base, kind: 'shutdown', icon: ICONS.shutdown, title: 'SHUTDOWN', magnitude: c.pts + 12, detail: `${actorName(side)}’s 6th kick negates ${victimName(side)} — ${c.pts.toFixed(1)} gone for good` });
          break;
        case 'tenuke':
          out.push({ ...base, kind: 'tenuke', icon: ICONS.tenuke, title: 'DRIP NUKED', magnitude: 4, detail: `a TE touchdown knocks ${victimName(side)}’s drip rate${(e.effect?.text ?? '').includes('HOT killed') ? ' — and kills the hot streak' : ''}` });
          break;
        case 'erase':
          out.push({ ...base, kind: 'erase', icon: ICONS.erase, title: 'ERASE', magnitude: c.pts + 4, detail: `${actorName(side)} erases ${c.pts.toFixed(1)} of ${victimName(side)}’s recent drip` });
          break;
        case 'hot':
          out.push({ ...base, kind: 'hot', icon: ICONS.hot, title: 'HOT STREAK', magnitude: 6, detail: `${actorName(side)} ignites — the drip runs 2×` });
          break;
      }
    }
    // In-slot lead flips: meaningful only once both banks are real (≥10) and the
    // game has settled (>10 min in). A flip in the final 5 minutes is a walk-off.
    const m = e.youBank - e.theirBank > 1e-9 ? 1 : e.theirBank - e.youBank > 1e-9 ? -1 : 0;
    if (m !== 0 && lead !== 0 && m !== lead && e.clock > 600 && Math.min(e.youBank, e.theirBank) >= 10) {
      const side = m === 1 ? 'you' : 'their';
      const walkoff = e.clock >= reg - 300;
      out.push({
        kind: walkoff ? 'walkoff' : 'flip', clock: e.clock, win, slotKey, side,
        icon: walkoff ? ICONS.walkoff : ICONS.flip, title: walkoff ? 'WALK-OFF FLIP' : 'LEAD FLIP',
        magnitude: walkoff ? 9 : 5,
        detail: `${actorName(side)} takes the slot lead${walkoff ? ' in the final minutes' : ''} — up ${Math.abs(e.youBank - e.theirBank).toFixed(1)}`,
      });
    }
    if (m !== 0) lead = m;
    lastYou = e.youBank; lastTheir = e.theirBank;
  }
  // Photo finish: the slot closed within 3 with real scores on both sides.
  if (events.length && Math.abs(lastYou - lastTheir) <= 3 && Math.min(lastYou, lastTheir) >= 15) {
    const side = lastYou >= lastTheir ? 'you' : 'their';
    out.push({
      kind: 'photo', clock: events[events.length - 1].clock, win, slotKey, side,
      icon: ICONS.photo, title: 'PHOTO FINISH', magnitude: 7,
      detail: `${actorName(side)} edges it ${Math.max(lastYou, lastTheir).toFixed(1)}–${Math.min(lastYou, lastTheir).toFixed(1)}`,
    });
  }
  return out;
}

/** The recap's top-N: rank by magnitude, then earliest first for stable ties. */
export function topMoments(all: Moment[], n = 4): Moment[] {
  return [...all].sort((a, b) => b.magnitude - a.magnitude || a.clock - b.clock).slice(0, n);
}
