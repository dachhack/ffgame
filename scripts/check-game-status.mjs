// THE CLOCK'S OWN WORDS (v0.434.3), checked in Node.
//
// Founder, at halftime of IND–KC with the field frozen on "Q2 00:35": "Is half
// time and other clock stoppage events something we can tell and show on the
// field and play by play?" The header's status and the stoppage rows now ride
// on game_feed (0313); these pin what every host prints for them, and that a
// row without them falls back to the last play's clock exactly as before.
// Run: npx tsx scripts/check-game-status.mjs
import { stoppageLabel, liveClockLabel, clockLabelFor, shortClockLabel, eventLabel, gameLog, qClock } from '../packages/core/src/data/gameView.ts';
import { feedRowsToWeek, setLiveGameFeed, clearLiveGameFeeds, gameFeedFor, allGameFeeds } from '../packages/core/src/data/gameFeed.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const st = (name, extra = {}) => ({ st: 'in', status: { name, ...extra } });
const last = { c: 1765 };   // Q2 0:35

ok(stoppageLabel(st('STATUS_HALFTIME', { detail: 'Halftime' })) === 'HALFTIME', 'STATUS_HALFTIME → HALFTIME');
ok(stoppageLabel(st('STATUS_END_PERIOD', { detail: 'End of 1st Quarter', period: 1 })) === 'END OF Q1', 'STATUS_END_PERIOD, period 1 → END OF Q1');
ok(stoppageLabel(st('STATUS_END_PERIOD', { detail: 'End of 2nd Quarter', period: 2 })) === 'HALFTIME', 'the end of the 2nd quarter is halftime');
ok(stoppageLabel(st('STATUS_END_PERIOD', { detail: 'End of 3rd Quarter' })) === 'END OF Q3', 'no period: the ordinal in the words is read');
ok(stoppageLabel(st('STATUS_DELAYED', { detail: 'Delayed' })) === 'DELAYED', 'STATUS_DELAYED → DELAYED');
ok(stoppageLabel(st('STATUS_IN_PROGRESS', { period: 3, clock: '12:04' })) === null, 'in progress is not a stoppage');
ok(stoppageLabel({ st: 'post', status: { name: 'STATUS_FINAL' } }) === 'FINAL' && stoppageLabel({ st: 'post' }) === 'FINAL', 'post is FINAL, status or not');
ok(stoppageLabel({ st: 'in' }) === null && stoppageLabel(null) === null, 'no status: no claim');

ok(liveClockLabel(st('STATUS_IN_PROGRESS', { period: 3, clock: '12:04' })) === 'Q3 12:04', 'the live display clock reads as Q3 12:04');
ok(liveClockLabel(st('STATUS_IN_PROGRESS', { period: 2, clock: '0:35' })) === 'Q2 00:35', 'a one-digit minute pads to the log\'s mm:ss');
ok(liveClockLabel(st('STATUS_IN_PROGRESS', { period: 5, clock: '8:12' })) === 'OT 08:12', 'period 5 is OT');
ok(liveClockLabel(st('STATUS_HALFTIME', { period: 2, clock: '0:00' })) === null, 'halftime has no live clock');
ok(liveClockLabel({ st: 'in' }) === null, 'no status: no live clock');

ok(clockLabelFor(st('STATUS_HALFTIME'), last, 'UPCOMING') === 'HALFTIME', 'the strip says HALFTIME over the last play\'s clock');
ok(clockLabelFor(st('STATUS_IN_PROGRESS', { period: 3, clock: '12:04' }), last, 'UPCOMING') === 'Q3 12:04', 'the strip says the live clock over the last play\'s');
ok(clockLabelFor({ st: 'in' }, last, 'UPCOMING') === qClock(last.c) && qClock(last.c) === 'Q2 00:35', 'no status: the last play\'s clock, as before');
ok(clockLabelFor({ st: 'in' }, null, 'UPCOMING') === 'UPCOMING', 'no status, no plays: the fallback');
ok(shortClockLabel(st('STATUS_HALFTIME'), last) === 'HALF' && shortClockLabel(st('STATUS_END_PERIOD', { period: 1 }), last) === 'END Q1'
  && shortClockLabel(st('STATUS_IN_PROGRESS', { period: 3, clock: '12:04' }), last) === 'Q3' && shortClockLabel({ st: 'in' }, last) === 'Q2', 'the chip words: HALF, END Q1, Q3, Q2');

