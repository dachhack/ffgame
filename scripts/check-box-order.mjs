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
import { boxRowOrder, scrimmageYards, boxTabRows, offInvolved, defInvolved } from '../packages/core/src/engine/boxScore.ts';

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

// ── 10. RETURN YARDS DO NOT COUNT TOWARD THE SORT (v0.338.4) ──────────────
// Founder's call, and the case that prompted it is in the screenshot that
// started this: a receiver with 14 receiving and 86 on kick returns was
// sorting as the best receiver in the game. He is not, and a box score is
// read precisely to avoid believing he is.
{
  const line = (o) => ({
    passYds: 0, passTds: 0, carries: 0, rushYds: 0, rushTds: 0,
    targets: 0, rec: 0, recYds: 0, recTds: 0, retYds: 0, retTds: 0,
    fg: 0, xp: 0, sacks: 0, ints: 0, fumrec: 0, dtd: 0, safety: 0, tackles: 0, ...o,
  });
  ok(scrimmageYards(line({ recYds: 14, retYds: 86 })) === 14,
    'THE POINT: 14 receiving + 86 on returns counts as 14, not 100');
  ok(scrimmageYards(line({ retYds: 200 })) === 0,
    'a pure returner has ZERO box-score yards');
  ok(scrimmageYards(line({ passYds: 300, rushYds: 20, recYds: 5 })) === 325,
    'passing, rushing and receiving all count at full value');
  ok(scrimmageYards(line({ passYds: 100 })) === 100,
    'passing is NOT discounted the way weigh discounts it');
  // And the ordering that falls out of it, which is the visible symptom.
  const out = sorted([row('returner', 'WR', scrimmageYards(line({ recYds: 14, retYds: 86 })), 100),
    row('real-wr', 'WR', scrimmageYards(line({ recYds: 46 })), 46)]);
  ok(out[0] === 'real-wr', 'the 46-yard receiver now outranks the 14-yard kick returner');
}

// ── 11. THE OFFENSE / DEFENSE TABS (v0.343.2) ─────────────────────────────
// Founder: "have a tab for offense and a tab for defense. if a player has
// multiple designations (Travis Hunter) put them in both positions."
// Membership is the STAT LINE, so the two-way case needs no roster knowledge.
{
  const line = (o) => ({
    passYds: 0, passTds: 0, carries: 0, rushYds: 0, rushTds: 0,
    targets: 0, rec: 0, recYds: 0, recTds: 0, retYds: 0, retTds: 0,
    fg: 0, xp: 0, sacks: 0, ints: 0, fumrec: 0, dtd: 0, safety: 0, tackles: 0, ...o,
  });
  const full = (slug, pos, l, weight = 1) => ({
    slug, pos, team: 'JAX', stat: 'orig', line: l, weight,
    yards: scrimmageYards(l),
    side: ['DEF', 'DL', 'LB', 'DB'].includes(pos) ? 'def' : 'off',
  });
  const hunter = full('travis-hunter', 'WR', line({ rec: 4, targets: 6, recYds: 52, tackles: 3, ints: 1 }), 90);
  const wr = full('pure-wr', 'WR', line({ rec: 2, targets: 3, recYds: 30 }), 30);
  const lb = full('pure-lb', 'LB', line({ tackles: 6 }), 12);
  const tacklingWr = full('int-tackler', 'WR', line({ tackles: 1 }), 2);
  const rows = [hunter, wr, lb, tacklingWr];

  const off = boxTabRows(rows, 'off').map((r) => r.slug);
  const def = boxTabRows(rows, 'def').map((r) => r.slug);
  ok(off.includes('travis-hunter') && def.includes('travis-hunter'),
    'THE POINT: a two-way line (catches AND tackles) appears on BOTH tabs');
  ok(off.includes('pure-wr') && !def.includes('pure-wr'),
    'a pure receiver stays off the defense tab');
  ok(def.includes('pure-lb') && !off.includes('pure-lb'),
    'a pure linebacker stays off the offense tab');
  ok(!off.includes('int-tackler') && def.includes('int-tackler'),
    'a WR whose ONLY stat is a tackle lists under DEFENSE — where his stat is — not as an 0/0 line on offense');
  ok(def.indexOf('pure-lb') < def.indexOf('travis-hunter'),
    'on the defense tab, native defenders come first; the two-way visitor follows');
  const hunterDef = boxTabRows(rows, 'def').find((r) => r.slug === 'travis-hunter');
  ok(hunterDef.stat.includes('tkl') && hunterDef.stat.includes('INT') && !hunterDef.stat.includes('rec'),
    "the visitor's line is re-phrased through the defensive lens (tackles + INT, no receiving)");
  const hunterOff = boxTabRows(rows, 'off').find((r) => r.slug === 'travis-hunter');
  ok(hunterOff.stat === 'orig', "on his own side's tab the original phrasing survives untouched");
  ok(rows.every((r) => r.stat === 'orig' || r.stat !== undefined) && hunter.stat === 'orig',
    'the underlying rows are never mutated');
  ok(offInvolved(line({ rushYds: -4, carries: 3 })) && !defInvolved(line({ rushYds: -4, carries: 3 })),
    'negative rushing yards still count as offensive involvement');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL BOX-ORDER ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
