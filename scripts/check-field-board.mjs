// Guard for the ▦ ALL GAMES board's game list (v0.338.2).
//
// The screen is called ALL GAMES and for its whole life showed only the games a
// SLOTTED PLAYER was in — it built its map by looking up each entry's team, so
// a game nobody in your matchup was playing in did not exist as far as it was
// concerned. On a two-game preseason Friday that is indistinguishable from a
// broken feed, which is exactly how the founder read it.
//
// The grouping rule is `groupFieldGames` in core (v0.340.1) — asserted
// DIRECTLY. This file used to pin a "faithful reimplementation" because the
// real rule lived inside a React useMemo; that compromise and its drift risk
// are gone: the web board, the app's all-fields overlay, and these assertions
// all call the same function.
// Run: npx tsx scripts/check-field-board.mjs
import {
  allGameFeeds, groupFieldGames, setLiveGameFeed, clearLiveGameFeeds, feedRowsToWeek,
} from '../packages/core/src/data/gameFeed.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const WEEK = 103; // PRE 3 — the week the founder was looking at
const play = (c, pid) => ({ c, pid, tx: 'x', ty: 'Pass', as: 0, hs: 0 });

// A four-game slate. The matchup only touches LV@HOU and SF@LAC — the other two
// are the ones that used to vanish.
clearLiveGameFeeds();
setLiveGameFeed(WEEK, feedRowsToWeek([
  { key: 'LV@HOU', away: 'LV', home: 'HOU', plays: [play(100, 1), play(200, 2)], state: 'in' },
  { key: 'SF@LAC', away: 'SF', home: 'LAC', plays: [play(150, 3)], state: 'in' },
  { key: 'NYJ@PIT', away: 'NYJ', home: 'PIT', plays: [play(120, 4)], state: 'in' },
  { key: 'CAR@JAX', away: 'CAR', home: 'JAX', plays: [], state: 'pre' },
]));

// ── 1. The accessor sees the whole slate ──────────────────────────────────
{
  const all = allGameFeeds(WEEK);
  ok(all.length === 4, 'allGameFeeds returns every game on the feed, not just played-in ones');
  ok(all.some((g) => g.key === 'CAR@JAX'), 'a game with ZERO plays is still a game');
  const jax = all.find((g) => g.key === 'CAR@JAX');
  ok(jax?.away === 'CAR' && jax?.home === 'JAX', 'away/home are split out of the key');
  ok(jax?.st === 'pre', 'game state rides along');
  ok(allGameFeeds(999).length === 0, 'a week with no feed yields no games rather than throwing');
}

// The REAL rule, not a copy of it.
const group = groupFieldGames;

const ENTRIES = [
  { playerId: 'a', team: 'LV', side: 'you', clock: 100, pids: [1] },
  { playerId: 'b', team: 'HOU', side: 'their', clock: 200, pids: [2] },
  { playerId: 'c', team: 'SF', side: 'you', clock: 150, pids: [3] },
];

// ── 2. THE BUG: every game gets a card ────────────────────────────────────
{
  const g = group(WEEK, ENTRIES);
  ok(g.length === 4, 'THE POINT: all four games appear, not just the two with slotted players');
  ok(g.some((x) => x.feed.key === 'NYJ@PIT'), 'a game nobody slotted still gets a card');
  ok(g.some((x) => x.feed.key === 'CAR@JAX'), 'a game with no plays yet still gets a card');
}

// ── 3. Your games come first ──────────────────────────────────────────────
{
  const g = group(WEEK, ENTRIES);
  ok(g[0].mine && g[1].mine, 'the two games your matchup is in sort to the front');
  ok(!g[2].mine && !g[3].mine, 'the rest follow');
  ok(g.slice(2).map((x) => x.feed.key).join(',') === 'NYJ@PIT,CAR@JAX',
    'and the rest keep the feed\'s own schedule order');
}

