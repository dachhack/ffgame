// SCOPED SCORING RULES (0145), checked in Node — and specifically that they
// mean the SAME THING in 🏈 NORMAL leagues as in ◈ DRIP ones (v0.277.0).
//
// This lives in check:parity because a scoped rule is now read by two
// different scorers — sim.ts for drip, classicPoints for classic — off ONE
// module-global install. A rule that pays ×1.5 on the board and ×1 in the
// worker (or vice versa) is the worst class of bug this project can ship: the
// league sees a score it cannot reproduce, and nothing errors.
//
// The cases that earn their keep: a rule that MATCHES (each of mult / pts /
// per-TD), a rule that MISSES on each scope axis, rules that STACK, and the
// identity property — no rules installed must score bit-for-bit what the
// league scored before 0145 existed.
import { readFileSync } from 'node:fs';
import { classicPoints } from '../packages/core/src/engine/classic';
import { setLeagueScoring, clearLeagueScoring, scopedAdjustFor, parseScoring } from '../packages/core/src/engine/leagueScoring';
import { installRealWeek } from '../packages/core/src/data/realPbp';
import { setLeagueFlags, clearLeagueFlags } from '../packages/core/src/data/commish';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;   // round1 on both sides

const WEEK = 1;
const w = JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url)));
installRealWeek(WEEK, w);

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });

// A real Week-1 back with touchdowns in the bake, and a QB on another team —
// the pair is what makes the "misses" cases meaningful rather than vacuous.
const RB = mk('saquon-barkley', 'RB', 'PHI');
const QB = mk('josh-allen', 'QB', 'BUF');

clearLeagueScoring();
const baseRb = classicPoints(RB, WEEK, { ppr: 1 });
const baseQb = classicPoints(QB, WEEK, { ppr: 1 });
ok('the bake actually scores (else every case below is vacuous)', baseRb > 0 && baseQb > 0, { baseRb, baseQb });

// ── identity: no rules = the pre-0145 number ────────────────────────────────
setLeagueScoring({ tdBonus: 0, ydMult: 1, toPenalty: 0, scoped: [] });
ok('no scoped rules → classic scores exactly as before', near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));

// ── a multiplier that matches ───────────────────────────────────────────────
setLeagueScoring({ scoped: [{ pos: ['RB'], bonusMult: 1.5 }] });
ok('×1.5 on RBs multiplies the RB', near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb * 1.5),
  classicPoints(RB, WEEK, { ppr: 1 }));
ok('…and leaves the QB alone', near(classicPoints(QB, WEEK, { ppr: 1 }), baseQb));

// ── flat points that match ──────────────────────────────────────────────────
setLeagueScoring({ scoped: [{ pos: ['QB'], bonusPts: 3 }] });
ok('+3 for QBs adds three', near(classicPoints(QB, WEEK, { ppr: 1 }), baseQb + 3));

// ── a per-TD bonus pays per touchdown ───────────────────────────────────────
setLeagueScoring({ scoped: [{ pos: ['RB'], tdBonus: 2 }] });
const withTd = classicPoints(RB, WEEK, { ppr: 1 });
const tds = Math.round((withTd - baseRb) / 2);
ok('a per-TD bonus pays a whole number of touchdowns', tds >= 1 && near(withTd, baseRb + tds * 2),
  { withTd, baseRb, tds });

// ── every scope axis can MISS ───────────────────────────────────────────────
for (const [name, rule] of [
  ['team', { team: ['DAL'], bonusMult: 2 }],
  ['position', { pos: ['TE'], bonusMult: 2 }],
  ['tenure', { tenure: 'rookie', bonusMult: 2 }],
]) {
  setLeagueScoring({ scoped: [rule] });
  ok(`a rule scoped by ${name} that he doesn't match pays nothing`,
    near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));
}

// ── EVERY part of a scope must match (the rule the sheet warns about) ───────
setLeagueScoring({ scoped: [{ pos: ['RB'], team: ['DAL'], bonusMult: 2 }] });
ok('right position + wrong team = no bonus (scopes AND, not OR)',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));

