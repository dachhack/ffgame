// THE DYNASTY AND SEASON BOARDS, PINNED (v0.455.0). Offline — check:parity.
//
// Two automated rebakes, two different risks.
//
// THE DYNASTY RESCALE has to be the upstream's rule and not something near
// it: per-player ratio above the floor, positional median below it, and
// UNSUPPORTED POSITIONS UNTOUCHED — which is the clause that carries the
// rookie-pick rows through at their raw value. Get that last one wrong and
// every pick in the app is priced at 40% of the market.
//
// THE SEASON RATE must stay a LEVEL. `projectedPoints` scores a baked
// component line under each league's own catalog; the live number replaces
// the level that ratio multiplies, never the ratio. If it ever became the
// returned value, every custom-scoring league would silently go back to PPR —
// the bug v0.308.0 existed to kill.
import { readFileSync } from 'node:fs';
import { rescaledValue, dynRows } from '../server/src/poll/dynasty.js';
import { seasonRows } from '../server/src/poll/projections.js';
import { setLiveProjRate, clearLiveProjRate, projectedPoints, setLeagueProjScoring } from '../packages/core/src/engine/projScoring.ts';
import { PROJ_2026 } from '../packages/core/src/data/proj2026.ts';
import { slugMeta } from '../packages/core/src/data/slugMeta.ts';
import { setLiveDyn, clearLiveDyn, dynFor, setDynFormat } from '../packages/core/src/data/dyn2026.ts';
import { setLivePickValues, clearLivePickValues, pickMarketValue } from '../packages/core/src/data/pickValues2026.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// ── the rescale, against the upstream's stated rule ───────────────────────
const snap = {
  floor: 500,
  perPlayer: { 1415: { oneQB: 0.5, sf: 0.6 }, 99: { oneQB: 0.9, sf: 0.9 } },
  positional: { QB: { oneQB: 0.4, sf: 0.62 }, RB: { oneQB: 0.42, sf: 0.48 },
                WR: { oneQB: 0.39, sf: 0.48 }, TE: { oneQB: 0.39, sf: 0.5 } },
};
const above = { playerID: 1415, playerName: 'A Back', position: 'RB', value: 9999, superflexValue: 8000 };
ok(rescaledValue(above, snap, '1qb') === 5000, 'above the floor, the per-player ratio applies (9999 × 0.5)');
ok(rescaledValue(above, snap, 'sf') === 4800, 'and the superflex ratio to the superflex value');
const below = { playerID: 99, playerName: 'A Deep Stash', position: 'WR', value: 300, superflexValue: 280 };
ok(rescaledValue(below, snap, '1qb') === 117, 'below the floor, the POSITIONAL median applies (300 × 0.39), not the per-player one');
const unknown = { playerID: 5, playerName: 'Nobody', position: 'TE', value: 1000, superflexValue: 900 };
ok(rescaledValue(unknown, snap, '1qb') === 390, 'a player with no per-player ratio takes his position\'s');
// THE CLAUSE THAT MATTERS MOST
const pick = { playerID: 7, playerName: '2027 Early 1st', position: 'RDP', value: 7174, superflexValue: 6944 };
ok(rescaledValue(pick, snap, '1qb') === 7174 && rescaledValue(pick, snap, 'sf') === 6944,
  'an unsupported position — a rookie pick — keeps its RAW value, unrescaled');
const kicker = { playerID: 8, playerName: 'A Kicker', position: 'K', value: 500, superflexValue: 500 };
ok(rescaledValue(kicker, snap, '1qb') === 500, 'and so does a kicker');

// ── rows: players keyed by id, picks by the market's own label ────────────
const xwalk = { players: [
  { display_name: 'Kenny Gainwell', all_names: ['Kenny Gainwell', 'Kenneth Gainwell'], position: 'RB', sleeper_id: '7567' },
] };
const index = { sleeper: (sid) => (sid === '7567' ? { slug: 'kenneth-gainwell' } : null), slugForName: () => null };
const rows = dynRows([
  { playerID: 1, playerName: 'Kenneth Gainwell', position: 'RB', team: 'TBB', value: 3487, superflexValue: 3000 },
  pick,
], { floor: 500, perPlayer: {}, positional: snap.positional }, xwalk, index);
const gain = rows.find((r) => r.kind === 'player');
ok(gain.sleeper_id === '7567' && gain.slug === 'kenneth-gainwell',
  'the crosswalk\'s ALIASES resolve Kenneth/Kenny Gainwell — the join a bare name drops');
