// BULLSEYE (v0.643.0), checked in Node — docs/bullseye.md §6, one block per
// scenario. Lives in check:parity for the same reason golf does: it is a
// setting that changes what a number the WORKER writes and the BOARD draws
// MEANS, and the two reach it through one engine install. A board that shows
// "you're ahead" over a total the resolver will score as a loss is the worst
// class of bug this project can ship, because nothing errors.
//
// Run: npx tsx scripts/check-bullseye.mjs
import { readFileSync } from 'node:fs';
import {
  classicSlotsFromSpec, resolveClassicMatchup, classicPoints, autoSlotPlan, aimFill, bestballFillBy, leagueSlotDefs,
} from '../packages/core/src/engine/classic.ts';
import {
  bullseyeConfigOf, dealBullseyeCard, drawSetFor, BULLSEYE_DRAWS, cardRows, cardFromRows,
  ringScore, ringLabel, aimValue, applyBullseye, rankByRing, bullseyeScaleOf, scaledDraw, bullseyeFit, ringFromDist, bullseyePenalty, isZeroScore,
  setLeagueBullseye, clearLeagueBullseye, leagueBullseye, bullseyeTargetFor, setBullseyeRoster, bullseyeCardFor, cardsFromRows,
} from '../packages/core/src/engine/bullseye.ts';
import { projectedFor, setLeagueProjScoring, clearLeagueProjScoring } from '../packages/core/src/engine/projScoring.ts';
import { clearLeagueScoring } from '../packages/core/src/engine/leagueScoring.ts';
import { clearLeagueGolf } from '../packages/core/src/engine/golf.ts';
import { installRealWeek } from '../packages/core/src/data/realPbp.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const WEEK = 1;
installRealWeek(WEEK, JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url))));
clearLeagueScoring(); clearLeagueGolf(); clearLeagueBullseye(); clearLeagueProjScoring();

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });
const RB = mk('saquon-barkley', 'RB', 'PHI');
const QB = mk('josh-allen', 'QB', 'BUF');
const WR = mk('ceedee-lamb', 'WR', 'DAL');
const GHOST = mk('probe-ghost-player', 'RB', 'KC');   // nothing in the week-1 bake: a true zero
const side = (picks, roster, extra = {}) => ({ picks, roster, hasLineup: true, bestball: [], ...extra });
const CFG = { variant: 'slots', radius: 10, deal: 'shared' };
const LEAGUE = '00000000-0000-4000-8000-00000000b011';

// ── 1. THE DEAL IS DETERMINISTIC, AND EVERY TARGET IS A ROUND NUMBER ─────────
{
  const slots = leagueSlotDefs(null);   // the default nine
  const a = dealBullseyeCard(LEAGUE, 3, slots);
  const b = dealBullseyeCard(LEAGUE, 3, slots);
  const c = dealBullseyeCard(LEAGUE, 4, slots);
  ok('§1 the same (league, week, spots) deals the same card', JSON.stringify(a) === JSON.stringify(b));
  ok('§1 another week deals another card', JSON.stringify(a.targets) !== JSON.stringify(c.targets), { a: a.targets, c: c.targets });
  ok('§1 one target per spot', Object.keys(a.targets).length === slots.length && slots.every((d) => a.targets[d.slot] != null));
  ok('§1 every target is a positive multiple of 5 from its type\'s set',
    slots.every((d) => a.targets[d.slot] > 0 && a.targets[d.slot] % 5 === 0 && drawSetFor(d).some(([t]) => t === a.targets[d.slot])), a.targets);
  ok('§1 the TOTAL is the sum', a.total === Object.values(a.targets).reduce((s, t) => s + t, 0));
  ok('§1 no draw set contains a zero', Object.values(BULLSEYE_DRAWS).every((set) => set.every(([t]) => t > 0)));
  // A custom spot that matches no catalog type falls back by its first position.
  const custom = classicSlotsFromSpec([{ pos: ['QB', 'K'] }]);
  ok('§1 a custom spot draws by its first eligible position', drawSetFor(custom[0]) === BULLSEYE_DRAWS.QB, custom[0]);
  // Spread: over many weeks the middle targets dominate (the weights bite).
  const seen = {};
  for (let w = 1; w <= 200; w++) { const t = dealBullseyeCard(LEAGUE, w, slots).targets.RB1; seen[t] = (seen[t] ?? 0) + 1; }
  ok('§1 the weights bite: 10 and 15 outnumber 5 and 20 for an RB', (seen[10] + seen[15]) > (seen[5] ?? 0) + (seen[20] ?? 0), seen);
  // Published rows round-trip.
  const rows = cardRows(a);
  ok('§1 the rows carry every spot plus TOTAL', rows.length === slots.length + 1 && rows.some((r) => r.slot === 'TOTAL' && r.target === a.total));
  ok('§1 the rows read back as the same card', JSON.stringify(cardFromRows(rows)) === JSON.stringify(a));
  ok('§1 no rows → no card', cardFromRows([]) === null && cardFromRows(null) === null);
}

