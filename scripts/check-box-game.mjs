// Guard for BOX-SCORE MEMBERSHIP (v0.344.1): the game's own plays decide who
// is in it.
//
// Founder, over a NYG@MIA sheet listing 2025 Dolphins: "Zach Wilson and Waddle
// are not on the dolphins this year." The old rule trusted slugMeta's team —
// the BAKED 2025 tag for anyone no league rosters — so an offseason mover
// haunted his old team's box score, carrying real stats from whatever 2026
// game he actually played somewhere else.
//
// Unlike check-box-order (a pure comparator, asserted bare), membership READS
// the week's installed plays and feed — so this probe installs synthetic ones:
// the live pbp overlay, the live game feed, and slugMeta overrides, all torn
// down at the end. Week 901 keeps it clear of every real and baked week.
// Run: npx tsx scripts/check-box-game.mjs
import { gameBoxScore } from '../packages/core/src/engine/boxScore.ts';
import { setLivePlays, clearLivePlays } from '../packages/core/src/data/realPbp.ts';
import { setLiveGameFeed, clearLiveGameFeeds, feedRowsToWeek } from '../packages/core/src/data/gameFeed.ts';
import { setSlugMetaOverrides } from '../packages/core/src/data/slugMeta.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const WEEK = 901;
const rush = (c, pid, y = 7) => ({ c, pid, k: 'rush', y, td: 0, ca: 1, tg: 0 });
const feedPlay = (c, pid, tm) => ({ c, pid, tm, drv: 0, dn: 1, dist: 10, yl: 60, yl2: 55, ty: 'Rush', txt: 'x', hs: 0, as: 0 });

setSlugMetaOverrides([
  { slug: 'real-dolphin', pos: 'RB', team: 'MIA' },
  { slug: 'ghost-dolphin', pos: 'QB', team: 'MIA' },      // 2025 tag; plays for someone else now
  { slug: 'new-arrival', pos: 'RB', team: 'CLE' },        // 2026 Dolphin the bake files in Cleveland
  { slug: 'new-arrival-lb', pos: 'LB', team: 'CLE' },     // same, on defense
  { slug: 'pidless-giant', pos: 'WR', team: 'NYG' },      // old data: no play ids
  { slug: 'pidless-stranger', pos: 'WR', team: 'SEA' },
  { slug: 'collider', pos: 'QB', team: 'GB' },            // nflverse ids restart per game: one of his collides
]);
// The NYG@MIA feed knows plays 1-6; plays 100+ belong to some other game.
setLiveGameFeed(WEEK, feedRowsToWeek([{
  key: 'NYG@MIA', away: 'NYG', home: 'MIA', state: 'in',
  plays: [feedPlay(0, 1, 'MIA'), feedPlay(30, 2, 'MIA'), feedPlay(60, 3, 'NYG'),
          feedPlay(90, 4, 'NYG'), feedPlay(120, 5, 'MIA'), feedPlay(150, 6, 'MIA')],
}]));
setLivePlays(WEEK, {
  'real-dolphin': [rush(0, 1), rush(30, 2)],
  'ghost-dolphin': [rush(10, 100), rush(40, 101)],        // real plays, WRONG game
  'new-arrival': [rush(120, 5), rush(150, 6)],            // in MIA's own snaps
  'new-arrival-lb': [{ c: 60, pid: 3, k: 'tackle', y: 0, td: 0, ca: 1, tg: 0 }], // on NYG's snap
  'pidless-giant': [{ c: 60, k: 'rush', y: 12, td: 0, ca: 1, tg: 0 }],
  'pidless-stranger': [{ c: 60, k: 'rush', y: 12, td: 0, ca: 1, tg: 0 }],
  // Baked nflverse play ids are only unique WITHIN a game — this stranger's
  // ids 3, 200, 201 are from HIS game, and 3 numerically collides with a
  // NYG@MIA play. Before v0.352.3 "any pid matches" seated him (and, at
  // scale, the whole pool: the founder's seventeen-QB SEA@TEN sheet).
  'collider': [rush(10, 3), rush(40, 200), rush(70, 201)],
});

const box = gameBoxScore(WEEK, 'MIA', 'NYG', 3600);
const homeSlugs = box.home.map((r) => r.slug), awaySlugs = box.away.map((r) => r.slug);

ok(homeSlugs.includes('real-dolphin'), 'a current player with plays in this game appears normally');
ok(!homeSlugs.includes('ghost-dolphin') && !awaySlugs.includes('ghost-dolphin'),
  "THE POINT: a stale 2025 team tag does not haunt the box score — his plays are provably another game's");
ok(homeSlugs.includes('new-arrival'),
  'a 2026 arrival the bake files elsewhere is claimed by the game his plays are in, column from his own snaps');
ok(homeSlugs.includes('new-arrival-lb'),
  "a defender's plays are the OPPONENT'S snaps — the column derivation flips them (NYG snaps → MIA defender)");
ok(awaySlugs.includes('pidless-giant'),
  'pid-less data keeps the old team rule — history does not vanish for lacking ids');
ok(!homeSlugs.includes('pidless-stranger') && !awaySlugs.includes('pidless-stranger'),
  'pid-less AND wrong-team still excludes (the old rule, still standing where ids are absent)');
ok(!homeSlugs.includes('collider') && !awaySlugs.includes('collider'),
  'v0.352.3: a numeric pid collision is not membership — MOST of his plays must be this game\'s, not any');

// No feed installed at all → membership is unknowable → pure team rule.
clearLiveGameFeeds();
const bare = gameBoxScore(WEEK, 'MIA', 'NYG', 3600);
ok(bare.home.some((r) => r.slug === 'ghost-dolphin'),
  'without a feed the team rule stands alone (the pre-feed behavior, unchanged)');
ok(!bare.home.some((r) => r.slug === 'new-arrival'),
  'and without a feed a mis-tagged arrival cannot be claimed — no id evidence, no seat');

clearLivePlays();
clearLiveGameFeeds();
console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL BOX-GAME ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
