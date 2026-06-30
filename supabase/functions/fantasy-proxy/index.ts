// Edge Function: fantasy-proxy
// A generic, anonymous CORS proxy for fantasy platforms whose read APIs don't
// send permissive CORS headers (Fleaflicker, MyFantasyLeague). The static bundle
// can't call them from the browser, so it POSTs a target URL here and we GET it
// server-side and relay the JSON.
//
// Safety: only HTTPS GETs to an explicit host allowlist are forwarded — this is
// not an open proxy. No credentials are held or attached (these are public read
// APIs). For ESPN (which needs per-user cookies) see the dedicated espn-league
// function instead.
//
// Deploy note: must allow anonymous invocation (no JWT) — set
// `verify_jwt = false` for it, since demo visitors aren't signed in.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Hosts this proxy is allowed to reach.
const ALLOW = new Set(['www.fleaflicker.com', 'api.myfantasyleague.com']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const target = String(body.url ?? '').trim();
    let u: URL;
    try { u = new URL(target); } catch { return json({ ok: false, error: 'A valid url is required.' }); }
    if (u.protocol !== 'https:') return json({ ok: false, error: 'https only.' });
    if (!ALLOW.has(u.hostname)) return json({ ok: false, error: `Host not allowed: ${u.hostname}` });

    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (drip-fantasy-proxy)', Accept: 'application/json' },
    });
    if (!r.ok) return json({ ok: false, error: `Upstream ${r.status}` }, 502);
    const data = await r.json().catch(() => null);
    if (data == null) return json({ ok: false, error: 'Upstream did not return JSON.' }, 502);
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
