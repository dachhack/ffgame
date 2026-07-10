// Parity guard: the locked-metric → unlock map must match between the TypeScript
// catalog (src/data/metrics.ts LOCKED_METRIC_UNLOCK, derived from the `lock:`
// fields) and the SQL trigger map (locked_metric_unlock()). The function is
// `create or replace`d across migrations, so the DB's live definition is the
// LAST one in migration order — read that, not a hardcoded file (reading only
// 0024 is how this check went stale when 0087 added underdog). If they drift,
// a player could pick a locked metric the trigger doesn't gate, or vice versa.
// Run: npx tsx scripts/check-locked-metrics.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { LOCKED_METRIC_UNLOCK } from '../src/data/metrics.ts';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let body = null, from = null;
for (const f of files) {
  const sql = readFileSync(new URL(f, dir), 'utf8');
  const at = sql.indexOf('function locked_metric_unlock');
  if (at < 0) continue;
  // Bound the extraction to this function's body (dollar-quoted, `$$ ... $$;`).
  const open = sql.indexOf('$$', at);
  const close = sql.indexOf('$$', open + 2);
  body = sql.slice(at, close > 0 ? close : undefined);
  from = f;
}
if (!body) { console.log('FAIL  no migration defines locked_metric_unlock()'); process.exit(1); }
console.log(`SQL definition read from ${from} (last create-or-replace wins)`);
const sqlMap = {};
for (const m of body.matchAll(/when\s+'([^']+)'\s+then\s+'([^']+)'/g)) sqlMap[m[1]] = m[2];

const tsKeys = Object.keys(LOCKED_METRIC_UNLOCK).sort();
const sqlKeys = Object.keys(sqlMap).sort();
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

console.log('TS :', JSON.stringify(LOCKED_METRIC_UNLOCK));
console.log('SQL:', JSON.stringify(sqlMap));
ok(tsKeys.length > 0, 'TS map is non-empty');
ok(JSON.stringify(tsKeys) === JSON.stringify(sqlKeys), 'same set of locked metrics');
for (const k of tsKeys) ok(LOCKED_METRIC_UNLOCK[k] === sqlMap[k], `${k} → ${LOCKED_METRIC_UNLOCK[k]} (SQL: ${sqlMap[k] ?? '—'})`);

console.log(fails ? `\n${fails} FAILED — SQL/TS locked-metric maps have drifted.` : '\nALL PASS — maps in lockstep.');
process.exit(fails ? 1 : 0);
