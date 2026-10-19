// A REFUSED PLAY GIVES THE CARD BACK (v0.730.21, #1372). The web board spends
// a card when it draws a play, before apply_targeted answers; a refusal used to
// leave the card spent and nothing armed (a Gridiron Gang team's Double or
// Nothing and Grudge Match). This holds the wiring in src/screens/Matchup.tsx:
// a refusal (r.ok false) undoes the play or refunds the card, the undo reads the
// store through a ref (not the stale render), a network failure refunds
// nothing, and the pre-kickoff plays each pass their undo.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/screens/Matchup.tsx', 'utf8');
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const fn = src.slice(src.indexOf('const liveTargeted = '), src.indexOf('const liveClearTargeted = '));
ok('liveTargeted found', fn.length > 0);
ok('a refusal runs the undo, or refunds the card', /if \(r\.ok\) return;[\s\S]*if \(undo\) undo\(undoNow\.current\)[\s\S]*refundInventory\(mid, id\)/.test(fn));
ok('the player is told the card is back', /Your card is back in your hand/.test(fn));
ok('no answer refunds nothing', /\.catch\(\(e\) => window\.alert\([^)]*may not have played/.test(fn));
ok('the undo reads the store through a ref, refreshed every render', /undoNow\.current = \{ clearDoubleOrNothing, removeSlotListPu, removeRivalry, clearByeSteal, grantPowerup \}/.test(src));
ok('Double or Nothing passes its undo', /liveTargeted\('double-or-nothing', keyParts\(key\), \(u\) => u\.clearDoubleOrNothing\(week\)\)/.test(src));
ok('Grudge / Lead Change / Jinx / Red Herring / Ghost pass theirs', /liveTargeted\(pu, keyParts\(key\), \(u\) => u\.removeSlotListPu\(pu, week, key\)\)/.test(src));
ok('Rivalry passes its undo', /liveTargeted\('rivalry', \{ win \}, \(u\) => u\.removeRivalry\(week, win\)\)/.test(src));
ok('Bye Steal passes its undo', /\(u\) => u\.clearByeSteal\(week\)\)/.test(src));
ok('refundInventory is imported', /applyUnderdog, refundInventory,/.test(src));

if (fails) { console.log(`\nFAIL — ${fails}`); process.exit(1); }
console.log('\nALL REFUSED-PLAY ASSERTIONS PASSED');
