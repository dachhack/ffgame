// Guard for what an UNCLAIMED SEAT does on the transaction wire (v0.338.0).
//
// The whole policy is a set of judgement calls that look arbitrary in the code
// and are not: fill holes on any gain, take an upgrade only above a margin,
// never drop a starter, never bid the budget. Each one is here because the
// opposite behaviour is worse in a specific way, and none of them is visible
// from a passing league — an over-eager agent looks exactly like an active
// manager until someone reads the transaction log in November.
//
// The planner is pure precisely so this can be a unit test rather than a
// fixture league, so there is no excuse for the policy to be unpinned.
// Run: npx tsx scripts/check-seat-waivers.mjs
import {
  seatWirePlan, wireBid, UPGRADE_MIN_GAIN, HOLE_MIN_GAIN, FAAB_PER_POINT, FAAB_MAX_SHARE,
} from '../packages/core/src/engine/seatWaivers.ts';
import { clearLeagueFlags, setLeagueFlags } from '../packages/core/src/data/commish.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

// A minimal but REAL slot shape: two RB and a flex, so eligibility actually
// constrains the matching rather than every player fitting everywhere.
const SLOTS = [
  { slot: 'S1', type: 'RB', pos: ['RB'] },
  { slot: 'S2', type: 'RB', pos: ['RB'] },
  { slot: 'S3', type: 'FLEX', pos: ['RB', 'WR', 'TE'] },
];
const rb = (id) => ({ id, pos: 'RB' });
const wr = (id) => ({ id, pos: 'WR' });
const free = (p, onWaivers = true) => ({ ...p, onWaivers });

// Projection by explicit table — no bakes, no slate, no clock.
const projOf = (t) => (p) => t[p.id] ?? 0;
const OPTS = { faab: false, budget: 0, openSeats: 0 };

clearLeagueFlags();

// ── 1. A HOLE gets filled on a small gain ─────────────────────────────────
// starter2 is projected 0 — the shape slateAwareProj gives a bye or an OUT.
{
  const roster = [rb('starter1'), rb('hurt'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ starter1: 10, hurt: 0, flexguy: 1, bench1: 0.5, bench2: 0.3, streamer: 4 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], proj, OPTS);
  ok(plan.length === 1 && plan[0].add === 'streamer', 'a zeroed starter is a hole the agent fills');
  ok(plan[0]?.kind === 'hole', 'the claim is classified as a hole, not an upgrade');
  ok(plan[0]?.drop === 'bench2', 'it pays for the add with the WORST bench player');
}

// ── 2. A MARGINAL upgrade is refused ──────────────────────────────────────
// Everyone is playing, and the candidate clears the bar against nobody.
//
// NOTE THE ARITHMETIC, because it is easy to get wrong and I did: a new RB's
// gain is NOT measured against the worst RB. Adding a 9.5 RB to a lineup of
// RB 10 / RB 8 / FLEX 5 seats him at RB and pushes the 5-point FLEX occupant
// out — the displaced player is the WEAKEST STARTER, whatever his position, so
// the gain is 4.5 and not 1.5. `lineupValue` gets this right for free because
// it re-solves the whole assignment; a hand-rolled "compare to the same
// position" check would not, and would refuse good adds all season.
// So a genuinely marginal candidate has to beat the 5-point flex, not the 8.
{
  const roster = [rb('starter1'), rb('starter2'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ starter1: 10, starter2: 8, flexguy: 5, bench1: 1, bench2: 0.5,
    slightlyBetter: 5 + UPGRADE_MIN_GAIN - 0.5 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('slightlyBetter'))], proj, OPTS);
  ok(plan.length === 0, `an upgrade below the ${UPGRADE_MIN_GAIN}pt bar is refused (no churn)`);
  // and it is refused BY THE BAR, not because there was nothing to drop:
  ok(seatWirePlan(SLOTS, roster, [free(rb('wellOver'))], projOf({ starter1: 10, starter2: 8,
    flexguy: 5, bench1: 1, bench2: 0.5, wellOver: 40 }), OPTS).length === 1,
    'the same fixture DOES transact for a big enough gain (the bar is what refused it)');
}

// ── 3. A CLEAR upgrade is taken ───────────────────────────────────────────
{
  const roster = [rb('starter1'), rb('starter2'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ starter1: 10, starter2: 8, flexguy: 5, bench1: 1, bench2: 0.5,
    muchBetter: 8 + UPGRADE_MIN_GAIN + 3 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('muchBetter'))], proj, OPTS);
  ok(plan.length === 1 && plan[0].add === 'muchBetter', 'an upgrade well above the bar is taken');
  ok(plan[0]?.kind === 'upgrade', 'a full lineup with everyone playing classifies as upgrade');
}

// ── 4. A STARTER IS NEVER THE DROP ────────────────────────────────────────
// The only bench player is worthless and the roster is full, so dropping a
// starter would "work" numerically. It must not be offered.
{
  const roster = [rb('starter1'), rb('starter2'), wr('flexguy'), wr('bench1')];
  const proj = projOf({ starter1: 10, starter2: 8, flexguy: 5, bench1: 0.5, stud: 30 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('stud'))], proj, OPTS);
  ok(plan.every((c) => !['starter1', 'starter2', 'flexguy'].includes(c.drop)),
    'no claim ever drops a player who is in the best lineup');
  ok(plan[0]?.drop === 'bench1', 'the bench body is the drop even when a starter would score worse');
}

