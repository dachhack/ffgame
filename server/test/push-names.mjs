// Players by NAME in pushes, never by id (v0.713.11). Founder, holding up a
// push: "Looks like a player id in my notification" — "Your claim WON —
// C 4870609 is yours." Run from server/:
//   npx tsx test/push-names.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
__setClientForTest({});   // push.js reads nothing at import
const { slugToName } = await import('../src/push.js');

assert.strictEqual(slugToName('c-4870609'), 'a college player');
console.log('PASS  a college slug is never printed as a name');
assert.strictEqual(slugToName('aaron-jones'), 'Aaron Jones');
assert.strictEqual(slugToName('kc-dst'), 'KC Defense');
console.log('PASS  the fallback still reads an NFL slug and a defense');

const src = readFileSync(new URL('../src/push.js', import.meta.url), 'utf8');
assert.ok(/async function poolNames\(pairs\)/.test(src) && /from\('league_pool'\)\.select\('league_id, slug, full_name'\)/.test(src));
assert.ok(/const players = await poolNames\(claims\.map\(\(c\) => \[c\.league_id, c\.add_slug\]\)\)/.test(src));
console.log('PASS  waiver pushes name the player from the league pool');
assert.ok(/const players = await poolNames\(bites\.flatMap/.test(src));
console.log('PASS  the vampire bite push does too');
assert.ok(!/slug\.split\('-'\)\.map/.test(src.replace(/export function slugToName[\s\S]*?\n}\n/, '')));
console.log('PASS  no other push capitalises a slug into a name');
console.log('ALL PUSH-NAMES TESTS PASSED');