const prow = rows.find((r) => r.kind === 'pick');
ok(prow.key === 'pick:2027 Early 1st' && prow.label === '2027 Early 1st' && !prow.sleeper_id,
  'a pick is keyed by the market\'s own label and carries no player id');
const orphan = dynRows([{ playerID: 2, playerName: 'Nobody At All', position: 'WR', value: 900, superflexValue: 900 }],
  snap, xwalk, index)[0];
ok(orphan.key === 'ktc:2' && orphan.slug === null,
  'a player nothing can place keeps his value under the source\'s own id, with a null slug');

// ── the season board is a per-week rate ───────────────────────────────────
const srows = seasonRows({ players: [
  { sleeper: '1', ppg: 17, gp: 17, rosPPG: 16.4, gamesRemaining: 15 },
  { sleeper: '2', ppg: 20, gp: 8.5 },
  { sleeper: '3', ppg: 0 },
  { sleeper: null, ppg: 12, gp: 17 },
] });
ok(srows.length === 2, 'a zero rate and a row with no id are not season lines');
ok(srows[0].per_week === 17, 'a full season at 17.0 a game is 17.0 a week');
ok(srows[1].per_week === 10, 'and 20.0 a game over 8.5 games is 10.0 a week — the games ride in the rate');
ok(srows[0].ros_ppg === 16.4 && srows[0].games_left === 15, 'rest-of-season rides along');

// ── THE LEVEL IS LIVE; THE RULES STAY THE LEAGUE'S ────────────────────────
setLeagueProjScoring(null);
clearLiveProjRate();
const slug = [...PROJ_2026.entries()].filter(([s]) => slugMeta(s)?.pos === 'WR').sort((a, b) => b[1] - a[1])[0][0];
const baked = projectedPoints({ id: slug, pos: 'WR' });
setLiveProjRate({ [slug]: PROJ_2026.get(slug) * 2 });
const doubled = projectedPoints({ id: slug, pos: 'WR' });
ok(Math.abs(doubled - baked * 2) < 0.15, `doubling the live rate doubles the projection (${baked} → ${doubled})`);

// …and under a TE-premium catalog the league's own ratio still applies on top.
clearLiveProjRate();
setLeagueProjScoring({ teRec: 1 });
const te = [...PROJ_2026.entries()].filter(([s]) => slugMeta(s)?.pos === 'TE').sort((a, b) => b[1] - a[1])[0][0];
const tePrem = projectedPoints({ id: te, pos: 'TE' });
setLeagueProjScoring(null);
const teStd = projectedPoints({ id: te, pos: 'TE' });
ok(tePrem > teStd, `a TE-premium league scores its tight end higher (${tePrem} vs ${teStd})`);
setLeagueProjScoring({ teRec: 1 });
setLiveProjRate({ [te]: PROJ_2026.get(te) * 2 });
const both = projectedPoints({ id: te, pos: 'TE' });
ok(Math.abs(both - tePrem * 2) < 0.2,
  'and the live level multiplies THAT number — the catalog is not bypassed by the overlay');
clearLiveProjRate(); setLeagueProjScoring(null);

// ── the format guards ─────────────────────────────────────────────────────
setDynFormat('1qb');
setLiveDyn({ 'some-slug': 12345 }, '1qb');
ok(dynFor('some-slug') === 12345, 'the live dynasty value answers in its own format');
setDynFormat('sf');
ok(dynFor('some-slug') !== 12345,
  'and a screen reading the OTHER format falls through to the bake rather than taking a 1QB price');
setDynFormat('1qb'); clearLiveDyn();
setLivePickValues({ '2027 Mid 1st': 4242 }, '1qb');
ok(pickMarketValue('2027', 1, '1qb') === 4242, 'the live pick board answers by the market\'s label');
ok(pickMarketValue('2027', 1, 'sf') !== 4242, 'and never hands a 1QB price to a superflex question');
clearLivePickValues();

// ── the contract, in the migration ────────────────────────────────────────
const sql = readFileSync(new URL('../supabase/migrations/0335_the_bakes_refresh_themselves.sql', import.meta.url), 'utf8')
  .replace(/\s+/g, ' ');
ok(/case when fmt = '2qb' then 'sf' else '1qb' end/.test(sql),
  'the dynasty format follows the same superflex rule as the ADP one');
ok(/delete from dyn_board where fetched_at < stamp/.test(sql) && /delete from proj_board where fetched_at < stamp/.test(sql),
  'both boards prune on the source\'s stamp');
ok(/'proj', case when projb then/.test(sql), 'a stale season board serves an empty map, not a zero');

console.log(fails === 0 ? '\nALL BOARD ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
