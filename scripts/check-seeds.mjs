// THE COMMISSIONER SEEDS THE BRACKET (0359): the consoles' shared seeding list.
import { seedStart, seedsCustom, moveSeed } from '../packages/core/src/data/seeds';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const dflt = [3, 1, 2, 5, 4, 6];
ok('no bracket: the league\'s own order', seedStart(dflt, null).join() === '3,1,2,5,4,6');
ok('a bracket: its seeds first, then everyone else in the league\'s order', seedStart(dflt, [2, 1, 3, 5]).join() === '2,1,3,5,4,6', seedStart(dflt, [2, 1, 3, 5]));
ok('a team missing from the standings still lands on the list', seedStart(dflt, null, [9]).join() === '3,1,2,5,4,6,9');
ok('the league\'s order is not custom', !seedsCustom(dflt, dflt, 4));
ok('a change below the cut is not custom', !seedsCustom([3, 1, 2, 5, 6, 4], dflt, 4));
ok('a change in the top four is', seedsCustom([1, 3, 2, 5, 4, 6], dflt, 4));
ok('↑ swaps with the one above', moveSeed(dflt, 1, -1).join() === '1,3,2,5,4,6');
ok('↑ at the top does nothing', moveSeed(dflt, 0, -1) === dflt);
ok('↓ at the bottom does nothing', moveSeed(dflt, 5, 1) === dflt);
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nseeds: all ok');