// ── 2. A DART SCORES BY DISTANCE ─────────────────────────────────────────────
{
  const r = (p) => ringScore(p, 10, 10);
  ok('§2 exact → bullseye, double the radius', r(10) === 20);
  ok('§2 inside half a point → the bonus, on top of the distance', near(r(10.4), 19.6) && near(r(9.5), 19.5), [r(10.4), r(9.5)]);
  ok('§2 just outside the band → radius − distance', near(r(10.6), 9.4), r(10.6));
  ok('§2 two off → 8', r(12) === 8 && r(8) === 8);
  ok('§2 five off → 5', r(15) === 5);
  ok('§2 at the radius → 0', r(20) === 0 && r(0.0001) === 0);
  ok('§2 way over → 0, no worse than the radius', r(50) === 0);
  ok('§2 eight under → 2', r(2) === 2);
  ok('§2 negative points still throw', near(ringScore(-1, 5, 10), 4), ringScore(-1, 5, 10));
  ok('§2 the labels', ringLabel(0.3, 10) === 'BULLSEYE' && ringLabel(1.5, 10) === 'INNER' && ringLabel(4, 10) === 'OUTER'
    && ringLabel(7, 10) === 'EDGE' && ringLabel(10, 10) === 'MISS');
  ok('§2 a wider radius widens the band', ringScore(14, 10, 50) === 50 - 4 && ringScore(12, 10, 50) === 98);
}

// ── 3. A ZERO IS A MISS ──────────────────────────────────────────────────────
{
  ok('§3 0.0 against a 5 is 0, not 5', ringScore(0, 5, 10) === 0);
  ok('§3 no target is 0', ringScore(5, undefined, 10) === 0 && ringScore(5, null, 10) === 0);
  const slots = classicSlotsFromSpec([{ pos: ['RB'] }]);
  setLeagueBullseye(CFG, { targets: { S1: 5 }, total: 5 });
  const r = resolveClassicMatchup(side([{ slot: 'S1', player: GHOST }], [GHOST]), side([{ slot: 'S1', player: RB }], [RB]), WEEK, { ppr: 1 }, slots);
  ok('§3 through the resolver: a scoreless starter banks 0', r.home === 0 && r.slots.find((x) => x.side === 'home').aim.ring === 0, r.slots);
  ok('§3 …and wears the penalty', r.slots.find((x) => x.side === 'home').aim.penalty === 10 && r.bullseye.home.zeros === 1 && r.bullseye.home.penalty === 10, r.bullseye);
  clearLeagueBullseye();
}

