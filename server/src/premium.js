// Premium entitlement resolution for the worker (docs/premium-model.md, migration 0036).
//
// `matchupPremium(id)` is the server-authoritative answer to "is this matchup premium?",
// reading the entitlement OR-rule (personal/league/spillover) minus the commish opt-out via
// the matchup_premium() SQL function. Both sides get the full feature set when true — so a
// premium matchup is always SYMMETRIC and premium is never pay-to-win (the playtester's
// r≈0.96 cancellation), only a richer experience.
//
// Free vs premium CONTENT split (tunable product config). Premium adds K/DST/IDP + the full
// power-up set + special events; the free tier is a complete, balanced game on its own (the
// playtester measured skill-only at a fair 50.7% home win-rate).
import { db } from './supabase.js';

// Defaults / fallback. The live values are edited from the super-admin control panel and
// stored in the premium_tier table (migration 0037); premiumTier() reads them (cached).
export const FREE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
// A limited but genuinely useful starter set — the live tactical swaps + one EV amplifier
// (momentum is a proven win, §playtester). Everything else (defensive/counter buffs, the
// metric unlocks, extra-slot, events) is premium. Tune freely from the admin panel.
export const FREE_POWERUPS = ['metric-swap', 'player-swap', 'momentum'];

// Cached read of the admin-edited free tier (60s TTL; falls back to the constants above).
let _tier = null, _tierAt = 0;
const TIER_TTL_MS = 60_000;
export async function premiumTier() {
  if (_tier && Date.now() - _tierAt < TIER_TTL_MS) return _tier;
  try {
    const { data, error } = await db().rpc('get_premium_tier');
    if (!error && data) { _tier = { positions: data.free_positions ?? FREE_POSITIONS, powerups: data.free_powerups ?? FREE_POWERUPS }; _tierAt = Date.now(); }
  } catch (e) { console.error('[premium] tier', e?.message ?? e); }
  return _tier ?? { positions: FREE_POSITIONS, powerups: FREE_POWERUPS };
}

/** Is this matchup premium? Fail CLOSED (basic) on error so a hiccup never hands out premium. */
export async function matchupPremium(matchupId) {
  try {
    const { data, error } = await db().rpc('matchup_premium', { m_id: matchupId });
    if (error) { console.error('[premium] matchup_premium', error?.message ?? error); return false; }
    return !!data;
  } catch (e) { console.error('[premium] matchup_premium', e?.message ?? e); return false; }
}

/** Grant helpers — call from the Stripe webhook handler (service role), never the client. */
export const grantPersonal = (uid, season, ref) => db().rpc('grant_personal', { p_uid: uid, p_season: season, p_source: 'stripe', p_ref: ref });
export const grantLeague = (leagueId, season, ref) => db().rpc('grant_league', { p_league: leagueId, p_season: season, p_source: 'stripe', p_ref: ref });
export const contributeToPool = (leagueId, season, uid, cents, ref) => db().rpc('contribute_to_pool', { p_league: leagueId, p_season: season, p_uid: uid, p_cents: cents, p_ref: ref });

// ── Content gating (apply when premium === false) ────────────────────────────
/** Drop free-tier-ineligible positions when not premium. Pass the admin tier's `positions`
 *  (from premiumTier()) or omit to use the default constants. posOf(slug) → 'QB'|'RB'|… */
export function gateFreePositions(slugs, premium, posOf, freePositions = FREE_POSITIONS) {
  if (premium) return slugs;
  return (slugs ?? []).filter((s) => freePositions.includes(posOf(s)));
}
/** Keep only free-tier power-ups when not premium. Pass the admin tier's `powerups` or omit. */
export function gateFreePowerups(ids, premium, freePowerups = FREE_POWERUPS) {
  if (premium) return ids;
  return (ids ?? []).filter((id) => freePowerups.includes(id));
}

// ── INTEGRATION SEAMS (where to call the above when the gating ships) ────────
// 1. server/src/lock.js materializeAutoLineups / aiBudgetPass:
//    const premium = await matchupPremium(m.id);
//    starters → gateFreePositions(slugs, premium, posOf); desired buffs → gateFreePowerups(...).
// 2. server/src/resolve.js resolveMatchup: gate revealed sealed picks + applied_state buffs by
//    matchupPremium(matchup.id) before handing them to resolveLiveMatchup, so a non-premium
//    matchup can't score K/DST/IDP or a premium power-up even if a pick row exists.
// 3. Client (src/screens/LivePicks.tsx + the shop): read matchup_premium() to show locked
//    positions/power-ups + the upgrade CTA, and fire Ev.gatedFeatureAttempted on a locked tap.
// 4. Stripe webhook (new): on payment_succeeded → grantPersonal / grantLeague / contributeToPool.
