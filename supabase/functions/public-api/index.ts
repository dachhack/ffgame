// Edge Function: public-api — Drip's league API: anonymous reads (0326), and
// since 0352 keyed WRITES for leagues whose commissioner opted in.
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
//
// KEYED (0352) — `Authorization: Bearer drip_sk_…`, a key a manager mints for
// one league once its commissioner has switched the write API on. Every one
// of these ends in `api_write`, the single SQL door that checks the key, acts
// as its owner, and whitelists the action (see writeRoute below):
//   GET    /v1/me                               who this key is, and your team
//   GET    /v1/league/{id}/me
//   GET    /v1/league/{id}/lineup?roster_id=&week=
//   PUT    /v1/league/{id}/lineup               {roster_id, week, picks:[…]}
//   POST   /v1/league/{id}/add | drop | claims | roster-spot | trades
//   DELETE /v1/league/{id}/claims/{claim_id}
//   POST   /v1/league/{id}/trades/{id}/accept | decline | cancel
//   POST   /v1/league/{id}/trades/{id}/approve | veto          (league scope)
//   POST   /v1/league/{id}/waivers/process                     (league scope)
//   POST   /v1/league/{id}/players/{slug}/move | remove        (league scope)
//   PUT    /v1/league/{id}/waiver-priority                     (league scope)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Open to every origin, writes included: a key is a bearer secret sent in a
// header, never a cookie, so a page that does not hold one cannot borrow it.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

/** A keyed answer: never cached anywhere, by anyone. */
const keyed = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Method + path (after /v1) → the api_write action and the arguments the
 *  path itself supplies. The body supplies the rest; the path wins where both
 *  say something, so a URL cannot be contradicted by its own payload. One
 *  table, like SECTIONS: a route that is not here cannot exist. */
type Route = [string, Record<string, unknown>];
function writeRoute(method: string, r: string[]): Route | null {
  const m = method === 'HEAD' ? 'GET' : method;
  if (r[0] === 'me' && r.length === 1 && m === 'GET') return ['me', {}];
  if (r[0] !== 'league' || !r[1]) return null;
  const league_id = r[1];
  const [a, b, c] = [r[2] ?? '', r[3], r[4]];
  const at = (action: string, extra: Record<string, unknown> = {}): Route => [action, { league_id, ...extra }];
  if (a === 'me' && !b && m === 'GET') return at('me');
  if (a === 'lineup' && !b && m === 'GET') return at('lineup');
  if (a === 'lineup' && !b && (m === 'PUT' || m === 'POST')) return at('set_lineup');
  if (m === 'POST' && !b && a === 'add') return at('add');
  if (m === 'POST' && !b && a === 'drop') return at('drop');
  if (m === 'POST' && !b && a === 'claims') return at('claim');
  if (m === 'DELETE' && a === 'claims' && b && !c) return at('cancel_claim', { claim_id: b });
  if (m === 'POST' && !b && a === 'roster-spot') return at('roster_spot');
  if (m === 'POST' && !b && a === 'trades') return at('propose_trade');
  if (m === 'POST' && a === 'trades' && b && c) {
    const verbs: Record<string, Route> = {
      accept: at('respond_trade', { trade_id: b, accept: true }),
      decline: at('respond_trade', { trade_id: b, accept: false }),
      cancel: at('cancel_trade', { trade_id: b }),
      approve: at('rule_trade', { trade_id: b, approve: true }),
      veto: at('rule_trade', { trade_id: b, approve: false }),
    };
    return verbs[c] ?? null;
  }
  if (m === 'POST' && a === 'waivers' && b === 'process' && !c) return at('process_waivers');
  if (m === 'POST' && a === 'players' && b && c === 'move') return at('move_player', { player: b });
  if (m === 'POST' && a === 'players' && b && c === 'remove') return at('remove_player', { player: b });
  if (m === 'PUT' && a === 'waiver-priority' && !b) return at('set_waiver_priority');
  return null;
}

