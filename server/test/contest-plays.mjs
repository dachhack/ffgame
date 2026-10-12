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
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
