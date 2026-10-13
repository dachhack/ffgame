// THE BOX SCORE AND THE MIRRORED COLLEGE GAME (v0.697.0). Founder, on BUF@LA's
// box listing "WR C 5141656 · 0/1 rec": "Why are we getting IDs instead of
// player names". A college game's rows are mirrored into the NFL week that
// holds its kickoff (0372), keyed c-<espn id>; ESPN numbers plays within a
// game, so an Ohio State tight end's first target (play 40, 15:00) matched
// the Rams game's opening kickoff (play 40, 15:00) under the play-number
// fallback. Two rules stop it: a college slug is never in an NFL game, and a
// player whose every play names another game is elsewhere.
import { setLiveGameFeed, feedRowsToWeek, clearLiveGameFeeds } from '../../packages/core/src/data/gameFeed.ts';
import { setLivePlays, liveRowsToPbp, clearLivePlays } from '../../packages/core/src/data/realPbp.ts';
import { gameBoxScore } from '../../packages/core/src/engine/boxScore.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const W = 5, NFL = '401872994', CFB = '401858483';
const play = (c, pid, tm, yl, yl2, ty, txt) => ({ c, pid, drv: 0, tm, dn: 1, dist: 10, yl, yl2, ty, txt });
setLiveGameFeed(W, feedRowsToWeek([{ key: 'BUF@LA', away: 'BUF', home: 'LA', state: 'in', game_id: NFL, plays: [
  play(0, 40, 'LA', 35, 96, 'Kickoff', 'E.Evans kicks 61 yards'), play(10, 68, 'BUF', 77, 74, 'Rush', 'J.Cook up the middle for 3 yards'),
] }]));
const row = (slug, c, pid, gid, k, extra = {}) => ({ player_slug: slug, c, t: null, pid, game_id: gid, k, y: 0, td: 0, ca: 0, tg: 0, to: null, ...extra });
setLivePlays(W, liveRowsToPbp([
  row('james-cook', 10, 68, NFL, 'rush', { y: 3, ca: 1 }),
  // the Buckeye: his first target is play 40 at 15:00 of HIS game — the same number and second as the Rams' kickoff
  // (one row so far, as the mirror had it when the founder looked: 1 of 1 is a majority)
  row('c-5141656', 0, 40, CFB, 'incomplete', { tg: 1 }),
  // an NFL man whose every play names another game (a Lion, from DET@KC) — also elsewhere
  row('jahmyr-gibbs', 0, 40, '401872990', 'rush', { y: 12, ca: 1 }),
]));
const box = gameBoxScore(W, 'LA', 'BUF', 99999);
const slugs = [...box.home, ...box.away].map((r) => r.slug);
ok('the Bill with plays in this game is in the box', slugs.includes('james-cook'), slugs);
ok('the Buckeye whose play number and clock collide with the opening kickoff is not', !slugs.includes('c-5141656'), slugs);
ok('a man whose every play names another game is not either', !slugs.includes('jahmyr-gibbs'), slugs);
clearLiveGameFeeds(); clearLivePlays();
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('box-college-bleed: all passed');
