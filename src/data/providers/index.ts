// League-provider registry. Screens/store reach platforms only through
// getProvider(id), so adding a provider is: implement LeagueProvider, register
// it here. Unimplemented providers are `undefined` until their adapter lands
// (see docs/multi-league-integration-research.md for the rollout plan).
import type { LeagueProvider, ProviderId } from './types';
import { sleeperProvider } from './sleeper';
import { espnProvider } from './espn';
import { fleaflickerProvider } from './fleaflicker';
import { mflProvider } from './mfl';

export const DEFAULT_PROVIDER_ID: ProviderId = 'sleeper';

const REGISTRY: Record<ProviderId, LeagueProvider | undefined> = {
  sleeper: sleeperProvider,
  espn: espnProvider,            // Phase B — unofficial v3 API via the espn-league proxy
  fleaflicker: fleaflickerProvider, // Phase C — public read API via the fantasy-proxy
  mfl: mflProvider,              // Phase C — documented export API via the fantasy-proxy
  yahoo: undefined,              // Phase D — official OAuth 2.0 API via proxy
};

/** Providers with a live adapter, in registration order. */
export const AVAILABLE_PROVIDERS: LeagueProvider[] = Object.values(REGISTRY).filter(
  (p): p is LeagueProvider => p != null,
);

/** Resolve a provider by id (defaults to Sleeper). Throws if not yet implemented. */
export function getProvider(id: ProviderId = DEFAULT_PROVIDER_ID): LeagueProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`League provider not available: ${id}`);
  return p;
}

export { espnAuth } from './espn';
export * from './types';
