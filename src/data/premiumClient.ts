// Client-side premium tier (the free/premium split the super admin sets, migration 0037)
// + the upgrade-INTENT signal. The SERVER is authoritative (gating runs in the worker);
// this is for UX and for measuring demand. Fail-OPEN: if the tier isn't loaded we treat
// everything as free, so we never show a false lock — the server still enforces.
import { getPremiumTier } from './liveApi';
import { track, Ev } from '../app/analytics';

let tier: { positions: string[]; powerups: string[] } | null = null;
let loading: Promise<void> | null = null;

/** Load the free/premium tier once (cached). Safe to call when signed-out — it just
 *  stays null (fail-open) if there's no session / DB. */
export function ensurePremiumTier(): Promise<void> {
  if (tier) return Promise.resolve();
  if (!loading) {
    loading = getPremiumTier()
      .then((t) => { tier = { positions: t.free_positions ?? [], powerups: t.free_powerups ?? [] }; })
      .catch(() => { /* signed-out / no DB — stay fail-open */ })
      .finally(() => { loading = null; });
  }
  return loading;
}

export function isFreePowerup(id: string): boolean { return !tier || tier.powerups.includes(id); }
export function isFreePosition(pos: string): boolean { return !tier || tier.positions.includes(pos); }

const seen = new Set<string>();
/** The leading conversion indicator: someone reached for a premium feature. Fired once
 *  per feature per session so it counts intent, not taps. */
export function markGatedAttempt(feature: string): void {
  if (seen.has(feature)) return;
  seen.add(feature);
  track(Ev.gatedFeatureAttempted, { feature });
}