// ── 3b. THE ZERO PENALTY (v0.648.0) ─────────────────────────────────────────
{
  ok('§3b the penalty is the radius', bullseyePenalty(10) === 10 && bullseyePenalty(25) === 25);
  ok('§3b a zero is a zero', isZeroScore(0) && isZeroScore(null) && isZeroScore(0.00001) === false && isZeroScore(-1) === false);
  ok('§3b a dart from its distance matches ringScore', ringFromDist(0, 10) === 20 && ringFromDist(2, 10) === 8 && ringFromDist(10, 10) === 0 && ringFromDist(-1, 10) === 0);
  // SLOTS: two spots, one scoreless → the live spot's dart minus the penalty, floored at 0.
  const slots = classicSlotsFromSpec([{ pos: ['RB'] }, { pos: ['QB'] }]);
  const rb = classicPoints(RB, WEEK, { ppr: 1 });
  setLeagueBullseye(CFG, { targets: { S1: Math.round(rb), S2: 20 }, total: Math.round(rb) + 20 });
  const r = resolveClassicMatchup(side([{ slot: 'S1', player: RB }, { slot: 'S2', player: GHOST }], [RB, GHOST]), side([{ slot: 'S1', player: RB }], [RB]), WEEK, { ppr: 1 }, slots);
  const dart = ringScore(rb, Math.round(rb), 10);
  ok('§3b SLOTS: the no-show takes 10 off the team', near(r.home, Math.max(0, dart - 10)) && r.bullseye.home.zeros === 1, { got: r.home, dart, bull: r.bullseye.home });
  ok('§3b SLOTS: an UNFILLED spot is a no-show too', r.bullseye.away.zeros === 1 && near(r.away, Math.max(0, dart - 10)), r.bullseye.away);
  ok('§3b the distance carries the penalty', near(r.bullseye.home.dist, Math.abs(rb - (Math.round(rb) + 20)) + 10), r.bullseye.home);
  // TOTAL: the penalty is distance on the one dart.
  const picks = [{ slot: 'S1', player: RB }, { slot: 'S2', player: GHOST }];
  setLeagueBullseye({ variant: 'total', radius: 10, deal: 'shared' }, { targets: {}, total: rb });   // aimed exactly at the points
  const t = resolveClassicMatchup(side(picks, [RB, GHOST]), side(picks, [RB, GHOST]), WEEK, { ppr: 1 }, slots);
  ok('§3b TOTAL: on the number but a no-show → 10 off on a 20-radius dart', near(t.home, 10) && near(t.bullseye.home.dist, 10) && t.bullseye.home.zeros === 1, t.bullseye.home);
  ok('§3b TOTAL: the zero row wears the penalty, the live row none', t.slots.find((x) => x.side === 'home' && x.slot === 'S2').aim?.penalty === 10 && !t.slots.find((x) => x.side === 'home' && x.slot === 'S1').aim);
  // A zero-fill spot banks its fill: not a zero, no penalty.
  const zf = classicSlotsFromSpec([{ pos: ['RB'] }, { pos: ['QB'], zero_pts: 10 }]);
  setLeagueBullseye(CFG, { targets: { S1: Math.round(rb), S2: 10 }, total: Math.round(rb) + 10 });
  const z = resolveClassicMatchup(side(picks, [RB, GHOST]), side(picks, [RB, GHOST]), WEEK, { ppr: 1 }, zf);
  ok('§3b a zero-fill spot is not a no-show', z.bullseye.home.zeros === 0 && near(z.home, dart + 20), z.bullseye.home);
  clearLeagueBullseye();
}

// ── 4. AN UNFILLED SPOT IS A MISS ────────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }]);
  setLeagueBullseye(CFG, { targets: { S1: 20, S2: 10 }, total: 30 });
  const r = resolveClassicMatchup(side([{ slot: 'S1', player: QB }], [QB]), side([{ slot: 'S1', player: QB }], [QB]), WEEK, { ppr: 1 }, slots);
  const qb = classicPoints(QB, WEEK, { ppr: 1 });
  ok('§4 the empty spot adds nothing and produces no row', near(r.home, ringScore(qb, 20, 10)) && !r.slots.some((x) => x.slot === 'S2'), r);
  clearLeagueBullseye();
}

// ── 5. THE ZERO-FILL THROWS THE DART ─────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['RB'], zero_pts: 10 }]);
  setLeagueBullseye(CFG, { targets: { S1: 10 }, total: 10 });
  const r = resolveClassicMatchup(side([{ slot: 'S1', player: GHOST }], [GHOST]), side([{ slot: 'S1', player: RB }], [RB]), WEEK, { ppr: 1 }, slots);
  const row = r.slots.find((x) => x.side === 'home');
  ok('§5 the fill banks 10, the dart lands on 10 → bullseye', row.score === 10 && row.aim.ring === 20 && r.home === 20, row);
  clearLeagueBullseye();
}

