// Edge Function: dispatch-sim
// Lets an ADMIN kick off the real server-driven live feed sim from inside the
// app (the static Pages bundle can't hold a GitHub token, so this server-side
// function does). Flow:
//   admin clicks "▶ play live" → supabase.functions.invoke('dispatch-sim')
//   → we verify is_admin() with the caller's JWT
//   → we POST a workflow_dispatch to the simulate.yml GitHub Action
//   → the Action drives live_play → matchup_state, the board animates.
//
// Secrets (set once with `supabase secrets set …`, see README.md):
//   GH_TOKEN     fine-grained PAT with Actions: read+write on the repo
//   GH_REPO      "owner/repo"   (default: dachhack/ffgame)
//   GH_REF       branch to run the workflow on (default: main — must hold simulate.yml)
//   GH_WORKFLOW  workflow file name (default: simulate.yml)
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ ok: false, error: 'Not signed in.' });

    // Verify the caller is an admin, using THEIR JWT (not the service role).
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: isAdmin, error: adminErr } = await supa.rpc('is_admin');
    if (adminErr) return json({ ok: false, error: adminErr.message });
    if (!isAdmin) return json({ ok: false, error: 'Admins only.' });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const mode = String(body.mode ?? 'live');
    if (!['live', 'reset', 'check', 'dry'].includes(mode)) return json({ ok: false, error: `bad mode ${mode}` });
    if ((mode === 'live' || mode === 'reset' || mode === 'check') && !body.league)
      return json({ ok: false, error: `${mode} mode needs a league id` });

    // GitHub workflow_dispatch inputs must all be strings.
    const inputs: Record<string, string> = {
      mode,
      league: String(body.league ?? ''),
      week: String(body.week ?? '1'),
      src: String(body.src ?? ''),
      speed: String(body.speed ?? '600'),
      jitter: String(body.jitter ?? '0'),
      corrections: String(body.corrections ?? '0'),
    };

    const token = Deno.env.get('GH_TOKEN');
    if (!token) return json({ ok: false, error: 'Server not configured: GH_TOKEN secret is missing.' });
    const repo = Deno.env.get('GH_REPO') ?? 'dachhack/ffgame';
    const ref = Deno.env.get('GH_REF') ?? 'main';
    const workflow = Deno.env.get('GH_WORKFLOW') ?? 'simulate.yml';

    const ghRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'drip-dispatch-sim',
        },
        body: JSON.stringify({ ref, inputs }),
      },
    );
    if (!ghRes.ok) {
      const txt = await ghRes.text();
      return json({ ok: false, error: `GitHub ${ghRes.status}: ${txt.slice(0, 300)}` });
    }
    // 204 No Content on success.
    return json({ ok: true, mode, ref, repo });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
