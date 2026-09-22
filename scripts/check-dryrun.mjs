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

// ── the restamp's blast radius is bounded by default (v0.475.0) ──
// A drip week was scored live against power-ups, buffs and window state no
// later pass can rebuild, so re-resolving one invents a different week. The
// guard is off-by-default-safe: you have to ASK for drip.
{
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  const rs = cli.slice(cli.indexOf("case 'restamp'"), cli.indexOf("case 'diff-week'"));
  ok(rs.length > 0, 'restamp is in the CLI');
  ok(rs.includes("!args.includes('--include-drip')"),
    'restamp skips non-classic leagues unless --include-drip is passed');
  ok(/!== 'classic'/.test(rs), '…deciding by game_mode, not by guessing from the name');
  ok(rs.includes('skipLeagues'), '…and hands the set to stampFinals rather than filtering after the fact');
  const res = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
  ok(/if \(opts\.skipLeagues\?\.size\) rows = rows\.filter/.test(res),
    'stampFinals drops skipped leagues BEFORE resolving, not after');
  // A restore must never resolve: it writes recorded numbers, full stop.
  const rw = cli.slice(cli.indexOf("case 'restore-week'"), cli.indexOf("case 'seed-test-users'"));
  ok(rw.length > 0, 'restore-week is in the CLI');
  ok(!/resolveMatchup|stampFinals/.test(rw),
    'restore-week resolves nothing — it only writes what the file records');
  ok(rw.includes("!== 1"), 'restore-week refuses a row that does not match exactly one matchup');
}

