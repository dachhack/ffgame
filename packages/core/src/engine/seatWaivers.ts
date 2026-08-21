// ── WHAT AN UNCLAIMED SEAT DOES ON THE WIRE (v0.338.0) ─────────────────────
//
// Seat agents (0180) have set lineups since v0.248.0 — `autoSlotClassicLineups`
// fields an unclaimed seat's best legal eleven every tick. What they have never
// done is TRANSACT. A seat whose starting RB tore an ACL in week 3 fielded the
// same hole for the rest of the season while the replacement sat in the pool,
// and by December an agent seat is a dead weight in the standings that every
// human has already farmed.
//
// This is the decision half, and it is deliberately pure: roster in, claims
// out, no database and no clock. The worker (server/src/seatWire.js) supplies
// the rows and spends the result. That split is what lets the whole policy be
// asserted directly — see scripts/check-seat-waivers.mjs — rather than through
// a league fixture that takes a Postgres to build.
//
// ── THE POLICY, AND WHY IT IS NOT "TAKE THE BEST PLAYER" ───────────────────
//
// Founder's call, and it is the conservative one on purpose: fill holes, and
// take a clear upgrade, but do not churn. An agent seat sits in a league of
// humans, and a bot that rerolls three bench spots every Tuesday reads as
// broken even when each move is individually justified. Worse, a human may
// CLAIM this seat mid-season (0180's transfer trigger hands them the roster) —
// they should inherit a team that was tended, not one that was strip-mined.
//
// So two bars, not one:
//
//   • A HOLE — a starting spot with nobody legal in it, or one held by a player
//     the projection has already zeroed (bye, or ruled OUT/IR upstream) — is a
//     real loss happening this week. Any positive gain clears it.
//   • An UPGRADE over a starter who is actually playing is speculative, so it
//     must beat `UPGRADE_MIN_GAIN` points per week before it is worth spending
//     a roster spot, a waiver priority and somebody's FAAB on.
//
// The asymmetry IS the design. Collapsing both into one threshold either makes
// the agent ignore injuries (bar too high) or churn (bar too low).
import type { ClassicSlotDef, SpotPlayer } from './classic';
import { optimalLineup } from './classic';
import { flagRulesFor } from '../data/commish';

/** A player the agent could acquire. `onWaivers` splits the two write paths:
 *  a player still inside his `waived_until` hold is a `submit_waiver_claim`,
 *  anyone past it is an `add_free_agent`. The planner does not care which —
 *  it ranks them together, because the RIGHT player is the right player — but
 *  it carries the flag through so the worker knows which RPC to call. */
export interface WirePlayer extends SpotPlayer { onWaivers: boolean }

export interface WireClaim {
  add: string;
  drop: string | null;
  bid: number;
  /** Projected points per week this claim adds to the starting lineup. */
  gain: number;
  kind: 'hole' | 'upgrade';
  onWaivers: boolean;
}

export interface WireOpts {
  /** FAAB league → bids are meaningful. Priority/standings leagues bid 0. */
  faab: boolean;
  /** Remaining FAAB. Ignored when `faab` is false. */
  budget: number;
  /** Active-roster places still open. 0 → every add needs a drop. */
  openSeats: number;
  /** Most claims one sweep may produce. Small on purpose: the sweep runs
   *  often, and a burst of claims is the churn the policy exists to avoid. */
  maxClaims?: number;
}

/** Points per week an upgrade must add before it is worth transacting for.
 *  Roughly the gap between a low-end starter and a streamer — below this the
 *  projection isn't confident enough to justify the move. */
export const UPGRADE_MIN_GAIN = 2;

/** A hole is a loss already in progress, so it only has to be improved at all.
 *  Not zero: floating-point noise on two equal projections is not a reason to
 *  spend a waiver claim. */
export const HOLE_MIN_GAIN = 0.1;

/** FAAB per projected point per week, before the cap. A 5-point upgrade bids
 *  $15 of a $100 budget — enough to win a contested add, nowhere near enough
 *  to be the reason the seat is broke in November. */
export const FAAB_PER_POINT = 3;

/** No single claim may commit more than this share of what's left. The cap is
 *  the whole reason "bid proportional to gain" is safe: an enormous projected
 *  gain (a QB1 hitting waivers) would otherwise bid the entire budget. */
export const FAAB_MAX_SHARE = 0.25;

/** The value of the best legal lineup this roster can field. */
function lineupValue(
  slots: ClassicSlotDef[],
  roster: SpotPlayer[],
  valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number,
): number {
  return optimalLineup(slots, roster, valueOf).spots
    .reduce((n, r) => n + (r.player ? valueOf(r.player, r.def) : 0), 0);
}

/** Does this lineup have a hole — a spot nobody legal is standing in, or one
 *  held by a player already worth nothing this week?
 *
 *  The second half is the case that matters in practice. An injured starter
 *  does not vacate his spot; `slateAwareProj` just returns 0 for him, and the
 *  spot stays "filled" by someone who will not score. Treating only EMPTY
 *  spots as holes would miss every injury and bye, which is most of them. */
