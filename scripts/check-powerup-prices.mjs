// Parity guard: the server-authoritative price list (powerup_price() in
// supabase/migrations/0026_coin_spend.sql) must match the client catalog prices
// (src/data/powerups.ts) for every power-up the SQL lists. If they drift, the
// shop shows one price while the wallet charges another, and the AI budget pass
// (which reads the TS price) spends a different amount than the DB guard expects.
// Run: npx tsx scripts/check-powerup-prices.mjs
import { readFileSync } from 'node:fs';
import { POWERUPS } from '../src/data/powerups.ts';

const sql = readFileSync(new URL('../supabase/migrations/0026_coin_spend.sql', import.meta.url), 'utf8');
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

console.log(fails ? `\n${fails} FAILED — SQL/TS power-up prices have drifted.` : '\nALL PASS — power-up prices in lockstep.');
process.exit(fails ? 1 : 0);