/** The query string as arguments, for the keyed GETs. Numbers stay numbers. */
function queryArgs(q: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of q) out[k] = /^-?\d+$/.test(v) ? Number(v) : v;
  return out;
}

async function handleKeyed(req: Request, route: string[], url: URL): Promise<Response | null> {
  const hit = writeRoute(req.method, route);
  const auth = req.headers.get('authorization') ?? '';
  const key = /^Bearer\s+(drip_sk_[0-9a-f]{64})\s*$/i.exec(auth)?.[1] ?? null;
  if (!hit) {
    // Not a keyed route. A GET falls through to the read API — a tool that
    // sends its key on every request still reads /rosters like anybody else.
    // Anything else names a write that does not exist.
    return req.method === 'GET' || req.method === 'HEAD'
      ? null : fail(404, 'not_found', 'No such route. See /v1/openapi.json.');
  }
  if (!key) {
    return keyed({ error: { code: 'unauthorized', message: 'Send Authorization: Bearer drip_sk_… — a key from your league\'s API settings.' } }, 401);
  }
  // THE METER, per key rather than per IP: a busy tool behind one address
  // should not starve another, and one key should not outrun its league.
  // A minute's worth of burst, one a second sustained.
  try {
    const left = Number(await rpc('api_take_token', { p_ip: `key:${key.slice(0, 14)}`, p_rate: 1, p_burst: 60 }));
    if (left < 0) {
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down — 60 writes a minute per key.' } }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '5', 'Cache-Control': 'no-store' },
      });
    }
  } catch { /* the meter is a courtesy, not a gate */ }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    const text = await req.text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        body = parsed as Record<string, unknown>;
      } catch {
        return keyed({ error: { code: 'bad_request', message: 'The body must be a JSON object.' } }, 400);
      }
    }
  }
  const [action, fromPath] = hit;
  const args = { ...queryArgs(url.searchParams), ...body, ...fromPath };
  try {
    const r = await rpc('api_write', { p_key: key, p_action: action, p_args: args }) as Record<string, unknown>;
    const status = Number(r?.status ?? (r?.ok ? 200 : 422));
    const { status: _status, ...rest } = r ?? {};
    if (r?.ok) return keyed(rest, 200);
    return keyed({ ...rest, error: { code: codeFor(status), message: String(r?.error ?? 'refused') } }, status);
  } catch (e) {
    return keyed({ error: { code: 'upstream', message: String((e as Error).message) } }, 502);
  }
}

const codeFor = (status: number) => ({
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  409: 'conflict', 422: 'refused',
} as Record<number, string>)[status] ?? 'error';

/** A weak ETag over the body — enough for a poller to get a 304 and skip the
 *  payload, which is the difference between a tool checking every minute
 *  being free and being expensive. */
async function etagOf(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return `W/"${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}"`;
}

