// LIVE DRIP GATING (v0.587.0) — founder: "My guy just got 9 points from 15
// yards. That's too high." A Return Yards card in a live game, his team yet
// to have a drive: the drip may only run on his team's offensive time, and
// before its first possession there is none. It used to read the empty
// possession list as "unknown" and drip every game-minute to the whistle.
import { setLivePlays, clearLivePlays } from '../packages/core/src/data/realPbp.ts';
import { setLiveGameFeed, feedRowsToWeek, clearLiveGameFeeds } from '../packages/core/src/data/gameFeed.ts';
import { resolveSlot } from '../packages/core/src/engine/sim.ts';

let fails = 0;
const ok = (cond, msg, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const WEEK = 905;   // a week no bake owns
const zero = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const kw = { id: 'kaden-wetjen', name: 'K. Wetjen', full: 'Kaden Wetjen', pos: 'WR', team: 'PIT', stats: zero };
const dk = { id: 'dk-metcalf', name: 'D. Metcalf', full: 'DK Metcalf', pos: 'WR', team: 'PIT', stats: zero };
// CLE's opening drive, then the punt Wetjen returns 15 yards at 2:13 (133 s).
const play = (c, tm, tm2, ty) => ({ c, drv: 0, tm, ...(tm2 ? { tm2 } : {}), dn: 1, dist: 10, yl: 75, yl2: 70, ty, txt: ty, hs: 0, as: 0 });
setLiveGameFeed(WEEK, feedRowsToWeek([{ key: 'PIT@CLE', away: 'PIT', home: 'CLE',
  plays: [play(0, 'CLE', null, 'Kickoff'), play(40, 'CLE', null, 'Rush'), play(80, 'CLE', null, 'Pass'), play(133, 'CLE', 'PIT', 'Punt')] }]));
setLivePlays(WEEK, { 'kaden-wetjen': [{ c: 133, k: 'return', y: 15, td: 0, ca: 0, tg: 0, rk: 'pr' }] });

const r = resolveSlot({ player: kw, metricId: 'retyd' }, { player: dk, metricId: 'recyd' }, WEEK, 'PIT@CLE', { youBuffs: new Set(['garbage-time']), realResolve: true });
ok(r.youFinal < 0.5, 'before his team\'s first drive, a 15-yd return banks next to nothing (was ~9.4)', r.youFinal);

// Once PIT has the ball, the drip runs on its offensive time only.
setLiveGameFeed(WEEK, feedRowsToWeek([{ key: 'PIT@CLE', away: 'PIT', home: 'CLE',
  plays: [play(0, 'CLE', null, 'Kickoff'), play(133, 'CLE', 'PIT', 'Punt'), play(193, 'PIT', null, 'Rush'), play(253, 'PIT', null, 'Pass')] }]));
const r2 = resolveSlot({ player: kw, metricId: 'retyd' }, { player: dk, metricId: 'recyd' }, WEEK, 'PIT@CLE', { realResolve: true });
ok(r2.youFinal > 0 && r2.youFinal < 1, 'two minutes of PIT offense at 0.15/min banks a fraction of a point', r2.youFinal);

clearLivePlays(); clearLiveGameFeeds();
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL LIVE-DRIP CHECKS PASS');
