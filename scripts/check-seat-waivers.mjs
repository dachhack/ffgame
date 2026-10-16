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
  seatWirePlan, wireBid, shortlistWire, positionNeed, wireInstrument, HUMANS_FIRST_MS,
  UPGRADE_MIN_GAIN, HOLE_MIN_GAIN, FAAB_PER_POINT, FAAB_MAX_SHARE, BENCH_MIN_GAIN, benchUse, DROP_FLOOR_GAP,
  trendMomentum, legalizeIrDrop, MOMENTUM_MAX, TREND_PER_POINT, spotCover, uncoveredSpots, soleCover, isScopedSpot,
} from '../packages/core/src/engine/seatWaivers.ts';
import { slateAwareProj } from '../packages/core/src/engine/classic.ts';
import { PROJ_2026 } from '../packages/core/src/data/proj2026.ts';
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

// ── 14. An EMPTY roster fills its open seats (v0.425.0) ───────────────────
// A bot vampire sits out the draft (0268) and starts with nobody. The worker
// used to skip a seat with no active roster; the planner itself never did —
// every spot is a hole, and each open place is filled best-first, so the
// vampire is a team by the next lock rather than eight sweeps later.
{
  const pool = [free(rb('r1'), false), free(rb('r2'), false), free(rb('r3'), false), free(wr('w1'), false), free(wr('w2'), false)];
  const proj = projOf({ r1: 12, r2: 9, r3: 4, w1: 8, w2: 3 });
  const plan = seatWirePlan(SLOTS, [], pool, proj, { faab: false, budget: 0, openSeats: 4, maxClaims: 4 });
  ok(plan.length === 4, `an empty roster with four open places files four adds (${plan.length})`);
  ok(plan.every((c) => c.drop === null), 'every one lands in an open seat — there is nobody to drop');
  ok(plan.slice(0, 3).every((c) => c.kind === 'hole'), 'the three starting spots are holes, filled on any gain');
  ok(plan[0]?.add === 'r1' && plan[1]?.add === 'r2', 'best first: the two RB starters, then the flex');
  ok(plan.map((c) => c.add).includes('w1'), 'the flex takes the best remaining body whatever his position');
  // The fourth place is BENCH: the lineup gains nothing, so it is depth —
  // the best free body left, at no cost to anyone.
  ok(plan[3]?.kind === 'depth' && plan[3]?.add === 'r3' && plan[3]?.bid === 0,
    'the fourth is depth: the best remaining free agent (r3 at 4 > w2 at 3), bid 0');
  // The claim cap is what limits it, not the roster: capped at two, it stops.
  ok(seatWirePlan(SLOTS, [], pool, proj, { faab: false, budget: 0, openSeats: 4, maxClaims: 2 }).length === 2,
    'maxClaims still bounds an open-seat fill');
  // No open seat and no roster: nothing to drop, nowhere to put him.
  ok(seatWirePlan(SLOTS, [], pool, proj, { faab: false, budget: 0, openSeats: 0, maxClaims: 4 }).length === 0,
    'an empty roster with no open seat cannot transact (a legitimate answer, not a throw)');
  // Depth never touches a HELD player: with every body on waivers the bench
  // stays open rather than spending a claim on a spare.
  const held = pool.map((p) => ({ ...p, onWaivers: true }));
  const heldPlan = seatWirePlan(SLOTS, [], held, proj, { faab: false, budget: 0, openSeats: 4, maxClaims: 4 });
  ok(heldPlan.length === 3 && heldPlan.every((c) => c.kind === 'hole'),
    'depth is free agents only — holes still claim held players, the bench does not');
  // A full lineup with a bench place open takes depth, and a full roster
  // takes nothing: the agent seats that drafted a full roster never see it.
  const starters = [rb('s1'), rb('s2'), wr('s3')];
  const dProj = projOf({ s1: 10, s2: 9, s3: 8, spare: 2, w2: 1 });
  const dPlan = seatWirePlan(SLOTS, starters, [free(rb('spare'), false), free(wr('w2'), false)], dProj, { faab: false, budget: 0, openSeats: 1 });
  ok(dPlan.length === 1 && dPlan[0].kind === 'depth' && dPlan[0].add === 'spare' && dPlan[0].drop === null,
    'a full lineup with one open place adds one bench body and stops');
  ok(seatWirePlan(SLOTS, starters, [free(rb('spare'), false)], dProj, { faab: false, budget: 0, openSeats: 0 }).length === 0,
    'a full roster with nothing to gain does nothing (no churn)');
  ok(seatWirePlan(SLOTS, starters, [free(rb('zero'), false)], projOf({ s1: 10, s2: 9, s3: 8, zero: 0 }), { faab: false, budget: 0, openSeats: 1 }).length === 0,
    'depth wants a body that projects — a zero is left in the pool');
}

