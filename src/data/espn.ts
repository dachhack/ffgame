// ESPN Fantasy (unofficial v3) league import. ESPN sends no CORS headers and
// private leagues need the user's espn_s2 + SWID cookies, so the actual HTTP
// goes through the `espn-league` Supabase Edge Function (a thin proxy that
// attaches the cookies server-side). This module shapes ESPN's JSON into the
// platform-agnostic NormalizedLeague that the shared builder consumes.
//
// Crosswalk: ESPN athlete ids are joined to Sleeper ids via the player directory
// (loadDirectoryByEspn) so ESPN players reuse Sleeper's baked-slug mapping — the
// directory is the hub. Unmatched players fall back to name-match, then synth.
//
// NOTE: mapped to ESPN's documented v3 shape; the per-week boxscore extraction in
// particular should be validated against a real league once the proxy is
// deployed (see docs/multi-league-integration-research.md §7).
import { supabase } from './supabaseClient';
import { loadDirectoryByEspn } from './sleeperPlayers';
import { REG_SEASON_WEEKS } from './league';
import type { Pos } from '../types';
import type { NormalizedLeague, NormPlayer, NormTeam, NormMatchup } from './normalized';

export interface EspnCreds { leagueId: string; season: string; swid?: string; s2?: string; }

// ESPN defaultPositionId → our Pos (skill + light IDP). Unknown → null (skipped).
const POS: Record<number, Pos> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF', 9: 'DL', 10: 'DL', 11: 'LB', 12: 'DB', 13: 'DB', 14: 'DB' };
// ESPN proTeamId → NFL abbreviation (buildLeague.normTeam folds LAR/WSH → LA/WAS).
const TEAM: Record<number, string> = {
  0: '', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',
  10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
  28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

interface EspnPlayer { id: number; fullName?: string; defaultPositionId?: number; proTeamId?: number; }
interface EspnEntry { playerId?: number; playerPoolEntry?: { player?: EspnPlayer }; appliedStatTotal?: number; }
interface EspnTeam {
  id: number; name?: string; location?: string; nickname?: string; abbrev?: string;
  owners?: string[];
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number } };
  roster?: { entries?: EspnEntry[] };
}
interface EspnSide { teamId: number; totalPoints?: number; rosterForCurrentScoringPeriod?: { entries?: EspnEntry[] } }
interface EspnSchedule { id: number; matchupPeriodId?: number; home?: EspnSide; away?: EspnSide }
interface EspnMember { id: string; displayName?: string; firstName?: string; lastName?: string }
interface EspnLeague {
  id: number; seasonId?: number;
  settings?: { name?: string; scoringSettings?: { scoringItems?: { statId: number; points?: number; pointsOverrides?: Record<string, number> }[] };
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scheduleSettings?: { matchupPeriodCount?: number };
  };
  teams?: EspnTeam[]; schedule?: EspnSchedule[]; members?: EspnMember[];
}
interface ProxyResponse { ok: boolean; error?: string; league?: EspnLeague; weeks?: Record<string, { schedule?: EspnSchedule[] }> }

/** Call the espn-league proxy for the base league + per-week boxscores. */
async function fetchEspn(creds: EspnCreds, weeks: number[]): Promise<ProxyResponse> {
  if (!supabase) throw new Error('ESPN import needs the backend, which isn’t configured here.');
  const { data, error } = await supabase.functions.invoke('espn-league', {
    body: { leagueId: creds.leagueId, season: creds.season, swid: creds.swid ?? '', s2: creds.s2 ?? '', weeks },
  });
  if (error) throw new Error(error.message || 'Could not reach ESPN.');
  const res = data as ProxyResponse;
  if (!res?.ok) throw new Error(res?.error || 'ESPN returned an error.');
  return res;
}

// ESPN PPR detection: the reception scoring item (statId 53) point value.
function scoringLabel(lg: EspnLeague): string {
  const items = lg.settings?.scoringSettings?.scoringItems ?? [];
  const rec = items.find((i) => i.statId === 53);
  const pts = rec?.points ?? rec?.pointsOverrides?.['0'] ?? 0;
  return pts >= 1 ? 'PPR' : pts >= 0.5 ? 'Half-PPR' : 'Standard';
}

function teamName(t: EspnTeam): string {
  return (t.name && t.name.trim()) || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || t.abbrev || `Team ${t.id}`;
}