function hasHole(
  slots: ClassicSlotDef[],
  roster: SpotPlayer[],
  valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number,
): boolean {
  return optimalLineup(slots, roster, valueOf).spots
    .some((r) => !r.player || valueOf(r.player, r.def) <= 0);
}

/** What one claim should bid, given what it is worth and what is left.
 *  Exported because the assertion suite pins the curve, not just the plan. */
export function wireBid(gain: number, budget: number, faab: boolean): number {
  if (!faab || budget <= 0 || gain <= 0) return 0;
  // The cap is a SHARE of what's left, floored at $1. Without that floor a
  // seat down to a few dollars computes a cap of 0 and can only ever bid $0 —
  // which `submit_waiver_claim` accepts as a real bid and which loses every
  // contested claim, so the seat would look active while being unable to win
  // anything for the rest of the season.
  const cap = Math.max(1, Math.floor(budget * FAAB_MAX_SHARE));
  // Never over the balance: a bid above `member_faab` is rejected outright.
  return Math.min(budget, Math.max(1, Math.min(cap, Math.ceil(gain * FAAB_PER_POINT))));
}

/**
 * The claims an unclaimed seat should file this sweep, best first.
 *
 * Greedy and sequential: each accepted claim is applied to a working roster
 * before the next is considered, so two claims never both "fix" the same hole
 * and the second one's gain is measured against the first one's result. That
 * matters most in the case the policy exists for — a seat with two injured
 * starters should fill both spots, not bid twice on the better of two RBs.
 *
 * `valueOf` is the caller's projection (the worker passes `slateAwareProj`, so
 * byes and ruled-out players already read as 0). The planner never looks at a
 * calendar itself.
 */
export function seatWirePlan(
  slots: ClassicSlotDef[],
  roster: SpotPlayer[],
  available: WirePlayer[],
  valueOf: (p: SpotPlayer, d?: ClassicSlotDef) => number,
  opts: WireOpts,
): WireClaim[] {
  const maxClaims = Math.max(0, opts.maxClaims ?? 2);
  if (!maxClaims || !slots.length) return [];

  // A commissioner's no_add flag binds the agent exactly as it binds a manager
  // (0144). The DB would reject the claim anyway — `process_waivers` kills a
  // flagged claim with a note — but filing one we know is dead wastes the
  // sweep and litters the league's transaction log.
  const pool = available.filter((p) => !flagRulesFor(p.id).noAdd);
  if (!pool.length) return [];

  const claims: WireClaim[] = [];
  let have = [...roster];
  let budget = opts.budget;
  let seats = opts.openSeats;
  const used = new Set<string>();   // added or dropped already this sweep

  for (let n = 0; n < maxClaims; n++) {
    const base = lineupValue(slots, have, valueOf);
    const hole = hasHole(slots, have, valueOf);

    // Only a player who is NOT in the best lineup may be dropped. This is the
    // "never drops a healthy contributor" rail, and it is structural rather
    // than a threshold: if he is starting, he is not a drop candidate, full
    // stop. Cheapest bench body first.
    const starting = new Set(optimalLineup(slots, have, valueOf).spots
      .flatMap((r) => (r.player ? [r.player.id] : [])));
    const droppable = have
      .filter((p) => !starting.has(p.id) && !used.has(p.id))
      .sort((a, b) => valueOf(a) - valueOf(b));

    // With a seat open the add costs nobody; otherwise the worst bench body
    // goes. A roster that is full AND has no droppable bench player cannot
    // transact at all, which is a legitimate answer, not a failure.
    const dropOpts: (SpotPlayer | null)[] = seats > 0 ? [null] : [];
    if (droppable.length) dropOpts.push(droppable[0]);
    if (!dropOpts.length) break;

    let best: WireClaim | null = null;
    for (const cand of pool) {
      if (used.has(cand.id) || have.some((p) => p.id === cand.id)) continue;
      for (const drop of dropOpts) {
        const next = have.filter((p) => !drop || p.id !== drop.id).concat(cand);
        const gain = lineupValue(slots, next, valueOf) - base;
        const kind: 'hole' | 'upgrade' = hole ? 'hole' : 'upgrade';
        if (gain < (hole ? HOLE_MIN_GAIN : UPGRADE_MIN_GAIN)) continue;
        // Ties break toward the SMALLER move: keeping a roster spot open beats
        // filling it for the same projected points, and an earlier candidate
        // beats a later one, so the plan is deterministic for a given pool.
        if (best && !(gain > best.gain + 1e-9)) continue;
        best = {
          add: cand.id,
          drop: drop?.id ?? null,
          bid: 0,               // priced below, once the claim is settled
          gain,
          kind,
          onWaivers: cand.onWaivers,
        };
      }
    }
    if (!best) break;

    best.bid = wireBid(best.gain, budget, opts.faab);
    claims.push(best);
    used.add(best.add);
    if (best.drop) used.add(best.drop);
    have = have.filter((p) => p.id !== best!.drop).concat(pool.find((p) => p.id === best!.add)!);
    if (!best.drop) seats -= 1;
    budget -= best.bid;
  }
  return claims;
}