// ── 15. The shortlist keeps the best few PER POSITION (v0.425.0) ──────────
{
  const big = [];
  for (let i = 0; i < 30; i++) big.push(free(rb(`rb${i}`), false));
  for (let i = 0; i < 30; i++) big.push(free(wr(`wr${i}`), false));
  big.push({ id: 'k1', pos: 'K', onWaivers: false });
  const t = {}; big.forEach((p, i) => { t[p.id] = p.pos === 'K' ? 0.5 : (p.id.endsWith('7') ? 20 : i % 10); });
  const cut = shortlistWire(big, projOf(t), 3);
  ok(cut.filter((p) => p.pos === 'RB').length === 3 && cut.filter((p) => p.pos === 'WR').length === 3,
    'three per position survive the cut');
  ok(cut.some((p) => p.id === 'k1'), 'a thin position keeps what it has — the lone kicker stays');
  ok(cut.filter((p) => p.pos === 'RB').every((p) => p.id.endsWith('7')), 'the survivors are the best projected, not the first listed');
  ok(cut.map((p) => p.id).join() === big.filter((p) => cut.some((c) => c.id === p.id)).map((p) => p.id).join(),
    'pool order is preserved, so the planner\'s tie-break reads the same list run to run');
}

// ── 16. A drop is judged by the SEASON, not the week (v0.426.0) ──────────
// Founder: "not drop players that have more value or score well rest of
// season." This week's value zeroes a bye and a one-game Out, which made a
// benched star the cheapest body on the roster. With rosValueOf the planner
// spends the cheapest SEASON body, and never drops a man worth more for the
// year than the one coming in.
{
  // starter2 is hurt (this week 0); the streamer fills the hole.
  // Bench: `star` is on his BYE (week 0, season 15) and `scrub` (week 2, season 2).
  const roster = [rb('starter1'), rb('hurt'), wr('flexguy'), rb('star'), wr('scrub')];
  const week = projOf({ starter1: 10, hurt: 0, flexguy: 4, star: 0, scrub: 2, streamer: 6 });
  const ros = projOf({ starter1: 10, hurt: 9, flexguy: 4, star: 15, scrub: 2, streamer: 5 });
  const naive = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], week, OPTS);
  ok(naive[0]?.drop === 'star', 'WITHOUT a season value the bye-week star is the first man overboard (the old behaviour)');
  const plan = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], week, { ...OPTS, rosValueOf: ros });
  ok(plan.length === 1 && plan[0].add === 'streamer' && plan[0].drop === 'scrub',
    'with it the hole is still filled — paying with the cheapest SEASON body, not the star');
  // Every bench body is worth more for the season than the streamer: the
  // hole stays open this week rather than costing the year.
  const ros2 = projOf({ starter1: 10, hurt: 9, flexguy: 4, star: 15, scrub: 8, streamer: 5 });
  ok(seatWirePlan(SLOTS, roster, [free(rb('streamer'))], week, { ...OPTS, rosValueOf: ros2 }).length === 0,
    'no drop of a player worth more for the season than the add — the hole stays');
  // …unless a seat is open, where the add costs nobody.
  const open = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], week, { ...OPTS, rosValueOf: ros2, openSeats: 1 });
  ok(open.length === 1 && open[0].drop === null, 'an open seat takes the streamer with no drop at all');
  // A season-ending IR (season value 0) is the first body spent.
  const roster3 = [rb('starter1'), rb('hurt'), wr('flexguy'), rb('star'), wr('done')];
  const ros3 = projOf({ starter1: 10, hurt: 9, flexguy: 4, star: 15, done: 0, streamer: 5 });
  const week3 = projOf({ starter1: 10, hurt: 0, flexguy: 4, star: 0, done: 0, streamer: 6 });
  const p3 = seatWirePlan(SLOTS, roster3, [free(rb('streamer'))], week3, { ...OPTS, rosValueOf: ros3 });
  ok(p3[0]?.drop === 'done', 'a season-ending IR on the active roster is the body spent');
  // The starting rail is untouched: a starter is never a drop candidate
  // however cheap his season looks.
  const ros4 = projOf({ starter1: 1, hurt: 9, flexguy: 4, star: 15, scrub: 2, streamer: 5 });
  const p4 = seatWirePlan(SLOTS, roster, [free(rb('streamer'))], week, { ...OPTS, rosValueOf: ros4 });
  ok(p4[0]?.drop === 'scrub', 'a starter is still never dropped, whatever his season value');
}

// ── 17. Depth goes where the roster is THIN (v0.426.0) ────────────────────
// Founder: "if the team … is light on RBs". Two dedicated RB spots and one
// flex: with three RBs and one WR on the roster, the WR side has more spare
// bodies than the RB side? No — need counts bodies beyond DEDICATED spots:
// RB 3 − 2 = 1, WR 1 − 0 = 1 → a tie, broken by season value. With two RBs
// the RB need is 0 and the depth add is a running back even when a better
// receiver is free.
{
  const need = positionNeed(SLOTS, [rb('a'), rb('b'), rb('c'), wr('d')]);
  ok(need.get('RB') === 1 && need.get('WR') === 1 && need.get('TE') === 0 && !need.has('QB'),
    'positionNeed: bodies beyond dedicated spots, flex counted against nobody, no-spot positions absent');
  const starters = [rb('s1'), rb('s2'), wr('s3')];
  const proj = projOf({ s1: 10, s2: 9, s3: 8, rbx: 3, wrx: 6, k1: 9 });
  const pool = [free(rb('rbx'), false), free(wr('wrx'), false), { id: 'k1', pos: 'K', onWaivers: false }];
  const plan = seatWirePlan(SLOTS, starters, pool, proj, { ...OPTS, openSeats: 1, rosValueOf: proj });
  ok(plan.length === 1 && plan[0].kind === 'depth' && plan[0].add === 'rbx',
    'light on RBs: the depth add is the running back, not the better-projected receiver');
  const plan2 = seatWirePlan(SLOTS, [...starters, rb('s4')], pool, proj, { ...OPTS, openSeats: 1, rosValueOf: proj });
  ok(plan2[0]?.add === 'wrx', 'with a spare RB the receiver side is thinner and gets the body');
  ok(!plan.some((c) => c.add === 'k1') && !plan2.some((c) => c.add === 'k1'),
    'a position no spot accepts is never a depth add, whatever it projects');
}

