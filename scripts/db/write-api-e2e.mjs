// THE WRITE API, END TO END (0352) — the real edge-function router, its SQL,
// and nothing mocked in between but the wire.
//
// The Deno function is loaded under Node with a two-line Deno stand-in, and
// its `fetch` to PostgREST is answered by the scratch database instead: each
// RPC runs the way PostgREST runs it, as the service role, with the service
// role's claims, in its own transaction. So this exercises what the probes
// cannot — the routing table, the status codes, the body parsing, the cache
// headers, and a keyed GET still reaching the read API — against the same SQL
// the probes hold.
//
// Runs at the end of run-scratch-probes.sh, on the database the suites left
// behind (it needs write-api-probes' league). By hand:
//   SCRATCH_PG_DIR=/tmp/pgscratch npx tsx scripts/db/write-api-e2e.mjs
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PSQL = ['-h', process.env.SCRATCH_PG_DIR ?? '/tmp/pgscratch', '-p', process.env.SCRATCH_PG_PORT ?? '54329',
  '-U', 'postgres', '-d', 'scratch', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = (q) => execFileSync('psql', [...PSQL, '-c', q], { encoding: 'utf8' }).trim();
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://pg', SUPABASE_SERVICE_ROLE_KEY: 'svc' })[k] }, serve: (h) => { handler = h; } };
const calls = [];
globalThis.fetch = async (url, init) => {
  const fn = String(url).split('/rpc/')[1]; const a = JSON.parse(init.body); calls.push(fn);
  let q;
  // As PostgREST runs an RPC for the service role: its own role and claims, one transaction.
  const pre = `set role service_role; set request.jwt.claims = '{"role":"service_role"}';`;
  if (fn === 'api_write') q = `${pre} select api_write(${lit(a.p_key)}, ${lit(a.p_action)}, ${lit(JSON.stringify(a.p_args))}::jsonb);`;
  else if (fn === 'api_take_token') q = `${pre} select api_take_token(${lit(a.p_ip)}, ${a.p_rate ?? 10}, ${a.p_burst ?? 120});`;
  else if (fn === 'api_league') q = `${pre} select api_league(${lit(a.p_league_id)});`;
  else return new Response('unknown rpc ' + fn, { status: 404 });
  const out = execFileSync('psql', [...PSQL, '-c', q], { encoding: 'utf8' }).trim().split('\n').pop();
  return new Response(out === '' ? 'null' : out, { status: 200 });
};
await import(pathToFileURL(resolve(root, 'supabase/functions/public-api/index.ts')).href);

// Fixture: the newest WriteApi league; A mints a LEAGUE key, B a TEAM key, as themselves.
const lid = sql(`select id from league where name = 'WriteApi' order by created_at desc limit 1`);
sql(`update league set settings_json = settings_json || '{"write_api": true}' where id = '${lid}'`);
const mint = (u, scope) => sql(`select set_config('app.uid', '00000000-0000-0000-0000-0000000015${u}', false), set_config('app.email','x',false); select api_key_create('${lid}', 'e2e ${scope}', '${scope}') ->> 'key'`).split('\n').pop();
sql(`update api_key set revoked_at = now() where label like 'e2e%'`);
const KL = mint('01', 'league'), KT = mint('02', 'team');
const b = Number(sql(`select sleeper_roster_id from league_membership where league_id = '${lid}' and app_user_id = '00000000-0000-0000-0000-000000001502'`));
const pool = sql(`select slug from league_pool lp where league_id = '${lid}' and (waived_until is null or waived_until <= now()) and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug) order by slug limit 1`);
sql(`select set_transaction_rules('${lid}', p_fa_mode => 'open', p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb) from (select set_config('app.uid','00000000-0000-0000-0000-000000001501',false)) x`);

let fails = 0;
const req = async (method, path, { key, body } = {}) => {
  const headers = new Headers(key ? { authorization: `Bearer ${key}` } : {});
  if (body !== undefined) headers.set('content-type', 'application/json');
  const r = await handler(new Request(`http://edge/functions/v1/public-api/v1${path}`, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }));
  const text = await r.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed, headers: r.headers };
};
const expect = (name, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + JSON.stringify(got)}`); if (!cond) fails++; };

let r = await req('OPTIONS', `/league/${lid}/add`);
expect('preflight allows Authorization and POST', r.headers.get('access-control-allow-headers').includes('authorization') && r.headers.get('access-control-allow-methods').includes('POST'));
r = await req('POST', `/league/${lid}/add`, { body: { roster_id: b, add: pool } });
expect('a write without a key is a 401', r.status === 401, r);
r = await req('GET', '/me', { key: KT });
expect('GET /me', r.status === 200 && r.body.key.scope === 'team' && r.body.rosters[0] === b && !('status' in r.body), r.body);
expect('keyed answers are never cached', r.headers.get('cache-control') === 'no-store');
r = await req('GET', `/league/${lid}/me`, { key: KT });
expect('GET /league/{id}/me', r.status === 200, r);
r = await req('GET', `/league/00000000-0000-0000-0000-00000000dead/me`, { key: KT });
expect('another league in the path is a 403', r.status === 403 && r.body.error.code === 'forbidden', r);
r = await req('POST', `/league/${lid}/add`, { key: KT, body: { roster_id: b, add: pool } });
expect('POST /add', r.status === 200 && r.body.ok === true, r);
r = await req('POST', `/league/${lid}/drop`, { key: KT, body: { roster_id: b, player: pool } });
expect('POST /drop', r.status === 200, r);
const free = sql(`select slug from league_pool lp where league_id = '${lid}' and waived_until is null and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug) and slug <> '${pool}' order by slug limit 1`);
r = await req('POST', `/league/${lid}/claims`, { key: KT, body: { roster_id: b, add: free } });
expect('a league refusal is a 422 with its message', r.status === 422 && /add him directly/.test(r.body.error.message) && r.body.error.code === 'refused', r);
r = await req('POST', `/league/${lid}/waivers/process`, { key: KT });
expect('a commissioner route with a team key is a 403', r.status === 403, r);
r = await req('POST', `/league/${lid}/waivers/process`, { key: KL });
expect('POST /waivers/process with the league key', r.status === 200, r);
r = await req('GET', `/league/${lid}/lineup?roster_id=${b}&week=1`, { key: KT });
expect('GET /lineup reads query args as numbers', r.status === 200 && r.body.roster_id === b, r);
r = await req('POST', `/league/${lid}/add`, { key: KT, body: '[1,2]' });
expect('a body that is not an object is a 400', r.status === 400, r);
r = await req('POST', `/league/${lid}/add`, { key: KT, body: { roster_id: b + 100, add: pool } });
expect('another seat is a 403', r.status === 403, r);
r = await req('POST', `/league/${lid}/nonsense`, { key: KT, body: {} });
expect('an unknown write route is a 404', r.status === 404, r);
r = await req('DELETE', `/league/${lid}/claims/00000000-0000-0000-0000-000000000000`, { key: KT });
expect('DELETE a claim not in this league is a 404', r.status === 404, r);
r = await req('POST', `/league/${lid}/add`, { key: 'drip_sk_' + '0'.repeat(64), body: { roster_id: b, add: pool } });
expect('a well-formed but unknown key is a 401', r.status === 401, r);
r = await req('GET', `/league/${lid}`, { key: KT });
expect('a keyed GET of a read section still reads', r.status === 200 && r.headers.get('cache-control').startsWith('public'), r.status);
r = await req('DELETE', `/league/${lid}`);
expect('a non-GET to a read section without a key is a 404, not a write', r.status === 404, r);
r = await req('GET', `/league/${lid}/rosters`);
expect('anonymous reads unchanged', r.status !== 401 && r.status !== 403, r.status);
expect('the key never reaches the log', !sql(`select coalesce(string_agg(coalesce(error,''), ' '), '') from api_write_log`).includes(KT.slice(14)));
r = await req('GET', '/openapi.json');
expect('openapi lists reads and keyed writes together', r.status === 200 && r.body.paths['/league/{id}/standings']
  && r.body.paths['/league/{id}/add'].post && r.body.components.securitySchemes.key.scheme === 'bearer', Object.keys(r.body?.paths ?? {}));
console.log(fails ? `\n${fails} FAILED` : '\nALL WRITE-API E2E PASS');
process.exit(fails ? 1 : 0);
