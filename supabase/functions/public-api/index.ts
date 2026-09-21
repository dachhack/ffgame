// Edge Function: public-api — Drip's anonymous, read-only league API (0326).
//
// The whole of it is a ROUTER. Every response is assembled by one SQL function
// (api_* in migration 0326), so what the API exposes is a contract written in
// one file rather than an accident of which columns a query happened to
// select — and so the "never in it" list (sealed picks before they reveal,
// pending bids, offers in flight, emails, invite codes) is enforced where the
// data is, not here where it would be one forgotten `select *` from being
// wrong.
//
// Deploy note: must allow anonymous invocation — `verify_jwt = false`. It uses
// the SERVICE ROLE to call the api_* functions, which is safe precisely
// because those functions decide for themselves what an anonymous caller may
// see: each one returns null unless the league has opted in.
//
// Routes (after the function name, so both /functions/v1/public-api/v1/… and a
// rewritten /v1/… work):
//   GET /v1/health
//   GET /v1/openapi.json
//   GET /v1/league/{id}
//   GET /v1/league/{id}/teams | rosters | standings | draft | picks | players
//                             | transactions | trades | history | awards
//   GET /v1/league/{id}/matchups?week=N
//   GET /v1/league/{id}/lineups?week=N
//   GET /v1/league/{id}/transactions?after=&limit=

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/** How long a browser or a bot may reuse a response. Live things are short,
 *  settled things are long — a finished draft never changes again. */
const TTL: Record<string, number> = {
  health: 30, league: 60, teams: 300, rosters: 60, standings: 60,
  matchups: 30, lineups: 60, transactions: 60, trades: 120,
  draft: 60, picks: 300, players: 600, history: 900, awards: 300,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Call one SQL function as the service role. */
async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return await res.json();
}

const json = (body: unknown, status: number, ttl: number, etag?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=${ttl * 4}`,
      ...(etag ? { ETag: etag } : {}),
    },
  });

const fail = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status, 0);

/** A weak ETag over the body — enough for a poller to get a 304 and skip the
 *  payload, which is the difference between a tool checking every minute
 *  being free and being expensive. */
async function etagOf(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return `W/"${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}"`;
}

const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Drip Fantasy public API',
    version: '1.0.0',
    description:
      'Anonymous, read-only access to leagues that have opted in. No key, no auth, CORS open. ' +
      'A league that has not opted in returns 404, identical to one that does not exist. ' +
      'Never served: sealed picks before their window reveals, pending waiver claims and bids, ' +
      'trade offers in flight, email addresses, invite codes, chat.',
  },
  servers: [{ url: '/v1' }],
  paths: Object.fromEntries([
    ['/health', 'Service heartbeat.'],
    ['/league/{id}', 'League settings, scoring, rules, current week.'],
    ['/league/{id}/teams', 'The seats: team name, manager display name, avatar, division.'],
    ['/league/{id}/rosters', 'Every roster, with contracts in contract leagues.'],
    ['/league/{id}/standings', 'Records, points for and against, divisions.'],
    ['/league/{id}/matchups', 'Pairings and scores. ?week=N to narrow.'],
    ['/league/{id}/lineups', 'Starters (classic) and revealed picks (drip). ?week=N required.'],
    ['/league/{id}/transactions', 'The register, newest first. ?after= cursor, ?limit= up to 500.'],
    ['/league/{id}/trades', 'Completed trades, including multi-team legs and the league vote.'],
    ['/league/{id}/draft', 'Draft state and every pick made.'],
    ['/league/{id}/picks', 'Tradeable future pick assets and who owns them.'],
    ['/league/{id}/players', "The league's player pool with crosswalk ids."],
    ['/league/{id}/history', 'Champions, the record book, all-time manager lines.'],
    ['/league/{id}/awards', 'Award definitions, weekly winners, badges.'],
  ].map(([path, summary]) => [path, { get: { summary, responses: { 200: { description: 'OK' }, 404: { description: 'No such public league' }, 429: { description: 'Rate limited' } } } }])),
};

/** Which SQL function serves each league section, and how its query string
 *  becomes arguments. One table, so a route that is not here cannot exist. */
const SECTIONS: Record<string, (id: string, q: URLSearchParams) => [string, Record<string, unknown>]> = {
  '': (id) => ['api_league', { p_league_id: id }],
  teams: (id) => ['api_teams', { p_league_id: id }],
  rosters: (id) => ['api_rosters', { p_league_id: id }],
  standings: (id) => ['api_standings', { p_league_id: id }],
  matchups: (id, q) => ['api_matchups', { p_league_id: id, p_week: q.get('week') ? Number(q.get('week')) : null }],
  lineups: (id, q) => ['api_lineups', { p_league_id: id, p_week: q.get('week') ? Number(q.get('week')) : null }],
  transactions: (id, q) => ['api_transactions', {
    p_league_id: id,
    p_after: q.get('after') ? Number(q.get('after')) : null,
    p_limit: q.get('limit') ? Number(q.get('limit')) : 100,
  }],
  trades: (id, q) => ['api_trades', { p_league_id: id, p_limit: q.get('limit') ? Number(q.get('limit')) : 50 }],
  draft: (id) => ['api_draft', { p_league_id: id }],
  picks: (id) => ['api_picks', { p_league_id: id }],
  players: (id) => ['api_players', { p_league_id: id }],
  history: (id) => ['api_history', { p_league_id: id }],
  awards: (id) => ['api_awards', { p_league_id: id }],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return fail(405, 'method_not_allowed', 'This API is read-only — GET.');
  }
  const url = new URL(req.url);
  // Everything after the function name, so a rewrite to /v1/… works the same
  // as the raw /functions/v1/public-api/v1/… path.
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('public-api');
  const route = (at >= 0 ? parts.slice(at + 1) : parts);
  if (route[0] === 'v1') route.shift();

  if (route.length === 0 || route[0] === 'health') {
    try {
      return json(await rpc('api_health', {}), 200, TTL.health);
    } catch (e) {
      return fail(503, 'unavailable', String((e as Error).message));
    }
  }
  if (route[0] === 'openapi.json') return json(OPENAPI, 200, 3600);

  if (route[0] !== 'league' || !route[1]) {
    return fail(404, 'not_found', 'Try /v1/openapi.json for the routes.');
  }
  const id = route[1];
  if (!UUID.test(id)) return fail(404, 'not_found', 'No such public league.');
  const section = (route[2] ?? '').toLowerCase();
  const build = SECTIONS[section];
  if (!build) return fail(404, 'not_found', `Unknown section "${section}".`);

  // THE METER. One token per request, per caller IP, counted in the database
  // so that every instance of this function shares one bucket.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  try {
    const left = Number(await rpc('api_take_token', { p_ip: ip }));
    if (left < 0) {
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down — 600 requests a minute.' } }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '10' },
      });
    }
  } catch { /* the meter is a courtesy, not a gate: never fail a read over it */ }

  try {
    const [fn, args] = build(id, url.searchParams);
    const body = await rpc(fn, args);
    // A league that has not opted in, and a league that does not exist, are
    // the same answer — so this API cannot be used to test whether an id is
    // real.
    if (body === null || body === undefined) return fail(404, 'not_found', 'No such public league.');
    const etag = await etagOf(body);
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ...cors, ETag: etag } });
    }
    return json(body, 200, TTL[section || 'league'] ?? 60, etag);
  } catch (e) {
    return fail(502, 'upstream', String((e as Error).message));
  }
});
