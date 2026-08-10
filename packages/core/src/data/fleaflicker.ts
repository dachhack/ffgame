// Fleaflicker league import. Fleaflicker has a documented, public read API
// (www.fleaflicker.com/api) but sends no permissive CORS header, so the HTTP
// goes through the shared `fantasy-proxy` Edge Function. This module maps
// Fleaflicker's JSON into the platform-agnostic NormalizedLeague.
//
// Crosswalk: Fleaflicker player ids are its own namespace (no Sleeper/ESPN id),
// so players resolve to baked slugs by NAME (resolveEngineId's name-match path);
// K/DST resolve by NFL team. No directory join is needed.
//
// `getJson` is injected so the same normalize logic is unit-validated in Node
// (direct fetch) and run in the app (via the proxy).
import { REG_SEASON_WEEKS } from './league';
import type { Pos } from '../types';
import type { NormalizedLeague, NormPlayer, NormTeam, NormMatchup } from './normalized';

export interface FleaflickerCreds { leagueId: string; season: string; }
export type GetJson = (url: string) => Promise<any>;

const API = 'https://www.fleaflicker.com/api';
const POS: Record<string, Pos> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', 'D/ST': 'DEF', DST: 'DEF' };

interface FfProPlayer { id: number; nameFull?: string; position?: string; proTeam?: { abbreviation?: string }; proTeamAbbreviation?: string }
interface FfLeaguePlayer { proPlayer?: FfProPlayer; viewingActualPoints?: { value?: number } }
interface FfSlot { home?: FfLeaguePlayer; away?: FfLeaguePlayer; leaguePlayer?: FfLeaguePlayer }
interface FfGroup { group?: string; slots?: FfSlot[] }

const num = (x: { value?: number } | undefined) => (typeof x?.value === 'number' ? x.value : 0);
const teamAbbr = (p?: FfProPlayer) => p?.proTeam?.abbreviation || p?.proTeamAbbreviation || null;

/** Fetch a Fleaflicker league and map it into the platform-agnostic NormalizedLeague. */
export async function fleaflickerNormalize(
  creds: FleaflickerCreds,
  getJson: GetJson,
  onProgress?: (note: string) => void,
): Promise<NormalizedLeague> {
  const { leagueId, season } = creds;
  const q = `sport=NFL&league_id=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(season)}`;

  onProgress?.('Reading Fleaflicker league…');
  const standings = await getJson(`${API}/FetchLeagueStandings?${q}`);
  const leagueName = standings?.league?.name ?? 'Fleaflicker League';
  const size = standings?.league?.size ?? 0;
  const desc = standings?.league?.description as string | undefined;

  const players: Record<string, NormPlayer> = {};
  const addPlayer = (lp?: FfLeaguePlayer): string | null => {
    const p = lp?.proPlayer;
    if (!p || p.id == null) return null;
    const pos = p.position ? POS[p.position] : undefined;
    if (!pos) return null;
    const key = String(p.id);
    if (!players[key]) players[key] = { key, full: p.nameFull || key, pos, nflTeam: teamAbbr(p) };
    return key;
  };

  const teams: NormTeam[] = [];
  for (const div of standings?.divisions ?? []) {
    for (const t of div.teams ?? []) {
      const rec = t.recordOverall ?? {};
      teams.push({
        rosterId: t.id,
        teamName: t.name ?? `Team ${t.id}`,
        owner: t.owners?.[0]?.displayName ?? '—',
        ownerId: t.owners?.[0]?.id != null ? String(t.owners[0].id) : '',
        wins: rec.wins ?? 0, losses: rec.losses ?? 0, ties: rec.ties ?? 0,
        pf: num(t.pointsFor), pa: num(t.pointsAgainst),
        playerKeys: [],
      });
    }
  }

  // Regular-season length, capped at the baked slate.
  const periods: number[] = (standings?.divisions ? [] : []); // (standings has no period list)
  void periods;
  const weeks = Math.min(REG_SEASON_WEEKS, 14);

  onProgress?.(`Loading ${weeks} weeks of results…`);
  const matchupsByWeek: NormMatchup[][] = Array.from({ length: weeks }, () => []);
  // Per-team latest-week roster (START+BENCH) → NormTeam.playerKeys.
  const rosterByTeam = new Map<number, { week: number; keys: string[] }>();

  const loadWeek = async (week: number) => {
    const board = await getJson(`${API}/FetchLeagueScoreboard?${q}&scoring_period=${week}`).catch(() => null);
    const games = board?.games ?? [];
    const pointsByTeam = new Map<number, Record<string, number>>();
    const rosterThisWeek = new Map<number, string[]>();

    await Promise.all(games.map(async (g: any) => {
      // Boxscore takes league_id + fantasy_game_id only — it 400s on a season param.
      const box = await getJson(`${API}/FetchLeagueBoxscore?sport=NFL&league_id=${encodeURIComponent(leagueId)}&fantasy_game_id=${g.id}&scoring_period=${week}`).catch(() => null);
      const homeId = g.home?.id, awayId = g.away?.id;
      const recH = pointsByTeam.get(homeId) ?? {}; const recA = pointsByTeam.get(awayId) ?? {};
      const rH = rosterThisWeek.get(homeId) ?? []; const rA = rosterThisWeek.get(awayId) ?? [];
      for (const grp of (box?.lineups ?? []) as FfGroup[]) {
        for (const slot of grp.slots ?? []) {
          const kH = addPlayer(slot.home); if (kH) { recH[kH] = (recH[kH] ?? 0) + num(slot.home!.viewingActualPoints); rH.push(kH); }
          const kA = addPlayer(slot.away); if (kA) { recA[kA] = (recA[kA] ?? 0) + num(slot.away!.viewingActualPoints); rA.push(kA); }
        }
      }
      if (homeId != null) { pointsByTeam.set(homeId, recH); rosterThisWeek.set(homeId, rH); }
      if (awayId != null) { pointsByTeam.set(awayId, recA); rosterThisWeek.set(awayId, rA); }

      matchupsByWeek[week - 1].push(
        { rosterId: homeId, matchupId: g.id, points: num(g.homeScore?.score), playerPoints: recH },
        { rosterId: awayId, matchupId: g.id, points: num(g.awayScore?.score), playerPoints: recA },
      );
    }));

    // Latest week wins for the "current" roster.
    for (const [tid, keys] of rosterThisWeek) {
      const prev = rosterByTeam.get(tid);
      if (!prev || week > prev.week) rosterByTeam.set(tid, { week, keys: [...new Set(keys)] });
    }
  };

  await Promise.all(Array.from({ length: weeks }, (_, i) => loadWeek(i + 1)));

  for (const t of teams) t.playerKeys = rosterByTeam.get(t.rosterId)?.keys ?? [];

  // Superflex if any roster position accepts QB alongside RB/WR/TE.
  const reqs = (standings?.league?.rosterRequirements?.positions ?? []) as { eligibility?: string[] }[];
  const sf = reqs.some((p) => (p.eligibility ?? []).includes('QB') && (p.eligibility ?? []).includes('RB'));
  const format = desc || `${size || teams.length}-team${sf ? ' · Superflex' : ''}`;

  return {
    id: leagueId,
    name: leagueName,
    season: Number(season) || Number(standings?.season) || 2025,
    format,
    weeks,
    youUserId: '',
    synthPrefix: 'fl',
    players,
    teams,
    matchupsByWeek,
  };
}
