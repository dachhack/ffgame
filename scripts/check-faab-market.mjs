// Guard for the FAAB market pricer (v0.428.0): what an AI seat bids on a
// held player, against the room, without overpaying.
// Run: npx tsx scripts/check-faab-market.mjs
import {
  marketShare, calibration, expectedTopBid, faabBid,
  MARKET_MAX_SHARE, MARKET_HALF_POINT, MARKET_RESERVE, CALIBRATION_MIN, CALIBRATION_MAX, HOLE_FAAB_PER_POINT,
} from '../packages/core/src/engine/faabMarket.ts';
import { seatWirePlan } from '../packages/core/src/engine/seatWaivers.ts';
import { clearLeagueFlags } from '../packages/core/src/data/commish.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
clearLeagueFlags();

// ── 1. The share curve ────────────────────────────────────────────────────
ok(marketShare(0) === 0 && marketShare(-5) === 0, 'no surplus commands nothing');
ok(Math.abs(marketShare(MARKET_HALF_POINT) - MARKET_MAX_SHARE / 2) < 1e-9, 'half the ceiling at the half-point');
ok(marketShare(1000) < MARKET_MAX_SHARE && marketShare(1000) > MARKET_MAX_SHARE * 0.99, 'a stud approaches the ceiling and never passes it');
ok(marketShare(3) < marketShare(6) && marketShare(6) < marketShare(12), 'monotone in surplus');

// ── 2. The room: expected top rival ───────────────────────────────────────
ok(expectedTopBid(10, []) === 0, 'no rivals, nothing to beat');
ok(expectedTopBid(10, [100, 100, 100]) > expectedTopBid(10, [50, 50, 50]), 'richer rivals raise the price');
ok(expectedTopBid(10, [100, 10, 10]) > expectedTopBid(10, [40, 40, 40]), 'one deep pocket sets the price more than the average does');
ok(expectedTopBid(10, [100], 2) === 2 * expectedTopBid(10, [100], 1), 'calibration scales it');

// ── 3. Calibration from the league's own claims ───────────────────────────
const claim = (surplus, bid, won = true, ref = 100) => ({ surplus, bid, won, ref });
ok(calibration(undefined) === 1 && calibration([]) === 1, 'no history → the curve as written');
ok(calibration([claim(6, 60), claim(6, 60)]) === 1, 'two samples are not enough to trust');
{
  const fair = marketShare(6) * 100;   // what the curve says a 6-surplus player costs of $100
  ok(Math.abs(calibration([claim(6, fair), claim(6, fair), claim(6, fair)]) - 1) < 1e-9, 'a league that pays the curve reads 1');
  ok(Math.abs(calibration([claim(6, fair * 1.5), claim(6, fair * 1.5), claim(6, fair * 1.5)]) - 1.5) < 1e-9, 'a league that overpays by half reads 1.5');
  ok(calibration([claim(6, fair * 9), claim(6, fair * 9), claim(6, fair * 9)]) === CALIBRATION_MAX, 'clamped above');
  ok(calibration([claim(6, 1), claim(6, 1), claim(6, 1)]) === CALIBRATION_MIN, 'clamped below');
  ok(Math.abs(calibration([claim(6, fair), claim(6, fair), claim(6, fair), claim(6, fair * 10, false)]) - 1) < 1e-9, 'a LOST bid does not calibrate — only what winners paid');
  ok(Math.abs(calibration([claim(6, fair), claim(6, fair), claim(6, fair), claim(0.5, 40)]) - 1) < 1e-9, 'a claim with no real surplus is noise, not a sample');
}