// ── stacking: multipliers multiply, points add ─────────────────────────────
setLeagueScoring({ scoped: [
  { pos: ['RB'], bonusMult: 1.5 },
  { team: ['PHI'], bonusMult: 2, bonusPts: 1 },
] });
ok('two matching rules stack (×1.5 × ×2, +1)',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb * 3 + 1), classicPoints(RB, WEEK, { ppr: 1 }));

// ── the two scorers read the SAME install ──────────────────────────────────
// classicPoints and sim.ts both go through scopedAdjustFor; this is the check
// that the classic path is genuinely reading it rather than approximating it.
setLeagueScoring({ scoped: [{ pos: ['RB'], bonusMult: 1.5, bonusPts: 2 }] });
const adj = scopedAdjustFor(RB);
ok('drip and classic agree on the adjustment', adj.mult === 1.5 && adj.pts === 2, adj);
ok('classic applies exactly that adjustment',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb * adj.mult + adj.pts));

// ── THE SPOT SCOPE (v0.300.0) ───────────────────────────────────────────────
// A rule scoped to a lineup spot is a rule about the SPOT, so it only pays
// when the caller says which spot is being scored. The three cases that matter:
// named spot + no spot in play (a card, a projection) pays nothing; the right
// spot pays; the wrong spot doesn't.
setLeagueScoring({ scoped: [{ slot: ['S7'], bonusMult: 2 }] });
ok('a spot rule pays nothing when nothing says which spot',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb), classicPoints(RB, WEEK, { ppr: 1 }));
ok('…pays in the spot it names',
  near(classicPoints(RB, WEEK, { ppr: 1 }, undefined, 'S7'), baseRb * 2),
  classicPoints(RB, WEEK, { ppr: 1 }, undefined, 'S7'));
ok('…and not in any other spot',
  near(classicPoints(RB, WEEK, { ppr: 1 }, undefined, 'S2'), baseRb));
setLeagueScoring({ scoped: [{ pos: ['RB'], slot: ['S7'], bonusPts: 4 }] });
ok('spot AND position both have to match',
  near(classicPoints(QB, WEEK, { ppr: 1 }, undefined, 'S7'), baseQb));

// ── THE FLAG SCOPE (v0.300.0) ───────────────────────────────────────────────
// A rule scoped to a commissioner's flag reads the SAME flag cache the badge
// renders from, matched on the label case-insensitively — the label is what
// the commissioner typed and what the league reads.
clearLeagueFlags();
setLeagueScoring({ scoped: [{ flag: ['Franchise Tag'], bonusMult: 1.5 }] });
ok('a flag rule pays nobody while nobody is flagged',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));
setLeagueFlags('L', [{ slug: 'saquon-barkley', label: 'FRANCHISE TAG' }]);
ok('…pays the flagged player, matching the label case-insensitively',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb * 1.5), classicPoints(RB, WEEK, { ppr: 1 }));
ok('…and leaves an unflagged player alone', near(classicPoints(QB, WEEK, { ppr: 1 }), baseQb));
setLeagueScoring({ scoped: [{ flag: ['Keeper'], bonusMult: 1.5 }] });
ok('a different label on the flag is a miss', near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));
clearLeagueFlags();

// ── the stored (snake-case) shape parses to the same thing ─────────────────
const parsed = parseScoring({ scoped: [{ pos: ['RB'], bonus_mult: 1.5, bonus_pts: 2 }] });
setLeagueScoring(parsed);
ok('the stored snake-case rule scores identically to the camel one',
  near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb * 1.5 + 2));

clearLeagueScoring();
ok('cleared → back to the base number', near(classicPoints(RB, WEEK, { ppr: 1 }), baseRb));

if (fails) { console.log(`\n${fails} SCOPED-SCORING ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SCOPED-SCORING ASSERTIONS PASSED');
