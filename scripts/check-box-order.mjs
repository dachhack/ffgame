// Guard for the BOX SCORE's reading order (v0.338.3).
//
// Founder: "sort the box score by offense vs defense, then by position then by
// yards (highest at the top)."
//
// Before this it was one flat involvement ranking, so a 6-tackle linebacker
// outranked a 46-yard receiver and the positions were interleaved — you could
// not scan the list for "how did the backs do", which is most of what a box
// score is for. Nothing about that was visibly wrong; it just made the popup
// useless for the question it exists to answer, which is exactly the class of
// thing that stays broken until somebody says so.
//
// The comparator is asserted directly rather than through `gameBoxScore`,
// which reads a week's play table out of module globals — testing a sort by
// installing a play-by-play week would pin the plumbing and not the judgement.
// Run: npx tsx scripts/check-box-order.mjs
import { boxRowOrder } from '../packages/core/src/engine/boxScore.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

// A row is only what the comparator reads. Keeping the fixture to those four
// fields is the point: if the rule starts depending on something else, this
// stops compiling rather than silently testing the wrong thing.
const row = (slug, pos, yards, weight = 0) => ({
  slug, pos, yards, weight,
  side: ['DEF', 'DL', 'LB', 'DB'].includes(pos) ? 'def' : 'off',
});
const sorted = (rows) => [...rows].sort(boxRowOrder).map((r) => r.slug);

// ── 1. OFFENSE BEFORE DEFENSE, whatever the numbers say ───────────────────
{
  const out = sorted([
    row('star-lb', 'LB', 0, 400),      // a huge defensive game
    row('quiet-wr', 'WR', 3),          // a nearly invisible receiver
  ]);
  ok(out[0] === 'quiet-wr',
    'THE POINT: every offensive player sorts above every defender, however big the defensive line');
}

// ── 2. POSITION ORDER WITHIN OFFENSE ──────────────────────────────────────
{
  const out = sorted([
    row('te', 'TE', 500), row('k', 'K', 0), row('wr', 'WR', 10),
    row('rb', 'RB', 1), row('qb', 'QB', 0), row('fb', 'FB', 0),
  ]);
  ok(out.join(',') === 'qb,rb,fb,wr,te,k',
    'offense reads QB → RB → FB → WR → TE → K regardless of yards');
}

// ── 3. POSITION ORDER WITHIN DEFENSE ──────────────────────────────────────
{
  const out = sorted([row('db', 'DB', 0, 9), row('lb', 'LB', 0, 1), row('dst', 'DEF', 0, 2), row('dl', 'DL', 0, 3)]);
  ok(out.join(',') === 'dst,dl,lb,db', 'defense reads D/ST → DL → LB → DB');
}

// ── 4. YARDS DESCENDING INSIDE A POSITION ─────────────────────────────────
{
  const out = sorted([row('wr-low', 'WR', 12), row('wr-high', 'WR', 96), row('wr-mid', 'WR', 46)]);
  ok(out.join(',') === 'wr-high,wr-mid,wr-low', 'inside a position, most yards first');
}

// ── 5. YARDS BEAT WEIGHT — the reordering the founder actually asked for ──
// A receiver with a touchdown carries far more `weight`; yards still decide.
{
  const out = sorted([row('td-guy', 'WR', 10, 999), row('yardage-guy', 'WR', 90, 1)]);
  ok(out[0] === 'yardage-guy', 'a big-yardage receiver outranks a short touchdown inside the group');
}

// ── 6. WEIGHT IS THE TIEBREAK, AND IT CARRIES THE DEFENDERS ───────────────
// Every defender has 0 yards, so this chain link does the entire job there.
{
  const out = sorted([row('one-tackle', 'LB', 0, 2), row('pick-six', 'LB', 0, 45), row('six-tackles', 'LB', 0, 12)]);
  ok(out.join(',') === 'pick-six,six-tackles,one-tackle',
    'defenders order by involvement, since "yards" measures nothing for them');
}

// ── 7. A TOTAL, STABLE ORDER ──────────────────────────────────────────────
{
  const a = row('aaa', 'WR', 10, 5), b = row('bbb', 'WR', 10, 5);
  ok(sorted([b, a]).join(',') === 'aaa,bbb', 'two identical lines fall back to the slug, so the order never flickers');
  ok(boxRowOrder(a, a) === 0, 'a row compares equal to itself');
  ok(boxRowOrder(a, b) === -boxRowOrder(b, a), 'the comparator is antisymmetric');
}

// ── 8. AN UNKNOWN POSITION SINKS RATHER THAN THROWING ─────────────────────
{
  const out = sorted([row('mystery', 'ZZ', 999), row('qb', 'QB', 0)]);
  ok(out[0] === 'qb', 'a position the rank table has never heard of sorts last within its side');
}

// ── 9. THE WHOLE SHAPE, on a realistic mixed line ─────────────────────────
{
  const out = sorted([
    row('lb-tackles', 'LB', 0, 12),
    row('wr2', 'WR', 41, 60),
    row('qb1', 'QB', 89, 40),
    row('dst', 'DEF', 0, 30),
    row('rb1', 'RB', 53, 80),
    row('wr1', 'WR', 46, 20),
    row('te1', 'TE', 13, 5),
    row('rb2', 'RB', 17, 70),
  ]);
  ok(out.join(',') === 'qb1,rb1,rb2,wr1,wr2,te1,dst,lb-tackles',
    'a full line reads offense-first, by position, by yards — and note rb1 > rb2 and wr1 > wr2 on YARDS, not weight');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL BOX-ORDER ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