// ── 4. The bid: just above the room, never above the ceiling ──────────────
{
  const room = { rivalBudgets: [80, 60, 40], weeksLeft: 10, history: [] };
  const expected = expectedTopBid(10, room.rivalBudgets);
  const bid = faabBid({ surplus: 10, myGain: 10, gainNow: 10, budget: 100, ...room });
  ok(bid > expected && bid <= Math.ceil(expected * 1.05) + 1, `the bid sits just over the expected top rival (${bid} vs ${expected.toFixed(1)})`);
  const poor = faabBid({ surplus: 10, myGain: 10, gainNow: 10, budget: 20, ...room });
  ok(poor <= 20 && poor >= 1, 'never above what is left');
  const ceiling = Math.floor(100 * marketShare(2) * (1 - MARKET_RESERVE));
  const meh = faabBid({ surplus: 10, myGain: 2, gainNow: 0, budget: 100, ...room });
  ok(meh === ceiling, `a player the room prices high but MY lineup barely needs is capped at his worth to me (${meh} = ${ceiling})`);
  const late = faabBid({ surplus: 10, myGain: 2, gainNow: 0, budget: 100, ...room, weeksLeft: 2 });
  ok(late > meh, 'in the last weeks the reserve is spent');
  ok(faabBid({ surplus: 10, myGain: 10, gainNow: 10, budget: 0, ...room }) === 0, 'broke → no bid');
  ok(faabBid({ surplus: 0, myGain: 0, gainNow: 0, budget: 100, ...room }) === 0, 'nothing to bid for → no bid');
  // A quiet room (everyone broke) still answers a hole at the old rate.
  const quiet = faabBid({ surplus: 3, myGain: 3, gainNow: 4, hole: true, budget: 100, rivalBudgets: [0, 0], weeksLeft: 10, history: [] });
  const quietUp = faabBid({ surplus: 3, myGain: 3, gainNow: 4, budget: 100, rivalBudgets: [0, 0], weeksLeft: 10, history: [] });
  ok(quietUp === 1, 'an UPGRADE in a quiet room bids the minimum — nobody to beat, no floor');
  ok(quiet === Math.min(Math.ceil(4 * HOLE_FAAB_PER_POINT), Math.floor(100 * marketShare(3) * (1 - MARKET_RESERVE))),
    `a hole in a quiet room is answered at $${HOLE_FAAB_PER_POINT} a point, under the ceiling (${quiet})`);
  // Calibration moves the bid: a league that overpays makes the AI pay more
  // (to win), a thrifty one makes it pay less (no overbid).
  const fair = marketShare(10) * 100;
  const dear = faabBid({ surplus: 10, myGain: 10, gainNow: 10, budget: 100, ...room, history: [claim(10, fair * 1.5), claim(10, fair * 1.5), claim(10, fair * 1.5)] });
  const cheap = faabBid({ surplus: 10, myGain: 10, gainNow: 10, budget: 100, ...room, history: [claim(10, fair * 0.6), claim(10, fair * 0.6), claim(10, fair * 0.6)] });
  ok(dear > bid && cheap < bid, `the league's own prices move the bid (${cheap} < ${bid} < ${dear})`);
}

// ── 5. Through the planner: a chopped star on his bye is still the prize ──
{
  const SLOTS = [{ slot: 'S1', type: 'RB', pos: ['RB'] }, { slot: 'S2', type: 'RB', pos: ['RB'] }, { slot: 'S3', type: 'FLEX', pos: ['RB', 'WR', 'TE'] }];
  const rb = (id) => ({ id, pos: 'RB' }); const wr = (id) => ({ id, pos: 'WR' });
  const free = (p, onWaivers = true) => ({ ...p, onWaivers });
  const projOf = (t) => (p) => t[p.id] ?? 0;
  const roster = [rb('s1'), rb('s2'), wr('s3'), wr('bench')];
  const week = projOf({ s1: 10, s2: 9, s3: 8, bench: 3, star: 0, streamer: 10.5, fa: 4 });
  const ros = projOf({ s1: 10, s2: 9, s3: 8, bench: 3, star: 18, streamer: 6, fa: 4 });
  const pool = [free(rb('star')), free(rb('streamer')), free(rb('fa'), false)];
  const market = { rivalBudgets: [70, 70, 70], weeksLeft: 10, history: [], replacementOf: () => 4 };
  const noRos = seatWirePlan(SLOTS, roster, pool, week, { faab: true, budget: 100, openSeats: 0 });
  ok(noRos[0]?.add === 'streamer', 'by this week alone the bye-week star is invisible and the streamer is taken');
  const plan = seatWirePlan(SLOTS, roster, pool, week, { faab: true, budget: 100, openSeats: 0, rosValueOf: ros, market });
  ok(plan[0]?.add === 'star' && plan[0].kind === 'upgrade', 'with the season in view the chopped star is the first claim');
  ok(plan[0]?.rosGain > 0 && plan[0].gain === 0, 'ranked on his season gain, though he adds nothing this week');
  const expected = expectedTopBid(18 - 4, market.rivalBudgets);
  ok(plan[0]?.bid > expected && plan[0].bid <= Math.floor(100 * marketShare(plan[0].rosGain) * (1 - MARKET_RESERVE)),
    `priced over the room and under his worth here ($${plan[0]?.bid})`);
  const total = plan.reduce((a, c) => a + c.bid, 0);
  ok(total <= 100, 'a sweep\'s claims never sum past the budget');
  ok(plan.every((c) => c.onWaivers || c.bid === 0), 'a free agent costs nothing to sign');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL FAAB-MARKET ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