// ── THE LEAGUE'S CLOCK DECIDES THE INSTRUMENT (v0.433.0) ─────────────────
// Founder: "We shouldn't be working the wire at times not in line with what
// the league has." A claim for anyone held or unreachable this minute; an add
// only through an open door; and a WAIT on a player who became addable within
// the hour, so the worker is never the fastest hand at the window.
{
  const now = 10_000_000_000;
  const H = HUMANS_FIRST_MS;
  const open = { faOpen: true, openSince: now - 3 * H };
  ok(wireInstrument({ heldUntil: now + 1000 }, open, now) === 'claim', 'a player inside his hold is a claim, door open or not');
  ok(wireInstrument({ heldUntil: null }, { faOpen: false, openSince: null }, now) === 'claim',
    'with free agency shut, a never-held player is a claim too (0288\'s rule for the pool screen)');
  ok(wireInstrument({ heldUntil: now - 5 * H }, { faOpen: false }, now) === 'claim', '…and so is one whose hold cleared long ago');
  ok(wireInstrument({ heldUntil: null }, open, now) === 'add', 'never held, door open for hours: an add');
  ok(wireInstrument({ heldUntil: now - 2 * H }, open, now) === 'add', 'hold cleared two hours ago: an add');
  ok(wireInstrument({ heldUntil: now - H / 2 }, open, now) === 'wait', 'hold cleared half an hour ago: humans first');
  ok(wireInstrument({ heldUntil: null }, { faOpen: true, openSince: now - H / 3 }, now) === 'wait',
    'the window opened twenty minutes ago: humans first, even for a never-held player');
  ok(wireInstrument({ heldUntil: now - 2 * H }, { faOpen: true, openSince: now - H / 3 }, now) === 'wait',
    'the later of the two clocks is the one that counts');
  ok(wireInstrument({ heldUntil: null }, { faOpen: true, openSince: null }, now) === 'add',
    'no opening on record (the door has stood open): an add');
  ok(wireInstrument({ heldUntil: now - H }, open, now) === 'add', 'exactly an hour is enough');

  // A depth body may be CLAIMED for $0 when the door is shut: an empty bench
  // in a league with no free agency must still be filled.
  const starters = [rb('s1'), rb('s2'), wr('s3')];
  const proj = projOf({ s1: 12, s2: 11, s3: 10, body: 6, held: 9 });
  const pool = [
    { ...rb('body'), onWaivers: true, held: false },   // a claim only because the door is shut
    { ...rb('held'), onWaivers: true, held: true },    // a real hold
  ];
  const plan = seatWirePlan(SLOTS, starters, pool, proj, { faab: true, budget: 50, openSeats: 1, rosValueOf: proj, maxClaims: 1 });
  ok(plan.length === 1 && plan[0].add === 'body' && plan[0].kind === 'depth',
    'the unheld body fills the open place as a depth claim; the held one is a claim to win, not a bench body');
  ok(plan[0]?.onWaivers === true && plan[0]?.bid === 0, '…filed as a claim, for $0');
  const openDoor = seatWirePlan(SLOTS, starters, pool.map((p) => ({ ...p, onWaivers: p.held })), proj,
    { faab: true, budget: 50, openSeats: 1, rosValueOf: proj, maxClaims: 1 });
  ok(openDoor[0]?.add === 'body' && openDoor[0]?.onWaivers === false, 'door open: the same body is an add');
  const legacy = seatWirePlan(SLOTS, starters, [{ ...rb('body'), onWaivers: true }], proj,
    { faab: true, budget: 50, openSeats: 1, rosValueOf: proj, maxClaims: 1 });
  ok(legacy.length === 0, 'without `held` the flag keeps its old meaning: a claim is never a depth body');
}

