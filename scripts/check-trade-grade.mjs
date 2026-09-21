// THE TRADE GRADE, PINNED (v0.444.0).
//
// A grade is a number a manager will argue with, so the properties that make
// it arguable — rather than arbitrary — are the ones worth a test:
//   · a one-for-one swap of equals is EVEN;
//   · two starters for one better starter leans to the side getting depth
//     only when the depth is actually above replacement;
//   · a bench body is worth ZERO, not a negative — giving one away is not a
//     cost, because the other side can sign the same production off the wire;
//   · the league's SHAPE moves the number: a QB is worth far more in a
//     superflex league than a 1-QB one, with no special case in the code;
//   · "even" is a band, not a point — a projection is not precise to a point.
import { gradeTrade } from '../packages/core/src/data/tradeGrade.ts';
import { setLeagueProjScoring } from '../packages/core/src/engine/projScoring.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

setLeagueProjScoring(null);

// A synthetic pool: enough bodies at each position that a replacement line
// exists. Slugs are real ones from the bake so projectedPoints answers.
import { PROJ_2026 } from '../packages/core/src/data/proj2026.ts';
import { slugMeta } from '../packages/core/src/data/slugMeta.ts';

const ranked = [...PROJ_2026.entries()]
  .map(([slug, pts]) => ({ slug, pts, pos: slugMeta(slug)?.pos ?? null }))
  .filter((p) => p.pos && p.pts > 0)
  .sort((a, b) => b.pts - a.pts);
const at = (pos, i) => ranked.filter((p) => p.pos === pos)[i];
const pool = ranked.map((p) => ({ slug: p.slug, pos: p.pos }));
ok(pool.length > 200, `pool has ${pool.length} projected players`);

const ONE_QB = { slots: [
  { slot: 'QB', type: 'QB', pos: ['QB'] },
  { slot: 'RB1', type: 'RB', pos: ['RB'] }, { slot: 'RB2', type: 'RB', pos: ['RB'] },
  { slot: 'WR1', type: 'WR', pos: ['WR'] }, { slot: 'WR2', type: 'WR', pos: ['WR'] },
  { slot: 'TE', type: 'TE', pos: ['TE'] },
] };
const SUPERFLEX = { slots: [...ONE_QB.slots, { slot: 'SFLX', type: 'SFLX', pos: ['QB', 'RB', 'WR', 'TE'] }] };

const grade = (send, receive, slots = ONE_QB) =>
  gradeTrade({ send, receive, pool, teams: 12, slots });

// 1. the same player both ways is exactly even
const rb1 = at('RB', 0), rb2 = at('RB', 1);
const even = grade({ players: [{ slug: rb1.slug, pos: 'RB' }] }, { players: [{ slug: rb1.slug, pos: 'RB' }] });
ok(even.delta === 0 && even.verdict === 'even', 'the same player both ways is dead even');

// 2. a clearly better player leans the right way
const lop = grade({ players: [{ slug: at('RB', 40).slug, pos: 'RB' }] },
                   { players: [{ slug: rb1.slug, pos: 'RB' }] });
ok(lop.verdict === 'for' && lop.delta > 0, `the best RB for the 41st leans your way (${lop.delta})`);
const other = grade({ players: [{ slug: rb1.slug, pos: 'RB' }] },
                     { players: [{ slug: at('RB', 40).slug, pos: 'RB' }] });
ok(other.verdict === 'against' && other.delta < 0, 'and the mirror of it leans theirs');

// 3. a bench body is worth zero, not a negative
const deep = ranked.filter((p) => p.pos === 'RB').slice(-1)[0];
const junk = grade({ players: [{ slug: deep.slug, pos: 'RB' }] }, { players: [] });
ok(junk.out === 0, 'a below-replacement player costs nothing to give away');
ok(junk.verdict === 'even', 'so a trade of nothing for nothing is even');

// 4. the league's shape moves the price of a quarterback
const qb = at('QB', 3);
const oneQb = gradeTrade({ send: { players: [] }, receive: { players: [{ slug: qb.slug, pos: 'QB' }] },
                           pool, teams: 12, slots: ONE_QB });
const sflx = gradeTrade({ send: { players: [] }, receive: { players: [{ slug: qb.slug, pos: 'QB' }] },
                          pool, teams: 12, slots: SUPERFLEX });
ok(sflx.in > oneQb.in, `a QB is worth more in superflex (${sflx.in} vs ${oneQb.in}) with no special case`);

// 5. "even" is a band
const nudge = grade({ players: [{ slug: rb1.slug, pos: 'RB' }] }, { players: [{ slug: rb2.slug, pos: 'RB' }] });
ok(nudge.verdict === 'even', `the top two RBs are the same trade (${nudge.delta} apart, inside the band)`);

// 6. picks are counted, and flagged as estimates
const withPick = grade({ players: [] }, { players: [], picks: [{ season: '2027', round: 1 }] });
ok(withPick.inPicks > 0 && /picks estimated/.test(withPick.summary), 'a first counts, and says it is an estimate');
const late = grade({ players: [] }, { players: [], picks: [{ season: '2027', round: 5 }] });
ok(late.inPicks < withPick.inPicks, 'and a fifth is worth less than a first');

// 7. dollars are reported as dollars, never converted into points
const money = grade({ players: [], faab: 20 }, { players: [] });
ok(money.faab === -20 && /\$-?20 FAAB/.test(money.summary), 'FAAB is reported as money, not points');

// 8. a player with no projection at all is named rather than silently zeroed
const nobody = grade({ players: [] }, { players: [{ slug: 'not-a-real-player', pos: 'RB' }] });
ok(nobody.missing.includes('not-a-real-player'), 'an unprojected player is flagged');

console.log(fails === 0 ? '\nALL TRADE-GRADE ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
