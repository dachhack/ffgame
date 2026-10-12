// THE SECOND DEAL (v0.696.0). Founder: "no compound effect power ups. It should
// have one effect and one effect only and it should be easy to explain in
// three rows of text." Fourteen plays, each one effect: nine event bonuses
// from the squad's real plays, Floor and Garbage Time on a spot, Smoke,
// Mirror and Curse across the table.
import { scoreContest, contestConfigOf, contestPlaysFor, CONTEST_PLAYS } from '../../packages/core/src/engine/contest.ts';
import { contestEventBonus } from '../../packages/core/src/engine/contestPlays.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const ids = (f, c) => contestPlaysFor(f, c).map((d) => d.id);
const NEW = ['trick-play', 'return-man', 'bomb-squad', 'hat-trick', 'century-club', 'two-for-one', 'iron-grip', 'goal-line-stand', 'long-boot', 'floor', 'garbage-time', 'smoke', 'mirror', 'curse'];
ok('each new blurb is one line, under 120 characters', CONTEST_PLAYS.filter((d) => NEW.includes(d.id)).every((d) => !d.blurb.includes('\n') && d.blurb.length <= 120), CONTEST_PLAYS.filter((d) => NEW.includes(d.id) && d.blurb.length > 120).map((d) => d.id));
ok('a high-score head-to-head league is offered all fourteen', ['trick-play', 'return-man', 'bomb-squad', 'hat-trick', 'century-club', 'two-for-one', 'iron-grip', 'goal-line-stand', 'long-boot', 'floor', 'garbage-time', 'smoke', 'mirror', 'curse'].every((i) => ids('h2h', 'high').includes(i)), ids('h2h', 'high'));
ok('golf keeps the event bonuses and Smoke, not a floor, a doubling, a mirror or a curse', ids('h2h', 'golf').includes('smoke') && ids('h2h', 'golf').includes('long-boot') && !['floor', 'garbage-time', 'mirror', 'curse'].some((i) => ids('h2h', 'golf').includes(i)), ids('h2h', 'golf'));
ok('a leaderboard league has no across-the-table plays', !['smoke', 'mirror', 'curse'].some((i) => ids('board', 'high').includes(i)) && ids('board', 'high').includes('floor'), ids('board', 'high'));
// THE EVENT BONUSES, from the squad's real plays
const pbp = {
  wr: [{ k: 'rec', y: 60, td: 1 }, { k: 'rush', y: 12, td: 0 }, { k: 'rec', y: 45, td: 0 }],
  rb: [{ k: 'rush', y: 11, td: 1 }, { k: 'rush', y: 2, td: 1 }, { k: 'rec', y: 5, td: 1 }, { k: 'rush', y: 30, td: 0 }, { k: 'tp_rush', y: 2, td: 0, pid: 9 }],
  qb: [{ k: 'pass', y: 61, td: 1 }, { k: 'tp_pass', y: 2, td: 0, pid: 9 }, { k: 'fum', y: 0, td: 0 }],
  ret: [{ k: 'return', y: 55, td: 0 }, { k: 'return', y: 50, td: 0 }],
  dst: [{ k: 'safety', y: 0, td: 0 }],
  k: [{ k: 'fg', y: 52, td: 0 }, { k: 'fg', y: 38, td: 0 }, { k: 'fg', y: 50, td: 0 }],
};
const posOf = (s) => ({ wr: 'WR', rb: 'RB', qb: 'QB', ret: 'WR', dst: 'DEF', k: 'K' })[s];
const all = Object.keys(pbp);
const bonus = (id, slugs = all, settled = true) => contestEventBonus([{ id }], slugs, (s) => pbp[s] ?? [], { posOf, settled }).find((b) => b.id === id)?.delta ?? 0;
ok('Trick Play: the receiver’s 12-yard carry, +10', bonus('trick-play') === 10);
ok('…not the back’s', bonus('trick-play', ['rb']) === 0);
ok('Return Man: 105 return yards, +12', bonus('return-man') === 12 && bonus('return-man', ['ret']) === 12);
ok('Bomb Squad: a 61-yard touchdown pass, +25', bonus('bomb-squad') === 25);
ok('Hat Trick: the back’s three touchdowns, +20', bonus('hat-trick') === 20 && bonus('hat-trick', ['wr']) === 0);
ok('Century Club: the receiver’s 105 receiving yards, +10, once', bonus('century-club') === 10);
ok('Two for One: one conversion with two rows (passer and runner share the play) counts once, +6', bonus('two-for-one') === 6);
ok('Iron Grip: the quarterback fumbled — nothing', bonus('iron-grip') === 0);
ok('…a squad without him banks +10 at the final, not before', bonus('iron-grip', ['wr', 'rb']) === 10 && bonus('iron-grip', ['wr', 'rb'], false) === 0);
ok('Goal Line Stand: the safety, +15', bonus('goal-line-stand') === 15);
ok('Long Boot: two field goals of 50+, +16', bonus('long-boot') === 16);
// FLOOR, GARBAGE TIME, MIRROR, CURSE in the scorer
const slots = [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }];
const cfg = (extra) => contestConfigOf({ contest: 'high', contest_format: 'h2h', roster_slots: slots, coin: true, ...extra }, 'dfs');
const pts = { qb: 20, rb: 10, wr: 5, cheap: 4, big: 14 };
const pointsOf = (slug) => pts[slug] ?? 0;
const squads = { home: { S1: 'qb', S2: 'rb', S3: 'wr' }, away: { S1: 'qb', S2: 'big', S3: 'cheap' } };
let r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'floor', slot: 'S3', proj: 8 }], away: [] }, settled: true });
ok('Floor at the final: 5 short of an 8 projection scores 8', r.home === 20 + 10 + 8 && r.slots.find((x) => x.side === 'home' && x.slot === 'S3').play === 'floor', r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'floor', slot: 'S3', proj: 8 }], away: [] }, settled: false });
ok('…reads raw before the final', r.home === 35, r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'garbage-time', slot: 'S2' }], away: [] }, lateOf: (s) => (s === 'rb' ? 4 : 0) });
ok('Garbage Time: the back’s 4 fourth-quarter points count twice', r.home === 20 + 14 + 5, r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'mirror', slot: 'S2' }], away: [] }, settled: true });
ok('Mirror at the final: my S2 (10) takes their S2 (14)', r.home === 20 + 14 + 5 && r.slots.find((x) => x.side === 'home' && x.slot === 'S2').play === 'mirror', r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [{ id: 'mirror', slot: 'S1' }], away: [] }, settled: true });
ok('…and keeps its own when theirs is no higher', r.home === 35 && r.slots.find((x) => x.side === 'home' && x.slot === 'S1').play === 'mirror', r.home);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [], away: [{ id: 'curse' }] }, settled: true });
ok('Curse at the final: their curse takes my best spot (20) to 16', r.home === 16 + 10 + 5 && r.slots.find((x) => x.side === 'home' && x.slot === 'S1').play === 'curse' && r.away === 20 + 14 + 4, [r.home, r.away]);
r = scoreContest(squads, cfg(), pointsOf, { plays: { home: [], away: [{ id: 'curse' }] }, settled: false });
ok('…nothing before the final', r.home === 35, r.home);
r = scoreContest({ home: squads.home, away: squads.home }, cfg({ contest_format: 'board' }), pointsOf, { plays: { home: [{ id: 'mirror', slot: 'S2' }, { id: 'curse' }], away: [{ id: 'curse' }] }, settled: true });
ok('a seat alone on the board mirrors and curses nobody', r.home === 35, r.home);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-plays-three: all passed');
