// ── WHAT A VAMPIRE NOBODY MANAGES TAKES (v0.427.0) ─────────────────────────
//
// Founder: "Let's have the bot vampire take a bite." The format (0222/0268):
// a vampire that WINS its matchup steals one player from the beaten team's
// active roster and gives one of its own back — one bite per win, only while
// the win is fresh. A vampire seat nobody manages could win every week and
// never feed. This is the decision half, pure like seatWaivers.ts: two
// rosters in, ranked bites out, no database and no clock. The worker
// (server/src/vampireBite.js) reads the window, spends the answer through
// vampire_steal (0300 lets it), and tries the next bite when the RPC refuses
// one — a position cap, a stash, a roster that moved since.
//
// ── THE POLICY ───────────────────────────────────────────────────────────────
// A bite is a SEASON-LONG acquisition, so it is judged by rest-of-season
// value (the season projection; zero for a season-ending IR), never by this
// week's slate — a star on his bye is exactly who a vampire should take.
//
//   • Rank by what the bite adds to the best lineup the vampire can field
//     (lineupValue after − before), because a third RB behind two better
//     ones adds nothing on Sunday however good he looks in isolation.
//   • Then by the raw asset swing (take − give), so two bites that lift the
//     lineup equally prefer the better player and the cheaper give-back.
//   • NEVER give back a player worth more for the season than the one taken.
//     That is the one hard rail: a bite is a win's reward, and a reward is
//     never a downgrade. Pairs below it are not ranked low — they are not
//     offered.
//   • A player worth nothing for the season (IR, or unknown to the bake) is
//     never taken; there is no reward in him.
//
// The vampire gives back from its ACTIVE roster only — the worker hands only
// active bodies in — so a stash is never the price of a bite, mirroring the
// rule that the victim's stash is off the menu (0222).
import type { ClassicSlotDef, SpotPlayer } from './classic';
import { optimalLineup } from './classic';

export interface Bite {
  take: string;
  give: string;
  /** Rest-of-season points per week the bite adds to the best lineup. */
  gain: number;
  /** ros(take) − ros(give): the raw asset swing. */
  swing: number;
}

export interface BiteOpts {
  /** How many ranked bites to hand back — the worker tries them in order
   *  until the RPC accepts one. Default 5. */
  max?: number;
}

function lineupValue(slots: ClassicSlotDef[], roster: SpotPlayer[], valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number): number {
  return optimalLineup(slots, roster, valueOf).spots
    .reduce((n, r) => n + (r.player ? valueOf(r.player, r.def) : 0), 0);
}

/**
 * The bites a vampire should declare, best first.
 *
 * `mine` is the vampire's active roster, `theirs` the beaten team's active
 * roster, `rosValueOf` the rest-of-season value (the worker passes the
 * season projection under the league's catalog, zero for IR).
 */
export function vampireBitePlan(
  slots: ClassicSlotDef[],
  mine: SpotPlayer[],
  theirs: SpotPlayer[],
  rosValueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number,
  opts: BiteOpts = {},
): Bite[] {
  const max = Math.max(0, opts.max ?? 5);
  if (!max || !slots.length || !mine.length || !theirs.length) return [];
  const base = lineupValue(slots, mine, rosValueOf);
  const bites: Bite[] = [];
  for (const take of theirs) {
    const tv = rosValueOf(take);
    if (!(tv > 0)) continue;                                  // nothing to feed on
    if (mine.some((p) => p.id === take.id)) continue;         // already ours (a stale read)
    for (const give of mine) {
      const gv = rosValueOf(give);
      if (gv > tv) continue;                                  // the rail: never a downgrade
      const next = mine.filter((p) => p.id !== give.id).concat(take);
      bites.push({ take: take.id, give: give.id, gain: lineupValue(slots, next, rosValueOf) - base, swing: tv - gv });
    }
  }
  bites.sort((a, b) => (b.gain - a.gain) || (b.swing - a.swing)
    || a.take.localeCompare(b.take) || a.give.localeCompare(b.give));
  return bites.slice(0, max);
}
