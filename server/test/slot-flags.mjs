// Verify liveResolve publishes per-slot hot/nuked flags for the card board:
// resolve a baked week through resolveLiveMatchup with (a) a nuke-metric RB
// pair — the TD side's victim must come out `nuked` — and (b) a drip WR that
// goes hot. Run: `npx tsx test/slot-flags.mjs` from server/.
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek } from '../src/engine.js';
import { resolveLiveMatchup } from '../../src/engine/liveResolve';

const WEEK = 1;
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);

const pick = (win, slot, slug, pos, team, metricId) =>
  ({ win, slot, player: makePlayer(slug, pos, team), metricId });

// Barkley (td = NUKE family) vs Cook (td): both nuke; whoever eats a TD wipe
// should carry nuked. Chase (recyd drip) should heat up against a quiet slot.
const home = [
  pick('early', 'RB1', 'saquon-barkley', 'RB', 'PHI', 'td'),
  pick('early', 'WR1', 'jamarr-chase', 'WR', 'CIN', 'recyd'),
];
const away = [
  pick('early', 'RB1', 'james-cook', 'RB', 'BUF', 'td'),
  pick('early', 'WR1', 'puka-nacua', 'WR', 'LA', 'recyd'),
];

const r = resolveLiveMatchup(home, away, WEEK, {});
console.log('slots:');
for (const s of r.slots) {
  console.log(` ${s.side.padEnd(4)} ${s.slot.padEnd(4)} ${s.slug.padEnd(16)} ${String(s.score).padStart(6)}  hot=${!!s.hot} nuked=${!!s.nuked}`);
}
const anyNuked = r.slots.some((s) => s.nuked);
const anyHot = r.slots.some((s) => s.hot);
if (!anyNuked) { console.error('FAIL: expected at least one nuked slot from the td-vs-td pair'); process.exit(1); }
if (!anyHot) { console.error('FAIL: expected at least one hot drip slot'); process.exit(1); }
console.log('\nOK — hot + nuked flags derived from engine events.');
