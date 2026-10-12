// THE HAND ON THE MATCHUP (v0.695.0): which spot a play may land on now, and
// what each hand card says — the builders' shared rules, the twin of SQL
// _contest_play_window.
import { contestSpotOpen, contestHandCard, contestPlayById } from '../../packages/core/src/engine/contest.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const open = { slug: 'josh-allen', locked: false }, gone = { slug: 'jahmyr-gibbs', locked: true }, empty = { slug: null, locked: false };
ok('Double or Nothing lands on a player who has not kicked off, after the week started', contestSpotOpen('double-or-nothing', open, true));
ok('…not on one who has', !contestSpotOpen('double-or-nothing', gone, true));
ok('…not on an empty spot', !contestSpotOpen('double-or-nothing', empty, false));
ok('the phantom takes an empty spot before the first kickoff', contestSpotOpen('ghost', empty, false) && !contestSpotOpen('ghost', empty, true));
ok('…or a player’s spot until his kickoff', contestSpotOpen('ghost', open, true) && !contestSpotOpen('ghost', gone, true));
ok('Jinx takes their sealed spot before the first kickoff, their shown player until his', contestSpotOpen('jinx', empty, false) && !contestSpotOpen('jinx', empty, true) && contestSpotOpen('jinx', open, true));
ok('Spy only before the first kickoff', contestSpotOpen('spy', empty, false) && !contestSpotOpen('spy', open, true));
const don = contestPlayById('double-or-nothing'), hm = contestPlayById('hail-mary'), spy = contestPlayById('spy'), mg = contestPlayById('magnet');
let c = contestHandCard(don, { started: true, plays: [], cap: 2 });
ok('a spot play in hand after kickoff: usable, says until his own kickoff', c.usable && c.action === 'apply' && /his own kickoff/.test(c.note), c);
c = contestHandCard(hm, { started: true, plays: [], cap: 2 });
ok('a squad play after kickoff waits for next week', !c.usable && c.action === 'arm' && /next week/.test(c.note), c);
c = contestHandCard(spy, { started: true, plays: [], cap: 2 });
ok('Spy keeps the squad clock', !c.usable, c);
c = contestHandCard(don, { started: false, plays: [{ id: 'underdog' }, { id: 'ghost' }], cap: 2 });
ok('the cap: your plays are set', !c.usable && /set/.test(c.note), c);
c = contestHandCard(don, { started: false, plays: [{ id: 'double-or-nothing' }], cap: 2 });
ok('already in play', !c.usable && /already/.test(c.note), c);
c = contestHandCard(don, { started: false, off: ['double-or-nothing'], plays: [], cap: 2 });
ok('turned off by the commissioner', !c.usable && /commissioner/.test(c.note), c);
c = contestHandCard(mg, { variant: 'total', started: true, plays: [], cap: 1 });
ok('a one-team-total Magnet is a squad play', c.action === 'arm' && !c.usable, c);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-hand: all passed');
