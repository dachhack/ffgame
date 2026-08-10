// The platform-agnostic league shape that sits between a provider's native API
// and the engine builder. Each provider fetches its own payloads and maps them
// into a NormalizedLeague; `buildFromNormalized` (buildLeague.ts) turns that into
// a playable engine League — so the build/crosswalk/synth logic is written once
// and every provider reuses it. See docs/multi-league-integration-research.md §5.
import type { Pos } from '../types';

/** A rostered player, provider-native id plus whatever cross-ids we can supply
 *  so the builder can crosswalk to baked play-by-play. Sleeper sets `sleeperId`;
 *  ESPN sets `espnId` (and `sleeperId` too when the directory join finds it). */
export interface NormPlayer {
  key: string;          // provider-native player id (unique within the league payload)
  full: string;
  pos: Pos;
  nflTeam: string | null;
  sleeperId?: string;   // crosswalk hint — Sleeper id (the baked-slug hub)
  espnId?: string;      // crosswalk hint — ESPN athlete id (for headshots + slugs)
}

export interface NormTeam {
  rosterId: number;
  teamName: string;
  owner: string;
  ownerId: string;
  wins: number; losses: number; ties: number;
  pf: number; pa: number;
  playerKeys: string[]; // keys into NormalizedLeague.players
}

export interface NormMatchup {
  rosterId: number;
  matchupId: number | null;         // pairs the two sides of a head-to-head
  points: number;                   // team total that week
  playerPoints: Record<string, number>; // playerKey → that week's fantasy points
}

export interface NormalizedLeague {
  id: string;
  name: string;
  season: number;
  format: string;       // "Dynasty · Superflex · 10-team"
  weeks: number;        // regular-season weeks to build (capped at the baked slate)
  youUserId: string;    // ownerId of YOU (marks youTeamId); '' when unknown
  /** Synthetic engine-id prefix for players with no baked PBP (e.g. 'sl', 'espn'). */
  synthPrefix: string;
  players: Record<string, NormPlayer>;  // every key referenced by teams/matchups
  teams: NormTeam[];                    // in native roster order (drives YOU default)
  matchupsByWeek: NormMatchup[][];      // length === weeks
}
