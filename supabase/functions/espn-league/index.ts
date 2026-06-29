// Edge Function: espn-league
// A thin, anonymous CORS proxy for ESPN's (unofficial) Fantasy v3 read API. The
// static bundle can't call ESPN directly — ESPN sends no CORS headers, and
// PRIVATE leagues require the user's `espn_s2` + `SWID` cookies, which a browser
// can't attach cross-site. This function forwards the request server-side with
// those cookies and relays the JSON back.
//
// It holds NO secrets of its own: the cookies are the *caller's* own ESPN
// session, passed per-request and used only to read their own league. Public
// leagues work with no cookies at all.
//
// Flow:
//   client → supabase.functions.invoke('espn-league', { body })
//   → fetch lm-api-reads.fantasy.espn.com with the views (+ optional per-week
//     boxscores) → return { league, weeks } as raw ESPN JSON.
//
// Deploy note: this function must allow anonymous invocation (no JWT) — set
// `verify_jwt = false` for it (supabase/config.toml or the dashboard), since
// demo visitors importing an ESPN league are not signed in.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
const DEFAULT_VIEWS = ['mTeam', 'mRoster', 'mMatchup', 'mSettings'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const leagueId = String(body.leagueId ?? '').trim();
    const season = String(body.season ?? '2025').trim();
    const swid = String(body.swid ?? '').trim();
    const s2 = String(body.s2 ?? '').trim();
    const views: string[] = Array.isArray(body.views) && body.views.length ? body.views.map(String) : DEFAULT_VIEWS;
    // Weeks to pull per-player boxscores for (drives non-baked players' texture).
    const weeks: number[] = Array.isArray(body.weeks) ? body.weeks.map((n: unknown) => Number(n)).filter((n) => n > 0 && n <= 18) : [];

    if (!leagueId || !/^\d+$/.test(leagueId)) return json({ ok: false, error: 'A numeric ESPN league id is required.' });
    if (!/^\d{4}$/.test(season)) return json({ ok: false, error: 'A 4-digit season is required.' });

    const headers: Record<string, string> = { 'User-Agent': 'drip-espn-league', Accept: 'application/json' };
    // Only attach cookies for private leagues; public leagues read without them.
    if (swid && s2) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;

    const base = `${HOST}/${season}/segments/0/leagues/${leagueId}`;
    const fetchJson = async (url: string) => {
      const r = await fetch(url, { headers });
      if (r.status === 401) throw new Error('ESPN rejected the credentials (401). For a private league, re-copy espn_s2 and SWID.');
      if (r.status === 404) throw new Error('ESPN returned 404 — check the league id and season.');
      if (!r.ok) throw new Error(`ESPN ${r.status}`);
      return r.json();
    };

    const qs = views.map((v) => `view=${encodeURIComponent(v)}`).join('&');
    const league = await fetchJson(`${base}?${qs}`);

    // Per-week boxscores (best-effort: a failed week just omits its texture).
    const weekData: Record<string, unknown> = {};
    await Promise.all(
      weeks.map(async (w) => {
        try { weekData[w] = await fetchJson(`${base}?view=mBoxscore&scoringPeriodId=${w}`); }
        catch { /* skip this week */ }
      }),
    );

    return json({ ok: true, league, weeks: weekData });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
