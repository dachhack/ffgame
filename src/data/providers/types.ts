// The provider seam: one interface every fantasy platform implements so the
// engine, store and screens stay platform-agnostic. Sleeper is the only live
// provider today (src/data/providers/sleeper.ts); ESPN/Yahoo/Fleaflicker/MFL
// slot in behind the same interface — see docs/multi-league-integration-research.md.
import type { BuiltLeague } from '../league';

export type ProviderId = 'sleeper' | 'espn' | 'yahoo' | 'fleaflicker' | 'mfl';

/** How a user connects to a provider — drives the connect UX (and whether a
 *  server proxy is needed to hold the credential). Sleeper is `handle` (public
 *  username, no secret); the others need `cookie` (ESPN/MFL private) or `oauth`. */
export type AuthKind = 'none' | 'handle' | 'cookie' | 'oauth';

/** Opaque per-user credentials a non-client-side provider needs (ESPN cookies,
 *  Yahoo OAuth token, MFL key). Empty/omitted for Sleeper. The app never reads
 *  these — they're forwarded to the provider's proxy. */
export type ProviderAuth = Record<string, string>;

/** A connected account, tagged with the provider that resolved it. Superset of
 *  the legacy Sleeper user shape (adds `provider`) so it drops in unchanged. */
export interface ProviderUser {
  provider: ProviderId;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface ProviderLeague {
  provider: ProviderId;
  leagueId: string;
  name: string;
  totalRosters: number;
  status: string;
  avatar: string | null;
  format: string;   // e.g. "Dynasty · Superflex"
  scoring: string;  // "PPR" | "Half-PPR" | "Standard"
  starters: number; // starting-lineup size
}

export interface ProviderStanding {
  rosterId: number;
  teamName: string;
  owner: string;
  avatar: string | null;
  wins: number; losses: number; ties: number;
  pf: number; pa: number; playerCount: number;
}

export interface BuildOptions {
  /** Give teams missing one a baked K/DST so those metrics stay playable. */
  addKdst?: boolean;
  /** Per-user credentials for providers that require them (ignored by Sleeper). */
  auth?: ProviderAuth;
}

export interface LeagueProvider {
  id: ProviderId;
  /** Human label, e.g. "Sleeper". */
  label: string;
  /** Runs entirely in the browser (no proxy/secret). Sleeper only, today. */
  clientSide: boolean;
  /** How users connect — drives the connect UX. */
  auth: AuthKind;

  /** Resolve an avatar id/handle to a displayable URL (null when absent). */
  avatarUrl(id: string | null): string | null;
  /** Resolve a connect handle (Sleeper username) to an account, or null. */
  resolveUser(handle: string, auth?: ProviderAuth): Promise<ProviderUser | null>;
  /** A user's leagues for a season. */
  getLeagues(user: ProviderUser, season?: string, auth?: ProviderAuth): Promise<ProviderLeague[]>;
  /** A league's standings (team/record/points). */
  getStandings(leagueId: string, auth?: ProviderAuth): Promise<{ name: string; standings: ProviderStanding[] }>;
  /** Build a fully-playable engine league + the caller's own team id. */
  buildLeague(
    leagueId: string,
    userId: string,
    onProgress?: (note: string) => void,
    opts?: BuildOptions,
  ): Promise<{ built: BuiltLeague; youTeamId: string }>;
}
