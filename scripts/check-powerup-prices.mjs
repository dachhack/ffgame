// Parity guard: the server-authoritative price list (the LATEST powerup_price()
// definition across supabase/migrations/) must match the client catalog prices
// (src/data/powerups.ts) — for every power-up, in BOTH directions. If a price
// drifts, the shop shows one number while the wallet charges another (and the AI
// budget pass, which reads the TS price, spends a different amount than the DB
// guard expects); if a catalog item is missing from the SQL, it prices at the
// `else 9999` default and wallet_buy_powerup rejects it as 'unknown powerup'
// even though the shop lists it — the exact bug migration 0059 fixed, hence the
// omission check.
// Run: npx tsx scripts/check-powerup-prices.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { POWERUPS } from '../src/data/powerups.ts';

// The newest migration that (re)defines powerup_price() wins — CREATE OR REPLACE
// semantics — so parity is checked against the last definition, not 0026's.
const dir = new URL('../supabase/migrations/', import.meta.url);
const defining = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => readFileSync(new URL(f, dir), 'utf8').includes('function powerup_price'));
if (!defining.length) { console.log('FAIL  no migration defines powerup_price()'); process.exit(1); }
const src = defining[defining.length - 1];
const sql = readFileSync(new URL(src, dir), 'utf8');
console.log(`price source: supabase/migrations/${src}`);

// Grab the powerup_price() CASE arms: when 'id' then <price>.
const body = sql.slice(sql.indexOf('function powerup_price'), sql.indexOf('$$;', sql.indexOf('function powerup_price')));
const sqlPrice = {};
for (const m of body.matchAll(/when\s+'([^']+)'\s+then\s+(\d+(?:\.\d+)?)/g)) sqlPrice[m[1]] = Number(m[2]);

const tsPrice = Object.fromEntries(POWERUPS.map((p) => [p.id, p.price]));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

ok(Object.keys(sqlPrice).length > 0, 'SQL price list is non-empty');
// Every priced item in SQL must exist in the catalog at the same price.
for (const [id, price] of Object.entries(sqlPrice)) {
  ok(id in tsPrice, `catalog has '${id}'`);
  ok(tsPrice[id] === price, `${id}: SQL ◆${price} === catalog ◆${tsPrice[id] ?? '—'}`);
}
// And every catalog item must be priced in SQL — an omission means the shop
// lists it but the wallet can't sell it.
for (const id of Object.keys(tsPrice)) {
  ok(id in sqlPrice, `SQL prices '${id}' (omission = unbuyable in live leagues)`);
}

console.log(fails ? `\n${fails} FAILED — SQL/TS power-up prices have drifted.` : '\nALL PASS — power-up prices in lockstep.');
process.exit(fails ? 1 : 0);
