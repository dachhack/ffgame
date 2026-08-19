// GOLF MODE (v0.303.0, founder: "the second change is that lowest point total
// wins rather than highest").
//
// One league setting, and it inverts the meaning of a score everywhere a score
// is compared. That is a bigger blast radius than it sounds, so it lives in one
// module with one question — `leagueIsGolf()` — rather than as a boolean
// threaded through forty signatures, and it follows exactly the contract the
// other per-league engine caches already use (setLeagueScoring, setLeagueFlags,
// setLiveInjuries): the client installs it when a board loads and clears it on
// exit; the worker sets it synchronously before EACH matchup's resolve.
//
// WHAT INVERTS, and what deliberately doesn't:
//
//   • WHO WINS — the matchup, the standings, a playoff game, a consolation
//     rung. Decided server-side; `betterScore` is the client's copy of the same
//     rule so a board never disagrees with the row it is drawing.
//   • WHAT "BEST LINEUP" MEANS — auto-slot, the unmanaged-seat fallback, and
//     best ball all pick the LOWEST scorer in a golf league. Not inverting this
//     would leave the app confidently setting the lineup most likely to lose,
//     every week, for every seat with no manager sitting in it.
//   • THE PLAYERS THEMSELVES do not change. Nobody scores negative points and
//     no metric flips sign — a touchdown is still worth what the catalog says.
//     Golf changes which end of the leaderboard you are aiming at, nothing
//     about how the number is made.
//
// A ZERO IS NOT A LOW SCORE, IT IS AN ABSENCE. `golfValue` sends a player worth
// zero to the BACK of the golf ordering rather than the front: a zero is a bye,
// a ruled-out player, or somebody the projection doesn't know, and starting a
// body who will not play is never the plan. It is also the case the zero-fill
// rule exists to punish — a spot that scores nothing takes the league's
// designated points instead, which in golf is the worst thing that can happen
// to it.

let golf = false;

/** Install the league's rule. */
export function setLeagueGolf(on?: boolean | null): void { golf = on === true; }
export function clearLeagueGolf(): void { golf = false; }
/** Does this league play golf — lowest total wins? */
export function leagueIsGolf(): boolean { return golf; }

/** Does `a` beat `b` under the league's rule? Ties are not wins either way. */
export function betterScore(a: number, b: number): boolean {
  return golf ? a < b : a > b;
}

/** Sort comparator that puts the LEADER first, whichever end that is. */
export function leaderFirst(a: number, b: number): number {
  return golf ? a - b : b - a;
}

// Big enough that flipping a value never makes "fill this spot" look worse than
// leaving it empty, which is the one property the assignment search relies on.
const GOLF_BIG = 1_000_000;

/** A player's value RE-EXPRESSED so that "higher is better" stays true — the
 *  single adaptation every lineup search needs. In a normal league it is the
 *  identity. In golf a smaller score is worth more, and a score of exactly zero
 *  is worth nothing at all (see the docblock: a zero is an absence). */
export function golfValue(v: number): number {
  if (!golf) return v;
  return v > 0 ? GOLF_BIG - v : 0;
}

/** THE ZERO-FILL RULE (v0.303.0, founder: "any unfilled starting roster spot or
 *  any starting roster spot that gets 0 points in a week gets assigned a
 *  designated point total (usually 10)"). Per-spot, because that is how the
 *  founder described it — a rule you add to each roster spot — and because a
 *  league may well want it on the flex and not on the quarterback.
 *
 *  `settled` is what keeps a live board honest: a player at zero in the second
 *  quarter has not scored nothing, he has not scored YET, and paying the fill
 *  early would show a total that walks backwards when he catches a pass. An
 *  EMPTY spot is settled the moment the week starts — nobody is going to play
 *  it — so it takes the fill immediately. */
export function zeroFill(raw: number, zeroPts?: number | null, settled = true): number {
  if (zeroPts == null) return raw;
  return settled && raw === 0 ? zeroPts : raw;
}
