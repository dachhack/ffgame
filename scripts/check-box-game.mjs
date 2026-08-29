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
  { slug: 'lone-returner', pos: 'WR', team: 'CAR' },      // ONE play, genuinely this game's (stale tag)
  { slug: 'lone-collider', pos: 'WR', team: 'CAR' },      // ONE play, id collides, different moment
  { slug: 'ward-case', pos: 'RB', team: 'MIA' },          // opening kickoff: pid AND clock collide; gid says E2
  { slug: 'gid-member', pos: 'RB', team: 'MIA' },         // gid says E1 though pid/clock match nothing
  { slug: 'sim-flat', pos: 'RB', team: 'MIA' },           // gid 'SIM' names no feed game → fallback rules
  { slug: 'wr-tackler', pos: 'WR', team: 'MIA' },         // KNOWN WR with a lone tackle: two-way, not re-typed
  // 'unknown-corner' and 'unknown-qb' are deliberately NOT here — they must
  // take the WR/'' default for the stat-shape inference (v0.369.3) to fire.
]);
// The NYG@MIA feed knows plays 1-6; plays 100+ belong to some other game.
// game_id rides the rows (v0.369.0): E1 is this game, E2 the other one on
// the slate — the exact-membership universe.
setLiveGameFeed(WEEK, feedRowsToWeek([{
  key: 'NYG@MIA', away: 'NYG', home: 'MIA', state: 'in', game_id: 'E1',
  plays: [feedPlay(0, 1, 'MIA'), feedPlay(30, 2, 'MIA'), feedPlay(60, 3, 'NYG'),
          feedPlay(90, 4, 'NYG'), feedPlay(120, 5, 'MIA'), feedPlay(150, 6, 'MIA')],
}, {
  key: 'OTH@ERS', away: 'OTH', home: 'ERS', state: 'in', game_id: 'E2',
  plays: [feedPlay(0, 1, 'OTH')],
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
  // THE ONE-PLAY CASE (v0.368.6, founder: "how is Jalen Reagor on two
  // teams?"). The majority rule alone collapses at one play — a pure
  // returner's single small id collides with an early play of every game and
  // 1-of-1 is a majority, so he appeared in every box on the slate. The id
  // AND the clock have to agree now: lone-returner's play is pid 5 at c 120,
  // exactly the feed's; lone-collider's is pid 3 at c 10, while THIS game's
  // pid 3 happened at c 60 — same number, different moment, different game.
  'lone-returner': [{ c: 120, pid: 5, k: 'return', y: 26, td: 0, ca: 0, tg: 0 }],
  'lone-collider': [{ c: 10, pid: 3, k: 'return', y: 26, td: 0, ca: 0, tg: 0 }],
  // THE OPENING KICKOFF (v0.369.0, founder: "Jonathan Ward still in two
  // places. Don't we have player IDs to use?"). Every game's first play is
  // pid ~1 at clock ~0, so a kick returner collides on id AND clock — the one
  // case the ±3s join cannot tell apart. His live_play rows carry the game_id
  // they were ingested from, and that is decisive: ward-case's play matches
  // NYG@MIA's opening play exactly (pid 1, c 0) but his gid says E2 — out.
  // gid-member's play matches NOTHING by pid/clock but his gid says E1 — in.
  // sim-flat's gid ('SIM') names no feed game, so the pid/clock rules stand.
  'ward-case': [{ c: 0, pid: 1, gid: 'E2', k: 'return', y: 30, td: 0, ca: 0, tg: 0 }],
  'gid-member': [{ c: 999, pid: 777, gid: 'E1', k: 'rush', y: 9, td: 0, ca: 1, tg: 0 }],
  'sim-flat': [{ c: 120, pid: 5, gid: 'SIM', k: 'rush', y: 8, td: 0, ca: 1, tg: 0 }],
  // THE UNKNOWN DEFENDER (v0.369.3, founder: "some mix up def vs off on
  // Miami"). No slugMeta override on purpose — he takes the WR/'' default.
  // His only stat is a tackle on NYG's snap (pid 4), so he is a MIA defender:
  // the purely-defensive line must flip him to DB, which lands him in MIA's
  // column via the defender flip instead of NYG's via raw possession.
  'unknown-corner': [{ c: 90, pid: 4, k: 'tackle', y: 0, td: 0, ca: 1, tg: 0 }],
  // …while a KNOWN WR whose only stat is a tackle keeps his listed position
  // (the v0.343.2 two-way treatment) — the inference keys on the default.
  'wr-tackler': [{ c: 120, pid: 5, k: 'tackle', y: 0, td: 0, ca: 1, tg: 0 }],
  // An unknown QB (the founder's "WR Josh Johnson Qb · 0/0 rec"): passing
  // stats make him a QB, so his line reads C/ATT + yards, not empty receiving.
  'unknown-qb': [{ c: 150, pid: 6, k: 'pass', y: 7, td: 0, ca: 0, tg: 0, cp: 1 }],
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
ok(homeSlugs.includes('lone-returner'),
  'a one-play returner whose play IS this game\'s (id + clock agree) is seated, column from possession');
ok(!homeSlugs.includes('lone-collider') && !awaySlugs.includes('lone-collider'),
  'v0.368.6: a one-play id collision at a DIFFERENT clock is not membership — the Reagor-on-two-teams case');
ok(!homeSlugs.includes('ward-case') && !awaySlugs.includes('ward-case'),
  'v0.369.0 THE POINT: an opening-kickoff collision (pid AND clock match) loses to the play\'s own game id');
ok(homeSlugs.includes('gid-member'),
  'a play whose game id names THIS game is seated, whatever the pid/clock heuristics think');
ok(homeSlugs.includes('sim-flat'),
  "a flat sim gid ('SIM') names no feed game — the pid/clock rules still decide, and his play is genuine");
{
  // v0.369.3: the unknown player's position comes from his stats.
  const corner = [...box.home, ...box.away].find((r) => r.slug === 'unknown-corner');
  ok(corner?.pos === 'DB' && corner?.side === 'def',
    `an unknown man with a purely defensive line is a DB on the defense side (got ${corner?.pos}/${corner?.side})`);
  ok(homeSlugs.includes('unknown-corner'),
    'and the defender column flip applies: tackling on NYG snaps seats him in the MIA column');
  const uqb = [...box.home, ...box.away].find((r) => r.slug === 'unknown-qb');
  ok(uqb?.pos === 'QB' && uqb.stat.includes('pass'),
    `an unknown man with passing stats is a QB, phrased as one (got ${uqb?.pos}: ${uqb?.stat})`);
  const wrT = [...box.home, ...box.away].find((r) => r.slug === 'wr-tackler');
  ok(wrT?.pos === 'WR' && wrT?.side === 'off',
    `a KNOWN WR with a lone tackle keeps the two-way treatment — the inference keys on the default (got ${wrT?.pos}/${wrT?.side})`);
}

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
