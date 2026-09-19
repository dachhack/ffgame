// Guard for what a VAMPIRE NOBODY MANAGES takes (v0.427.0). The planner is
// pure so the policy is pinned here rather than in a fixture league.
// Run: npx tsx scripts/check-vampire-bite.mjs
import { vampireBitePlan } from '../packages/core/src/engine/vampireBite.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const SLOTS = [
  { slot: 'S1', type: 'RB', pos: ['RB'] },
  { slot: 'S2', type: 'RB', pos: ['RB'] },
  { slot: 'S3', type: 'FLEX', pos: ['RB', 'WR', 'TE'] },
];
const rb = (id) => ({ id, pos: 'RB' });
const wr = (id) => ({ id, pos: 'WR' });
const projOf = (t) => (p) => t[p.id] ?? 0;

// ── 1. The bite lifts the LINEUP, and gives back the cheapest body ────────
{
  const mine = [rb('m1'), rb('m2'), wr('m3'), wr('mb')];
  const theirs = [rb('stud'), rb('t2'), wr('t3'), wr('tb')];
  const ros = projOf({ m1: 10, m2: 6, m3: 5, mb: 2, stud: 14, t2: 7, t3: 4, tb: 1 });
  const plan = vampireBitePlan(SLOTS, mine, theirs, ros);
  ok(plan.length > 0 && plan[0].take === 'stud', 'the best bite takes the stud');
  ok(plan[0]?.give === 'mb', 'and gives back the cheapest bench body, not a starter');
  ok(Math.abs(plan[0].gain - (14 + 10 + 6 - (10 + 6 + 5))) < 1e-9, 'gain is the lineup delta (stud in, the flex WR displaced)');
  ok(plan.every((b, i) => i === 0 || plan[i - 1].gain >= b.gain), 'ranked best first');
}

// ── 2. NEVER a downgrade: give-back worth more than the take is not offered
{
  const mine = [rb('m1'), rb('m2'), wr('m3')];
  const theirs = [rb('t1'), wr('t2')];
  const ros = projOf({ m1: 10, m2: 9, m3: 8, t1: 5, t2: 4 });
  ok(vampireBitePlan(SLOTS, mine, theirs, ros).length === 0,
    'when every one of theirs is worth less than every one of ours there is no bite');
  const ros2 = projOf({ m1: 10, m2: 9, m3: 8, t1: 9.5, t2: 4 });
  const plan = vampireBitePlan(SLOTS, mine, theirs, ros2);
  ok(plan.length === 2 && plan.every((b) => b.take === 't1') && !plan.some((b) => b.give === 'm1'),
    'only the 9.5 back is worth taking, and never for the 10-point starter');
  ok(plan[0].give === 'm3' && plan[1].give === 'm2',
    'giving the flex WR (8) lifts the lineup more than giving the RB2 (9) — the lineup, not the label, ranks it');
}

// ── 3. Judged by the SEASON: a bye-week star is exactly who to take ───────
{
  const mine = [rb('m1'), rb('m2'), wr('m3'), wr('mb')];
  const theirs = [rb('bye-star'), rb('t2')];
  const ros = projOf({ m1: 10, m2: 6, m3: 5, mb: 2, 'bye-star': 15, t2: 7 });
  const plan = vampireBitePlan(SLOTS, mine, theirs, ros);
  ok(plan[0]?.take === 'bye-star', 'the caller hands season value, so the bye this week does not hide the star');
}

// ── 4. Nothing to feed on: IR / unknown players are never taken ───────────
{
  const mine = [rb('m1'), rb('m2'), wr('m3')];
  const theirs = [rb('done'), rb('nobody')];
  const ros = projOf({ m1: 10, m2: 6, m3: 5, done: 0 });
  ok(vampireBitePlan(SLOTS, mine, theirs, ros).length === 0, 'a season-ending IR or an unpriced player is no reward');
}

// ── 5. Equal lineup lifts prefer the bigger asset swing ───────────────────
{
  const mine = [rb('m1'), rb('m2'), wr('m3'), wr('mb1'), wr('mb2')];
  const theirs = [wr('tb1'), wr('tb2')];
  // Neither bench WR starts (m3 holds the flex), so every bite's lineup gain
  // is 0; the swing decides: take tb2 (6) for mb2 (1).
  const ros = projOf({ m1: 10, m2: 9, m3: 8, mb1: 2, mb2: 1, tb1: 5, tb2: 6 });
  const plan = vampireBitePlan(SLOTS, mine, theirs, ros);
  ok(plan[0]?.take === 'tb2' && plan[0]?.give === 'mb2' && plan[0]?.gain === 0,
    'a bench-for-bench bite still happens — the best swing first');
}

// ── 6. The list is bounded and deterministic ──────────────────────────────
{
  const mine = [rb('m1'), rb('m2'), wr('m3'), wr('mb')];
  const theirs = [rb('a'), rb('b'), wr('c'), wr('d')];
  const ros = projOf({ m1: 3, m2: 3, m3: 3, mb: 1, a: 9, b: 8, c: 7, d: 6 });
  ok(vampireBitePlan(SLOTS, mine, theirs, ros, { max: 2 }).length === 2, 'max bounds the list');
  const p1 = vampireBitePlan(SLOTS, mine, theirs, ros), p2 = vampireBitePlan(SLOTS, mine, [...theirs].reverse(), ros);
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'the same rosters in any order rank the same');
  ok(vampireBitePlan([], mine, theirs, ros).length === 0 && vampireBitePlan(SLOTS, [], theirs, ros).length === 0,
    'no slots or no roster yields no bites rather than throwing');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL VAMPIRE-BITE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
