// ── WHAT A FAAB CLAIM IS WORTH ON THIS LEAGUE'S WIRE (v0.428.0) ─────────────
//
// Founder: "Waiver wire can be a frenzy. We need a good way for AIs to make
// FAAB bids with competitive valuations without over bidding as much as
// possible." A guillotine league is the sharpest case: every week the chopped
// roster lands on the wire whole, and a dozen managers bid on the same three
// players from the same shrinking budgets.
//
// The old bid (seatWaivers.ts wireBid, v0.338.0) was $3 a point of THIS
// WEEK'S lineup gain, capped at a quarter of what was left. Fine for a
// streamer; hopeless in a frenzy, where a top-12 back goes for half a budget
// and the AI's $25 was the floor of the auction. And it never looked at the
// room: what the others still hold, what this league has actually paid.
//
// ── THE PRICE, IN THREE PARTS ────────────────────────────────────────────────
//
//   1. THE MARKET SHARE. What share of a rival's remaining budget a player
//      commands, as a saturating function of his SURPLUS — rest-of-season
//      value over the best free agent at his position (a player anyone can
//      sign for nothing is worth nothing on the wire). Half the ceiling at
//      MARKET_HALF_POINT points a week, never above MARKET_MAX_SHARE: a stud
//      empties no one's budget on his own, because nobody bids it all.
//   2. THE ROOM. The expected top rival bid is that share of the rivals'
//      money — leaning toward the deepest pocket, since the one bidder who
//      can pay is the one who sets the price — CALIBRATED by this league's
//      own resolved claims: the median of what winners actually paid against
//      what the curve would have said, clamped so one wild bid does not
//      reprice the season. A league that overpays teaches the AI to pay; a
//      thrifty league teaches it not to.
//   3. THE CEILING. What the player is worth to THIS roster — the share for
//      his rest-of-season lineup gain, of the budget left, less a reserve
//      while weeks remain (the next chop brings the next star). The bid is
//      the expected top rival plus a small margin, never above the ceiling:
//      just enough to win at the price the room has set, and no more. A
//      hole this week floors the bid at $3 a point so an injury is answered
//      even when the room is quiet.
//
// Pure: numbers in, a bid out. The worker gathers the room (server/src/
// seatWire.js); the planner (seatWaivers.ts) calls this per claim with the
// running budget so a sweep's claims never sum past it.

/** No player commands more than this share of a rival's remaining budget. */
export const MARKET_MAX_SHARE = 0.6;
/** Surplus (pts/wk over replacement) at which the share is half its ceiling. */
export const MARKET_HALF_POINT = 6;
/** Kept back while more than MARKET_RESERVE_WEEKS remain: the next chop
 *  brings the next star, and a seat that is broke in October cannot bid. */
export const MARKET_RESERVE = 0.15;
export const MARKET_RESERVE_WEEKS = 3;
/** Over the expected top rival: enough to win a tie, not enough to matter. */
export const BID_MARGIN = 0.05;
/** Calibration clamps: one league's habits move the curve, not rewrite it. */
export const CALIBRATION_MIN = 0.5;
export const CALIBRATION_MAX = 2;
/** Resolved claims needed before the league's own prices are trusted. */
export const CALIBRATION_MIN_SAMPLES = 3;
/** The hole floor, per point of THIS week's lineup gain (the old wireBid rate). */
export const HOLE_FAAB_PER_POINT = 3;

/** One resolved FAAB claim from this league's history. `ref` is the budget
 *  the bid was measured against (the league's starting budget is the honest
 *  stand-in when the bidder's balance at the time is unknown). */
export interface MarketClaim { surplus: number; bid: number; won: boolean; ref: number }

export interface MarketInput {
  /** The player's rest-of-season value over replacement at his position. */
  surplus: number;
  /** Rest-of-season points per week he adds to THIS roster's best lineup. */
  myGain: number;
  /** This week's lineup gain. */
  gainNow: number;
  /** True when the claim fills a HOLE (a spot nobody legal or nobody scoring
   *  is in): then `gainNow` floors the bid at the old $3 a point, so an
   *  injury is answered even when the room is quiet. An upgrade gets no
   *  floor — the room and the ceiling price it. */
  hole?: boolean;
  /** My remaining FAAB. */
  budget: number;
  /** Remaining FAAB of every other seat that can still bid. */
  rivalBudgets: number[];
  /** Weeks still to come this season. */
  weeksLeft: number;
  /** This league's resolved FAAB claims, for calibration. */
  history?: MarketClaim[];
}

/** Share of a budget a player of this surplus commands: saturating, 0 at no
 *  surplus, half the ceiling at the half-point, never above the ceiling. */
export function marketShare(surplus: number): number {
  const s = Math.max(0, surplus);
  return MARKET_MAX_SHARE * (s / (s + MARKET_HALF_POINT));
}

/** How this league prices against the curve: the median ratio of what
 *  winners paid to what the curve says, over won claims with real surplus.
 *  1 until there are enough samples; clamped either way. */
export function calibration(history: MarketClaim[] | undefined): number {
  const ratios = (history ?? [])
    .filter((c) => c.won && c.surplus >= 1 && c.ref > 0 && c.bid > 0)
    .map((c) => c.bid / Math.max(1e-9, marketShare(c.surplus) * c.ref))
    .sort((a, b) => a - b);
  if (ratios.length < CALIBRATION_MIN_SAMPLES) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, median));
}

/** The bid the room's top rival is expected to make: the calibrated share of
 *  the rivals' money, leaning toward the deepest pocket. No rivals, no bid
 *  to beat. */
export function expectedTopBid(surplus: number, rivalBudgets: number[], k = 1): number {
  const rivals = rivalBudgets.filter((b) => Number.isFinite(b) && b > 0);
  if (!rivals.length) return 0;
  const max = Math.max(...rivals);
  const mean = rivals.reduce((a, b) => a + b, 0) / rivals.length;
  return marketShare(surplus) * k * (0.5 * max + 0.5 * mean);
}

/** The bid. Integer dollars, 0 when there is nothing to bid for or with. */
export function faabBid(input: MarketInput): number {
  const budget = Math.floor(Math.max(0, input.budget));
  if (budget <= 0) return 0;
  if (!(input.surplus > 0) && !(input.myGain > 0) && !(input.gainNow > 0)) return 0;
  const k = calibration(input.history);
  const expected = expectedTopBid(input.surplus, input.rivalBudgets, k);
  const margin = Math.max(1, Math.ceil(expected * BID_MARGIN));
  // The ceiling: his worth to me, of what I have, less the reserve while the
  // season still has chops in it.
  const pacing = input.weeksLeft > MARKET_RESERVE_WEEKS ? 1 - MARKET_RESERVE : 1;
  const ceiling = Math.max(1, Math.floor(budget * marketShare(Math.max(input.myGain, 0)) * pacing));
  // A hole is answered: the old rate, so a quiet room still fills an injury.
  const floor = input.hole && input.gainNow > 0 ? Math.ceil(input.gainNow * HOLE_FAAB_PER_POINT) : 0;
  const want = expected > 0 ? Math.ceil(expected + margin) : 0;
  const bid = Math.min(ceiling, Math.max(want, floor, 1));
  return Math.min(budget, Math.max(1, bid));
}