// ── 18. BENCH SWAPS: a full roster cuts dead weight for a stash (v0.518.0) ─
// Founder: AI teams should make "pickups that would strengthen their teams
// just like real players would". A lineup that wants nothing used to freeze
// the whole roster; a real manager cuts the zero-projection body for the
// breakout back even though the back will not start this week.
{
  const starters = [rb('s1'), rb('s2'), wr('s3')];
  const roster = [...starters, wr('dead')];
  // Hold values (season over half the next free body, × benchUse): stash RB
  // 9 − 1 = 8; the dead WR (0.5 − 1) × ½ (only the flex seats a WR here) =
  // −0.25. Gain 8.25, well over the bar.
  const ros = projOf({ s1: 12, s2: 11, s3: 10, dead: 0.5, stash: 9, rb2: 2, wr2: 2 });
  const pool = [free(rb('stash'), false), free(rb('rb2'), false), free(wr('wr2'), false)];
  const plan = seatWirePlan(SLOTS, roster, pool, ros, { ...OPTS, rosValueOf: ros });
  ok(plan.length === 1 && plan[0].kind === 'bench' && plan[0].add === 'stash' && plan[0].drop === 'dead',
    'a full roster swaps its dead-weight bench body for the clear stash');
  ok(plan[0]?.bid === 0 && plan[0]?.gain === 0, 'a free-agent stash costs nothing and adds nothing this week');
  // Below the bar: a stash only a little better than what is free stays put.
  const close = projOf({ s1: 12, s2: 11, s3: 10, dead: 2, stash: 4, rb2: 2, wr2: 2 });
  ok(seatWirePlan(SLOTS, roster, pool, close, { ...OPTS, rosValueOf: close }).length === 0,
    `a stash under ${BENCH_MIN_GAIN} positional points is not worth the churn`);
  // Without a season value there is no honest bench measure: the old freeze.
  ok(seatWirePlan(SLOTS, roster, pool, ros, OPTS).length === 0, 'no season value → no bench swaps (pre-0.518 behaviour)');
  // One per sweep, even with two dead bodies and two stashes — and two good
  // backs on the wire do not cancel each other out (REPLACEMENT_WEIGHT).
  const t2 = projOf({ s1: 12, s2: 11, s3: 10, dead: 0.5, dead2: 0.4, stash: 9, stash2: 8.5, rb2: 2, wr2: 2 });
  const two = seatWirePlan(SLOTS, [...roster, wr('dead2')], [...pool, free(rb('stash2'), false)], t2, { ...OPTS, rosValueOf: t2 });
  ok(two.length === 1 && two[0].add === 'stash' && two[0].drop === 'dead2',
    'one bench swap per sweep, the best stash for the least useful body');
  // A held stash in a PRIORITY league is not worth the seat's place in line…
  const heldPool = [{ ...rb('stash'), onWaivers: true, held: true }, free(rb('rb2'), false), free(wr('wr2'), false)];
  ok(seatWirePlan(SLOTS, roster, heldPool, ros, { ...OPTS, rosValueOf: ros }).length === 0,
    'a priority league never spends its claim on a bench stash');
  // …but in FAAB it is claimed, for a priced, modest bid.
  const fb = seatWirePlan(SLOTS, roster, heldPool, ros, { faab: true, budget: 100, openSeats: 0, rosValueOf: ros });
  ok(fb.length === 1 && fb[0].kind === 'bench' && fb[0].onWaivers && fb[0].bid >= 1 && fb[0].bid <= 25,
    `a FAAB league claims the held stash for a modest bid ($${fb[0]?.bid})`);
  // A position no spot accepts is never a stash, however it projects.
  ok(seatWirePlan(SLOTS, roster, [{ id: 'k1', pos: 'K', onWaivers: false }], projOf({ s1: 12, s2: 11, s3: 10, dead: 0, k1: 30 }),
    { ...OPTS, rosValueOf: projOf({ s1: 12, s2: 11, s3: 10, dead: 0, k1: 30 }) }).length === 0,
    'a kicker in a league with no K spot is never stashed');
}

// ── 19. POSITIONAL VALUE: raw points do not compare across positions ──────
// A backup QB projecting 16 in a one-QB league, with a 15 on the wire, is
// worth almost nothing to hold; the bot used to hoard him forever because
// no back ever "outscored" him.
{
  const QSLOTS = [{ slot: 'Q', type: 'QB', pos: ['QB'] }, ...SLOTS];
  const qb = (id) => ({ id, pos: 'QB' });
  ok(benchUse(QSLOTS, 'QB') === 0.5 && benchUse(QSLOTS, 'RB') === 1 && benchUse(QSLOTS, 'K') === 0,
    'benchUse: a one-spot position is half as useful on the bench; no spot, not at all');
  const roster = [qb('q1'), rb('s1'), rb('hurt'), wr('s3'), qb('q2')];
  const week = projOf({ q1: 20, s1: 12, hurt: 0, s3: 10, q2: 16, rbA: 9, qfree: 15, rbB: 4 });
  const ros = projOf({ q1: 20, s1: 12, hurt: 11, s3: 10, q2: 16, rbA: 9, qfree: 15, rbB: 4 });
  const pool = [free(rb('rbA'), false), free(qb('qfree'), false), free(rb('rbB'), false)];
  const plan = seatWirePlan(QSLOTS, roster, pool, week, { ...OPTS, rosValueOf: ros });
  ok(plan[0]?.kind === 'hole' && plan[0]?.add === 'rbA' && plan[0]?.drop === 'q2',
    'the hole is filled by cutting the backup QB, whose double is free — raw points alone refused it');
  // …but not for a mere streamer when the backup QB is genuinely scarce.
  const sw = projOf({ q1: 20, s1: 12, hurt: 0, s3: 10, q2: 16, rbA: 5, qjunk: 4, rbB: 4 });
  const scarce = seatWirePlan(QSLOTS, roster, [free(rb('rbA'), false), free(qb('qjunk'), false), free(rb('rbB'), false)], sw,
    { ...OPTS, rosValueOf: projOf({ q1: 20, s1: 12, hurt: 11, s3: 10, q2: 16, rbA: 5, qjunk: 4, rbB: 4 }) });
  ok(scarce.length === 0, 'a backup QB with nothing like him on the wire is kept over a streamer');
  // And the bench never fills up with QBs: one backup at a one-spot position
  // is cover, a second is a hoard.
  const hq = projOf({ q1: 20, s1: 12, s2: 11, s3: 10, q2: 9, dead: 1, qa: 18, qb2: 14, w2: 2 });
  const noHoard = seatWirePlan(QSLOTS, [qb('q1'), rb('s1'), rb('s2'), wr('s3'), qb('q2'), wr('dead')],
    [free(qb('qa'), false), free(qb('qb2'), false), free(wr('w2'), false)], hq, { ...OPTS, rosValueOf: hq });
  ok(noHoard.every((c) => c.add !== 'qa' || c.drop === 'q2'), 'a second backup QB is never stashed beside the first');
}

