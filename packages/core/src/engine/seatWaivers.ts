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
import { faabBid, type MarketClaim } from './faabMarket';

/** A player the agent could acquire. `onWaivers` splits the two write paths:
 *  a player still inside his `waived_until` hold is a `submit_waiver_claim`,
 *  anyone past it is an `add_free_agent`. The planner does not care which —
 *  it ranks them together, because the RIGHT player is the right player — but
 *  it carries the flag through so the worker knows which RPC to call. */
export interface WirePlayer extends SpotPlayer {
  onWaivers: boolean;
  /** THE HOLD ITSELF (v0.433.0), apart from the instrument. `onWaivers` now
   *  also says "a claim because free agency is shut right now" (0288's rule),
   *  so a caller who knows the difference passes it: replacement level and
   *  the frenzy read the players a human could sign for nothing at the next
   *  opening, and a depth body may be CLAIMED for $0 when the door is shut.
   *  Absent, it reads as `onWaivers`, which is the pre-0.433 meaning. */
  held?: boolean;
}

/** THE LEAGUE'S CLOCK DECIDES THE INSTRUMENT (v0.433.0). Founder: "We
 *  shouldn't be working the wire at times not in line with what the league
 *  has." A player inside his hold is a claim; so is anyone at all while free
 *  agency cannot reach him this minute (the window shut, or a league that
 *  has none) — 0288's rule for the pool screen, which the sweep had never
 *  learned. And a first-come ADD gets no bot's edge: a player who has only
 *  just become addable — his hold cleared, or the window opened, within
 *  HUMANS_FIRST_MS — is `wait`ed on, and taken next sweep if still there.
 *  Claims settle at the league's run against everyone, so they need no
 *  such courtesy and are filed the hour a human could file them. */
export const HUMANS_FIRST_MS = 60 * 60 * 1000;
export type WireInstrument = 'claim' | 'add' | 'wait';
export function wireInstrument(
  p: { heldUntil?: number | null },
  league: { faOpen: boolean; openSince?: number | null },
  now: number,
): WireInstrument {
  const held = p.heldUntil != null && p.heldUntil > now;
  if (held || !league.faOpen) return 'claim';
  const since = Math.max(p.heldUntil ?? -Infinity, league.openSince ?? -Infinity);
  if (Number.isFinite(since) && now - since < HUMANS_FIRST_MS) return 'wait';
  return 'add';
}

