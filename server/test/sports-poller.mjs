// The daily-sport poller's pure parts: which day it asks for and which games
// it re-reads. Run: `npx tsx test/sports-poller.mjs` from server/.
import { easternDate, gamesToFetch, replayGame, REPLAY_LIVE_MS, scheduleAhead, AHEAD_DAYS, AHEAD_EVERY_MS } from '../src/poll/sportGames.js';

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


// REPLAY (v0.626.0): a past season's final, read through a shifted clock.
{
  const fin = { gameId: 'r', status: 'final', startUtc: '2025-08-04T22:40:00Z', awayScore: 4, homeScore: 5, clock: null, season: '2025' };
  const t0 = Date.parse(fin.startUtc);
  const pre = replayGame(fin, t0 - 60e3);
  ok(pre.status === 'pre' && pre.awayScore === null && pre.homeScore === null, 'before its start a replayed game is pre, score hidden');
  ok(replayGame(fin, t0 + 60e3).status === 'live' && replayGame(fin, t0 + 60e3).awayScore === 4, 'after the start it is live, the line is the final one');
  ok(replayGame(fin, t0 + REPLAY_LIVE_MS + 1).status === 'final', 'three hours on it is final');
  ok(replayGame({ ...fin, status: 'postponed' }, t0 + 60e3).status === 'postponed', 'a postponement stays one');
  ok(gamesToFetch([pre], new Map()).length === 0 && gamesToFetch([replayGame(fin, t0 + 60e3)], new Map()).length === 1, 'the box is fetched only once the clock has started the game');
}

// THE SCHEDULE AHEAD (v0.737.2): a ONE GAME week's later games exist before
// their day, so a spot has something to pick. Fri Nov 6 → through Fri Nov 20,
// which covers the whole Mon 11/9 – Sun 11/15 week and the one after.
{
  const asked = [], at = new Map();
  const poll = async (sport, date, opts) => { asked.push([sport, date, opts]); return { games: 2 }; };
  const now = new Date('2026-11-06T17:00:00Z'), wall = now.getTime();
  const a = await scheduleAhead('nba', now, null, { wallMs: wall, at, poll });
  ok(a.games === 2 * AHEAD_DAYS && asked.length === AHEAD_DAYS, 'every day ahead is asked for');
  ok(asked[0][1] === '2026-11-07' && asked.at(-1)[1] === '2026-11-20', 'tomorrow through two weeks out (not today: the tick has it)');
  ok(asked.some((x) => x[1] === '2026-11-09') && asked.some((x) => x[1] === '2026-11-15'), 'the next Mon–Sun period is all there');
  ok(await scheduleAhead('nba', now, null, { wallMs: wall + 60e3, at, poll }) === null, 'not again on the next tick');
  ok((await scheduleAhead('nba', now, null, { wallMs: wall + AHEAD_EVERY_MS, at, poll })) !== null, 'again once the refresh is due');
  asked.length = 0;
  await scheduleAhead('nba', new Date('2025-11-06T17:00:00Z'), { season: '2025', offsetDays: 365 }, { wallMs: wall, at, poll });
  ok(asked.length === AHEAD_DAYS && asked[0][2].replay?.season === '2025' && asked[0][1] === '2025-11-07', 'a replay clock gets its own pass, read as pre');
  const down = new Map();
  await scheduleAhead('nhl', now, null, { wallMs: wall, at: down, poll: async () => { throw new Error('feed down'); } });
  ok(!down.has('nhl|live|0'), 'a pass that failed outright retries next tick');
}

console.log(fails ? `\n${fails} FAILED` : '\nall sport poller checks passed');
process.exit(fails ? 1 : 0);