/** Fetch an ESPN league and map it into the platform-agnostic NormalizedLeague. */
export async function espnNormalize(creds: EspnCreds, onProgress?: (note: string) => void): Promise<NormalizedLeague> {
  onProgress?.('Reading ESPN league…');
  const byEspn = await loadDirectoryByEspn(onProgress);

  // Probe the league first (no week boxscores) to learn the regular-season length.
  const probe = await fetchEspn(creds, []);
  const lg = probe.league!;
  const matchupCount = lg.settings?.scheduleSettings?.matchupPeriodCount ?? REG_SEASON_WEEKS;
  const weeks = Math.min(REG_SEASON_WEEKS, Math.max(1, matchupCount));

  onProgress?.(`Loading ${weeks} weeks of results…`);
  const full = await fetchEspn(creds, Array.from({ length: weeks }, (_, i) => i + 1));
  const league = full.league ?? lg;

  // Members (owner guid → display name).
  const memberById = new Map<string, EspnMember>();
  for (const m of league.members ?? []) memberById.set(m.id, m);
  const ownerName = (ids?: string[]) => {
    const m = ids && ids.length ? memberById.get(ids[0]) : undefined;
    return m ? (m.displayName || `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Manager') : '—';
  };

  // Player registry from current rosters + a NormPlayer per ESPN athlete.
  const players: Record<string, NormPlayer> = {};
  const addPlayer = (p?: EspnPlayer): string | null => {
    if (!p || p.id == null) return null;
    const pos = p.defaultPositionId != null ? POS[p.defaultPositionId] : undefined;
    if (!pos) return null;
    const key = String(p.id);
    if (!players[key]) {
      const nflTeam = p.proTeamId != null ? (TEAM[p.proTeamId] || null) : null;
      const meta = byEspn.get(key); // join ESPN id → Sleeper id (the baked-slug hub)
      players[key] = {
        key,
        full: p.fullName || meta?.full || key,
        pos,
        nflTeam,
        sleeperId: meta?.id,
        espnId: key,
      };
    }
    return key;
  };

  const teams: NormTeam[] = (league.teams ?? []).map((t) => {
    const ov = t.record?.overall ?? {};
    const playerKeys: string[] = [];
    for (const e of t.roster?.entries ?? []) {
      const k = addPlayer(e.playerPoolEntry?.player);
      if (k) playerKeys.push(k);
    }
    return {
      rosterId: t.id,
      teamName: teamName(t),
      owner: ownerName(t.owners),
      ownerId: t.owners?.[0] ?? '',
      wins: ov.wins ?? 0, losses: ov.losses ?? 0, ties: ov.ties ?? 0,
      pf: ov.pointsFor ?? 0, pa: ov.pointsAgainst ?? 0,
      playerKeys,
    };
  });

  // Schedule → two NormMatchup rows per game (home, away), sharing the game id so
  // buildFromNormalized pairs them. Bucket by matchup period (the week).
  const matchupsByWeek: NormMatchup[][] = Array.from({ length: weeks }, () => []);
  const sideRow = (s: EspnSide, gameId: number, weekPoints: Map<number, Record<string, number>>): NormMatchup => ({
    rosterId: s.teamId,
    matchupId: gameId,
    points: s.totalPoints ?? 0,
    playerPoints: weekPoints.get(s.teamId) ?? {},
  });

  // Per-week per-player applied points, pulled from the boxscore views, keyed by
  // teamId → { playerKey → points }. Tolerant: missing data just omits texture.
  const weekPlayerPoints: Map<number, Map<number, Record<string, number>>> = new Map();
  for (let w = 1; w <= weeks; w++) {
    const box = full.weeks?.[String(w)];
    const byTeam = new Map<number, Record<string, number>>();
    for (const g of box?.schedule ?? []) {
      for (const side of [g.home, g.away]) {
        if (!side) continue;
        const rec: Record<string, number> = byTeam.get(side.teamId) ?? {};
        for (const e of side.rosterForCurrentScoringPeriod?.entries ?? []) {
          const k = addPlayer(e.playerPoolEntry?.player);
          if (k && typeof e.appliedStatTotal === 'number') rec[k] = (rec[k] ?? 0) + e.appliedStatTotal;
        }
        byTeam.set(side.teamId, rec);
      }
    }
    weekPlayerPoints.set(w, byTeam);
  }

  for (const g of league.schedule ?? []) {
    const wk = g.matchupPeriodId ?? 0;
    if (wk < 1 || wk > weeks) continue;
    const wp = weekPlayerPoints.get(wk) ?? new Map();
    const rows: NormMatchup[] = [];
    if (g.home) rows.push(sideRow(g.home, g.id, wp));
    if (g.away) rows.push(sideRow(g.away, g.id, wp));
    matchupsByWeek[wk - 1].push(...rows);
  }

  const size = teams.length;
  const slots = lg.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const sf = (slots['7'] ?? 0) > 0 || (slots['0'] ?? 0) >= 2; // 7 = OP/superflex, 0 = QB
  const format = `${sf ? 'Superflex' : 'Redraft'} · ${scoringLabel(lg)} · ${size}-team`;

  return {
    id: creds.leagueId,
    name: lg.settings?.name || 'ESPN League',
    season: Number(creds.season) || lg.seasonId || 2025,
    format,
    weeks,
    youUserId: creds.swid ?? '',
    synthPrefix: 'espn',
    players,
    teams,
    matchupsByWeek,
  };
}