// ── 6. THE RAW POINTS STILL SHOW; THE TOTAL IS THE RING SUM ──────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }]);
  const card = { targets: { S1: 25, S2: 15, S3: 10 }, total: 50 };
  const qb = classicPoints(QB, WEEK, { ppr: 1 }), rb = classicPoints(RB, WEEK, { ppr: 1 }), wr = classicPoints(WR, WEEK, { ppr: 1 });
  const picks = [{ slot: 'S1', player: QB }, { slot: 'S2', player: RB }, { slot: 'S3', player: WR }];
  const plain = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  setLeagueBullseye(CFG, card);
  const r = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  clearLeagueBullseye();
  const home = r.slots.filter((x) => x.side === 'home');
  ok('§6 every row keeps its real points', home.every((x, i) => x.score === plain.slots.filter((y) => y.side === 'home')[i].score), home);
  ok('§6 every row carries its dart', home.every((x) => x.aim && x.aim.target === card.targets[x.slot]), home);
  const want = ringScore(qb, 25, 10) + ringScore(rb, 15, 10) + ringScore(wr, 10, 10);
  ok('§6 the total is the sum of darts, not of points', near(r.home, want) && !near(r.home, plain.home), { got: r.home, want, plain: plain.home });
  ok('§6 the state carries the ring total', near(r.states[0].home, want) && near(r.states[0].away, want));
  ok('§6 the summary says what the lineup aimed at', r.bullseye?.variant === 'slots' && r.bullseye.home.target === 50
    && near(r.bullseye.home.points, plain.home) && near(r.bullseye.home.ring, want), r.bullseye);
  ok('§6 and the distance to the card\'s sum', near(r.bullseye.home.dist, Math.abs(plain.home - 50)), r.bullseye);
}

// ── 7. TOTAL IS ONE DART ─────────────────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }]);
  const picks = [{ slot: 'S1', player: QB }, { slot: 'S2', player: RB }, { slot: 'S3', player: WR }];
  const plain = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  const exact = { targets: { S1: 0, S2: 0, S3: 0 }, total: plain.home };   // aim the lineup at its own points
  setLeagueBullseye({ variant: 'total', radius: 10, deal: 'shared' }, exact);
  const r = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  ok('§7 a lineup on its total is a bullseye worth 2 × radius × spots', r.home === 60, r);
  ok('§7 rows carry no per-spot dart in TOTAL', r.slots.every((x) => !x.aim));
  ok('§7 the summary is the one dart', r.bullseye?.variant === 'total' && r.bullseye.home.dist === 0 && r.bullseye.home.ring === 60, r.bullseye);
  setLeagueBullseye({ variant: 'total', radius: 10, deal: 'shared' }, { targets: {}, total: plain.home + 10 });
  const ten = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  ok('§7 ten over on a 30-radius dart → 20', near(ten.home, 20), ten.home);
  setLeagueBullseye({ variant: 'total', radius: 10, deal: 'shared' }, { targets: {}, total: plain.home + 90 });
  const far = resolveClassicMatchup(side(picks, [QB, RB, WR]), side(picks, [QB, RB, WR]), WEEK, { ppr: 1 }, slots);
  ok('§7 beyond the radius → 0', far.home === 0, far.home);
  clearLeagueBullseye();
  // applyBullseye is pure and scales the radius by the SLOT COUNT it is told.
  const three = applyBullseye(plain, { cfg: { variant: 'total', radius: 10, deal: 'shared' }, card: { targets: {}, total: plain.home + 15 } }, 3);
  ok('§7 three spots → radius 30: 15 off banks 15', near(three.home, 15), three.home);
  const nine = applyBullseye(plain, { cfg: { variant: 'total', radius: 10, deal: 'shared' }, card: { targets: {}, total: plain.home } }, 9);
  ok('§7 told nine spots with three filled: six no-shows, 60 off a 90-radius dart → 30', near(nine.home, 30) && nine.bullseye.home.zeros === 6, nine.bullseye.home);
}

