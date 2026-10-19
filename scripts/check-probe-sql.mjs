// NO DMs IN A PROBE (v0.730.20). Founder: "yes, block DM tables in probes."
//
// An ops `query` request (ops/run/*.json, mode "query") runs a scripts/db/
// file read-only against the live database when it merges, and prints what it
// reads into the Actions log — which is public. Read-only stops a probe from
// changing anything; it does not stop one from reading private messages. So a
// probe file that names a DM table (dm_message, dm_thread, dm_messages(),
// dm_threads(), …) or the bare word "dm" (the start of a name built in
// pieces, 'dm' || '_message') is refused: here in CI, and again by ops-run.yml
// right before psql, so a refusal holds even if this check was skipped.
//
// The DM chat suite (scripts/db/chat-probes.sql) uses DM tables on purpose,
// against a scratch database with made-up users; it is not an ops request, and
// an ops request that points at it is refused like any other.
//
//   node scripts/check-probe-sql.mjs            every query file ops/run names, plus the self-test
//   node scripts/check-probe-sql.mjs a.sql …    just these (ops-run.yml)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DM = /\bdm(?:_\w+)?\b/i;

/** Why this SQL may not run as a probe, or null. Pure. */
export function probeRefusal(sql) {
  const m = String(sql ?? '').match(DM);
  return m ? `names "${m[0]}": DMs are private, and a probe's output is public` : null;
}

function selftest() {
  const cases = [
    ['select count(*) from dm_message', true],
    ['select * from public.DM_THREAD', true],
    ['select dm_messages(\'x\')', true],
    ["execute 'select * from ' || 'dm' || '_message'", true],
    ['select * from "dm_message"', true],
    ['-- DMs are off limits\nselect 1', false],   // "DMs" is not the word "dm"
    ['select * from league_message where kind = \'txn\'', false],
    ['select admin_id, random_seed from x', false],
  ];
  let bad = 0;
  for (const [sql, refused] of cases) {
    const got = probeRefusal(sql) != null;
    if (got !== refused) { bad++; console.log(`FAIL  ${refused ? 'should refuse' : 'should pass'}: ${sql}`); }
  }
  if (bad) process.exit(1);
  console.log(`ok    selftest — ${cases.length} cases`);
}

function check(files) {
  let bad = 0;
  for (const f of files) {
    if (!existsSync(f)) { console.log(`FAIL  ${f}: no such file`); bad++; continue; }
    const why = probeRefusal(readFileSync(f, 'utf8'));
    if (why) { console.log(`::error::${f} ${why}. Probes may not read DMs.`); bad++; }
  }
  return bad;
}

const args = process.argv.slice(2);
if (args.length) {
  if (check(args)) process.exit(1);
} else {
  selftest();
  const dir = 'ops/run';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { const r = JSON.parse(readFileSync(join(dir, f), 'utf8')); return r.mode === 'query' && r.file ? String(r.file).replace(/^\.?\//, '') : null; } catch { return null; }
  }).filter(Boolean);
  const uniq = [...new Set(files)];
  if (check(uniq)) process.exit(1);
  console.log(`ok    ${uniq.length} probe files read no DM table`);
}
