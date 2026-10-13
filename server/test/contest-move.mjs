// DRAG A CARD (v0.700.0). Founder: "Long press on a card and you can drag it
// to a trash can or any eligible swappable spot. If you move it to a spot that
// can't swap back trash that card with a info note about what will happen."
// Pure: the move rule and the picks it leaves.
import { contestCardMove, contestApplyCardMove, contestSlotWants } from '../../packages/core/src/engine/contest.ts';
import { classicSlotsFromSpec } from '../../packages/core/src/engine/classic.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slots = classicSlotsFromSpec([
  { slot: 'QB', pos: ['QB'] }, { slot: 'RB1', pos: ['RB'] }, { slot: 'RB2', pos: ['RB'] }, { slot: 'WR1', pos: ['WR'] },
  { slot: 'FLEX', pos: ['RB', 'WR', 'TE'] }, { slot: 'ROOK', pos: ['QB', 'RB', 'WR', 'TE'], min_exp: 0, max_exp: 0 },
]);
const P = {
  allen: { slug: 'allen', pos: 'QB', team: 'BUF', exp: 8 }, warren: { slug: 'warren', pos: 'RB', team: 'PIT', exp: 3 },
  harvey: { slug: 'harvey', pos: 'RB', team: 'DEN', exp: 0 }, metcalf: { slug: 'metcalf', pos: 'WR', team: 'PIT', exp: 6 },
  tate: { slug: 'tate', pos: 'WR', team: 'TEN', exp: 0 },
};
const playerOf = (s) => P[s] ?? null;
// the parser keys spots S1…S6 in order: QB, RB1, RB2, WR1, FLEX, ROOK
const [QB, RB1, RB2, WR1, FLEX, ROOK] = slots.map((d) => d.slot);
const picks = { [QB]: 'allen', [RB1]: 'warren', [RB2]: 'harvey', [WR1]: 'metcalf', [FLEX]: null, [ROOK]: 'tate' };
ok('a spot takes, in words', contestSlotWants(slots[5]) === 'QB/RB/WR/TE · rookies only', contestSlotWants(slots[5]));
ok('into an open spot he fits: move', contestCardMove(slots, picks, RB1, FLEX, playerOf).kind === 'move');
ok('onto a spot he fits whose player fits his: swap', contestCardMove(slots, picks, RB1, RB2, playerOf).kind === 'swap');
const bump = contestCardMove(slots, picks, WR1, ROOK, playerOf);
ok('a veteran onto the rookie spot: no (rookies only)', bump.kind === 'no' && bump.why === 'takes QB/RB/WR/TE · rookies only', bump);
const bump2 = contestCardMove(slots, picks, RB2, ROOK, playerOf);
ok('the rookie RB onto the rookie spot: the rookie WR there can\'t play RB2 — bump', bump2.kind === 'bump' && bump2.other === 'tate' && bump2.why === 'takes RB', bump2);
ok('a QB onto an RB spot: no', contestCardMove(slots, picks, QB, RB1, playerOf).kind === 'no');
ok('same spot: no', contestCardMove(slots, picks, QB, QB, playerOf).kind === 'no');
ok('an open spot has nothing to move', contestCardMove(slots, picks, FLEX, RB1, playerOf).kind === 'no');
ok('a locked mover stays', contestCardMove(slots, picks, RB1, FLEX, playerOf, { locked: (s) => s === 'warren' }).kind === 'no');
ok('a locked other stays', contestCardMove(slots, picks, RB1, RB2, playerOf, { locked: (s) => s === 'harvey' }).kind === 'no');
ok('a ghost\'s spot is off limits', contestCardMove(slots, picks, RB1, FLEX, playerOf, { ghosted: (s) => s === FLEX }).kind === 'no');
const sw = contestApplyCardMove(picks, RB1, RB2, { kind: 'swap', other: 'harvey' });
ok('swap trades the two', sw[RB1] === 'harvey' && sw[RB2] === 'warren');
const mv = contestApplyCardMove(picks, RB1, FLEX, { kind: 'move' });
ok('move leaves the old spot open', mv[FLEX] === 'warren' && mv[RB1] === null);
const bp = contestApplyCardMove(picks, RB2, ROOK, bump2);
ok('bump: the rookie takes the spot, the other leaves, the old spot opens', bp[ROOK] === 'harvey' && bp[RB2] === null && !Object.values(bp).includes('tate'));
ok('no leaves the picks alone', contestApplyCardMove(picks, QB, RB1, { kind: 'no', why: 'x' }) === picks);
console.log(fails ? `${fails} FAILED` : 'all contest-move checks passed'); process.exit(fails ? 1 : 0);
