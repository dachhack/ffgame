// Guard for the ▦ ALL GAMES board's game list (v0.338.2).
//
// The screen is called ALL GAMES and for its whole life showed only the games a
// SLOTTED PLAYER was in — it built its map by looking up each entry's team, so
// a game nobody in your matchup was playing in did not exist as far as it was
// concerned. On a two-game preseason Friday that is indistinguishable from a
// broken feed, which is exactly how the founder read it.
//
// The grouping itself lives in a React useMemo, so what is asserted here is the
// accessor it now seeds from (`allGameFeeds`) plus a faithful reimplementation
// of the grouping rule. That is a deliberate compromise: the rule is four lines
// and pinning it here is worth more than leaving it unpinned because the real
// one is inside a component. If the component's version changes, this must.
// Run: npx tsx scripts/check-field-board.mjs
import {
  allGameFeeds, gameFeedFor, setLiveGameFeed, clearLiveGameFeeds, feedRowsToWeek,
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

// The grouping rule as FieldBoard now runs it.
const group = (week, entries) => {
  const m = new Map();
  for (const feed of allGameFeeds(week)) {
    m.set(feed.key, { feed, clock: Infinity, you: new Set(), their: new Set(), mine: false });
  }
  for (const e of entries) {
    const feed = gameFeedFor(week, e.team);
    if (!feed) continue;
    let g = m.get(feed.key);
    if (!g) { g = { feed, clock: 0, you: new Set(), their: new Set(), mine: false }; m.set(feed.key, g); }
    g.clock = g.mine ? Math.max(g.clock, e.clock) : e.clock;
    g.mine = true;
    const pids = e.side === 'you' ? g.you : g.their;
    for (const pid of e.pids ?? []) pids.add(pid);
  }
  const all = [...m.values()];
  return [...all.filter((g) => g.mine), ...all.filter((g) => !g.mine)];
};

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

clearLiveGameFeeds();
console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL FIELD-BOARD ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
