// The lineup-lock alert's empty-spot count (v0.561.6). Founder: "I get this
// alert but I think I put a ghost in." Run from server/:
//   npx tsx test/push-lineup.mjs
import assert from 'node:assert';
import { __setClientForTest } from '../src/supabase.js';
__setClientForTest({});   // push.js reads nothing at import; the count is pure
const { emptySpots } = await import('../src/push.js');

// Three spots in the MNF window, two players picked.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1'], null), 1);
console.log('PASS  two of three picked: one empty');
// The third holds a Ghost — not empty.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1'], { targeted: { ghost: ['mnf|2'] } }), 0);
console.log('PASS  a Ghost fills its spot');
// A Ghost in ANOTHER window doesn't count here.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1'], { targeted: { ghost: ['snf|2'] } }), 1);
console.log('PASS  a Ghost in another window does not');
// A Bye Steal holds its spot too.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1'], { targeted: { byeSteal: { win: 'mnf', slot: '2', slug: 'x', pts: 9 } } }), 0);
console.log('PASS  a Bye Steal fills its spot');
// An Extra Slot on the window is one more spot to fill.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1', '2'], { extraSlots: { mnf: 1 } }), 1);
console.log('PASS  an Extra Slot adds a spot');
// A Ghost on a spot that also has a player is not counted twice.
assert.strictEqual(emptySpots(3, 'mnf', ['0', '1'], { targeted: { ghost: ['mnf|1'] } }), 1);
console.log('PASS  a Ghost and a player on one spot count once');
console.log('ALL PUSH-LINEUP TESTS PASSED');