// ── 20. AI LINEUPS PLAY THE ODDS (v0.518.0) ──────────────────────────────
// A Doubtful starter is worth his projection times his chance of playing on
// a seat the AI manages; a human seat keeps him at full value.
{
  // A real baked player, so the projection is not a vacuous zero.
  const [slug, pts] = [...PROJ_2026.entries()].find(([, v]) => v > 5);
  const p = { id: slug, pos: 'RB', team: null };
  const doubtful = () => 0.75;
  const plain = slateAwareProj(1, [], doubtful)(p);
  const odds = slateAwareProj(1, [], doubtful, { discountRisk: true })(p);
  ok(plain > 0 && Math.abs(odds - plain * 0.25) < 1e-9, `the AI values a Doubtful player at a quarter (${plain.toFixed(1)} → ${odds.toFixed(1)}; bake ${pts})`);
  ok(slateAwareProj(1, [], () => 0, { discountRisk: true })(p) === plain, 'a healthy player is untouched');
  ok(slateAwareProj(1, [], () => true, { discountRisk: true })(p) === 0, 'ruled out is still zero');
}

// ── PUKA FOR A DEFENSE (v0.561.4) ─────────────────────────────────────────
// Founder: a CPU team "dropped Puka Freaking Nacua for a defense". A Doubtful
// star sits this week (2.6 after the odds), the team has no defense, a decent
// WR is free and no other defense is: the old rail read him as replaceable
// and the defense as scarce, and filled the DEF "hole" with him.
{
  const SL = [
    { slot: 'S1', type: 'WR', pos: ['WR'] }, { slot: 'S2', type: 'WR', pos: ['WR'] },
    { slot: 'S3', type: 'WR', pos: ['WR'] }, { slot: 'S4', type: 'DEF', pos: ['DEF'] },
  ];
  const roster = [wr('w1'), wr('w2'), wr('w3'), wr('puka')];
  const wk = projOf({ w1: 12, w2: 11, w3: 10, puka: 2.6, freewr: 10.5, dst: 7 });
  const ros = projOf({ w1: 12, w2: 11, w3: 10, puka: 17.5, freewr: 10.5, dst: 7 });
  const healthy = projOf({ w1: 12, w2: 11, w3: 10, puka: 17.5, freewr: 10.5, dst: 7 });
  const pool = [{ id: 'dst', pos: 'DEF', onWaivers: false }, { id: 'freewr', pos: 'WR', onWaivers: false }];
  ok(seatWirePlan(SL, roster, pool, wk, { ...OPTS, rosValueOf: ros }).length === 0,
    `the floor: never a 17.5 WR for a 7 DEF (gap ≥ ${DROP_FLOOR_GAP})`);
  // The healthy-lineup rail on its own (floor out of reach: the defense is close in value).
  const ros2 = projOf({ w1: 12, w2: 11, w3: 10, puka: 9, freewr: 8, dst: 7 });
  const hv2 = projOf({ w1: 12, w2: 11, w3: 10, puka: 9, freewr: 8, dst: 7 });
  const planNoHealthy = seatWirePlan(SL, [wr('w1'), wr('w2'), wr('w3'), wr('puka')], pool, projOf({ w1: 12, w2: 11, w3: 10, puka: 1, dst: 7 }), { ...OPTS, rosValueOf: ros2 });
  ok(planNoHealthy.some((c) => c.drop === 'puka'), '(without the healthy view the Doubtful starter is the drop)');
  const hv3 = projOf({ w1: 8, w2: 8, w3: 8, puka: 9, dst: 7 });
  ok(!seatWirePlan(SL, [wr('w1'), wr('w2'), wr('w3'), wr('puka')], pool, projOf({ w1: 8, w2: 8, w3: 8, puka: 1, dst: 7 }), { ...OPTS, rosValueOf: ros2, healthyValueOf: hv3 })
    .some((c) => c.drop === 'puka'), 'who would start healthy is never dropped for a week\'s injury');
  // A real bench body still goes for the defense: the rails protect value, not everyone.
  const roster4 = [wr('w1'), wr('w2'), wr('w3'), wr('scrub')];
  const p4 = seatWirePlan(SL, roster4, pool, projOf({ w1: 12, w2: 11, w3: 10, scrub: 3, dst: 7 }),
    { ...OPTS, rosValueOf: projOf({ w1: 12, w2: 11, w3: 10, scrub: 3, freewr: 10.5, dst: 7 }), healthyValueOf: projOf({ w1: 12, w2: 11, w3: 10, scrub: 3, dst: 7 }) });
  ok(p4.length === 1 && p4[0].add === 'dst' && p4[0].drop === 'scrub', 'a 3-point bench WR still goes for the defense');
  void healthy; void hv2;
}