// ── 4. The slot clock is PRESERVED for your games ─────────────────────────
// This is the regression that would matter most: the field must keep mirroring
// what the slot rows show, so a seeded Infinity must never survive on a game
// an entry landed on.
{
  const g = group(WEEK, ENTRIES);
  const lv = g.find((x) => x.feed.key === 'LV@HOU');
  ok(lv.clock === 200, 'an entry game takes the FURTHEST slot clock (200), not Infinity');
  ok(Number.isFinite(lv.clock), 'and the seeded Infinity never survives on an entry game');
  const sf = g.find((x) => x.feed.key === 'SF@LAC');
  ok(sf.clock === 150, 'a single-entry game takes that entry\'s clock exactly');
  const jets = g.find((x) => x.feed.key === 'NYJ@PIT');
  ok(jets.clock === Infinity, 'a game with no slot to mirror shows everything ingested');
}

// ── 5. Tinting still only marks players who actually banked ───────────────
{
  const g = group(WEEK, ENTRIES);
  const lv = g.find((x) => x.feed.key === 'LV@HOU');
  ok(lv.you.has(1) && lv.their.has(2), 'you/their pids land on the right sides');
  const jets = g.find((x) => x.feed.key === 'NYJ@PIT');
  ok(jets.you.size === 0 && jets.their.size === 0,
    'a game nobody slotted is tinted for NEITHER side — it is context, not scoring');
}

// ── 6. Order of entries does not change the result ────────────────────────
{
  const a = group(WEEK, ENTRIES).map((x) => `${x.feed.key}:${x.clock}`).join('|');
  const b = group(WEEK, [...ENTRIES].reverse()).map((x) => `${x.feed.key}:${x.clock}`).join('|');
  ok(a === b, 'the grouping is order-independent (max clock, not last-write)');
}

// ── 7. FINISHED GAMES SINK (v0.342.0) ─────────────────────────────────────
// Founder, over a board where two finals sat above six live games: "erase the
// final play... and move it to the bottom so the active games are always at
// the top." The band order is: active yours, active others, finished yours,
// finished others — and only the feed SAYING 'post' buries a game; a missing
// state is a live unknown, never a burial.
{
  clearLiveGameFeeds();
  setLiveGameFeed(WEEK, feedRowsToWeek([
    { key: 'LV@HOU', away: 'LV', home: 'HOU', plays: [play(100, 1)], state: 'post' },   // YOUR game, over
    { key: 'SF@LAC', away: 'SF', home: 'LAC', plays: [play(150, 3)], state: 'in' },     // your game, live
    { key: 'NYJ@PIT', away: 'NYJ', home: 'PIT', plays: [play(120, 4)], state: 'post' }, // nobody's, over
    { key: 'CAR@JAX', away: 'CAR', home: 'JAX', plays: [play(90, 5)], state: 'in' },    // nobody's, live
    { key: 'GB@DEN', away: 'GB', home: 'DEN', plays: [play(80, 6)] },                   // nobody's, NO state
  ]));
  const g = group(WEEK, [
    { playerId: 'a', team: 'LV', side: 'you', clock: 100, pids: [1] },
    { playerId: 'c', team: 'SF', side: 'you', clock: 150, pids: [3] },
  ]).map((x) => x.feed.key);
  ok(g.join(',') === 'SF@LAC,CAR@JAX,GB@DEN,LV@HOU,NYJ@PIT',
    `THE POINT: live yours → live others → finished yours → finished others (got ${g.join(',')})`);
  ok(g.indexOf('LV@HOU') > g.indexOf('CAR@JAX'),
    'even YOUR OWN finished game sits below a stranger game that is still live');
  ok(g.indexOf('GB@DEN') < g.indexOf('LV@HOU'),
    'a game with NO state is treated as live — an absent flag never buries a game');
}

clearLiveGameFeeds();
console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL FIELD-BOARD ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