export interface WireClaim {
  add: string;
  drop: string | null;
  bid: number;
  /** Projected points per week this claim adds to the starting lineup. */
  gain: number;
  /** Rest-of-season points per week it adds to the best lineup (v0.428.0;
   *  0 when the caller gave no season value). */
  rosGain: number;
  /** hole — a starting spot nobody legal (or nobody scoring) was in;
   *  upgrade — a starter displaced by a clearly better player;
   *  depth — an OPEN roster place filled with the best free body when the
   *  lineup itself had nothing to gain (v0.425.0: a bot vampire's bench). */
  kind: 'hole' | 'upgrade' | 'depth';
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
  /** REST-OF-SEASON value (v0.426.0) — the season projection, NOT zeroed for
   *  this week's bye or a one-game Out, zero for a season-ending IR. When
   *  given it decides who may be DROPPED: bench bodies are spent cheapest-
   *  for-the-season first, and no claim drops a player worth more for the
   *  rest of the year than the one it adds. Without it `valueOf` stands in,
   *  which is the pre-0.426 behaviour and wrong in exactly one way: a star
   *  on his bye projects 0 THIS week and was the first man overboard. */
  rosValueOf?: (p: SpotPlayer) => number;
  /** THE ROOM (v0.428.0) — what a FAAB bid has to beat, and what this league
   *  has paid. When given (and `faab`), each claim is priced by faabMarket
   *  instead of the flat $3-a-point of this week's gain: the expected top
   *  rival bid for the player's surplus over replacement, calibrated by the
   *  league's resolved claims, capped by his worth to this roster. */
  market?: {
    /** Remaining FAAB of every other seat that can still bid. */
    rivalBudgets: number[];
    /** Weeks still to come. */
    weeksLeft: number;
    /** This league's resolved FAAB claims. */
    history: MarketClaim[];
    /** Rest-of-season value of the best FREE body at a position — what
     *  anyone could sign for nothing, so what a claim is measured over. */
    replacementOf: (pos: string) => number;
  };
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

/** How thin a roster is at each position: bodies at the position minus the
 *  starting spots that take ONLY that position. Flex-type spots are not
 *  counted against anyone — they are covered by whoever is left. A position
 *  no spot accepts at all is absent, so a kicker is never "needed" in a
 *  league with no K spot. Exported for the assertion suite. */
export function positionNeed(slots: ClassicSlotDef[], roster: SpotPlayer[]): Map<string, number> {
  const need = new Map<string, number>();
  for (const d of slots) for (const pos of d.pos) if (!need.has(pos)) need.set(pos, 0);
  for (const d of slots) if (d.pos.length === 1) need.set(d.pos[0], (need.get(d.pos[0]) ?? 0) - 1);
  for (const p of roster) if (need.has(p.pos)) need.set(p.pos, (need.get(p.pos) ?? 0) + 1);
  return need;
}

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

/** How deep into the pool the planner looks, PER POSITION, ranked by this
 *  week's projection. The planner solves a lineup per candidate per claim, so
 *  an empty roster (a bot vampire's, after a draft it sat out — v0.425.0)
 *  against a 2,000-player pool would be tens of thousands of solves inside a
 *  25-second tick. A seat that wants a player never wants the 40th-best at
 *  his position, so the cut costs nothing the policy would have chosen. */
export const POOL_DEPTH_PER_POS = 12;

/** The best `depth` players at each position by projection, returned in the
 *  ORIGINAL pool order so the planner's "earlier candidate wins a tie" rule
 *  still reads the same list run to run. A thin position keeps what it has. */
export function shortlistWire<P extends SpotPlayer>(
  available: P[],
  valueOf: (p: SpotPlayer) => number,
  depth = POOL_DEPTH_PER_POS,
): P[] {
  const byPos = new Map<string, P[]>();
  for (const p of available) {
    if (!byPos.has(p.pos)) byPos.set(p.pos, []);
    byPos.get(p.pos)!.push(p);
  }
  const keep = new Set<string>();
  for (const list of byPos.values()) {
    list.slice()
      .sort((a, b) => (valueOf(b) - valueOf(a)) || String(a.id).localeCompare(String(b.id)))
      .slice(0, Math.max(0, depth))
      .forEach((p) => keep.add(p.id));
  }
  return available.filter((p) => keep.has(p.id));
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
  // What a body is worth for the REST OF THE SEASON — the measure every drop
  // is judged by. Falls back to this week's value when the caller has none.
  const rosOf = opts.rosValueOf ?? valueOf;

  for (let n = 0; n < maxClaims; n++) {
    const base = lineupValue(slots, have, valueOf);
    const rosBase = opts.rosValueOf ? lineupValue(slots, have, rosOf) : 0;
    const hole = hasHole(slots, have, valueOf);

    // Only a player who is NOT in the best lineup may be dropped. This is the
    // "never drops a healthy contributor" rail, and it is structural rather
    // than a threshold: if he is starting, he is not a drop candidate, full
    // stop. Cheapest bench body first — cheapest for the SEASON (v0.426.0),
    // so a star on his bye or a one-week Out is not the first man overboard.
    const starting = new Set(optimalLineup(slots, have, valueOf).spots
      .flatMap((r) => (r.player ? [r.player.id] : [])));
    const droppable = have
      .filter((p) => !starting.has(p.id) && !used.has(p.id))
      .sort((a, b) => (rosOf(a) - rosOf(b)) || String(a.id).localeCompare(String(b.id)));

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
        // NEVER DROP A MORE VALUABLE PLAYER THAN THE ONE COMING IN (v0.426.0).
        // A streamer who fills this week's hole is still a streamer; if the
        // cheapest bench body is worth more for the rest of the season, the
        // hole stays open this week rather than costing the season. An open
        // seat (no drop) is never subject to it.
        if (drop && opts.rosValueOf && rosOf(drop) > rosOf(cand)) continue;
        const next = have.filter((p) => !drop || p.id !== drop.id).concat(cand);
        const gain = lineupValue(slots, next, valueOf) - base;
        // THE SEASON COUNTS TOO (v0.428.0). A chopped star on his bye adds
        // nothing THIS week and is the best player on the wire all year; the
        // upgrade bar is met by either measure, and the claim is ranked by
        // the larger, so the frenzy's prize is not passed over for a
        // streamer with a game on Sunday.
        const rosGain = opts.rosValueOf ? lineupValue(slots, next, rosOf) - rosBase : 0;
        const kind: 'hole' | 'upgrade' = hole ? 'hole' : 'upgrade';
        const clears = hole ? gain >= HOLE_MIN_GAIN : (gain >= UPGRADE_MIN_GAIN || rosGain >= UPGRADE_MIN_GAIN);
        if (!clears) continue;
        const score = Math.max(gain, rosGain);
        // Ties break toward the SMALLER move: keeping a roster spot open beats
        // filling it for the same projected points, and an earlier candidate
        // beats a later one, so the plan is deterministic for a given pool.
        if (best && !(score > Math.max(best.gain, best.rosGain) + 1e-9)) continue;
        best = {
          add: cand.id,
          drop: drop?.id ?? null,
          bid: 0,               // priced below, once the claim is settled
          gain,
          rosGain,
          kind,
          onWaivers: cand.onWaivers,
        };
      }
    }
    // DEPTH (v0.425.0). The lineup wants nothing — but a roster place is
    // open, and a seat nobody manages should not carry an empty bench into
    // the byes: a bot vampire sits out the draft (0268) and, filled to its
    // starters alone, would need a fresh hole every week. Free agents ONLY —
    // a held player is a claim to win and a priority to spend, and a bench
    // body is worth neither — best projected first, only if he projects at
    // all. No drop, no bid: it costs nobody anything. A full roster never
    // reaches here, so the agent seats that drafted are untouched by it.
    //
    // WHERE THE ROSTER IS THIN FIRST (v0.426.0). Founder: "if the team … is
    // light on RBs". positionNeed counts bodies beyond the dedicated starting
    // spots; the position with the fewest is filled first, and within it the
    // best rest-of-season body. A position no spot accepts is never taken.
    if (!best && seats > 0) {
      const need = positionNeed(slots, have);
      // NOT HELD, rather than not-a-claim (v0.433.0): with the door shut the
      // body is a $0 claim that clears at the run, and an empty bench in a
      // league with no free agency must still be filled somehow.
      const body = pool
        .filter((p) => !(p.held ?? p.onWaivers) && !used.has(p.id) && !have.some((q) => q.id === p.id)
          && need.has(p.pos) && rosOf(p) > 0)
        .sort((a, b) => ((need.get(a.pos) ?? 0) - (need.get(b.pos) ?? 0))
          || (rosOf(b) - rosOf(a)) || String(a.id).localeCompare(String(b.id)))[0];
      if (body) best = { add: body.id, drop: null, bid: 0, gain: 0, rosGain: 0, kind: 'depth', onWaivers: body.onWaivers };
    }
    if (!best) break;

    // THE PRICE. With the room in hand (v0.428.0) a claim on a held player
    // is priced against what the others will pay and capped by his worth
    // here; a free agent costs nothing to sign, and without the room the
    // old flat rate stands.
    const added = pool.find((p) => p.id === best!.add)!;
    best.bid = !opts.faab || !best.onWaivers || best.kind === 'depth' ? 0
      : opts.market
        ? faabBid({
          surplus: rosOf(added) - opts.market.replacementOf(added.pos),
          myGain: best.rosGain,
          gainNow: best.gain,
          hole: best.kind === 'hole',
          budget,
          rivalBudgets: opts.market.rivalBudgets,
          weeksLeft: opts.market.weeksLeft,
          history: opts.market.history,
        })
        : wireBid(best.gain, budget, opts.faab);
    claims.push(best);
    used.add(best.add);
    if (best.drop) used.add(best.drop);
    have = have.filter((p) => p.id !== best!.drop).concat(pool.find((p) => p.id === best!.add)!);
    if (!best.drop) seats -= 1;
    budget -= best.bid;
  }
  return claims;
}
