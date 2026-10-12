// The coin rules (v0.692.0): the engine's standard suite and the SQL's
// _contest_coin_defaults are the same list, and the helpers read right.
import { readFileSync } from 'node:fs';
import { CONTEST_COIN_DEFAULTS, CONTEST_COIN_EVENTS, contestCoinRules, contestCoinOverrides, coinEventApplies, coinRulesLine } from '../../packages/core/src/engine/contestCoin.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const sql = readFileSync(new URL('../../supabase/migrations/0489_contest_coin_rules.sql', import.meta.url), 'utf8');
const m = sql.match(/_contest_coin_defaults\(\) returns jsonb[\s\S]*?select '(\{[\s\S]*?\})'::jsonb/);
ok('the SQL defaults are findable', !!m);
const sqlDefaults = m ? JSON.parse(m[1]) : {};
ok('the engine and the SQL name the same events', JSON.stringify(Object.keys(sqlDefaults).sort()) === JSON.stringify(Object.keys(CONTEST_COIN_DEFAULTS).sort()), { sql: Object.keys(sqlDefaults), engine: Object.keys(CONTEST_COIN_DEFAULTS) });
ok('…with the same numbers', Object.keys(CONTEST_COIN_DEFAULTS).every((k) => sqlDefaults[k] === CONTEST_COIN_DEFAULTS[k]), { sqlDefaults, CONTEST_COIN_DEFAULTS });
ok('every event has a name and a blurb', CONTEST_COIN_EVENTS.every((e) => e.name && e.blurb && e.group));
ok('overrides sit on the suite', contestCoinRules({ built: 50 }).built === 50 && contestCoinRules({ built: 50 }).loss === 15);
ok('junk keys and values are dropped', !('winning' in contestCoinRules({ winning: 99 })) && contestCoinRules({ built: Number.NaN }).built === 40);
ok('only what differs is an override', JSON.stringify(contestCoinOverrides({ ...CONTEST_COIN_DEFAULTS, cap: 0 })) === JSON.stringify({ cap: 0 }));
const h2h = { format: 'h2h', contest: 'high', span: 'season' };
const board = { format: 'board', contest: 'bullseye', span: 'week' };
ok('the heartbreaker is head-to-head', coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'heartbreaker'), h2h) && !coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'heartbreaker'), board));
ok('the bottom half is the board', coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'bottomhalf'), board) && !coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'bottomhalf'), h2h));
ok('catch-up is a season', !coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'catchup'), board));
ok('dead-on is bullseye', coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'deadon'), board) && !coinEventApplies(CONTEST_COIN_EVENTS.find((e) => e.id === 'deadon'), h2h));
const line = coinRulesLine(contestCoinRules({ allowance: 10, cap: 0, bargain: 0 }), h2h);
ok('the line says the allowance', line.includes('weekly allowance ◎10'), line);
ok('…and no ceiling', line.includes('no ceiling'), line);
ok('…and skips an event turned off', !line.includes('bargain'), line);
ok('…and the streak with its cap', line.includes('weeks in a row ◎5 per week in a row (up to ◎25)'), line);

if (fails) { console.log(`${fails} failing`); process.exit(1); }
console.log('all coin-rules checks passed');
