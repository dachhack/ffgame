// Guard: the targeted-payload KEY NAMES must stay in lockstep across the three
// layers that speak them — the SQL entitlement gate + apply RPC (latest
// migration touching apply_targeted), the worker mapping (resolve.js toExtras),
// and the engine (liveResolve LiveExtras). A play added to one layer but not
// the others silently either never scores or can never be applied.
//   node scripts/check-targeted-keys.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Every targeted key the system knows, and the powerup id that fills it.
const KEYS = {
  don: 'double-or-nothing', byeSteal: 'bye-steal', emp: 'emp', swaps: 'metric-swap',
  rivalry: 'rivalry', ghost: 'ghost', leadChange: 'lead-change', grudge: 'grudge',
  jinx: 'jinx', redHerring: 'red-herring',
  surge: 'surge', coldSnap: 'cold-snap', napalm: 'napalm', bunker: 'bunker',
  clutchDon: 'clutch-don', clutchEncore: 'clutch-encore', clutchCounter: 'clutch-counter',
};

// Latest migration that (re)defines apply_targeted is the live SQL surface.
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
let sqlFile = null;
for (const f of [...migs].reverse()) { if (readSql(f).includes('function apply_targeted')) { sqlFile = f; break; } }
function readSql(f) { return readFileSync(join(migDir, f), 'utf8'); }
const sql = readSql(sqlFile);
const resolveJs = read('server/src/resolve.js');
const liveResolve = read('src/engine/liveResolve.ts');

let failed = 0;
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failed++; };

console.log(`targeted-key lockstep — SQL surface: ${sqlFile}\n`);
for (const [key, puId] of Object.entries(KEYS)) {
  // SQL must both accept the powerup id and store/count the camelCase key.
  ok(`SQL handles '${puId}' → t.${key}`, sql.includes(`'${puId}'`) && sql.includes(`'${key}'`) || sql.includes(`{${key}}`));
  // The worker must map the key into engine extras.
  ok(`resolve.js toExtras maps '${key}'`, resolveJs.includes(`'${key}'`) || resolveJs.includes(`t.${key}`));
  // The engine must declare the field (swaps/don named the same).
  ok(`LiveExtras declares '${key}'`, liveResolve.includes(`${key}?:`) || liveResolve.includes(`${key}:`));
}

// And the entitlement gate must count every consumable play id it gates.
for (const puId of Object.values(KEYS)) {
  ok(`entitlement counts '${puId}'`, sql.includes(`when '${puId}'`) || puId === 'metric-swap' && sql.includes(`'metric-swap'`));
}

console.log(failed ? `\n${failed} FAILURE(S) — a layer drifted.` : '\nALL PASS — targeted keys in lockstep.');
process.exit(failed ? 1 : 0);
