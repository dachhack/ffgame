// Yahoo Fantasy league import. Yahoo's official API uses OAuth 2.0 and returns a
// notoriously awkward JSON shape — lists are objects keyed "0","1",…,"count", and
// each team/player is an array whose first element is itself an array of
// single-key fragment objects. The helpers below tame that; everything goes
// through the yahoo-oauth Edge Function (auth + token refresh + API GET).
//
// Crosswalk: Yahoo player keys are their own namespace, so players resolve to
// baked slugs by NAME (resolveEngineId's name-match), K/DST by NFL team.
//
// `fetchPath(path)` returns the Yahoo `fantasy_content` object for an API path.
// It's injected so the same mapping can be validated independently of transport.
//
// NOTE: mapped to Yahoo's documented v2 shape but NOT yet validated against a
// live league (that needs a registered Yahoo app + OAuth). Treat the exact paths
// as needing a real-data check; the helpers degrade gracefully (missing →
// skipped) rather than throwing.
import { REG_SEASON_WEEKS } from './league';
import type { Pos } from '../types';
import type { NormalizedLeague, NormPlayer, NormTeam, NormMatchup } from './normalized';

export type FetchPath = (path: string) => Promise<any>;
const POS: Record<string, Pos> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', DB: 'DB', DL: 'DL', LB: 'LB' };

/** Yahoo wraps lists as { "0": {...}, "1": {...}, count: N } — pull the items. */
function coll(obj: any): any[] {
  if (!obj || typeof obj !== 'object') return [];
  const out: any[] = [];
  for (const k of Object.keys(obj)) if (/^\d+$/.test(k)) out.push(obj[k]);
  return out;
}
/** A Yahoo metadata array is a list of single-key objects — merge into one. */
function flat(fragments: any): Record<string, any> {
  const o: Record<string, any> = {};
  for (const f of Array.isArray(fragments) ? fragments : [fragments]) {
    if (f && typeof f === 'object' && !Array.isArray(f)) Object.assign(o, f);
  }
  return o;
}
const numAbbr = (s?: string) => (s ?? '').toUpperCase();

/** A user's NFL leagues for the season: [{ leagueKey, name }]. */
export async function yahooLeagues(fetchPath: FetchPath): Promise<{ leagueKey: string; name: string; season: string }[]> {
  const fc = await fetchPath('users;use_login=1/games;game_keys=nfl/leagues');
  const out: { leagueKey: string; name: string; season: string }[] = [];
  for (const u of coll(fc?.users)) {
    const user = u.user;
    const games = flat(user?.[1])?.games ?? user?.[1]?.games;
    for (const g of coll(games)) {
      const leagues = flat(g.game?.[1])?.leagues ?? g.game?.[1]?.leagues;
      for (const l of coll(leagues)) {
        const m = flat(l.league?.[0] ?? l.league);
        if (m.league_key) out.push({ leagueKey: String(m.league_key), name: String(m.name ?? 'Yahoo League'), season: String(m.season ?? '') });
      }
    }
  }
  return out;
}

function teamMeta(team: any): { id: number; key: string; name: string; owner: string } {
  const m = flat(team?.[0]);
  const managers = coll(m.managers) .map((x: any) => x.manager).filter(Boolean);
  const owner = managers[0]?.nickname ?? m.managers?.[0]?.manager?.nickname ?? '—';
  const idNum = Number(m.team_id ?? 0);
  return { id: idNum, key: String(m.team_key ?? ''), name: String(m.name ?? `Team ${idNum}`), owner: String(owner) };
}

