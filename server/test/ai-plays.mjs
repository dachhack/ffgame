// THE AI'S PLAY (v0.699.0): an AI seat picks plays it can afford, aimed at
// the squad it built, up to the cap — deterministic for a seed, never a play
// the league doesn't offer, never a spot twice.
import { aiContestPlays, contestPlaysFor, contestPlayById } from '../../packages/core/src/engine/contest.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slots = [{ slot: 'S1', pos: ['QB'] }, { slot: 'S2', pos: ['RB'] }, { slot: 'S3', pos: ['WR'] }, { slot: 'S4', pos: ['DEF'] }];
const board = [
  { slug: 'qb-a', pos: 'QB', salary: 8000, proj: 22 }, { slug: 'qb-b', pos: 'QB', salary: 5000, proj: 15 }, { slug: 'qb-c', pos: 'QB', salary: 4000, proj: 12 },
  { slug: 'rb-a', pos: 'RB', salary: 7000, proj: 18 }, { slug: 'rb-b', pos: 'RB', salary: 4000, proj: 9 }, { slug: 'rb-c', pos: 'RB', salary: 3000, proj: 6 },
  { slug: 'wr-a', pos: 'WR', salary: 6000, proj: 14 }, { slug: 'wr-b', pos: 'WR', salary: 3500, proj: 8 }, { slug: 'wr-c', pos: 'WR', salary: 3000, proj: 7 },
  { slug: 'dst-a', pos: 'DEF', salary: 3000, proj: 7 },
];
const squad = { S1: 'qb-a', S2: 'rb-c', S3: 'wr-a', S4: 'dst-a' };
const base = { wallet: 200, cap: 2, held: [], squad, slots, board, contest: 'high', format: 'h2h', seed: 'x' };
const offered = contestPlaysFor('h2h', 'high');
let p = aiContestPlays({ ...base, offered });
ok('an AI seat with room and coin picks up to the cap', p.length === 2, p);
ok('…each a play the league offers, priced within its wallet', p.every((x) => offered.some((d) => d.id === x.id)) && p.reduce((s, x) => s + (contestPlayById(x.id)?.price ?? 0), 0) <= 200, p);
ok('…no spot twice', new Set(p.filter((x) => x.slot).map((x) => x.slot)).size === p.filter((x) => x.slot).length, p);
ok('the same seed picks the same plays', JSON.stringify(aiContestPlays({ ...base, offered })) === JSON.stringify(p));
ok('another seed may differ', ['a', 'b', 'c', 'd', 'e'].some((s) => JSON.stringify(aiContestPlays({ ...base, offered, seed: s })) !== JSON.stringify(p)));
p = aiContestPlays({ ...base, offered, wallet: 30 });
ok('a thin wallet buys only what it can: the ◎25 plays', p.every((x) => (contestPlayById(x.id)?.price ?? 99) <= 30) && p.length === 1, p);
p = aiContestPlays({ ...base, offered, held: [{ id: 'hail-mary', slot: null }] });
ok('one play already on: one more, and not that one', p.length === 1 && p[0].id !== 'hail-mary', p);
p = aiContestPlays({ ...base, offered: contestPlaysFor('h2h', 'high', ['underdog', 'curse', 'iron-grip', 'pick-six']) });
ok('a play the commissioner turned off is never picked', !p.some((x) => ['underdog', 'curse', 'iron-grip', 'pick-six'].includes(x.id)), p);
const dog = aiContestPlays({ ...base, offered: [contestPlayById('underdog')] });
ok('Underdog lands on a bottom-third spot (the cheap back or the lone defense), never the star', dog.length === 1 && ['S2', 'S4'].includes(dog[0].slot), dog);
const bullOff = contestPlaysFor('h2h', 'bullseye');
p = aiContestPlays({ ...base, offered: bullOff, contest: 'bullseye', variant: 'total', seed: 'm' });
ok('under a one-team total a Magnet, if picked, is a squad play', p.every((x) => x.id !== 'magnet' || x.slot === null), p);
p = aiContestPlays({ ...base, offered: contestPlaysFor('board', 'high'), format: 'board', cap: 1 });
ok('a leaderboard seat never aims across a table it has not got', p.length === 1 && !['curse', 'jinx', 'mirror', 'spy', 'smoke'].includes(p[0].id), p);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('ai-plays: all passed');
