// THE API IS A CONTRACT (0326) — pinned here so it cannot drift.
//
// Two assertions, both of which would otherwise only fail in production:
//   1. Every section the edge function routes to names a SQL function that
//      migration 0326 actually defines. A typo in the router is a 502 for
//      whoever is using that endpoint, and nothing in a typecheck sees it.
//   2. No api_* function body mentions a column from the never-list. This is
//      the leak that a later "just add the manager's email" would cause, and
//      the one thing worth failing a build over.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const router = readFileSync(resolve(root, 'supabase/functions/public-api/index.ts'), 'utf8');
const sql = readFileSync(resolve(root, 'supabase/migrations/0326_the_public_api.sql'), 'utf8');
// 0327 flipped the default to open-with-an-opt-out. That is a product
// decision, not an implementation detail, so it is pinned here too.
const dflt = readFileSync(resolve(root, 'supabase/migrations/0327_open_by_default.sql'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// 1. every routed function exists
const routed = [...router.matchAll(/'(api_[a-z_]+)'/g)].map((m) => m[1]);
ok(routed.length >= 13, `the router names ${routed.length} api functions`);
for (const fn of new Set(routed)) {
  ok(new RegExp(`create or replace function ${fn}\\s*\\(`).test(sql), `${fn} is defined in 0326`);
}

// 2. nothing personal in any api_ function
const FORBIDDEN = ['claim_email', 'invite_code', 'm.email', 'u.email', 'app_user.email', 'league_message', 'chat_message'];
// Each function is the text from its own CREATE to the next one (or the end
// of the file) — simpler and more honest than trying to match $$ pairs.
const starts = [...sql.matchAll(/create or replace function ([a-z_]+)\s*\(/g)];
const bodies = starts
  .map((m, i) => ({ name: m[1], text: sql.slice(m.index, starts[i + 1]?.index ?? sql.length) }))
  .filter((f) => f.name.startsWith('api_'))
  .map((f) => f.text);
ok(bodies.length >= 13, `read ${bodies.length} api function bodies`);
for (const body of bodies) {
  const name = /function (api_[a-z_]+)/.exec(body)?.[1] ?? '?';
  for (const word of FORBIDDEN) {
    ok(!body.includes(word), `${name} does not touch ${word}`);
  }
}
// The one that matters most: the sealed pick gate.
const lineups = bodies.find((b) => b.includes('function api_lineups'));
ok(!!lineups && lineups.includes('window_revealed'), 'api_lineups asks window_revealed before serving a drip pick');
ok(!!lineups && lineups.includes('sp.locked'), 'api_lineups serves only locked picks');
const trades = bodies.find((b) => b.includes('function api_trades'));
ok(!!trades && /status in \('executed', 'vetoed', 'expired'\)/.test(trades), 'api_trades serves settled deals only');

// 3. the default, and the one thing that makes open-by-default defensible
ok(/create or replace function league_public_api/.test(dflt), '0327 redefines the default');
ok(/\(settings_json ->> 'public_api'\)::boolean/.test(dflt), 'an explicit choice still wins in either direction');
ok(/provider = 'native'/.test(dflt), 'absent means open for a league that lives here');
ok(/not coalesce\(is_mock, false\)/.test(dflt), 'a mock is never served');
ok(!/list.*public.*league|api_leagues|api_directory/i.test(router),
   'there is no directory endpoint — a league is readable only by whoever holds its id');

console.log(fails === 0 ? '\nALL PUBLIC-API ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
