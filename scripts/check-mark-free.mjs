// MARK-FREE SWITCHES (0395), checked in Node.
//
// Founder: "save it to my profile and add it to mobile.. we need a global mark
// free switch too." Four switches now decide whether NFL logos and headshots
// show, and the order is the whole point: a build or the global switch hides
// them for everyone, and nobody's personal "off" or ?markfree=0 brings them
// back. Get the order wrong and a licensing-free launch shows NFL marks.
import { setPlatform } from '../packages/core/src/platform';
import {
  isMarkFree, isMarkFreeForced, personalMarkFree, setMarkFree, applyServerMarkFree, onMarkFree,
} from '../packages/core/src/data/markFree';
import { teamLogo, espnHeadshot } from '../packages/core/src/data/media';

const store = new Map();
let query = '';
let envMarkFree;
setPlatform({
  storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
  env: (k) => (k === 'VITE_MARK_FREE' ? envMarkFree : undefined),
  url: { query: () => new URLSearchParams(query) },
});

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — got ${got}, want ${want}`}`);
};
let fired = 0;
onMarkFree(() => fired++);

eq('default: off', isMarkFree(), false);
eq('default: logos resolve', teamLogo('KC') !== null, true);
eq('default: no personal preference', personalMarkFree(), null);

eq('personal on: reports a change', setMarkFree(true), true);
eq('personal on: hidden', isMarkFree(), true);
eq('personal on: logos null', teamLogo('KC'), null);
eq('personal on: headshots null', espnHeadshot('3139477'), null);
eq('personal on: listeners told', fired, 1);
eq('personal on again: no change', setMarkFree(true), false);

eq('server says mine=false: shown', (applyServerMarkFree({ global: false, mine: false }), isMarkFree()), false);
eq('server mine=null leaves device copy', (setMarkFree(true), applyServerMarkFree({ global: false, mine: null }), isMarkFree()), true);

applyServerMarkFree({ global: false, mine: false });
eq('global on: hidden', (applyServerMarkFree({ global: true, mine: false }), isMarkFree()), true);
eq('global on: forced', isMarkFreeForced(), true);
eq('global on: personal off cannot undo', (setMarkFree(false), isMarkFree()), true);
query = 'markfree=0';
eq('global on: ?markfree=0 cannot undo', (applyServerMarkFree({ global: true, mine: false }), isMarkFree()), true);

eq('global off, ?markfree=0 wins over personal on', (applyServerMarkFree({ global: false, mine: true }), isMarkFree()), false);
query = 'markfree=1';
eq('?markfree=1 wins over personal off', (applyServerMarkFree({ global: false, mine: false }), isMarkFree()), true);
query = '';
eq('?markfree gone: personal off again', (applyServerMarkFree({ global: false, mine: false }), isMarkFree()), false);

envMarkFree = 'true';
eq('build env: hidden', (applyServerMarkFree({ global: false, mine: false }), isMarkFree()), true);
eq('build env: forced', isMarkFreeForced(), true);

if (fails) { console.log(`\n${fails} MARK-FREE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nmark-free switches OK');
