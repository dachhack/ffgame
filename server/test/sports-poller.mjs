// The daily-sport poller's pure parts: which day it asks for and which games
// it re-reads. Run: `npx tsx test/sports-poller.mjs` from server/.
import { easternDate, gamesToFetch } from '../src/poll/sportGames.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

// 03:30 UTC on Oct 21 is still Oct 20 in New York (EDT, UTC−4).
ok(easternDate(new Date('2026-10-21T03:30:00Z')) === '2026-10-20', 'a late tip is still today in the East');
ok(easternDate(new Date('2026-10-21T03:30:00Z'), -1) === '2026-10-19', 'yesterday, for the late finals');
ok(easternDate(new Date('2026-12-21T05:30:00Z')) === '2026-12-21', 'after ET midnight the day rolls (EST, UTC−5)');

const games = [
  { gameId: 'a', status: 'pre' }, { gameId: 'b', status: 'live' },
  { gameId: 'c', status: 'final' }, { gameId: 'd', status: 'final' }, { gameId: 'e', status: 'postponed' },
];
const stored = new Map([['c', 'final'], ['d', 'live']]);
ok(gamesToFetch(games, stored).map((g) => g.gameId).join() === 'b,d', 'live games and finals not yet stored as final are fetched');
ok(gamesToFetch(games, stored, true).map((g) => g.gameId).join() === 'b,c,d', '--force re-reads every final');
ok(gamesToFetch(games, new Map()).map((g) => g.gameId).join() === 'b,c,d', 'an unknown game is fetched once it is live or final');

console.log(fails ? `\n${fails} FAILED` : '\nall sport poller checks passed');
process.exit(fails ? 1 : 0);
