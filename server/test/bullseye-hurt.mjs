// HURT IN HIS GAME (v0.701.0). Founder: "We need a way to not apply the 0
// penalty to players who were injured during their game." The dart waives a
// zero from a hurt player; the worker reads who from the injury report dated
// to his game; the commissioner's waiver rides the same cache. Pure.
import assert from 'node:assert';
import { applyBullseye, bullseyePenalty } from '../../packages/core/src/engine/bullseye.ts';
import { setLeagueAdjustments, hurtFor, clearLeagueAdjustments } from '../../packages/core/src/data/commish.ts';
import { hurtInGame } from '../src/injuries.js';

const card = { total: 100, targets: { S1: 20, S2: 30 } };
const rows = (hurtScore) => [
  { win: 'wk', side: 'home', slot: 'S1', slug: 'a', metric: null, score: 25 },
  { win: 'wk', side: 'home', slot: 'S2', slug: 'b', metric: null, score: hurtScore },
  { win: 'wk', side: 'away', slot: 'S1', slug: 'c', metric: null, score: 20 },
  { win: 'wk', side: 'away', slot: 'S2', slug: 'd', metric: null, score: 0 },
];
const r = { home: 25, away: 20, slots: rows(0), states: [{ window: 'wk', home: 25, away: 20 }] };
const pen = bullseyePenalty(10);
// ── TOTAL: his zero costs no distance; the other side's zero still does ──
const tot = applyBullseye(r, { cfg: { variant: 'total', radius: 10 }, card }, 2, undefined, { hurt: (s) => s === 'b' });
assert.strictEqual(tot.bullseye.home.zeros, 0, 'a hurt zero is not a no-show');
assert.strictEqual(tot.bullseye.home.dist, 75, 'home: 25 from 100, no penalty');
assert.strictEqual(tot.bullseye.away.zeros, 1);
assert.strictEqual(tot.bullseye.away.dist, 80 + pen, 'away: 80 from 100 plus the penalty');
const hb = tot.slots.find((x) => x.side === 'home' && x.slot === 'S2');
assert.strictEqual(hb.aim.hurt, true, 'the row says hurt'); assert.strictEqual(hb.aim.penalty, undefined, 'and carries no penalty');
const ad = tot.slots.find((x) => x.side === 'away' && x.slot === 'S2');
assert.strictEqual(ad.aim.penalty, pen, 'the other zero wears the penalty');
// ── per spot ──
const spot = applyBullseye(r, { cfg: { variant: 'slots', radius: 10 }, card }, 2, undefined, { hurt: (s) => s === 'b' });
assert.strictEqual(spot.slots.find((x) => x.side === 'home' && x.slot === 'S2').aim.hurt, true);
assert.strictEqual(spot.slots.find((x) => x.side === 'away' && x.slot === 'S2').aim.penalty, pen);
assert.strictEqual(spot.bullseye.home.zeros, 0); assert.strictEqual(spot.bullseye.away.zeros, 1);
// ── a hurt player who scored is just his score ──
const scored = applyBullseye({ ...r, slots: rows(4.2) }, { cfg: { variant: 'total', radius: 10 }, card }, 2, undefined, { hurt: (s) => s === 'b' });
assert.strictEqual(scored.slots.find((x) => x.side === 'home' && x.slot === 'S2').aim, undefined, 'no aim on a scoring row in TOTAL');
// ── without the hook nothing changes ──
const plain = applyBullseye(r, { cfg: { variant: 'total', radius: 10 }, card }, 2);
assert.strictEqual(plain.bullseye.home.zeros, 1);
// ── the cache: the commissioner's row and the worker's ride together ──
setLeagueAdjustments('L', [{ week: 5, slug: 'b', points: 0, hurt: true }, { week: 5, slug: 'a', points: 2 }]);
assert.strictEqual(hurtFor('b', 5), true); assert.strictEqual(hurtFor('b', 6), false, 'keyed by week'); assert.strictEqual(hurtFor('a', 5), false);
clearLeagueAdjustments(); assert.strictEqual(hurtFor('b', 5), false);
// ── the report: a designation dated to his game ──
const K = Date.UTC(2026, 9, 11, 17, 0); const H = 3600_000; const D = 24 * H;
const kick = { BUF: K, LAR: K + 4 * H };
const inj = [
  { player_slug: 'hurt-sun', status: 'Q', designation_date: new Date(K + 2 * H).toISOString(), team: 'BUF' },      // during the game
  { player_slug: 'hurt-mon', status: 'O', designation_date: new Date(K + D).toISOString(), team: 'BUF' },          // reported the morning after
  { player_slug: 'friday-q', status: 'Q', designation_date: new Date(K - 2 * D).toISOString(), team: 'BUF' },      // the pre-game report
  { player_slug: 'next-week', status: 'O', designation_date: new Date(K + 6 * D).toISOString(), team: 'BUF' },     // a later injury
  { player_slug: 'rams-la', status: 'Q', designation_date: new Date(K + 5 * H).toISOString(), team: 'LA' },        // LA reads as LAR (#1095)
  { player_slug: 'no-team', status: 'Q', designation_date: new Date(K + H).toISOString(), team: null },
  { player_slug: 'not-yet', status: 'Q', designation_date: new Date(K + 5 * H).toISOString(), team: 'LAR' },
];
const got = hurtInGame(inj, kick, K + 2 * D);
assert.deepStrictEqual([...got].sort(), ['hurt-mon', 'hurt-sun', 'rams-la', 'not-yet'].sort(), 'dated to his game, LA normalised');
assert.strictEqual(hurtInGame(inj, kick, K + 6 * H).has('not-yet'), true, 'the Rams game kicked off, his designation is after it');
assert.strictEqual(hurtInGame(inj, kick, K + 1 * H).has('rams-la'), false, 'the Rams game has not kicked off yet');
console.log('bullseye-hurt: all checks passed');