// ── 8. OFF MEANS OFF ─────────────────────────────────────────────────────────
{
  ok('§8 no setting → no config', bullseyeConfigOf(null) === null && bullseyeConfigOf({}) === null && bullseyeConfigOf({ bullseye: 'on' }) === null);
  ok('§8 hybrid is not a variant any more; the deal parses', bullseyeConfigOf({ bullseye: 'hybrid' }) === null
    && bullseyeConfigOf({ bullseye: 'slots', bullseye_deal: 'team' }).deal === 'team'
    && bullseyeConfigOf({ bullseye: 'slots', bullseye_deal: 'odd' }).deal === 'shared'
    && bullseyeConfigOf({ bullseye: 'slots', bullseye_rings: 'fixed' }).rings === undefined);
  ok('§8 slots / total parse, radius defaults and clamps',
    JSON.stringify(bullseyeConfigOf({ bullseye: 'slots' })) === JSON.stringify({ variant: 'slots', radius: 10, deal: 'shared' })
    && bullseyeConfigOf({ bullseye: 'total', bullseye_radius: 25 }).radius === 25
    && bullseyeConfigOf({ bullseye: 'total', bullseye_radius: 99 }).radius === 10
    && bullseyeConfigOf({ bullseye: 'total', bullseye_radius: 1 }).radius === 10);
  ok('§8 nothing installed', leagueBullseye() === null && bullseyeTargetFor('S1') === undefined);
  setLeagueBullseye(null, { targets: { S1: 5 }, total: 5 });
  ok('§8 a card with no config installs nothing', leagueBullseye() === null);
  setLeagueBullseye(CFG, null);
  ok('§8 a config with no card installs nothing', leagueBullseye() === null);
  const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }]);
  const picks = [{ slot: 'S1', player: QB }, { slot: 'S2', player: RB }];
  const r = resolveClassicMatchup(side(picks, [QB, RB]), side(picks, [QB, RB]), WEEK, { ppr: 1 }, slots);
  const qb = classicPoints(QB, WEEK, { ppr: 1 }), rb = classicPoints(RB, WEEK, { ppr: 1 });
  ok('§8 a plain league resolves to its points, no darts, no summary',
    near(r.home, qb + rb) && r.slots.every((x) => !x.aim) && r.bullseye === undefined, r);
}