const OPENAPI: { openapi: string; info: { title: string; version: string; description: string }; servers: unknown[]; paths: Record<string, unknown> } = {
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

// THE KEYED ROUTES (0352), appended to the same document so a tool author
// finds reads and writes in one place. Merged path by path: /league/{id}/me
// and /lineup exist only here; nothing below collides with a read section.
const KEYED_RESPONSES = {
  200: { description: 'Done' }, 400: { description: 'Malformed request' },
  401: { description: 'Missing, unknown or revoked key' },
  403: { description: 'Write API off, wrong league, wrong seat, or needs a league-scope key' },
  404: { description: 'No such claim, trade or route in this league' },
  409: { description: 'A league rule refused it mid-write (a kickoff lock, an illegal roster) — nothing changed' },
  422: { description: "The league said no — the message is the league's own" },
  429: { description: 'Rate limited: 60 writes a minute per key' },
};
const op = (summary: string, body?: string) => ({
  summary, security: [{ key: [] }], responses: KEYED_RESPONSES,
  ...(body ? { requestBody: { content: { 'application/json': { example: JSON.parse(body) } } } } : {}),
});
const KEYED_PATHS: Record<string, Record<string, unknown>> = {
  '/me': { get: op('Who this key is: its league, scope and seats, and your team state.') },
  '/league/{id}/me': { get: op('The same, pinned to the league in the path.') },
  '/league/{id}/lineup': {
    get: op('Your saved lineup for a week, locked picks included. ?roster_id=&week='),
    put: op('Set a lineup. Replaces the unlocked picks in each window you name.',
      '{"roster_id":3,"week":4,"picks":[{"game_window":"wk","roster_slot":"QB","player_slug":"josh-allen"}]}'),
  },
  '/league/{id}/add': { post: op('Add a free agent, optionally dropping someone.', '{"roster_id":3,"add":"jaylen-warren","drop":"zamir-white"}') },
  '/league/{id}/drop': { post: op('Drop a player.', '{"roster_id":3,"player":"zamir-white"}') },
  '/league/{id}/claims': { post: op('File a waiver claim; bid in a FAAB league.', '{"roster_id":3,"add":"jaylen-warren","drop":"zamir-white","bid":12}') },
  '/league/{id}/claims/{claim_id}': { delete: op('Cancel one of your pending claims.') },
  '/league/{id}/roster-spot': { post: op('Move one of your players between active, IR, OUT and the taxi squad.', '{"player":"nick-chubb","spot":"ir"}') },
  '/league/{id}/trades': { post: op('Propose a trade.', '{"roster_id":3,"to_roster":5,"give":["jaylen-warren"],"get":["rome-odunze"],"note":"?"}') },
  '/league/{id}/trades/{trade_id}/accept': { post: op('Accept an offer made to you.') },
  '/league/{id}/trades/{trade_id}/decline': { post: op('Decline an offer made to you.') },
  '/league/{id}/trades/{trade_id}/cancel': { post: op('Withdraw your own offer.') },
  '/league/{id}/trades/{trade_id}/approve': { post: op('Commissioner (league scope): approve a trade under review.') },
  '/league/{id}/trades/{trade_id}/veto': { post: op('Commissioner (league scope): veto a trade under review.') },
  '/league/{id}/waivers/process': { post: op('Commissioner (league scope): run the waiver claims that are due.') },
  '/league/{id}/players/{slug}/move': { post: op('Commissioner (league scope): move a player to another team.', '{"to_roster":5}') },
  '/league/{id}/players/{slug}/remove': { post: op('Commissioner (league scope): take a player off his roster.', '{"waive":true}') },
  '/league/{id}/waiver-priority': { put: op('Commissioner (league scope): set the waiver order.', '{"order":[4,1,6,2,5,3]}') },
};
Object.assign(OPENAPI.paths as Record<string, unknown>, KEYED_PATHS);
(OPENAPI as Record<string, unknown>).components = {
  securitySchemes: { key: { type: 'http', scheme: 'bearer', description: 'drip_sk_… — made under 🔑 API keys in a league whose commissioner switched the write API on.' } },
};
OPENAPI.info.description += ' Writes (0352): send Authorization: Bearer drip_sk_…, a key a manager makes for one league ' +
  'once its commissioner opts in. A key acts as its owner with exactly their powers; team scope reaches only their own seats.';

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
  const url = new URL(req.url);
  // Everything after the function name, so a rewrite to /v1/… works the same
  // as the raw /functions/v1/public-api/v1/… path.
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('public-api');
  const route = (at >= 0 ? parts.slice(at + 1) : parts);
  if (route[0] === 'v1') route.shift();

  // Keyed routes first (0352). Null means "not a keyed request" and the read
  // API below answers it exactly as it always has.
  const keyedAnswer = await handleKeyed(req, route, url);
  if (keyedAnswer) return keyedAnswer;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return fail(405, 'method_not_allowed', 'Reads are GET. Writes need a key — see /v1/openapi.json.');
  }

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