ok(eventLabel({ c: 1680, ty: 'Two-minute warning', txt: 'Two-Minute Warning' }) === 'TWO-MINUTE WARNING', 'two-minute warning');
ok(eventLabel({ c: 1700, ty: 'Timeout', txt: 'Timeout #1 by KC at 01:40.', tm: 'KC' }) === 'TIMEOUT · KC', 'a timeout names the team');
ok(eventLabel({ c: 900, ty: 'End Period', txt: 'END QUARTER 1' }) === 'END OF Q1', 'End Period at 900s is the end of Q1');
ok(eventLabel({ c: 1800, ty: 'End Period', txt: 'END QUARTER 2' }) === 'HALFTIME', 'End Period at 1800s is halftime');
ok(eventLabel({ c: 1800, ty: 'End of Half', txt: 'END QUARTER 2' }) === 'HALFTIME', 'End of Half is halftime');
ok(eventLabel({ c: 3600, ty: 'End of Game', txt: 'END GAME' }) === 'FINAL', 'End of Game is the final');

// The log: plays and stoppages in clock order, a stoppage AFTER the play at its clock.
const plays = [{ c: 880, txt: 'a', ty: 'Rush', drv: 0, tm: 'KC', dn: 1, dist: 10, yl: 75, yl2: 70, hs: 0, as: 0 }, { c: 900, txt: 'b', ty: 'Pass Reception', drv: 0, tm: 'KC', dn: 2, dist: 5, yl: 70, yl2: 60, hs: 0, as: 0 }, { c: 910, txt: 'c', ty: 'Rush', drv: 0, tm: 'KC', dn: 1, dist: 10, yl: 60, yl2: 58, hs: 0, as: 0 }];
const events = [{ c: 900, ty: 'End Period', txt: 'END QUARTER 1' }, { c: 60, ty: 'Coin Toss', txt: 'KC wins the toss' }];
const log = gameLog({ plays, events });
ok(log.map((r) => (r.kind === 'play' ? r.p.txt : eventLabel(r.e))).join(',') === 'COIN TOSS,a,b,END OF Q1,c', `the log interleaves in clock order, the end of Q1 after the quarter's last snap (${log.map((r) => (r.kind === 'play' ? r.p.txt : eventLabel(r.e))).join(',')})`);
ok(gameLog({ plays }).length === 3 && gameLog(null).length === 0, 'no events: the plays alone; no feed: nothing');

// The rows carry the status and the events through to the per-team feed.
clearLiveGameFeeds();
setLiveGameFeed(3, feedRowsToWeek([{ key: 'IND@KC', away: 'IND', home: 'KC', plays, state: 'in', game_id: 'e1', status: { name: 'STATUS_HALFTIME', detail: 'Halftime', period: 2, clock: '0:00' }, events }]));
const f = gameFeedFor(3, 'KC');
ok(f?.status?.name === 'STATUS_HALFTIME' && (f?.events?.length ?? 0) === 2 && stoppageLabel(f) === 'HALFTIME', 'a live row\'s status and events reach gameFeedFor');
ok(allGameFeeds(3)[0]?.status?.name === 'STATUS_HALFTIME', '…and allGameFeeds');
clearLiveGameFeeds();
setLiveGameFeed(3, feedRowsToWeek([{ key: 'IND@KC', away: 'IND', home: 'KC', plays, state: 'in', game_id: 'e1' }]));
ok(gameFeedFor(3, 'KC')?.status == null && (gameFeedFor(3, 'KC')?.events?.length ?? 0) === 0, 'a row without them (the simulator, a bake) carries none');
clearLiveGameFeeds();

if (fails) { console.log(`\n${fails} GAME-STATUS ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL GAME-STATUS ASSERTIONS PASSED');