// ── 9. THE FILL AIMS ─────────────────────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['WR'] }, { pos: ['RB', 'WR', 'TE'] }]);
  const roster = [{ id: 'star', pos: 'WR' }, { id: 'dull', pos: 'WR' }, { id: 'back', pos: 'RB' }];
  const proj = { star: 22, dull: 9, back: 14 };
  const value = (p) => proj[p.id];
  // Off: the fill takes the best projections (22 in WR, 14 in the flex).
  const off = autoSlotPlan(slots, [], {}, roster, value);
  ok('§9 off, the auto-slot takes the biggest projections', off.find((x) => x.slot === 'S1')?.player === 'star' && off.find((x) => x.slot === 'S2')?.player === 'back', off);
  // On, aiming at 10 and 15: the 9 is gold in the 10 spot, the 14 in the 15.
  setLeagueBullseye(CFG, { targets: { S1: 10, S2: 15 }, total: 25 });
  const on = autoSlotPlan(slots, [], {}, roster, value);
  ok('§9 on, the auto-slot seats the 9 in the 10 spot and benches the 22', on.find((x) => x.slot === 'S1')?.player === 'dull' && on.find((x) => x.slot === 'S2')?.player === 'back', on);
  // The aim is per PAIR: with targets 20 and 15 the star is the dart for S1.
  setLeagueBullseye(CFG, { targets: { S1: 20, S2: 15 }, total: 35 });
  const on2 = autoSlotPlan(slots, [], {}, roster, value);
  ok('§9 …and the 22 when the spot asks for 20', on2.find((x) => x.slot === 'S1')?.player === 'star' && on2.find((x) => x.slot === 'S2')?.player === 'back', on2);
  // A stored spot is still a decision: the fill never overwrites it.
  const kept = autoSlotPlan(slots, [], { S1: 'star' }, roster, value);
  ok('§9 a stored spot stands; the open spot is aimed', kept.length === 1 && kept[0].slot === 'S2' && kept[0].player === 'back', kept);
  // A certain zero (bye/out) is a certain miss and ranks last, even against a 5.
  setLeagueBullseye(CFG, { targets: { S1: 5, S2: 15 }, total: 20 });
  const bye = autoSlotPlan(slots, [], {}, [{ id: 'out', pos: 'WR' }, { id: 'dull', pos: 'WR' }, { id: 'back', pos: 'RB' }], (p) => (p.id === 'out' ? 0 : proj[p.id]));
  ok('§9 a projection of nothing is never the dart for a 5', bye.find((x) => x.slot === 'S1')?.player === 'dull', bye);
  ok('§9 aimValue: a zero projection ranks below any live body, even a certain miss', aimValue(30, 5, 10) === -15 && aimValue(0, 5, 10) < aimValue(30, 5, 10) && Number.isFinite(aimValue(0, 5, 10)));
  ok('§9 aimValue with no target is the projection itself', aimValue(12, undefined, 10) === 12);
  // …but it still seats rather than leaving a hole when it is all there is.
  const only = aimFill(slots.slice(0, 1), [{ id: 'out', pos: 'WR' }], () => 0);
  ok('§9 a certain miss still fills an otherwise empty spot', only[0].player?.id === 'out', only);
  // The best-ball fill aims the same way.
  const bbSlots = classicSlotsFromSpec([{ pos: ['WR'], bb: true }, { pos: ['RB', 'WR', 'TE'], bb: true }]);
  setLeagueBullseye(CFG, { targets: { S1: 10, S2: 15 }, total: 25 });
  const bb = bestballFillBy([], ['S1', 'S2'], roster.map((p) => ({ ...p, name: p.id, full: p.id, team: 'X', stats: { ...ZERO } })), bbSlots, (p) => proj[p.id]);
  ok('§9 best ball seats the 9 in the 10 spot too', bb.find((x) => x.slot === 'S1')?.player.id === 'dull' && bb.find((x) => x.slot === 'S2')?.player.id === 'back', bb.map((x) => [x.slot, x.player.id]));
  clearLeagueBullseye();
  // The unmanaged seat (no stored lineup) aims through the real projection:
  // a QB-or-RB spot aimed at the RB's projection starts the RB; aimed at the
  // QB's, the QB — whichever is the bigger name.
  setLeagueProjScoring({ ppr: 1 });
  const pQB = projectedFor(QB.id, 'QB'), pRB = projectedFor(RB.id, 'RB');
  const sflx = classicSlotsFromSpec([{ pos: ['QB', 'RB'] }]);
  if (pQB > 0 && pRB > 0 && Math.abs(pQB - pRB) > 3) {
    for (const [who, proj] of [[RB, pRB], [QB, pQB]]) {
      setLeagueBullseye(CFG, { targets: { S1: Math.round(proj) }, total: Math.round(proj) });
      const r = resolveClassicMatchup({ picks: [], roster: [QB, RB], hasLineup: false, bestball: [] }, side([{ slot: 'S1', player: WR }], [WR]), WEEK, { ppr: 1 }, sflx);
      ok(`§9 the unmanaged seat starts the closer projection (${who.id} for ${Math.round(proj)})`, r.slots.find((x) => x.side === 'home')?.slug === who.id, { got: r.slots, pRB, pQB });
    }
    clearLeagueBullseye();
  } else {
    console.log(`skip §9 unmanaged seat (projections ${pRB} / ${pQB} too close to test)`);
  }
  clearLeagueProjScoring();
}