// ── the CLI resolves in the tick's world, not the bake's (v0.476.0) ──
// Without a runtime slate every window lookup answers from the baked 2025
// schedule. The tick installs one from ESPN before it stamps; the CLI has to
// install one from nfl_slate, and has to do it BEFORE it resolves anything.
{
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  ok(cli.includes('async function installWeekSlate('), 'the CLI has a DB-backed slate install');
  ok(cli.includes("from('nfl_slate')") && cli.includes('setRuntimeSlate(week, games)'),
    '…that reads nfl_slate and hands setRuntimeSlate the tick\'s shape');
  for (const name of ['restamp', 'diff-week']) {
    const start = cli.indexOf(`case '${name}'`);
    const body = cli.slice(start, cli.indexOf('\n    case ', start + 10));
    const at = body.indexOf('await installWeekSlate(');
    const resolveAt = Math.min(...['stampFinals(', 'resolveMatchup(', 'injectWeekPlays('].map((k) => body.indexOf(k)).filter((i) => i > 0));
    ok(at > 0 && at < resolveAt, `${name} installs the week's slate before it resolves anything`);
    ok(/if \(!slateN\) break;|not meaningful/.test(body), `${name} says so, or refuses, when there is no slate to install`);
  }
  const dw = cli.slice(cli.indexOf("case 'diff-week'"), cli.indexOf("case 'restore-week'"));
  ok(dw.includes("m.status === 'scheduled'") && dw.includes('continue;'),
    'diff-week skips a scheduled matchup rather than printing an auto-lineup as a finding');
  ok(dw.includes('window-battle bonus'), 'diff-week names a drip side\'s window-battle bonus instead of flagging it');
  // --flips (v0.481.0) resolves each matchup TWICE; both must be dry.
  const fl = dw.slice(dw.indexOf("args.includes('--flips')"));
  const flBody = fl.slice(0, fl.indexOf('break;'));
  ok(flBody.length > 0 && (flBody.match(/resolveMatchup\(/g) ?? []).length === 2
    && (flBody.match(/dryRun: true/g) ?? []).length === 2,
    'diff-week --flips resolves exactly twice, and both resolves are dry runs');
  ok(flBody.includes('stored') && /sh \+ fixed\.home - old\.home/.test(flBody),
    '…and corrects the STORED final by the old→fixed delta rather than trusting a re-fielded re-resolve');
}

// ── a committed request runs once, and only on main (v0.477.0) ──
{
  const wf = readFileSync(new URL('../.github/workflows/ops-run.yml', import.meta.url), 'utf8');
  ok(/push:\s*\n\s*branches: \[main\]/.test(wf), 'ops-run triggers on a push to main — never on a PR, which would hand its secrets to a branch');
  ok(!/pull_request/.test(wf), '…and has no pull_request trigger at all');
  ok(wf.includes('--diff-filter=A'), 'only NEWLY-ADDED request files run — an edited or re-pushed one never fires twice');
  ok(/set -euo pipefail/.test(wf), 'the first failing request stops the rest');
  ok(wf.includes('concurrency: live-sim'), 'it shares the write lock with Re-stamp / Sync / Simulate');
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  const op = cli.slice(cli.indexOf("case 'ops-run'"), cli.indexOf("case 'seed-test-users'"));
  ok(op.includes("req.confirm !== 'RESTAMP'"), 'a restamp request still needs its RESTAMP, in the file');
  // Strict `=== true`: a string "false" or a stray 1 in a hand-written file
  // must not be read as consent to re-resolve a drip week.
  ok(/if \(req\.include_drip === true\) argv\.push\('--include-drip'\)/.test(op),
    'a restamp request reaches drip only when it says include_drip: true, exactly');
}

// ── restore-week's two follow-throughs (v0.478.0) ──
{
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  const rw = cli.slice(cli.indexOf("case 'restore-week'"), cli.indexOf("case 'ops-run'"));
  ok(rw.includes("lg.reset_state === true") && rw.includes("game_window: 'ALL'") && rw.includes('slot_scores: []'),
    'reset_state writes ONE totals-only row with no slot breakdown — it states only what is known');
  const del = rw.indexOf("from('matchup_state').delete()"), fin = rw.indexOf("update({ home_final: m.home");
  ok(fin > 0 && del > fin, 'the final is written before the breakdown is touched');
  ok(/refused > refusedAtStart/.test(rw) && rw.indexOf('const refusedAtStart = refused') > 0,
    'a league with any refused row does not get its report rebuilt over half-restored numbers');
}

// ── a played week is never re-scheduled by the sync (v0.483.0) ──
// Sleeper's state week names the week just played until its midweek rollover,
// so the sync re-mirrors a FINISHED week on every pass in between. Its upsert
// used to write status 'scheduled' over it, and every reader of
// `status = 'final'` — standings, report, record book — dropped the week.
{
  const sy = readFileSync(new URL('../server/src/sync.js', import.meta.url), 'utf8');
  const sw = sy.slice(sy.indexOf('export async function syncWeek('), sy.indexOf('export async function', sy.indexOf('export async function syncWeek(') + 10));
  ok(/filter\(\(m\) => m\.status !== 'scheduled'\)/.test(sw) && sw.includes('played.has('),
    "syncWeek sets aside every matchup already past 'scheduled'");
  ok(!/upsert\(matchups,/.test(sw) && /upsert\(open,/.test(sw),
    '…and upserts only the ones still open — never the whole mirrored list');
  const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
  const rf = cli.slice(cli.indexOf("case 'refinalize-week'"), cli.indexOf("case 'seed-test-users'"));
  ok(rf.length > 0, 'refinalize-week is in the CLI');
  ok(rf.includes(".eq('status', 'scheduled')") && rf.includes(".not('home_final', 'is', null)")
    && rf.includes(".not('away_final', 'is', null)") && rf.includes(".lte('lock_at', nowIso)"),
    'refinalize-week touches only scheduled rows with BOTH finals stamped and lock_at past — never a game still to play');
  ok(!/resolveMatchup|stampFinals|home_final:|away_final:/.test(rf),
    '…and resolves nothing and writes no score — status only');
}

// And the caller that hands the dry run to a person must actually ask for it.
//
// The slice ENDS AT restore-week, not at the next case that happened to follow
// when this was written: restore-week writes on purpose, and once it landed
// between the two markers this scan was reading its updates as diff-week's.
// It still passed — the write regex does not span the newline restore-week
// happens to wrap on — which is a check passing by luck, and a check that can
// pass by luck is not one.
const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
const diffStart = cli.indexOf("case 'diff-week'");
const diffEnd = cli.indexOf("case 'restore-week'");
ok(diffStart > 0 && diffEnd > diffStart,
  'diff-week and restore-week are both present, in that order — the slice below is honest');
const diff = cli.slice(diffStart, diffEnd);
ok(diff.length > 0, 'diff-week is in the CLI');
ok(diff.includes('dryRun: true'), 'diff-week resolves with dryRun: true');
// `[^;]` rather than `[^)]` or `[\s\S]`: a write broken across lines is
// still a write (the `[^)]` pattern could be slipped by a line break), but the
// match must stay inside ONE statement — `[\s\S]` ran on across statements and
// read `createHash('sha256').update(…)`, a hash, as a database write.
ok(!/db\(\)\.from\([^;]*?\)[^;]{0,40}?\.(upsert|update|insert|delete)\(/.test(diff),
  'diff-week does no writing of its own either');

console.log(fails ? `\n${fails} DRY-RUN ASSERTION(S) FAILED` : '\nALL DRY-RUN ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
