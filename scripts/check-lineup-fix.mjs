// THE COMMISSIONER FIXES A LINEUP (0356): the console's half, shared by web
// and app. The server decides WHO may start; this decides which SPOT each
// player fits, so it has to be the same rule the lineup screens use — and a
// best-ball spot must never be written, because the resolver fills it itself.
import { fixSlots, fixChosen, fixOptions, fixPayload, fixChanged } from '../packages/core/src/data/lineupFix';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const c = (slug, pos, extra = {}) => ({ slug, why: 'roster', name: slug, pos, team: 'BUF', exp: 3, spot: 'active', ...extra });

// Default nine, best ball on the FLEX.
const slots = fixSlots({ roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 }, bestball: ['FLEX'] });
ok('the league\'s nine spots', slots.length === 9, slots.map((s) => s.slot));
ok('FLEX is best ball', slots.find((s) => s.slot === 'FLEX')?.bestball === true);

const cands = [c('qb1', 'QB'), c('rb1', 'RB'), c('rb2', 'RB'), c('wr1', 'WR'), c('te1', 'TE'), c('ir-wr', 'WR', { spot: 'ir' })];
const chosen = fixChosen(slots, [{ slot: 'RB1', slug: 'rb1' }, { slot: 'FLEX', slug: 'wr1' }, { slot: 'GONE', slug: 'qb1' }]);
ok('stored rows land on their spots', chosen.RB1 === 'rb1' && chosen.QB === null);
ok('a row for a spot the league no longer has is dropped', !('GONE' in chosen));

const rb2 = fixOptions(slots, 'RB2', cands, chosen).map((x) => x.slug);
ok('RB2 offers the other back, not the one starting at RB1', rb2.includes('rb2') && !rb2.includes('rb1'), rb2);
ok('RB2 offers no receiver', !rb2.includes('wr1'));
ok('an IR player fits his position (fixing IR is the point)', fixOptions(slots, 'WR1', cands, chosen).some((x) => x.slug === 'ir-wr'));
ok('QB offers only the QB', JSON.stringify(fixOptions(slots, 'QB', cands, chosen).map((x) => x.slug)) === '["qb1"]');

const pay = fixPayload(slots, { ...chosen, QB: 'qb1' });
ok('the payload leaves the best-ball spot out', !pay.some((p) => p.slot === 'FLEX') && pay.length === 8, pay);
ok('and carries every other spot, empty ones as null', pay.find((p) => p.slot === 'QB')?.slug === 'qb1' && pay.find((p) => p.slot === 'K')?.slug === null);
ok('unchanged reads unchanged', !fixChanged(slots, chosen, { ...chosen }));
ok('a best-ball difference is not a change', !fixChanged(slots, chosen, { ...chosen, FLEX: 'te1' }));
ok('a real change is', fixChanged(slots, chosen, { ...chosen, QB: 'qb1' }));

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nlineup-fix: all ok');