// ── 21. MOMENTUM: the wire's trending adds make a candidate more attractive,
//        never a rostered man cheaper to drop (v0.642.0) ─────────────────────
{
  ok(trendMomentum(100_000, 0) === MOMENTUM_MAX && trendMomentum(25_000, 0) === 1 && trendMomentum(0, 0) === 0,
    `momentum is net adds over ${TREND_PER_POINT} per point, capped at ${MOMENTUM_MAX}`);
  ok(trendMomentum(0, 100_000) === -MOMENTUM_MAX / 2 && trendMomentum(null, undefined) === 0,
    'a mass drop is half the cap downward; no feed is zero');
  // Two free backs for an UPGRADE: flat 'a' beats 'b' on the season by a
  // hair; 'b' is trending hard. Below the bar neither clears on the week, so
  // the season lens decides — and momentum tips it to the trending man.
  const roster = [rb('s1'), rb('s2'), wr('s3'), rb('bench')];
  const t = projOf({ s1: 12, s2: 11, s3: 10, bench: 3, a: 4.9, b: 4.8 });
  const pool = [free(rb('a'), false), free(rb('b'), false)];
  const flat = seatWirePlan(SLOTS, roster, pool, t, { ...OPTS, rosValueOf: t });
  ok(flat.length === 0, 'neither back clears the upgrade bar on season value alone');
  const hot = seatWirePlan(SLOTS, roster, pool, t, { ...OPTS, rosValueOf: t, momentumOf: (p) => (p.id === 'b' ? 1.5 : 0) });
  ok(hot.length === 1 && hot[0].add === 'b' && hot[0].drop === 'bench',
    'with momentum the trending back clears the season bar and is the one taken');
  // The rails hold: a trending man never gets a MORE valuable player dropped for him.
  const keep = projOf({ s1: 12, s2: 11, s3: 10, bench: 8, a: 4.9, b: 4.8 });
  ok(seatWirePlan(SLOTS, roster, pool, keep, { ...OPTS, rosValueOf: keep, momentumOf: () => MOMENTUM_MAX }).length === 0,
    'momentum never drops a bench body worth more for the season than the add');
  // Depth: with a seat open, the trending body is picked over the flat one.
  const deep = seatWirePlan(SLOTS, [rb('s1'), rb('s2'), wr('s3')], pool, t, { ...OPTS, openSeats: 1, rosValueOf: t, momentumOf: (p) => (p.id === 'b' ? 1 : 0) });
  ok(deep.length === 1 && deep[0].kind === 'depth' && deep[0].add === 'b', 'a depth add prefers the trending body');
}

// ── 22. OFF IR, FULL ROSTER OR NOT: who goes so the healed man comes back
//        (v0.642.0) ─────────────────────────────────────────────────────────
{
  const active = [rb('s1'), rb('s2'), wr('s3'), rb('b1'), wr('b2')];
  const ros = projOf({ s1: 12, s2: 11, s3: 10, b1: 6, b2: 2, healed: 9 });
  ok(legalizeIrDrop(SLOTS, active, rb('healed'), ros) === 'b2', 'the cheapest season body who would not start goes');
  // The healed man would START: a starter he displaces is a bench body now, but still never the best ones.
  const star = projOf({ s1: 12, s2: 11, s3: 10, b1: 6, b2: 2, healed: 20 });
  ok(legalizeIrDrop(SLOTS, active, rb('healed'), star) === 'b2', 'a returning star bumps a starter to the bench; the cheapest body still goes');
  // Nobody is worth less than him: he is the cut.
  const dud = projOf({ s1: 12, s2: 11, s3: 10, b1: 6, b2: 2, healed: 1 });
  ok(legalizeIrDrop(SLOTS, active, rb('healed'), dud) === 'healed', 'worth less than every bench body, the healed man himself is cut');
  // Never a starter, even when the bench is empty of cheaper men.
  const tight = projOf({ s1: 12, s2: 11, s3: 10, healed: 5 });
  ok(legalizeIrDrop(SLOTS, [rb('s1'), rb('s2'), wr('s3')], rb('healed'), tight) === 'healed', 'with no bench body at all, the starters are never touched');
}