// ── 1b. THE DEAL IS ANCHORED TO THE LEAGUE'S CATALOG ─────────────────────────
{
  ok('§4 a stock catalog scales nothing', Object.keys(bullseyeScaleOf({ ppr: 1 })).length === 0 && Object.keys(bullseyeScaleOf(null)).length === 0, bullseyeScaleOf({ ppr: 1 }));
  const std = bullseyeScaleOf({ ppr: 0 });
  ok('§4 standard scoring pays receivers less, so WR / TE / FLEX scale down', std.WR < 1 && std.TE < 1 && std.FLEX < 1 && std.WRT < 1, std);
  ok('§4 …and the TE (who lives on catches) more than the RB', std.TE < std.RB, std);
  ok('§4 …while K and DEF are untouched by PPR', std.K == null && std.DEF == null, std);
  const six = bullseyeScaleOf({ passTd: 6 });
  ok('§4 six-point passing TDs scale QB and SUPERFLEX up, nobody else', six.QB > 1 && six.SFLX > 1 && six.RB == null && six.WR == null, six);
  ok('§4 a scaled set stays multiples of 5, never below 5, weights pooled',
    JSON.stringify(scaledDraw([[5, 2], [10, 3], [15, 3], [20, 1]], 0.7)) === JSON.stringify([[5, 5], [10, 3], [15, 1]]), scaledDraw([[5, 2], [10, 3], [15, 3], [20, 1]], 0.7));
  ok('§4 ratio 1 is the identity', scaledDraw(BULLSEYE_DRAWS.WR, 1) === BULLSEYE_DRAWS.WR);
  const slots = leagueSlotDefs(null);
  const ppr = dealBullseyeCard(LEAGUE, 7, slots, { ppr: 1 });
  const none = dealBullseyeCard(LEAGUE, 7, slots, { ppr: 0 });
  ok('§4 the stock catalog deals the unanchored card', JSON.stringify(ppr) === JSON.stringify(dealBullseyeCard(LEAGUE, 7, slots)));
  ok('§4 a standard-scoring league aims lower from the same seed', none.total <= ppr.total && none.targets.K === ppr.targets.K && none.targets.DEF === ppr.targets.DEF, { ppr: ppr.targets, none: none.targets });
  ok('§4 …and still deals round numbers', Object.values(none.targets).every((t) => t > 0 && t % 5 === 0));
}

// ── 9b. THE WIRE'S FIT ───────────────────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }, { pos: ['RB', 'WR', 'TE'] }]);
  const card = { targets: { S1: 20, S2: 10, S3: 15, S4: 5 }, total: 50 };
  ok('§9 a 6-point RB fits the 5 flex, not the 10 RB spot', JSON.stringify(bullseyeFit('RB', 6, slots, card, 10)) === JSON.stringify({ slot: 'S4', target: 5, dist: 1, ring: 9 }), bullseyeFit('RB', 6, slots, card, 10));
  ok('§9 a 14-point WR fits the 15 WR spot', bullseyeFit('WR', 14, slots, card, 10)?.slot === 'S3');
  ok('§9 a QB only fits the QB spot', bullseyeFit('QB', 6, slots, card, 10)?.slot === 'S1' && bullseyeFit('QB', 6, slots, card, 10)?.dist === 14);
  ok('§9 a kicker fits nowhere on this lineup', bullseyeFit('K', 8, slots, card, 10) === null);
  ok('§9 no projection, no fit', bullseyeFit('RB', 0, slots, card, 10) === null && bullseyeFit('RB', 9, slots, null, 10) === null);
}