/** Fetch a Yahoo league and map it into the platform-agnostic NormalizedLeague. */
export async function yahooNormalize(leagueKey: string, fetchPath: FetchPath, onProgress?: (note: string) => void): Promise<NormalizedLeague> {
  onProgress?.('Reading Yahoo league…');
  const sFc = await fetchPath(`league/${leagueKey}/standings`);
  const leagueArr = sFc?.league ?? [];
  const meta = Array.isArray(leagueArr[0]) ? flat(leagueArr[0]) : (leagueArr[0] ?? {});
  const standings = (leagueArr[1]?.standings) ?? leagueArr.find((x: any) => x?.standings)?.standings;
  const teamsColl = coll(Array.isArray(standings) ? standings[0]?.teams : standings?.teams);

  const teams: NormTeam[] = [];
  const keyToRid = new Map<string, number>();
  for (const t of teamsColl) {
    const team = t.team;
    const tm = teamMeta(team);
    const meta2 = team?.[1] ?? {};
    const st = meta2.team_standings ?? {};
    const oc = st.outcome_totals ?? {};
    teams.push({
      rosterId: tm.id,
      teamName: tm.name,
      owner: tm.owner,
      ownerId: tm.key,
      wins: Number(oc.wins ?? 0), losses: Number(oc.losses ?? 0), ties: Number(oc.ties ?? 0),
      pf: Number(st.points_for ?? 0), pa: Number(st.points_against ?? 0),
      playerKeys: [],
    });
    keyToRid.set(tm.key, tm.id);
  }

  const players: Record<string, NormPlayer> = {};
  const addPlayer = (player: any): string | null => {
    const pm = flat(player?.[0]);
    const key = String(pm.player_key ?? '');
    if (!key) return null;
    const pos = POS[String(pm.display_position ?? pm.primary_position ?? '')];
    if (!pos) return null;
    if (!players[key]) {
      const full = pm.name?.full ?? (typeof pm.name === 'string' ? pm.name : key);
      players[key] = { key, full: String(full), pos, nflTeam: numAbbr(pm.editorial_team_abbr) || null };
    }
    return key;
  };

  const weeks = Math.min(REG_SEASON_WEEKS, Number(meta.end_week ?? 14) || 14, 14);
  onProgress?.(`Loading ${weeks} weeks of results…`);

  // Schedule + team scores from the weekly scoreboards.
  const matchupsByWeek: NormMatchup[][] = Array.from({ length: weeks }, () => []);
  const teamPointsByWeek: Map<number, Map<number, number>> = new Map();
  const boards = await Promise.all(
    Array.from({ length: weeks }, (_, i) => fetchPath(`league/${leagueKey}/scoreboard;week=${i + 1}`).catch(() => null)),
  );
  boards.forEach((fc, wi) => {
    const lg = fc?.league ?? [];
    const scoreboard = lg[1]?.scoreboard ?? lg.find?.((x: any) => x?.scoreboard)?.scoreboard;
    const matchups = coll(Array.isArray(scoreboard) ? scoreboard[0]?.matchups : scoreboard?.matchups);
    let mid = 0;
    const wkPts = new Map<number, number>();
    for (const mm of matchups) {
      const matchup = mm.matchup;
      const gameId = ++mid;
      const sides = coll(matchup?.['0']?.teams);
      for (const s of sides) {
        const tm = teamMeta(s.team);
        const pts = Number(s.team?.[1]?.team_points?.total ?? 0);
        wkPts.set(tm.id, pts);
        matchupsByWeek[wi].push({ rosterId: tm.id, matchupId: gameId, points: pts, playerPoints: {} });
      }
    }
    teamPointsByWeek.set(wi + 1, wkPts);
  });

  // Per-player weekly points: each team's weekly roster with week stats. This is
  // teams×weeks calls — the heaviest path; best-effort so a failure just thins
  // the synthetic texture (baked players still use real PBP).
  const rosterByTeam = new Map<number, string[]>();
  await Promise.all(teams.flatMap((t) =>
    Array.from({ length: weeks }, async (_, wi) => {
      const week = wi + 1;
      const fc = await fetchPath(`team/${t.ownerId}/roster;week=${week}/players/stats;type=week;week=${week}`).catch(() => null);
      const teamArr = fc?.team ?? [];
      const roster = teamArr.find?.((x: any) => x?.roster)?.roster ?? teamArr[1]?.roster;
      const plColl = coll(roster?.['0']?.players ?? roster?.players);
      const rec: Record<string, number> = {};
      const keys: string[] = [];
      for (const p of plColl) {
        const k = addPlayer(p.player);
        if (!k) continue;
        const pts = Number(p.player?.[1]?.player_points?.total ?? 0);
        rec[k] = (rec[k] ?? 0) + pts;
        keys.push(k);
      }
      // attach to this team's matchup row for the week
      const row = matchupsByWeek[wi].find((r) => r.rosterId === t.rosterId);
      if (row) row.playerPoints = rec;
      const prev = rosterByTeam.get(t.rosterId);
      if (!prev || week === weeks) rosterByTeam.set(t.rosterId, [...new Set(keys)]);
    }),
  ));
  for (const t of teams) t.playerKeys = rosterByTeam.get(t.rosterId) ?? [];

  const size = teams.length;
  return {
    id: leagueKey,
    name: String(meta.name ?? 'Yahoo League'),
    season: Number(meta.season) || 2025,
    format: `${size}-team`,
    weeks,
    youUserId: '',
    synthPrefix: 'yh',
    players,
    teams,
    matchupsByWeek,
  };
}