// ── COVERAGE (v0.665.1) ─────────────────────────────────────────────────────
// Founder: "AI teams … will make roster moves that leave them without players
// that fit scoped positions. Team 2 in Kickoff League … has no rookies but the
// league has a rookie only bestball spot."
{
  const SL = [
    { slot: 'S1', type: 'RB', pos: ['RB'] }, { slot: 'S2', type: 'WR', pos: ['WR'] },
    { slot: 'S3', type: 'FLEX', pos: ['RB', 'WR', 'TE', 'QB'], flt: { max_exp: 0 }, label: 'Rookie Only Bestball' },
  ];
  const vet = (id, pos, exp = 5) => ({ id, pos, exp });
  const rook = (id, pos) => ({ id, pos, exp: 0 });
  ok(isScopedSpot(SL[2]) && !isScopedSpot(SL[0]), 'a tenure-filtered spot is scoped; a plain RB spot is not');
  // 1. The only rookie is never the drop, even on his bye.
  {
    const roster = [vet('rb1', 'RB'), vet('wr1', 'WR'), rook('rookie', 'WR'), vet('bench', 'TE', 3)];
    ok(soleCover(SL, roster, roster[2]) && !soleCover(SL, roster, roster[3]), 'the one rookie alone covers the rookie spot');
    const wk = projOf({ rb1: 12, wr1: 11, rookie: 0, bench: 3, streamer: 9 });
    const ros = projOf({ rb1: 12, wr1: 11, rookie: 4, bench: 3, streamer: 9 });
    const plan = seatWirePlan(SL, roster, [free({ ...vet('streamer', 'TE', 4) }, false)], wk, { ...OPTS, rosValueOf: ros });
    ok(!plan.some((c) => c.drop === 'rookie'), `the rookie on his bye is not the drop (${JSON.stringify(plan.map((c) => [c.add, c.drop]))})`);
  }
  // 2. No rookie at all: the gap is filled first, from a rookie the position's
  //    top twelve would never carry, paying with the cheapest bench body.
  {
    const roster = [vet('rb1', 'RB'), vet('wr1', 'WR'), vet('bench', 'TE', 3), vet('bench2', 'WR', 6)];
    ok(uncoveredSpots(SL, roster).map((d) => d.slot).join() === 'S3', 'the rookie spot is uncovered');
    const wk = projOf({ rb1: 12, wr1: 11, bench: 3, bench2: 5, rookie: 2, star: 14 });
    const ros = projOf({ rb1: 12, wr1: 11, bench: 3, bench2: 5, rookie: 3, star: 14 });
    const pool = [free(vet('star', 'WR', 4), false), free(rook('rookie', 'WR'), true)];
    const short = shortlistWire(pool.concat(Array.from({ length: 14 }, (_, i) => free(vet(`wr${i + 10}`, 'WR', 4), false))), (p) => (p.id === 'rookie' ? 1 : 8), 12, { slots: SL, roster });
    ok(short.some((p) => p.id === 'rookie'), 'the shortlist keeps a rookie for the uncovered spot past the top twelve');
    const plan = seatWirePlan(SL, roster, pool, wk, { ...OPTS, rosValueOf: ros, maxClaims: 2 });
    // The drop is the cheapest body TO HOLD (v0.518.0's positional measure):
    // the WR with a 14 free at his position, not the TE with no double.
    ok(plan[0]?.add === 'rookie' && plan[0].kind === 'hole' && ['bench', 'bench2'].includes(plan[0].drop), `the rookie fill comes first, for a bench body (${JSON.stringify(plan.map((c) => [c.add, c.drop, c.kind]))})`);
    ok(plan[0]?.onWaivers === true, 'as a claim when he is held');
  }
  // 3. Still never a star for a rookie-spot body (the floor holds).
  {
    const roster = [vet('rb1', 'RB'), vet('wr1', 'WR'), vet('puka', 'WR', 2)];
    const wk = projOf({ rb1: 12, wr1: 11, puka: 2.6, rookie: 2 });
    const ros = projOf({ rb1: 12, wr1: 11, puka: 17.5, rookie: 3 });
    const plan = seatWirePlan(SL, roster, [free(rook('rookie', 'WR'), false)], wk, { ...OPTS, rosValueOf: ros, healthyValueOf: ros });
    ok(plan.length === 0, 'a 17.5 star is not cut for a rookie-spot body');
  }
  // 4. A healed rookie comes back; the cheapest other bench body goes.
  {
    const active = [vet('rb1', 'RB'), vet('wr1', 'WR'), vet('bench', 'TE', 3)];
    const ros = projOf({ rb1: 12, wr1: 11, bench: 3, rookie: 2 });
    ok(legalizeIrDrop(SL, active, rook('rookie', 'WR'), ros) === 'bench', 'the healed rookie is not the cut even though he is worth less than every bench body');
    const noBench = [vet('rb1', 'RB'), vet('wr1', 'WR')];
    ok(legalizeIrDrop(SL, noBench, rook('rookie', 'WR'), ros) === 'rookie', 'with no bench body at all, the rookie (not a starter) is still the only cut');
  }
  ok(spotCover(SL, [rook('r', 'RB')]).get('S3')?.join() === 'r', 'spotCover lists who may stand in each spot');
}

