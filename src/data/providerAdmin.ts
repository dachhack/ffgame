// Live-pilot import/sync for NON-Sleeper platforms, built on the provider-agnostic
// NormalizedLeague (the same shape the demo builder consumes). Every provider maps
// its native API into a NormalizedLeague, which already carries teams, per-week
// matchup pairings, and player pools — so this one client-side path persists any
// platform's league via the existing admin writer RPCs. Live scoring always comes
// from the ESPN play feed regardless of the host platform.
//
// Sleeper keeps its own optimized path (sleeperAdmin.ts, uses the 5MB directory).
// Non-Sleeper leagues use a namespaced key ("espn-<id>") so ids never collide.
import { normName } from './players';
import {
  adminUpsertLeague, adminUpsertMemberships, adminUpsertMatchups, adminUpsertLineups,
  type MemberRow, type MatchupRow, type LineupRow,
} from './liveApi';
import { espnNormalize } from './espn';
import type { NormalizedLeague, NormPlayer } from './normalized';

// Slug a normalized player onto the play-by-play key space (matches the ESPN
// adapter: `${team}-dst` / `${team}-k`, else normName-hyphenated).
function poolSlug(p: NormPlayer): string {
  const t = (p.nflTeam ?? '').toLowerCase();
  if (p.pos === 'DEF') return `${t}-dst`;
  if (p.pos === 'K') return `${t}-k`;
  return normName(p.full).replace(/\s+/g, '-');
}

// Namespaced league key so a non-Sleeper league id can't collide with a Sleeper one.
export const providerKey = (provider: string, ref: string) => `${provider}-${ref}`;
export const stripProvider = (key: string) => key.replace(/^[a-z]+-/, '');

/** Persist a NormalizedLeague as a provider-tagged live league (structure only —
 *  enrollment is admin-mapped, since non-Sleeper platforms have no public user id). */
async function persistLeague(provider: string, ref: string, season: string, norm: NormalizedLeague): Promise<{ leagueId: string; rosters: number }> {
  const res = await adminUpsertLeague(providerKey(provider, ref), season, norm.name,
    { format: norm.format, source: provider, sourceLeagueId: ref }, provider);
  if (!res.ok || !res.league_id) throw new Error(res.error ?? 'import failed');
  const members: MemberRow[] = norm.teams.map((t) => ({
    roster_id: t.rosterId,
    owner_id: t.ownerId ? providerKey(provider, t.ownerId) : null,
    team_name: t.teamName || `Roster ${t.rosterId}`,
  }));
  await adminUpsertMemberships(res.league_id, members);
  return { leagueId: res.league_id, rosters: members.length };
}

/** Mirror one week of a normalized league: matchup pairings + pick pools. */
export async function syncNormalizedWeek(leagueId: string, norm: NormalizedLeague, week: number): Promise<{ pairs: number; rosters: number }> {
  const wk = norm.matchupsByWeek[week - 1] ?? [];
  // Both sides of a game share a matchupId — group them into home/away pairs.
  const byMid = new Map<number, number[]>();
  for (const m of wk) {
    if (m.matchupId == null) continue;
    if (!byMid.has(m.matchupId)) byMid.set(m.matchupId, []);
    byMid.get(m.matchupId)!.push(m.rosterId);
  }
  const pairs: MatchupRow[] = [];
  for (const [mid, rs] of byMid) {
    if (rs.length < 2) continue;
    pairs.push({ sleeper_matchup_id: mid, home_roster_id: rs[0], away_roster_id: rs[1] });
  }
  await adminUpsertMatchups(leagueId, week, pairs, null);

  const lineups: LineupRow[] = norm.teams.map((t) => ({
    roster_id: t.rosterId,
    starters: t.playerKeys
      .map((k) => norm.players[k])
      .filter((p): p is NormPlayer => !!p)
      .map((p) => ({ slug: poolSlug(p), full: p.full, pos: p.pos })),
  }));
  await adminUpsertLineups(leagueId, week, lineups);
  return { pairs: pairs.length, rosters: norm.teams.length };
}

// ── ESPN ─────────────────────────────────────────────────────────────────────
// Public leagues need no creds; private ones take espn_s2 + SWID cookies.
export interface EspnImportCreds { swid?: string; s2?: string }

/** Import an ESPN league into the live pilot. */
export async function importEspnLeague(leagueId: string, season: string, creds?: EspnImportCreds): Promise<{ leagueId: string; rosters: number }> {
  const norm = await espnNormalize({ leagueId, season, swid: creds?.swid, s2: creds?.s2 });
  return persistLeague('espn', leagueId, season, norm);
}

/** Sync one week of an already-imported ESPN league (re-fetches its normalized data). */
export async function syncEspnWeek(dbLeagueId: string, espnLeagueId: string, season: string, week: number, creds?: EspnImportCreds): Promise<{ pairs: number; rosters: number }> {
  const norm = await espnNormalize({ leagueId: espnLeagueId, season, swid: creds?.swid, s2: creds?.s2 });
  return syncNormalizedWeek(dbLeagueId, norm, week);
}

/** Schedule the WHOLE regular season in one pass: one fetch, every week's matchups
 *  written. ESPN generates the full-season fantasy schedule up front, so this
 *  populates all weeks (even unplayed ones) — no per-week syncing. */
export async function syncEspnSeason(dbLeagueId: string, espnLeagueId: string, season: string, creds?: EspnImportCreds, onProgress?: (note: string) => void): Promise<{ weeks: number; pairs: number }> {
  const norm = await espnNormalize({ leagueId: espnLeagueId, season, swid: creds?.swid, s2: creds?.s2 });
  let pairs = 0;
  for (let w = 1; w <= norm.weeks; w++) {
    onProgress?.(`Scheduling week ${w}/${norm.weeks}…`);
    pairs += (await syncNormalizedWeek(dbLeagueId, norm, w)).pairs;
  }
  return { weeks: norm.weeks, pairs };
}

/** Import an ESPN league AND schedule its full regular season immediately, so
 *  every matchup exists the moment it's imported (no manual sync). */
export async function importEspnSeason(leagueId: string, season: string, creds?: EspnImportCreds, onProgress?: (note: string) => void): Promise<{ leagueId: string; rosters: number; weeks: number; pairs: number }> {
  const norm = await espnNormalize({ leagueId, season, swid: creds?.swid, s2: creds?.s2 });
  const { leagueId: dbId, rosters } = await persistLeague('espn', leagueId, season, norm);
  let pairs = 0;
  for (let w = 1; w <= norm.weeks; w++) {
    onProgress?.(`Scheduling week ${w}/${norm.weeks}…`);
    pairs += (await syncNormalizedWeek(dbId, norm, w)).pairs;
  }
  return { leagueId: dbId, rosters, weeks: norm.weeks, pairs };
}
