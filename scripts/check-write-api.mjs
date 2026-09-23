// THE WRITE API IS A WHITELIST (0352) — pinned here so it cannot drift.
//
// The router (supabase/functions/public-api/index.ts) turns a method and a
// path into an action name; `api_write` turns an action name into a call. If
// the two disagree, a documented route answers "unknown action" in
// production and nothing in a typecheck sees it. And four properties of the
// SQL are what make handing out keys defensible at all, so a later edit that
// quietly loses one should fail a build rather than a league:
//   • only the service role may call the door;
//   • the owner's claims carry no email, so no key is ever a platform admin;
//   • the switch is off unless the commissioner turned it on;
//   • the commissioner's tools refuse a team-scope key.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const router = readFileSync(resolve(root, 'supabase/functions/public-api/index.ts'), 'utf8');
const sql = readFileSync(resolve(root, 'supabase/migrations/0352_the_league_answers_to_a_key.sql'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const door = sql.slice(sql.indexOf('create or replace function api_write('), sql.indexOf('revoke all on function api_write('));
ok(door.length > 1000, 'found the body of api_write');

// 1. every action the router can emit is a branch of the door
const fnBody = router.slice(router.indexOf('function writeRoute('), router.indexOf('function queryArgs('));
const routed = new Set([...fnBody.matchAll(/at\('([a-z_]+)'/g), ...fnBody.matchAll(/return \['([a-z_]+)'/g)].map((m) => m[1]));
const branches = new Set([...door.matchAll(/when ('[a-z_]+'(?:,\s*'[a-z_]+')*) then/g)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));
ok(routed.size >= 15, `the router emits ${routed.size} actions`);
for (const a of routed) ok(branches.has(a), `api_write answers "${a}"`);
for (const b of branches) ok(routed.has(b), `"${b}" is reachable from a route`);

// 2. the door is the service role's alone
ok(/revoke all on function api_write\(text, text, jsonb\) from public, anon, authenticated;/.test(sql),
  'api_write is revoked from public, anon and authenticated');
ok(/grant execute on function api_write\(text, text, jsonb\) to service_role;/.test(sql), 'and granted to the service role');
ok(!/grant execute on function api_write\([^)]*\) to (anon|authenticated)/.test(sql), 'and to nobody else');
ok(/revoke all on function _api_set_lineup\(/.test(sql), '_api_set_lineup is not callable on its own');

// 3. acting as the owner: claims set only after the key checks out, and with no email
const claimsAt = door.indexOf("set_config('request.jwt.claims'");
ok(claimsAt > door.indexOf('secret_hash = encode(sha256('), 'the claims are set after the key is looked up');
ok(claimsAt > door.indexOf('league_write_api(lid)'), 'and after the switch is checked');
const claims = door.slice(claimsAt, door.indexOf(';', claimsAt));
ok(!/email/.test(claims), 'the claims carry no email — is_admin() stays false');
ok(/, true\)/.test(claims), 'and are transaction-local');

// 4. the switch defaults off, and the commissioner's tools need league scope
ok(/coalesce\(\(select \(l\.settings_json ->> 'write_api'\)::boolean[\s\S]*?\), false\)/.test(sql), 'write_api is off unless set');
const commishOnly = /commish_only constant text\[\] := array\[([^\]]+)\]/.exec(door)?.[1] ?? '';
for (const a of ['process_waivers', 'rule_trade', 'move_player', 'remove_player', 'set_waiver_priority']) {
  ok(commishOnly.includes(`'${a}'`), `${a} needs a league-scope key`);
}
ok(/k\.scope <> 'league'/.test(door), 'the commissioner list is checked against the key\'s scope');

// 5. the key itself is never stored
ok(/secret_hash\s+text not null unique/.test(sql) && !/\bkey\s+text\b/.test(sql.slice(sql.indexOf('create table if not exists api_key'), sql.indexOf('create index if not exists api_key_league'))),
  'api_key stores a hash and no key column');

console.log(fails === 0 ? '\nALL WRITE-API ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
