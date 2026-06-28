// Edge Function: stripe-webhook
// Stripe → entitlement. On a completed Checkout Session it reads the metadata the
// checkout function set and calls the matching grant RPC with the SERVICE ROLE.
//
// DEPLOY WITH `--no-verify-jwt` — the auth here is the Stripe SIGNATURE, not a Supabase
// JWT. Point a Stripe webhook endpoint at this function's URL for the
// `checkout.session.completed` event.
//
// Secrets (supabase secrets set …): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
  const sig = req.headers.get('stripe-signature') ?? '';
  const raw = await req.text(); // RAW body required for signature verification

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (e) {
    return new Response(`bad signature: ${e instanceof Error ? e.message : e}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const m = (s.metadata ?? {}) as Record<string, string>;
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    try {
      if (m.kind === 'personal') {
        await svc.rpc('grant_personal', { p_uid: m.app_user_id, p_season: m.season, p_source: 'stripe', p_ref: s.id });
      } else if (m.kind === 'league') {
        await svc.rpc('grant_league', { p_league: m.league_id, p_season: m.season, p_source: 'stripe', p_ref: s.id });
      } else if (m.kind === 'split') {
        await svc.rpc('contribute_to_pool', { p_league: m.league_id, p_season: m.season, p_uid: m.app_user_id, p_cents: Number(m.amount_cents), p_ref: s.id });
      }
    } catch (e) {
      console.error('[stripe-webhook] grant failed', e); // 500 → Stripe retries (RPCs are idempotent)
      return new Response('grant failed', { status: 500 });
    }
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
