// Edge Function: yahoo-oauth
// Yahoo Fantasy is the one provider with an OFFICIAL API — but it requires OAuth
// 2.0, whose client secret and token exchange must live server-side. This
// function holds the app credentials and does three things for the browser:
//   action 'exchange' { code, redirectUri }      → first token from an auth code
//   action 'refresh'  { refreshToken }           → a fresh access token
//   action 'get'      { accessToken, path }      → GET the Yahoo Fantasy API
// The browser keeps the (long-lived) refresh_token and asks for a new access
// token when needed; the secret never leaves the server.
//
// Secrets (supabase secrets set …):
//   YAHOO_CLIENT_ID      the app's Consumer Key
//   YAHOO_CLIENT_SECRET  the app's Consumer Secret
// Register an app at https://developer.yahoo.com/apps/ with Fantasy Sports
// read permission and a redirect URI that matches the site origin.
//
// Deploy note: allow anonymous invocation (verify_jwt = false).
// Attribution: products using this data must show "Fantasy data provided by
// Yahoo" with a link back to Yahoo Fantasy (Yahoo API terms).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const id = Deno.env.get('YAHOO_CLIENT_ID');
  const secret = Deno.env.get('YAHOO_CLIENT_SECRET');
  if (!id || !secret) return json({ ok: false, error: 'Server not configured: YAHOO_CLIENT_ID/SECRET missing.' });
  const basic = btoa(`${id}:${secret}`);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? '');

    if (action === 'exchange' || action === 'refresh') {
      const form = new URLSearchParams(
        action === 'exchange'
          ? { grant_type: 'authorization_code', redirect_uri: String(body.redirectUri ?? ''), code: String(body.code ?? '') }
          : { grant_type: 'refresh_token', refresh_token: String(body.refreshToken ?? '') },
      );
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const tok = await r.json().catch(() => null);
      if (!r.ok || !tok?.access_token) return json({ ok: false, error: tok?.error_description || `Yahoo token ${r.status}` });
      return json({ ok: true, accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresIn: tok.expires_in });
    }

    if (action === 'get') {
      const accessToken = String(body.accessToken ?? '');
      const path = String(body.path ?? '').replace(/^\/+/, '');
      if (!accessToken || !path) return json({ ok: false, error: 'accessToken and path are required.' });
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch(`${API}/${path}${sep}format=json`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (r.status === 401) return json({ ok: false, error: 'unauthorized', code: 401 });
      if (!r.ok) return json({ ok: false, error: `Yahoo ${r.status}` }, 502);
      return json({ ok: true, data: await r.json() });
    }

    return json({ ok: false, error: `Unknown action: ${action}` });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
