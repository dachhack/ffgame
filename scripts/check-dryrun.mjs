// Guard for THE READ-ONLY EXIT (v0.472.0). Offline — check:parity.
//
// `resolveMatchup(..., { dryRun: true })` is handed to a human and pointed at
// live, mid-season data on the promise that it writes nothing. That promise is
// kept by ONE return sitting above every write in the function — an arrangement
// that survives exactly as long as nobody adds a write above it, which is not a
// thing code review reliably notices six months from now.
//
// So this asserts the arrangement rather than the intention: find the dry-run
// return inside resolveMatchup, find every write in the same function, and
// require every one of them to come after it. A structural check, because the
// structure IS the safety property — "dry run" must never be able to degrade
// into "wrote slightly less".
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

const src = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');

// resolveMatchup runs from its own declaration to the next top-level export.
const start = src.indexOf('export async function resolveMatchup(');
ok(start > 0, 'resolveMatchup is where this check thinks it is');
const after = src.indexOf('\nexport ', start + 10);
ok(after > start, 'and the function has an end to look for writes inside');
const body = src.slice(start, after > start ? after : src.length);

const exit = body.indexOf('if (opts.dryRun)');
ok(exit > 0, 'the dry-run exit exists');
// It has to RETURN. A dry run that falls through to the writes with a flag set
// somewhere is the failure this whole file is about.
ok(/if \(opts\.dryRun\) \{\s*\n\s*return \{/.test(body), 'the dry-run exit returns rather than setting a flag and carrying on');

// Every way this function reaches the database, by the shape it is written in.
// `.select(` is deliberately absent: reads are what a dry run is FOR.
const WRITES = ['.upsert(', '.update(', '.insert(', '.delete(', 'creditWallet('];
let found = 0;
for (const w of WRITES) {
  let i = body.indexOf(w);
  while (i !== -1) {
    found++;
    ok(i > exit, `write \`${w}\` at offset ${i} sits AFTER the dry-run exit (${exit})`);
    i = body.indexOf(w, i + 1);
  }
}
// If the writes ever move out of this function the check must fail loudly
// rather than pass vacuously by finding nothing to check.
ok(found >= 2, `resolveMatchup still contains the writes this guard is about (${found} found)`);

// And the caller that hands the dry run to a person must actually ask for it.
const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
const diff = cli.slice(cli.indexOf("case 'diff-week'"), cli.indexOf("case 'seed-test-users'"));
ok(diff.length > 0, 'diff-week is in the CLI');
ok(diff.includes('dryRun: true'), 'diff-week resolves with dryRun: true');
ok(!/db\(\)\.from\([^)]*\)\.(upsert|update|insert|delete)/.test(diff),
  'diff-week does no writing of its own either');

console.log(fails ? `\n${fails} DRY-RUN ASSERTION(S) FAILED` : '\nALL DRY-RUN ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
