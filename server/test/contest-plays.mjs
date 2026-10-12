// THE PLAYS (v0.685.0): scoreContest applies a seat's armed plays — Underdog
// ×1.5, Double or Nothing at the final, the Ghost's flat points, and the two
// event bonuses from the squad's real plays, each the right way up for high,
// golf and a one-team-total Bullseye.
import { scoreContest, contestConfigOf, GHOST_POINTS } from '../../packages/core/src/engine/contest.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slots = [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }];
const cfg = (extra) => contestConfigOf({ contest: 'high', contest_format: 'h2h', roster_slots: slots, coin: true, ...extra }, 'dfs');
const pts = { qb: 20, rb: 10, wr: 8, cheap: 4, dst: 6 };
const pointsOf = (slug) => pts[slug] ?? 0;
const squads = { home: { S1: 'qb', S2: 'rb', S3: 'wr' }, away: { S1: 'qb', S2: 'cheap', S3: null } };
const plays = { home: [{ id: 'underdog', slot: 'S2' }], away: [{ id: 'ghost', slot: 'S3' }, { id: 'double-or-nothing', slot: 'S2', proj: 3 }] };
let r = scoreContest(squads, cfg(), pointsOf, { plays });
ok('underdog: the spot runs ×1.5', r.home === 43 && r.slots.find((x) => x.side === 'home' && x.slot === 'S2').play === 'underdog', r.home);
ok('ghost: the empty spot banks its flat points; double or nothing reads raw before the final', r.away === 20 + 4 + GHOST_POINTS && r.slots.find((x) => x.side === 'away' && x.slot === 'S3').play === 'ghost', r.away);
r = scoreContest(squads, cfg(), pointsOf, { plays, settled: true });
ok('double or nothing at the final: past his projection, double', r.away === 20 + 8 + GHOST_POINTS, r.away);
r = scoreContest(squads, cfg(), pointsOf, { plays: { ...plays, away: [plays.away[0], { id: 'double-or-nothing', slot: 'S2', proj: 5 }] }, settled: true });
ok('…short of it, zero', r.away === 20 + 0 + GHOST_POINTS, r.away);
ok('no plays: the plain squad', scoreContest(squads, cfg(), pointsOf, {}).home === 38);
const pbp = { qb: [{ k: 'pass', td: 1, y: 45 }, { k: 'pass', td: 0, y: 12 }], dst: [{ k: 'int', td: 1, y: 30 }] };
const playsOf = (slug) => pbp[slug] ?? [];
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'hail-mary' }], away: [] }, playsOf });
ok('hail mary: a 40-yard touchdown pass banks +15, as its own row', r.home === 38 + 15 && r.slots.some((x) => x.side === 'home' && x.slot === 'PLAY' && x.play === 'hail-mary' && x.score === 15), r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'hail-mary' }], away: [] }, playsOf: (s) => (s === 'qb' ? [{ k: 'pass', td: 1, y: 39 }] : []) });
ok('…a 39-yarder does not', r.home === 38, r.home);
r = scoreContest(squads, cfg({ contest: 'golf' }), pointsOf, { plays: { home: [{ id: 'hail-mary' }], away: [] }, playsOf });
ok('golf: the bonus comes OFF (lower wins)', r.home === 38 - 15 && r.slots.find((x) => x.side === 'home' && x.slot === 'PLAY').score === -15, r.home);
const dstSquads = { home: { S1: 'dst', S2: 'rb', S3: 'wr' }, away: { S1: 'qb', S2: 'rb', S3: 'wr' } };
r = scoreContest(dstSquads, cfg(), pointsOf, { plays: { home: [{ id: 'pick-six' }], away: [{ id: 'pick-six' }] }, playsOf });
ok('pick six: a defensive return touchdown banks +25; a squad without one, nothing', r.home === 6 + 10 + 8 + 25 && r.away === 38, [r.home, r.away]);
const bull = cfg({ contest: 'bullseye', bullseye: 'total', bullseye_radius: 10 });
r = scoreContest(squads, bull, pointsOf, { plays: { home: [{ id: 'hail-mary' }], away: [] }, playsOf, card: { targets: {}, total: 40 } });
ok('bullseye total: 38 against 40 is 2 off; the bonus takes the distance to 0', r.home === 0 && r.bullseye?.home?.dist === 2, [r.home, r.bullseye?.home]);
const bullS = cfg({ contest: 'bullseye', bullseye: 'slots', bullseye_radius: 10 });
r = scoreContest(squads, bullS, pointsOf, { plays: { home: [{ id: 'hail-mary' }], away: [] }, playsOf, card: { targets: { S1: 20, S2: 10, S3: 8 }, total: 38 } });
ok('bullseye per spot: three dead-on darts ring 60, the bonus rides on top', r.home === 60 + 15, r.home);
// IN PLAY (v0.685.1): a zero so far, in a game still on, is a spot still to play — no dart penalty, no row
const liveSquads = { home: { S1: 'qb', S2: 'rb', S3: 'zero' }, away: { S1: 'qb', S2: 'rb', S3: 'zero' } };
r = scoreContest(liveSquads, bull, pointsOf, { card: { targets: {}, total: 30 }, live: (s) => s === 'zero' });
ok('in play: the live zero is left out — 30 points against 30 is 0 off, no penalty', r.home === 0 && !r.slots.some((x) => x.side === 'home' && x.slot === 'S3'), [r.home, r.bullseye?.home]);
r = scoreContest(liveSquads, bull, pointsOf, { card: { targets: {}, total: 30 } });
ok('…and once his game is over, the zero is a no-show: 10 off', r.home === 10 && r.bullseye?.home?.zeros === 1, [r.home, r.bullseye?.home]);
r = scoreContest(liveSquads, cfg({ contest: 'golf', roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'], zero_pts: 25 }] }), pointsOf, { live: (s) => s === 'zero' });
ok('golf: a live zero banks no zero-fill yet', r.home === 30, r.home);
// PR 3 (v0.686.0): Jinx from across the table, Magnet under the dart, Re-deal of the tie-breaker
import { contestTiebreak } from '../../packages/core/src/engine/contest.ts';
const pbp2 = { qb: [{ k: 'pass', td: 1, y: 12 }, { k: 'pass', td: 1, y: 44 }], rb: [{ k: 'rush', td: 1, y: 3 }], wr: [{ k: 'rec', td: 0, y: 20 }] };
const playsOf2 = (s) => pbp2[s] ?? [];
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [], away: [{ id: 'jinx', slot: 'S1' }] }, playsOf: playsOf2, tdValue: { pass: 4, rush: 6, rec: 6 } });
ok('jinx: the first touchdown pass is struck off the jinxed spot, at the league\'s value', r.home === 38 - 4 && r.slots.find((x) => x.side === 'home' && x.slot === 'S1').play === 'jinx', r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [], away: [{ id: 'jinx', slot: 'S3' }] }, playsOf: playsOf2 });
ok('jinx: a spot whose player never scored a touchdown whiffs', r.home === 38, r.home);
r = scoreContest({ home: squads.home, away: squads.home }, cfg({ contest_format: 'board' }), pointsOf, { plays: { home: [{ id: 'jinx', slot: 'S1' }], away: [{ id: 'jinx', slot: 'S1' }] }, playsOf: playsOf2 });
ok('jinx: a leaderboard row is its own opponent — nothing to jinx', r.home === 38, r.home);
r = scoreContest(squads, bullS, pointsOf, { plays: { home: [{ id: 'magnet', slot: 'S1' }], away: [] }, card: { targets: { S1: 30, S2: 10, S3: 8 }, total: 48 }, settled: true });
ok('magnet, per spot: 20 against 30 lands at 25 — half as far, the dart rings 5 not 0', r.slots.find((x) => x.side === 'home' && x.slot === 'S1').aim.dist === 5 && r.home === 5 + 20 + 20, [r.home, r.slots.find((x) => x.side === 'home' && x.slot === 'S1')]);
r = scoreContest(squads, bullS, pointsOf, { plays: { home: [{ id: 'magnet', slot: 'S1' }], away: [] }, card: { targets: { S1: 30, S2: 10, S3: 8 }, total: 48 } });
ok('…and reads raw until the final', r.slots.find((x) => x.side === 'home' && x.slot === 'S1').aim.dist === 10, r.slots.find((x) => x.side === 'home' && x.slot === 'S1'));
r = scoreContest(squads, bull, pointsOf, { plays: { home: [{ id: 'magnet' }], away: [] }, card: { targets: {}, total: 50 }, settled: true });
ok('magnet, one-team total: 38 against 50 is 12 off; half a radius closer is 7 off', r.home === 7, r.home);
const slotsB = [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }, { pos: ['WR'] }, { pos: ['RB'] }];
const card = { targets: { S1: 20, S2: 10, S3: 8, S4: 9, S5: 11 }, total: 58 };
const t0 = contestTiebreak('L', 7, 1, card, bullS.slots.length ? slotsB.map((d, i) => ({ ...d, slot: `S${i + 1}`, type: d.pos[0] })) : []);
const t1 = contestTiebreak('L', 7, 1, card, slotsB.map((d, i) => ({ ...d, slot: `S${i + 1}`, type: d.pos[0] })), 1);
ok('re-deal: a second deal comes from a second seed, and the first deal stays what it was', t0 && t1 && JSON.stringify(t0) === JSON.stringify(contestTiebreak('L', 7, 1, card, slotsB.map((d, i) => ({ ...d, slot: `S${i + 1}`, type: d.pos[0] })))) && JSON.stringify(t0) !== JSON.stringify(t1), [t0, t1]);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
