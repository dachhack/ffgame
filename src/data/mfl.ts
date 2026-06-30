// MyFantasyLeague (MFL) league import. MFL has a long-standing documented export
// API (api.myfantasyleague.com/{year}/export?TYPE=...). League-specific calls
// 302-redirect to the league's home server (www##.myfantasyleague.com), and the
// API isn't CORS-open, so the HTTP goes through the shared `fantasy-proxy` Edge
// Function (which follows the redirect server-side). This module maps MFL's JSON
// into the platform-agnostic NormalizedLeague.
//
// Crosswalk: MFL player ids are its own namespace, so players resolve to baked
// slugs by NAME (resolveEngineId's name-match path) — MFL names are "Last, First"
// and are flipped here. K/DST resolve by NFL team (MFL uses some non-standard
// 3-letter codes, mapped below).
//
// `getJson` is injected so the same normalize logic can be unit-validated in Node
// (direct fetch) and run in the app (via the proxy).
import { REG_SEASON_WEEKS } from './league';
import type { Pos } from '../types';
import type { NormalizedLeague, NormPlayer, NormTeam, NormMatchup } from './normalized';

export interface MflCreds { leagueId: string; season: string; host?: string; }
export type GetJson = (url: string) => Promise<any>;

const POS: Record<string, Pos> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', Def: 'DEF', DEF: 'DEF', DT: 'DL', DE: 'DL', LB: 'LB', CB: 'DB', S: 'DB' };
// MFL's non-standard NFL team codes → the baked slate's codes (others pass through).
const TEAM: Record<string, string> = { GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', JAC: 'JAX', SDC: 'LAC', RAM: 'LA', ARZ: 'ARI', CLV: 'CLE', HST: 'HOU', BLT: 'BAL', WAS: 'WAS' };

const arr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const flipName = (n: string) => {
  const i = n.indexOf(',');
  return i >= 0 ? `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}`.trim() : n.trim();
};
const teamCode = (t?: string) => { const u = (t ?? '').toUpperCase(); return u ? (TEAM[u] ?? u) : null; };
const rid = (id: string) => parseInt(id, 10);

/** Fetch an MFL league and map it into the platform-agnostic NormalizedLeague. */
export async function mflNormalize(creds: MflCreds, getJson: GetJson, onProgress?: (note: string) => void): Promise<NormalizedLeague> {
  const { leagueId, season } = creds;
  const host = creds.host || 'https://api.myfantasyleague.com';
  const base = `${host}/${season}/export`;
  const url = (type: string, extra = '') => `${base}?TYPE=${type}&L=${encodeURIComponent(leagueId)}&JSON=1${extra}`;

  onProgress?.('Reading MFL league…');
  const [leagueRes, standRes, playersRes] = await Promise.all([
    getJson(url('league')),
    getJson(url('leagueStandings')),
    getJson(url('players', '&DETAILS=1')),
  ]);

  const league = leagueRes?.league ?? {};
  const franchises = arr<any>(league?.franchises?.franchise);

  // Player directory: MFL id → meta.
  const dir = new Map<string, { full: string; pos: Pos; team: string | null }>();
  for (const p of arr<any>(playersRes?.players?.player)) {
    const pos = POS[String(p.position ?? '')];
    if (!pos) continue;
    dir.set(String(p.id), { full: flipName(String(p.name ?? p.id)), pos, team: teamCode(p.team) });
  }

  // Standings → records + pf/pa per franchise.
  const standById = new Map<string, any>();
  for (const f of arr<any>(standRes?.leagueStandings?.franchise)) standById.set(String(f.id), f);

  const players: Record<string, NormPlayer> = {};
  const addPlayer = (mflId: string): string | null => {
    const meta = dir.get(mflId);
    if (!meta) return null;
    if (!players[mflId]) players[mflId] = { key: mflId, full: meta.full, pos: meta.pos, nflTeam: meta.team };
    return mflId;
  };

  const teams: NormTeam[] = franchises.map((f) => {
    const s = standById.get(String(f.id)) ?? {};
    return {
      rosterId: rid(f.id),
      teamName: String(f.name ?? `Franchise ${f.id}`),
      owner: String(f.owner_name ?? '—'),
      ownerId: String(f.id),
      wins: Number(s.h2hw ?? 0), losses: Number(s.h2hl ?? 0), ties: Number(s.h2ht ?? 0),
      pf: Number(s.pf ?? 0), pa: Number(s.pa ?? 0),
      playerKeys: [],
    };
  });

  const weeks = Math.min(REG_SEASON_WEEKS, 14);
  onProgress?.(`Loading ${weeks} weeks of results…`);
  const weekly = await Promise.all(
    Array.from({ length: weeks }, (_, i) => getJson(url('weeklyResults', `&W=${i + 1}`)).catch(() => null)),
  );

  const matchupsByWeek: NormMatchup[][] = Array.from({ length: weeks }, () => []);
  const rosterByTeam = new Map<number, string[]>();
  weekly.forEach((res, wi) => {
    let mid = 0;
    for (const m of arr<any>(res?.weeklyResults?.matchup)) {
      const gameId = ++mid;
      for (const f of arr<any>(m.franchise)) {
        const teamId = rid(f.id);
        const pp: Record<string, number> = {};
        const keys: string[] = [];
        for (const pl of arr<any>(f.players?.player)) {
          const k = addPlayer(String(pl.id));
          if (!k) continue;
          pp[k] = (pp[k] ?? 0) + Number(pl.score ?? 0);
          keys.push(k);
        }
        rosterByTeam.set(teamId, keys); // latest week processed wins (weeks ascend)
        matchupsByWeek[wi].push({ rosterId: teamId, matchupId: gameId, points: Number(f.score ?? 0), playerPoints: pp });
      }
    }
  });
  for (const t of teams) t.playerKeys = rosterByTeam.get(t.rosterId) ?? [];

  const size = teams.length;
  return {
    id: leagueId,
    name: String(league?.name ?? 'MFL League'),
    season: Number(season) || 2025,
    format: `${size}-team`,
    weeks,
    youUserId: '',
    synthPrefix: 'mfl',
    players,
    teams,
    matchupsByWeek,
  };
}