// ── 5. An open seat is preferred to a drop at equal value ─────────────────
{
  const roster = [rb('starter1'), rb('hurt'), wr('flexguy'), wr('bench1')];
  const proj = projOf({ starter1: 10, hurt: 0, flexguy: 1, bench1: 0.5, streamer: 6 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], proj, { ...OPTS, openSeats: 1 });
  ok(plan[0]?.drop === null, 'with a seat open the agent adds without dropping anybody');
}

// ── 6. A full roster with no droppable bench cannot transact ──────────────
{
  const roster = [rb('starter1'), rb('starter2'), rb('starter3')];
  const proj = projOf({ starter1: 10, starter2: 9, starter3: 8, stud: 40 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('stud'))], proj, OPTS);
  ok(plan.length === 0, 'a roster whose every player starts declines rather than dropping one');
}

// ── 7. TWO holes get TWO claims, and the second is re-measured ────────────
{
  const roster = [rb('hurt1'), rb('hurt2'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ hurt1: 0, hurt2: 0, flexguy: 2, bench1: 0.5, bench2: 0.4, streamA: 9, streamB: 7 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamA')), free(rb('streamB'))], proj, OPTS);
  ok(plan.length === 2, 'two zeroed starters produce two claims in one sweep');
  ok(plan[0].add === 'streamA' && plan[1].add === 'streamB', 'the better streamer is claimed first');
  ok(plan[0].add !== plan[1].add && plan[0].drop !== plan[1].drop,
    'the second claim neither re-adds nor re-drops the first claim\'s players');
}

// ── 8. maxClaims bounds the sweep ─────────────────────────────────────────
{
  const roster = [rb('hurt1'), rb('hurt2'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ hurt1: 0, hurt2: 0, flexguy: 2, bench1: 0.5, bench2: 0.4, streamA: 9, streamB: 7 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamA')), free(rb('streamB'))], proj,
    { ...OPTS, maxClaims: 1 });
  ok(plan.length === 1, 'maxClaims caps a sweep even with holes left unfilled');
}

// ── 9. A no_add flag binds the agent as it binds a manager (0144) ─────────
{
  setLeagueFlags('lg', [{ slug: 'flagged', label: 'do not add', rules: { no_add: true } }]);
  const roster = [rb('starter1'), rb('hurt'), wr('flexguy'), wr('bench1')];
  const proj = projOf({ starter1: 10, hurt: 0, flexguy: 1, bench1: 0.5, flagged: 20 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('flagged'))], proj, OPTS);
  ok(plan.length === 0, 'a commissioner no_add flag is respected before the claim is filed');
  clearLeagueFlags();
}

// ── 10. The waivers/FA split is carried through, not decided here ─────────
{
  const roster = [rb('starter1'), rb('hurt'), wr('flexguy'), wr('bench1')];
  const proj = projOf({ starter1: 10, hurt: 0, flexguy: 1, bench1: 0.5, fa: 6 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('fa'), false)], proj, OPTS);
  ok(plan[0]?.onWaivers === false, 'a free agent is flagged for add_free_agent, not a claim');
}

// ── 11. BIDDING: the curve, and both of its rails ─────────────────────────
ok(wireBid(5, 100, true) === 5 * FAAB_PER_POINT, 'a bid is gain × FAAB_PER_POINT when well under the cap');
ok(wireBid(100, 100, true) === Math.floor(100 * FAAB_MAX_SHARE),
  `an enormous gain is capped at ${FAAB_MAX_SHARE * 100}% of the remaining budget`);
ok(wireBid(0.2, 100, true) === 1, 'a claim worth making bids at least $1');
ok(wireBid(5, 0, true) === 0, 'a broke seat bids nothing rather than an impossible amount');
// $3 left: 25% of it rounds to nothing, so the $1 floor is what the seat bids.
// Deliberate — a disciplined $1 beats emptying the balance on one claim, and
// beats a $0 bid, which submit_waiver_claim accepts and which always loses.
ok(wireBid(50, 3, true) === 1, 'a nearly-broke seat falls back to the $1 floor, never over balance');
ok(wireBid(50, 3, true) <= 3, 'and never bids more than the balance');
ok(wireBid(5, 100, false) === 0, 'a non-FAAB league always bids 0');

// ── 12. Bids are spent DOWN across a multi-claim sweep ────────────────────
{
  const roster = [rb('hurt1'), rb('hurt2'), wr('flexguy'), wr('bench1'), wr('bench2')];
  const proj = projOf({ hurt1: 0, hurt2: 0, flexguy: 2, bench1: 0.5, bench2: 0.4, streamA: 9, streamB: 7 });
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamA')), free(rb('streamB'))], proj,
    { faab: true, budget: 100, openSeats: 0 });
  const total = plan.reduce((n, c) => n + c.bid, 0);
  ok(plan.length === 2 && total <= 100, 'a sweep never commits more FAAB than the seat has');
  ok(plan[1].bid <= Math.floor((100 - plan[0].bid) * FAAB_MAX_SHARE) || plan[1].bid === 1,
    'the second bid is capped against the budget the FIRST bid left behind');
}

// ── 13. Nothing available is not an error ─────────────────────────────────
ok(seatWirePlan(SLOTS, [rb('a')], [], projOf({ a: 5 }), OPTS).length === 0,
  'an empty pool yields no claims rather than throwing');
ok(seatWirePlan([], [rb('a')], [free(rb('b'))], projOf({ a: 1, b: 9 }), OPTS).length === 0,
  'a league with no slots yields no claims');
ok(HOLE_MIN_GAIN < UPGRADE_MIN_GAIN, 'the hole bar stays BELOW the upgrade bar (the asymmetry is the design)');

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL SEAT-WAIVER ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