// ── THE DYNASTY GUARD (v0.719.0): the AI seats use it too ───────────────────
{
  const RB2 = [{ slot: 'S1', type: 'RB', pos: ['RB'] }, { slot: 'S2', type: 'RB', pos: ['RB'] }];
  const proj = (p) => PROJ_2026.get(p.id) ?? 0;
  const mine = [{ id: 'bijan-robinson', pos: 'RB' }, { id: 'jonathan-taylor', pos: 'RB' }, { id: 'young-stash', pos: 'RB' }];
  const wire = [{ id: 'derrick-henry', pos: 'RB', onWaivers: false }];
  const base = { faab: false, budget: 0, openSeats: 0, maxClaims: 2, rosValueOf: proj, healthyValueOf: proj };
  const free = seatWirePlan(RB2, mine, wire, proj, base);
  ok(free.some((c) => c.drop === 'young-stash'), 'dynasty guard: without it, a zero-projection stash goes for a real back');
  const dyn = new Map([['young-stash', 7000], ['derrick-henry', 1500]]);
  const guarded = seatWirePlan(RB2, mine, wire, proj, { ...base, keepValueOf: (p) => dyn.get(p.id) ?? 0 });
  ok(!guarded.some((c) => c.drop === 'young-stash'), 'dynasty guard: no claim drops a player worth more on the dynasty market than the add');
  const both = [...mine, { id: 'old-vet', pos: 'RB' }];
  const dyn2 = new Map([['young-stash', 7000], ['old-vet', 100], ['derrick-henry', 1500]]);
  const spent = seatWirePlan(RB2, both, wire, proj, { ...base, keepValueOf: (p) => dyn2.get(p.id) ?? 0 });
  ok(spent.length > 0 && spent.every((c) => c.drop !== 'young-stash'), 'dynasty guard: the bench is spent lowest-dynasty-value first');

  const { isDynastySettings, dynFormatOfSlots, dynValues } = await import('../packages/core/src/data/dynastyMarket.ts');
  ok(isDynastySettings({ continuity: 'dynasty' }) && isDynastySettings({ continuity: 'contract_dynasty' }) && !isDynastySettings({ continuity: 'keeper', rookie_rounds: 3 })
    && isDynastySettings({ rookie_rounds: 2 }) && isDynastySettings({ dynasty: true }) && !isDynastySettings({}) && !isDynastySettings(null),
    'dynasty market: which leagues are dynasty mirrors league_continuity (an explicit continuity wins)');
  ok(dynFormatOfSlots([{ slot: 'Q', pos: ['QB'] }, { slot: 'SF', pos: ['QB', 'RB', 'WR', 'TE'] }]) === 'sf' && dynFormatOfSlots([{ slot: 'Q', pos: ['QB'] }, ...RB2]) === '1qb',
    'dynasty market: more than one QB-eligible spot reads the superflex market');
  const now = Date.parse('2026-10-15T00:00:00Z');
  const rows = [{ slug: 'a', v1qb: 100, vsf: 300, fetched_at: '2026-10-12T00:00:00Z' }, { slug: null, v1qb: 5, vsf: 5, fetched_at: '2026-10-12T00:00:00Z' }];
  ok(dynValues(rows, 'sf', now).get('a') === 300 && dynValues(rows, '1qb', now).get('a') === 100 && dynValues(rows, '1qb', now).size === 1,
    'dynasty market: values in the league\'s format, unresolved rows skipped');
  ok(dynValues(rows, '1qb', now + 11 * 864e5).size === 0, 'dynasty market: a board over ten days old guards nothing');
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../server/src/seatWire.js', import.meta.url), 'utf8');
  ok(sw.includes("isDynastySettings(lg.settings_json) ? dynMarket(dynFormatOfSlots(slots))") && /momentumOf,\s*keepValueOf,/.test(sw),
    'worker: the AI seats pass the dynasty market as keepValueOf in a dynasty league');
}

// ── ONE LEAGUE CANNOT STOP THE REST (v0.727.0) ───────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../server/src/seatWire.js', import.meta.url), 'utf8');
  const lgLoop = sw.indexOf('for (const lg of lgs ?? []) {\n    try {');
  const seatLoop = sw.indexOf('for (const seat of seatRows.filter((r) => r.league_id === lg.id)) {\n      try {');
  ok(lgLoop > 0 && sw.includes("log('seat wire league failed', lg.id"), 'seat wire: each league runs in its own try — a failure is logged with its league and the sweep goes on');
  ok(seatLoop > lgLoop && sw.includes("log('seat wire seat failed', lg.id, seat.roster_id"), 'seat wire: each seat in its own try too');
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  ok(cli.includes("if (req.league) argv.push(`--league=${req.league}`);") && cli.includes("league ? { leagueId: league"), 'ops seat-wire: no league runs the whole sweep once, with its log');
}

// v0.729.1: the sweep's league read in chunks, every page, errors logged.
{
  const { inChunks, readAll } = await import('../server/src/seatWire.js');
  const ids = Array.from({ length: 250 }, (_, i) => `L${i}`);
  const calls = [];
  const fake = (part) => ({ range: async (a, b) => { calls.push(part.length); return { data: part.slice(a, b + 1).map((id) => ({ id })), error: null }; } });
  const got = await inChunks(ids, fake, 'leagues');
  ok(got.length === 250 && calls.length === 3 && Math.max(...calls) === 100, `250 league ids read in three chunks of at most 100 (got ${got.length} rows, ${calls.join('/')})`);
  const rows = Array.from({ length: 2300 }, (_, i) => ({ i }));
  const all = await readAll(() => ({ range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }) }), 'AI seats');
  ok(all.length === 2300, `every page past PostgREST's 1000-row cap is read (got ${all.length})`);
  const logged = [];
  const failed = await readAll(() => ({ range: async () => ({ data: null, error: { message: 'URI too long' } }) }), 'leagues', (...m) => logged.push(m.join(' ')));
  ok(failed.length === 0 && logged.some((l) => l.includes('leagues read failed') && l.includes('URI too long')), 'a failed read is logged, not taken for "no leagues"');
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../server/src/seatWire.js', import.meta.url), 'utf8');
  ok(!/\.in\('id', leagueIds\)|\.in\('league_id', leagueIds\)/.test(sw), 'no unchunked league-id read left in the sweep');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL SEAT-WAIVER ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
