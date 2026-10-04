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
  adminUpsertLeague, adminUpsertMemberships, adminUpsertMatchups, adminUpsertLineups, importProviderLeagueRpc,
  type MemberRow, type MatchupRow, type LineupRow,
} from './liveApi';
import { espnNormalize } from './espn';
import { fleaflickerNormalize } from './fleaflicker';
import { mflNormalize } from './mfl';
import { yahooNormalize } from './yahoo';
import { proxyGetJson } from './providers/proxy';
import { yahooApi } from './providers/yahooClient';
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
      // Carry the real NFL team so the hero board can slot players by their game
      // window even when the name-slug isn't in the baked slug map.
      .map((p) => ({ slug: poolSlug(p), full: p.full, pos: p.pos, team: p.nflTeam ?? '' })),
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

// ── EVERY PLATFORM, SELF-SERVE (0423, v0.613.0) ──────────────────────────────
// Founder: "Let's do the same for the other league providers (ESPN, Yahoo,
// etc). Current season inputs only." The admin path above persists through an
// admin-only RPC; this one persists through import_provider_league, which
// makes the member the league's commissioner and seats them on the team THEY
// PICK (no platform but Sleeper gives us a user id to match). The schedule
// and lineups follow through the same writers the admin path uses, which
// already admit a league's commissioner.

export type ImportProvider = 'espn' | 'yahoo' | 'mfl' | 'fleaflicker';
export const IMPORT_PROVIDERS: { id: ImportProvider; name: string; refLabel: string; refHint: string }[] = [
  { id: 'espn', name: 'ESPN', refLabel: 'ESPN LEAGUE ID', refHint: 'the number after leagueId= in your league URL' },
  { id: 'fleaflicker', name: 'Fleaflicker', refLabel: 'FLEAFLICKER LEAGUE ID', refHint: 'the number in your league URL (…/leagues/12345)' },
  { id: 'mfl', name: 'MFL', refLabel: 'MFL LEAGUE ID', refHint: 'the 5-digit number in your league URL (L=12345)' },
  { id: 'yahoo', name: 'Yahoo', refLabel: 'YAHOO LEAGUE KEY', refHint: 'e.g. 449.l.12345 — sign in with Yahoo first' },
];

/** The season a league must be in to come over (the database insists). */
export const providerImportSeason = (now = new Date()): string => String(now.getUTCFullYear());

/** Read a platform league into the normalized shape. ESPN takes optional
 *  cookies for a private league; Yahoo needs a connected account. */
export async function normalizeProviderLeague(provider: ImportProvider, ref: string, season: string, creds?: EspnImportCreds, onProgress?: (note: string) => void): Promise<NormalizedLeague> {
  const id = ref.trim();
  switch (provider) {
    case 'espn': return espnNormalize({ leagueId: id, season, swid: creds?.swid, s2: creds?.s2 }, undefined, onProgress);
    case 'fleaflicker': return fleaflickerNormalize({ leagueId: id, season }, proxyGetJson, onProgress);
    case 'mfl': return mflNormalize({ leagueId: id, season }, proxyGetJson, onProgress);
    case 'yahoo': return yahooNormalize(id, yahooApi, onProgress);
  }
}

/** The seats as import_provider_league wants them, namespaced like the admin
 *  import so a later admin re-import lands on the same rows. */
export const providerMembers = (provider: ImportProvider, norm: NormalizedLeague): MemberRow[] =>
  norm.teams.map((t) => ({
    roster_id: t.rosterId,
    owner_id: t.ownerId ? providerKey(provider, t.ownerId) : null,
    team_name: t.teamName || `Roster ${t.rosterId}`,
  }));

/** Bring a platform league in as its commissioner, seated on `myRosterId`,
 *  then schedule every week the platform published. */
export async function importMyProviderLeague(provider: ImportProvider, ref: string, season: string, norm: NormalizedLeague, myRosterId: number, onProgress?: (note: string) => void) {
  const r = await importProviderLeagueRpc({
    provider, ref: ref.trim(), season, name: norm.name,
    settings: { format: norm.format, source: provider, sourceLeagueId: ref.trim() },
    members: providerMembers(provider, norm), myRosterId,
  });
  if (!r.ok || !r.league_id) return { ...r, weeks: 0, pairs: 0 };
  let pairs = 0;
  for (let w = 1; w <= norm.weeks; w++) {
    onProgress?.(`Scheduling week ${w}/${norm.weeks}…`);
    try { pairs += (await syncNormalizedWeek(r.league_id, norm, w)).pairs; }
    catch { /* a week without pairings yet (MFL publishes as it goes) is not a failed import */ }
  }
  return { ...r, weeks: norm.weeks, pairs };
}

/** The commissioner's "sync season" for any platform (the desk had it for
 *  ESPN only). Re-reads the platform and rewrites every week's pairings and
 *  lineups. */
export async function syncProviderSeason(dbLeagueId: string, provider: ImportProvider, ref: string, season: string, creds?: EspnImportCreds, onProgress?: (note: string) => void): Promise<{ weeks: number; pairs: number }> {
  const norm = await normalizeProviderLeague(provider, ref, season, creds, onProgress);
  let pairs = 0;
  for (let w = 1; w <= norm.weeks; w++) {
    onProgress?.(`Week ${w}/${norm.weeks}…`);
    try { pairs += (await syncNormalizedWeek(dbLeagueId, norm, w)).pairs; } catch { /* see above */ }
  }
  return { weeks: norm.weeks, pairs };
}