// ── 14. A CARD PER TEAM ──────────────────────────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['RB'] }, { pos: ['WR'] }]);
  const a = dealBullseyeCard(LEAGUE, 2, slots, null, 7), b = dealBullseyeCard(LEAGUE, 2, slots, null, 8), shared = dealBullseyeCard(LEAGUE, 2, slots);
  ok('§4 a roster\'s seed deals its own card, stably', JSON.stringify(a) === JSON.stringify(dealBullseyeCard(LEAGUE, 2, slots, null, 7)) && JSON.stringify(dealBullseyeCard(LEAGUE, 2, slots, null, 0)) === JSON.stringify(shared));
  // Rows round-trip with roster ids.
  const rows = [...cardRows(shared).map((r) => ({ ...r, roster_id: 0 })), ...cardRows(a).map((r) => ({ ...r, roster_id: 7 })), ...cardRows(b).map((r) => ({ ...r, roster_id: 8 }))];
  const cs = cardsFromRows(rows);
  ok('§4 cardsFromRows sorts the shared card from the rosters\'', JSON.stringify(cs.card) === JSON.stringify(shared) && JSON.stringify(cs.cards[7]) === JSON.stringify(a) && JSON.stringify(cs.cards[8]) === JSON.stringify(b));
  ok('§4 rows without roster ids are the shared card', JSON.stringify(cardsFromRows(cardRows(shared)).card) === JSON.stringify(shared) && Object.keys(cardsFromRows(cardRows(shared)).cards).length === 0);
  // The install: focus picks the roster's card; no focus is the shared one.
  const cardA = { targets: { S1: 5, S2: 20 }, total: 25 }, cardB = { targets: { S1: 20, S2: 5 }, total: 25 }, cardS = { targets: { S1: 10, S2: 10 }, total: 20 };
  setLeagueBullseye({ variant: 'slots', radius: 10, deal: 'team' }, cardS, { 7: cardA, 8: cardB });
  ok('§4 no roster in focus → the shared card', bullseyeTargetFor('S1') === 10 && bullseyeCardFor() === cardS);
  setBullseyeRoster(7);
  ok('§4 roster 7 in focus → its card', bullseyeTargetFor('S1') === 5 && bullseyeTargetFor('S2') === 20);
  ok('§4 …and an explicit roster beats the focus', bullseyeTargetFor('S1', 8) === 20);
  ok('§4 an unknown roster falls back to the shared card', bullseyeTargetFor('S1', 99) === 10);
  // The fill aims each roster at ITS card: with the same two players, roster
  // 7 (RB wants 5, WR wants 20) and roster 8 (the reverse) swap them.
  const roster = [{ id: 'small', pos: 'RB' }, { id: 'big', pos: 'RB' }];
  const value = (p) => (p.id === 'small' ? 6 : 19);
  const flex = classicSlotsFromSpec([{ pos: ['RB'] }, { pos: ['RB', 'WR'] }]);
  setBullseyeRoster(7);
  const for7 = autoSlotPlan(flex, [], {}, roster, value);
  setBullseyeRoster(8);
  const for8 = autoSlotPlan(flex, [], {}, roster, value);
  ok('§4 the auto-slot aims each roster at its own card', for7.find((x) => x.slot === 'S1')?.player === 'small' && for8.find((x) => x.slot === 'S1')?.player === 'big', { for7, for8 });
  setBullseyeRoster(null);
  // The resolver: each side's darts read its own card, by rosterId on the side.
  const rbPts = classicPoints(RB, WEEK, { ppr: 1 });
  const two = classicSlotsFromSpec([{ pos: ['RB'] }]);
  setLeagueBullseye({ variant: 'slots', radius: 10, deal: 'team' }, { targets: { S1: 50 }, total: 50 }, { 7: { targets: { S1: Math.round(rbPts) }, total: 0 }, 8: { targets: { S1: 50 }, total: 50 } });
  const r = resolveClassicMatchup({ ...side([{ slot: 'S1', player: RB }], [RB]), rosterId: 7 }, { ...side([{ slot: 'S1', player: RB }], [RB]), rosterId: 8 }, WEEK, { ppr: 1 }, two);
  ok('§4 the same player scores differently against each side\'s card', r.home >= 9 && r.away === 0 && r.slots.find((x) => x.side === 'home')?.aim.target === Math.round(rbPts) && r.slots.find((x) => x.side === 'away')?.aim.target === 50, r);
  ok('§4 the install clears the focus', (setLeagueBullseye(CFG, cardS), bullseyeCardFor() === cardS));
  clearLeagueBullseye();
}

// ── 11. THE WEEK BOARD RANKS BY RING ─────────────────────────────────────────
{
  const ranked = rankByRing([{ team: 'a', ring: 40 }, { team: 'b', ring: 55 }, { team: 'c', ring: 40 }, { team: 'd', ring: 12 }]);
  ok('§11 highest first, ties share a rank, the next rank skips', ranked.map((r) => `${r.team}${r.rank}`).join(' ') === 'b1 a2 c2 d4', ranked);
}

// ── ISOLATION: the install never leaks ───────────────────────────────────────
{
  setLeagueBullseye(CFG, { targets: { S1: 10 }, total: 10 });
  clearLeagueBullseye();
  const slots = classicSlotsFromSpec([{ pos: ['RB'] }]);
  const r = resolveClassicMatchup(side([{ slot: 'S1', player: RB }], [RB]), side([{ slot: 'S1', player: RB }], [RB]), WEEK, { ppr: 1 }, slots);
  ok('clear → the next resolve is plain', r.bullseye === undefined && near(r.home, classicPoints(RB, WEEK, { ppr: 1 })));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL BULLSEYE CHECKS PASSED');
if (fails) process.exit(1);
