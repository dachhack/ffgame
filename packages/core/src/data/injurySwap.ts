// THE INJURY SWAP (v0.738.0, 0531). Founder: "We need to focus on the last
// minute Injury outs. What's a fair way for a swap that won't break the game?
// We don't want to have users put in a player and swap them last minute as
// way to trick their opponents."
//
// In the LOCKED HOUR (a window has locked and has not kicked off) a starter
// the injury report rules out — Out or IR, never Questionable — can be
// replaced, free, once per spot, like for like: a man on your roster at the
// same position whose team plays in this same window and who is not already
// in your lineup. The metric stays. The server (injury_swap) is the
// authority and checks every line of that itself; this module decides what
// the boards OFFER, so the phone and the web offer the same thing.
import type { AimPhase } from './aimRules';

/** The designations that rule a player out. */
export const INJURY_SWAP_STATUSES: ReadonlySet<string> = new Set(['O', 'IR']);
export const isRuledOut = (status: string | null | undefined): boolean => !!status && INJURY_SWAP_STATUSES.has(status);

/** Is the injury swap offered on this spot right now? */
export function injurySwapOffered(o: { phase: AimPhase; status: string | null | undefined; swapped: boolean }): boolean {
  return o.phase === 'locked' && isRuledOut(o.status) && !o.swapped;
}

export interface InjurySwapMan { slug: string; pos: string }
/** Who can go in: same position as the man coming out, his team in THIS
 *  window ('any' is a window-less board and never qualifies — the server asks
 *  for the window by name), on the active roster, and not already fielded. */
export function injurySwapCandidates<T extends InjurySwapMan>(roster: readonly T[], o: {
  outPos: string; win: string;
  windowOf: (slug: string) => string | null | undefined;
  groupOf: (slug: string) => string | null | undefined;
  fielded: ReadonlySet<string>;
}): T[] {
  const pos = o.outPos.toUpperCase();
  return roster.filter((p) => p.pos.toUpperCase() === pos
    && o.windowOf(p.slug) === o.win
    && !o.fielded.has(p.slug)
    && o.groupOf(p.slug) !== 'ir' && o.groupOf(p.slug) !== 'taxi');
}

/** The server's refusal, in a league member's words. */
export function injurySwapRefusal(code: string | null | undefined): string {
  switch (code) {
    case 'window not locked': return 'This window hasn’t locked yet — change the lineup the normal way.';
    case 'window kicked off': return 'This window has kicked off — the injury swap closes at kickoff.';
    case 'not ruled out': return 'He isn’t listed Out or on IR on the injury report.';
    case 'already swapped': return 'This spot has already used its injury swap this week.';
    case 'different position': return 'The replacement has to play the same position.';
    case 'not in this window': return 'The replacement’s team doesn’t play in this window.';
    case 'already in your lineup': return 'He is already in your lineup.';
    case 'on ir or taxi': return 'He is on your IR or taxi squad.';
    case 'not your player': return 'He isn’t on your roster.';
    case 'no pick at slot': return 'There is nobody in that spot to swap out.';
    case 'matchup final': return 'This matchup is final.';
    default: return code ? `The swap was refused (${code}).` : 'The swap was refused.';
  }
}
