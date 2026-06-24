// Parity guard: the locked-metric → unlock map must match between the TypeScript
// catalog (src/data/metrics.ts LOCKED_METRIC_UNLOCK, derived from the `lock:`
// fields) and the SQL trigger map (supabase/migrations/0024_locked_metrics.sql
// locked_metric_unlock). If they drift, a player could pick a locked metric the
// trigger doesn't gate, or vice versa. Run: npx tsx scripts/check-locked-metrics.mjs
import { readFileSync } from 'node:fs';
import { LOCKED_METRIC_UNLOCK } from '../src/data/metrics.ts';

const sql = readFileSync(new URL('../supabase/migrations/0024_locked_metrics.sql', import.meta.url), 'utf8');
// Grab the locked_metric_unlock() CASE arms: when 'metric' then 'unlock'.
const body = sql.slice(sql.indexOf('function locked_metric_unlock'), sql.indexOf('function is_live_unlock'));
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
