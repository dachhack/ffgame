// Edge Function: stripe-checkout
// Creates a Stripe Checkout Session for a premium purchase, initiated by a signed-in user.
// The season is derived from the league server-side (the caller's JWT must be able to read
// it — RLS), so the client only passes the league id. The webhook (stripe-webhook) grants
// the entitlement on payment.
//
//   Body: { kind: 'personal' | 'league' | 'split', leagueId: string, amountCents?: number }
//     personal → $5, premium for this user across all their leagues this season
//     league   → $30, premium matchups for the whole league this season
//     split    → a contribution (amountCents) toward the league's $30 unlock pool
//
// Secrets (supabase secrets set …): STRIPE_SECRET_KEY, APP_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PRICES: Record<string, number> = { personal: 500, league: 3000 }; // cents

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ error: 'Not signed in.' }, 401);
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: 'Not signed in.' }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const kind = String(body.kind ?? '');
    const leagueId = String(body.leagueId ?? '');
    if (!['personal', 'league', 'split'].includes(kind)) return json({ error: 'bad kind' }, 400);
    if (!leagueId) return json({ error: 'leagueId required' }, 400);

    // Season from the league (RLS: the caller must be a member to read it).
    const { data: lg } = await supa.from('league').select('season,name').eq('id', leagueId).maybeSingle();
    if (!lg) return json({ error: 'league not found' }, 404);

    const amount = kind === 'split' ? Math.max(100, Math.round(Number(body.amountCents) || 0)) : PRICES[kind];
    const name = kind === 'personal' ? 'Drip Premium — personal (all your leagues)'
      : kind === 'league' ? `Drip Premium — league unlock${lg.name ? ` · ${lg.name}` : ''}`
        : 'Drip Premium — league unlock contribution';

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
    const appUrl = Deno.env.get('APP_URL') ?? 'https://dripfantasy.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', unit_amount: amount, product_data: { name } }, quantity: 1 }],
      success_url: `${appUrl}/?premium=success`,
      cancel_url: `${appUrl}/?premium=cancel`,
      client_reference_id: user.id,
      // The webhook reads this to grant the right entitlement.
      metadata: { kind, app_user_id: user.id, league_id: leagueId, season: lg.season, amount_cents: String(amount) },
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
