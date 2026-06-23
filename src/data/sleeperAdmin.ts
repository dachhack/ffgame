// Admin setup orchestration: fetch + parse Sleeper on the client (reusing the
// cached player directory), then persist via the admin writer RPCs. Keeps the
// heavy 5MB directory + JSON work out of Postgres.
import { normName } from './players';
import { loadPlayerDirectory, type PlayerMeta } from './sleeperPlayers';
import {
  adminUpsertLeague, adminUpsertMemberships, adminUpsertMatchups, adminUpsertLineups,
  type MemberRow, type MatchupRow, type LineupRow,
} from './liveApi';

const BASE = 'https://api.sleeper.app/v1';
async function sj<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`Sleeper ${r.status} on ${path}`);
  return r.json() as Promise<T>;
}

// The slug a player's plays key on. K/DST are team-based (matching the ESPN
// adapter's `${team}-k` / `${team}-dst`); skill players are normName-hyphenated.
function poolSlug(pm: PlayerMeta): string {
  const t = (pm.team ?? '').toLowerCase();
  if (pm.pos === 'DEF') return `${t}-dst`;
  if (pm.pos === 'K') return `${t}-k`;
  return normName(pm.full).replace(/\s+/g, '-');
}

interface SleeperUser { user_id: string; display_name?: string; metadata?: { team_name?: string } }
interface SleeperRoster { roster_id: number; owner_id?: string | null; players?: string[] }
interface SleeperMatchup { roster_id: number; matchup_id: number | null }

/** Import / refresh a Sleeper league → league + memberships. Returns league_id. */
export async function importLeague(sleeperId: string, season: string): Promise<string> {
  const [lg, users, rosters] = await Promise.all([
    sj<{ name?: string; settings?: unknown; scoring_settings?: unknown; roster_positions?: unknown }>(`/league/${sleeperId}`),
    sj<SleeperUser[]>(`/league/${sleeperId}/users`),
    sj<SleeperRoster[]>(`/league/${sleeperId}/rosters`),
  ]);
  const res = await adminUpsertLeague(sleeperId, season, lg.name ?? 'League',
    { settings: lg.settings, scoring: lg.scoring_settings, roster_positions: lg.roster_positions });
  if (!res.ok || !res.league_id) throw new Error(res.error ?? 'import failed');

  const byId = new Map(users.map((u) => [String(u.user_id), u]));
  const members: MemberRow[] = rosters.map((ro) => {
    const owner = ro.owner_id != null ? String(ro.owner_id) : null;
    const u = owner ? byId.get(owner) : undefined;
    return { roster_id: ro.roster_id, owner_id: owner, team_name: u?.metadata?.team_name || u?.display_name || `Roster ${ro.roster_id}` };
  });
  await adminUpsertMemberships(res.league_id, members);
  return res.league_id;
}

/** Mirror a week: matchup pairings + pick pools (rosters resolved via directory). */
export async function syncWeek(leagueId: string, sleeperId: string, week: number): Promise<{ pairs: number; rosters: number }> {
  const [rosters, matchups, dir] = await Promise.all([
    sj<SleeperRoster[]>(`/league/${sleeperId}/rosters`),
    sj<SleeperMatchup[]>(`/league/${sleeperId}/matchups/${week}`),
    loadPlayerDirectory(),
  ]);

  const byMid = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    if (!byMid.has(m.matchup_id)) byMid.set(m.matchup_id, []);
    byMid.get(m.matchup_id)!.push(m);
  }
  const pairs: MatchupRow[] = [];
  for (const [mid, pr] of byMid) {
    if (pr.length < 2) continue;
    pairs.push({ sleeper_matchup_id: mid, home_roster_id: pr[0].roster_id, away_roster_id: pr[1].roster_id });
  }
  await adminUpsertMatchups(leagueId, week, pairs, null);

  const lineups: LineupRow[] = rosters.map((ro) => ({
    roster_id: ro.roster_id,
    starters: (ro.players ?? [])
      .map((pid) => dir.get(String(pid)))
      .filter((pm): pm is PlayerMeta => !!pm)
      .map((pm) => ({ slug: poolSlug(pm), full: pm.full, pos: pm.pos })),
  }));
  await adminUpsertLineups(leagueId, week, lineups);
  return { pairs: pairs.length, rosters: rosters.length };
}
