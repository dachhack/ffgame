// A FULL ROSTER ASKS FOR A DROP (v0.489.3), checked in Node.
//
// Founder, on a FAAB claim: "My roster is full but it doesn't force me to
// select a player to drop when waivering."
//
// The team screens decide "full" by counting, and the count read the roster
// through the league pool — which was fetched capped at 1,000 rows of a
// 1,200-man pool, so a player ranked past 1,000 was not counted. The count is
// fixed (raw roster rows, never below the server's own `active_held`, and the
// pool paged), and behind it both screens now take the SERVER's refusal as the
// last word: a move refused for a full active roster opens the drop picker.
//
// That second half hangs on one regex matching the server's wording. Reword
// `roster_seat_error` and the safety net goes quietly slack — so this reads
// the deployed body out of the migrations and holds the regex to it.
import { readFileSync, readdirSync } from 'node:fs';
import { seatFullError } from '../packages/core/src/data/liveApi';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// The LATEST definition of roster_seat_error — the one the database runs.
const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let body = null, from = null;
for (const f of files) {
  const s = readFileSync(`${dir}/${f}`, 'utf8');
  const m = s.match(/function roster_seat_error\([\s\S]*?\nend \$\$;/);
  if (m) { body = m[0]; from = f; }
}
ok('roster_seat_error is defined in the migrations', body != null);
const msgs = [...(body ?? '').matchAll(/return '([^']*)'/g)].map((m) => m[1]);
ok(`roster_seat_error (${from}) returns messages`, msgs.length >= 2, msgs);
for (const m of msgs) ok(`matches the server's "${m}"`, seatFullError(m), m);

// As submit_waiver_claim actually sends it back: the seat error, then its suffix.
ok('matches the claim refusal with its suffix',
  seatFullError('your active roster is full (15/15) — drop an active player, or move one to the taxi squad or IR — or include a drop'));
ok('matches the draft-mode refusal', seatFullError('roster full — drop someone — or include a drop'));

// And nothing else: a false positive opens a drop picker on a refusal a drop
// cannot fix, which is its own kind of dead end.
for (const e of ['player already rostered', 'claim already pending', 'free agent — add him directly',
  'bid exceeds your FAAB balance of $99', 'position limit: WR 6/6', 'the minimum bid is $1',
  'your roster is over its limits — too many WR', 'wait for the draft to finish', '', null, undefined]) {
  ok(`does not match ${JSON.stringify(e)}`, !seatFullError(e), e);
}

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nseat-full: all ok');
