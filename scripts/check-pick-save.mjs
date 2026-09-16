// Guard for WHICH SLOT DIDN'T SAVE (core data/pickSave, v0.394.2).
//
// Founder, over a board reading SLOTS SET 8/8: "what's up with the not saved
// alert?" The banner named the RULE and never the SLOT, so there was nothing
// to act on. This pins the line both hosts print.
// Run: npx tsx scripts/check-pick-save.mjs
import { pickFailureNote, failedSlotLabel, failedSlotKey, winLabelOf } from '../packages/core/src/data/pickSave.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (got, want, label) => ok(got === want, `${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

const COMBO = 'Combo Drip is one per unlock — you own 1, buy another to field more';

eq(pickFailureNote([]), null, 'nothing refused reads as no error at all');

const one = [{ win: 'early', slot: 'S2', slug: 'bijan-robinson', error: COMBO }];
eq(pickFailureNote(one), `NOT SAVED — SUN 1PM · S2: ${COMBO}`,
  'one refusal names the window and slot BEFORE the reason');

const two = [
  { win: 'early', slot: 'S2', slug: 'a', error: COMBO },
  { win: 'late', slot: 'S1', slug: 'b', error: COMBO },
];
eq(pickFailureNote(two), `2 SLOTS NOT SAVED — SUN 1PM · S2, SUN 4PM · S1: ${COMBO}`,
  'the same rule refusing two slots is said once, with both slots');

const mixed = [
  { win: 'tnf', slot: 'S1', slug: 'a', error: 'that player has already kicked off' },
  { win: 'snf', slot: 'S3', slug: 'b', error: COMBO },
];
ok(pickFailureNote(mixed).includes('already kicked off') && pickFailureNote(mixed).includes('Combo Drip'),
  'two DIFFERENT reasons are both shown — the fix differs per reason');

// Labels: the board's own words, so the line points at something on screen.
eq(winLabelOf('tnf'), 'TNF', 'tnf');
eq(winLabelOf('early'), 'SUN 1PM', 'early');
eq(winLabelOf('late'), 'SUN 4PM', 'late');
eq(winLabelOf('am'), 'SUN AM', 'am');
eq(winLabelOf('snf'), 'SNF', 'snf');
eq(winLabelOf('mnf'), 'MNF', 'mnf');
eq(winLabelOf('wk'), 'LINEUP', 'a classic week-wide pick reads LINEUP, not WK');
eq(winLabelOf('zzz'), 'ZZZ', 'an unknown window still prints something');

eq(failedSlotLabel(one[0]), 'SUN 1PM · S2', 'the slot label');
eq(failedSlotKey(one[0]), 'early#S2', 'the key both boards index picks by');

// Whitespace in the server's message must not produce a ragged line.
eq(pickFailureNote([{ win: 'tnf', slot: 'S1', slug: null, error: '  padded  ' }]),
  'NOT SAVED — TNF · S1: padded', 'the server message is trimmed');

console.log(fails ? `\n${fails} PICK-SAVE PROBE(S) FAILED` : '\nALL PICK-SAVE PROBES PASSED');
process.exit(fails ? 1 : 0);
