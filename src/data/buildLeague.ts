// Build a live, fully-playable League from a Sleeper league — rosters, real
// 14-week schedule + scores, and a player registry — so the existing engine /
// screens run the season sim on it unchanged. Per the chosen approach:
//   • Standings + schedule + per-player weekly totals come from Sleeper (real).
//   • Players we baked real play-by-play for (and every team K/DST) reuse it.
//   • Everyone else gets a synthesized play timeline scaled to their real
//     weekly Sleeper total — "hybrid texture".
import type { League, FantasyTeam, Player, Pos, PlayerStats, ScheduleGame } from '../types';
import { normName, shortName, hashStr } from './players';
import { BAKED_SLUGS } from './bakedSlugs';
import { SLEEPER_SLUG } from './sleeperSlug';
import { setSyntheticWeeks, type RealPlay } from './realPbp';
import { setRuntimeHeadshots, espnHeadshot } from './media';
import { loadPlayerDirectory, type PlayerMeta } from './sleeperPlayers';
import { REG_SEASON_WEEKS, type BuiltLeague } from './league';

const BASE = 'https://api.sleeper.app/v1';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sleeper ${r.status}`);
  return r.json() as Promise<T>;
}

// Sleeper team codes → the baked NFL slate's codes.
function normTeam(t: string | null | undefined): string {
  const u = String(t ?? '').toUpperCase();
  return u === 'LAR' ? 'LA' : u === 'WSH' ? 'WAS' : u === 'JAC' ? 'JAX' : u === 'OAK' ? 'LV' : u === 'SD' ? 'LAC' : u === 'STL' ? 'LA' : u;
}

/** Engine player id for a Sleeper player — a baked slug when we have its real
 *  play-by-play (incl. every team K/DST), else a synthetic id. */
function engineId(meta: PlayerMeta): { id: string; baked: boolean; team: string } {
  const team = normTeam(meta.team);
  if (meta.pos === 'DEF') return { id: `${(team || meta.id).toLowerCase()}-dst`, baked: true, team: team || meta.id };
  if (meta.pos === 'K' && team) return { id: `${team.toLowerCase()}-k`, baked: true, team };
  // Exact Sleeper-id → baked slug (most reliable); else fall back to a normalized
  // name match; else synthesize.
  const exact = SLEEPER_SLUG[meta.id];
  if (exact && BAKED_SLUGS[exact]) return { id: exact, baked: true, team: BAKED_SLUGS[exact].team };
  const slug = normName(meta.full).replace(/\s+/g, '-');
  if (BAKED_SLUGS[slug] && BAKED_SLUGS[slug].pos === meta.pos) return { id: slug, baked: true, team: BAKED_SLUGS[slug].team };
  return { id: `sl-${meta.id}`, baked: false, team };
}

const Z: PlayerStats = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

// A season stat line whose projectedPoints() ≈ the player's real per-game PPR,
// shaped by position (so default-lineup ranking mirrors real production).
function synthStats(pos: Pos, seasonPpr: number, games: number): PlayerStats {
  const g = Math.max(1, games);
  const S = Math.max(0, seasonPpr);
  const s: PlayerStats = { ...Z, games: g, ppr: Math.round(S * 10) / 10 };
  if (pos === 'QB') { s.passYds = Math.round((S * 0.85) / 0.04); s.passTds = Math.round((S * 0.15) / 4); }
  else if (pos === 'RB') { s.rushYds = Math.round((S * 0.65) / 0.1); s.rushTds = Math.round((S * 0.2) / 6); s.receptions = Math.round(S * 0.15); s.targets = s.receptions; s.recYds = s.receptions * 7; s.carries = Math.max(s.rushTds, Math.round(s.rushYds / 4.3)); }
  else if (pos === 'WR' || pos === 'TE') { s.recYds = Math.round((S * 0.6) / 0.1); s.recTds = Math.round((S * 0.18) / 6); s.receptions = Math.round(S * 0.22); s.targets = Math.round(s.receptions * 1.5); }
  return s;
}

let seedN = 1;
function rndY(base: number): number { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return base * (0.8 + (seedN % 1000) / 2500); }

// Synthesize a single player's plays for a week, scaled to their real weekly
// PPR total `P`. Spread across the game clock so drips/metrics have texture.
function synthPlays(pos: Pos, P: number): RealPlay[] {
  if (P <= 0.05) return [];
  const out: Omit<RealPlay, 'c'>[] = [];
  const add = (k: RealPlay['k'], y: number, td = 0, ca = 0, tg = 0) => out.push({ k, y: Math.max(0, Math.round(y)), td, ca, tg });
  if (pos === 'QB') {
    const passTd = Math.min(6, Math.max(0, Math.round(P / 24)));
    const passYds = Math.max(0, (P - passTd * 4) / 0.04);
    const n = Math.max(passTd + 1, Math.round(passYds / 11) || 1);
    for (let i = 0; i < n; i++) add('pass', passYds / n, i < passTd ? 1 : 0);
  } else if (pos === 'RB') {
    const rushTd = Math.min(3, Math.max(0, Math.round(P / 40)));
    const rec = Math.min(6, Math.max(0, Math.round(P * 0.12)));
    const recYds = rec * 7;
    const rem = P - rushTd * 6 - rec - recYds * 0.1;
    const rushYds = Math.max(0, rem / 0.1);
    const carries = Math.max(rushTd + 1, 5, Math.round(rushYds / 4.3));
    for (let i = 0; i < carries; i++) add('rush', rushYds / carries, i < rushTd ? 1 : 0);
    for (let i = 0; i < rec; i++) add('rec', recYds / rec, 0, 1, 1);
  } else if (pos === 'WR' || pos === 'TE') {
    const recTd = Math.min(3, Math.max(0, Math.round(P / 30)));
    const rec = Math.min(12, Math.max(1, Math.round(P * 0.16)));
    const recYds = Math.max(0, (P - rec - recTd * 6) / 0.1);
    for (let i = 0; i < rec; i++) add('rec', rndY(recYds / rec), i < recTd ? 1 : 0, 1, 1);
    add('incomplete', 0, 0, 0, 1); add('incomplete', 0, 0, 0, 1);
  } else if (pos === 'K') {
    const fgs = Math.min(7, Math.max(0, Math.round(P / 3.3)));
    for (let i = 0; i < fgs; i++) add('fg', 38);
    const xps = Math.max(0, Math.round(P - fgs * 3));
    for (let i = 0; i < xps; i++) add('xp', 0);
  } else if (pos === 'DEF') {
    let pts = P;
    while (pts >= 6) { add('dst_td', 0); pts -= 6; }
    while (pts >= 3) { add('int', 0); pts -= 3; }
    while (pts >= 2) { add('fumrec', 0); pts -= 2; }
    while (pts >= 1) { add('sack', 0); pts -= 1; }
  }
  const N = out.length || 1;
  return out.map((p, i) => ({ ...p, c: Math.round(150 + ((3100 - 150) * (i + 1)) / (N + 1)) }));
}

interface SleeperRoster { roster_id: number; owner_id: string | null; players: string[] | null; settings?: Record<string, number>; }
interface SleeperUser { user_id: string; display_name: string; metadata?: Record<string, string>; }
interface SleeperMatch { roster_id: number; matchup_id: number | null; points: number; players_points?: Record<string, number>; }
interface SleeperLeagueDetail { name: string; season: string; total_rosters: number; settings?: Record<string, number>; roster_positions?: string[]; scoring_settings?: Record<string, number> }

function formatLabel(d: SleeperLeagueDetail): string {
  const rp = d.roster_positions ?? [];
  const sf = rp.includes('SUPER_FLEX') || rp.filter((p) => p === 'QB').length >= 2;
  const st = d.settings ?? {};
  const base = st.best_ball ? 'Best Ball' : st.type === 2 ? 'Dynasty' : st.type === 1 ? 'Keeper' : 'Redraft';
  return `${base}${sf ? ' · Superflex' : ''} · ${d.total_rosters}-team`;
}

/**
 * Build a playable League from a Sleeper league for the given user.
 * Returns the built league plus the user's own team id (YOU).
 */
export async function buildSleeperLeague(
  leagueId: string,
  userId: string,
  onProgress?: (note: string) => void,
  opts?: { addKdst?: boolean },
): Promise<{ built: BuiltLeague; youTeamId: string }> {
  onProgress?.('Reading league…');
  const [detail, rosters, users] = await Promise.all([
    getJson<SleeperLeagueDetail>(`${BASE}/league/${leagueId}`),
    getJson<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`),
    getJson<SleeperUser[]>(`${BASE}/league/${leagueId}/users`),
  ]);
  const dir = await loadPlayerDirectory(onProgress);

  const userById = new Map<string, SleeperUser>();
  for (const u of users) userById.set(u.user_id, u);

  // Regular-season length: up to the playoffs, capped at the baked slate (14).
  const playoffStart = detail.settings?.playoff_week_start ?? 15;
  const weeks = Math.min(REG_SEASON_WEEKS, Math.max(1, playoffStart - 1));

  onProgress?.(`Loading ${weeks} weeks of results…`);
  const matchupsByWeek: SleeperMatch[][] = await Promise.all(
    Array.from({ length: weeks }, (_, i) => getJson<SleeperMatch[]>(`${BASE}/league/${leagueId}/matchups/${i + 1}`).catch(() => [])),
  );

  // Map every Sleeper roster to a team id, and remember roster_id → team id.
  const teamIdOf = (rid: number) => `r${rid}`;
  const players: Record<string, Player> = {};
  const seasonPts = new Map<string, number>();   // engineId → season PPR total
  const gamesPlayed = new Map<string, number>(); // engineId → weeks with >0
  const idMap = new Map<string, { eid: string; meta: PlayerMeta; baked: boolean; team: string }>(); // sleeperId → engine mapping

  const resolve = (sleeperId: string) => {
    const cached = idMap.get(sleeperId);
    if (cached) return cached;
    const meta = dir.get(sleeperId);
    if (!meta) return null;
    const { id, baked, team } = engineId(meta);
    const m = { eid: id, meta, baked, team };
    idMap.set(sleeperId, m);
    return m;
  };

  // Tally real per-player weekly totals (from matchups) → season totals + synth.
  const synthWeeks: { week: number; pbp: Record<string, RealPlay[]>; points: Record<string, number> }[] = [];
  for (let wi = 0; wi < weeks; wi++) {
    const week = wi + 1;
    const pbp: Record<string, RealPlay[]> = {};
    const points: Record<string, number> = {};
    for (const m of matchupsByWeek[wi]) {
      for (const [sid, pts] of Object.entries(m.players_points ?? {})) {
        const r = resolve(sid);
        if (!r) continue;
        seasonPts.set(r.eid, (seasonPts.get(r.eid) ?? 0) + pts);
        if (pts > 0) gamesPlayed.set(r.eid, (gamesPlayed.get(r.eid) ?? 0) + 1);
        if (!r.baked) { points[r.eid] = Math.round(pts * 10) / 10; const ps = synthPlays(r.meta.pos, pts); if (ps.length) pbp[r.eid] = ps; }
      }
    }
    synthWeeks.push({ week, pbp, points });
  }
  setSyntheticWeeks(synthWeeks);

  // Build the player registry + per-team rosters.
  const teams: FantasyTeam[] = [];
  // Per-player headshots from Sleeper's espn_id, so roster players outside the
  // baked crosswalk still get a real photo (baked HEADSHOTS still win).
  const runtimeHeadshots: Record<string, string> = {};
  let youTeamId = teamIdOf(rosters[0]?.roster_id ?? 1);
  for (const r of rosters) {
    const ids: string[] = [];
    for (const sid of r.players ?? []) {
      const m = resolve(sid);
      if (!m) continue;
      const hs = espnHeadshot(m.meta.espnId);
      if (hs && !runtimeHeadshots[m.eid]) runtimeHeadshots[m.eid] = hs;
      if (!players[m.eid]) {
        const ppr = seasonPts.get(m.eid) ?? 0;
        const g = gamesPlayed.get(m.eid) ?? 0;
        players[m.eid] = {
          id: m.eid,
          name: m.meta.pos === 'DEF' ? `${m.team} DST` : m.meta.pos === 'K' ? `${m.team} K` : shortName(m.meta.full),
          full: m.meta.full,
          pos: m.meta.pos,
          team: m.team || 'NFL',
          stats: synthStats(m.meta.pos, ppr, g),
        };
      }
      if (!ids.includes(m.eid)) ids.push(m.eid);
    }
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    const st = r.settings ?? {};
    const pf = (st.fpts ?? 0) + (st.fpts_decimal ?? 0) / 100;
    const pa = (st.fpts_against ?? 0) + (st.fpts_against_decimal ?? 0) / 100;
    teams.push({
      id: teamIdOf(r.roster_id),
      name: u?.metadata?.team_name || (u ? u.display_name : `Roster ${r.roster_id}`),
      owner: u ? u.display_name : '—',
      ownerId: r.owner_id ?? '',
      seed: 0,
      wins: st.wins ?? 0, losses: st.losses ?? 0, pf, pa,
      roster: ids,
    });
    if (r.owner_id && r.owner_id === userId) youTeamId = teamIdOf(r.roster_id);
  }

  // Many leagues don't roster kickers or team defenses, which leaves the K
  // (Banker / Negation) and DEF (Suppress / Earn) metrics unplayable. When
  // asked, give any team missing one a real baked K and/or DST, assigned a
  // random NFL team (distinct per fantasy team, so no two mirror each other).
  // This only enriches the playable drip lineup; Sleeper standings/scores are
  // untouched (they come from real Sleeper totals, not the roster).
  if (opts?.addKdst) {
    // The 32 NFL teams, all of which have baked K + DST play-by-play.
    const NFL = ['ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc', 'la', 'lac', 'lv', 'mia', 'min', 'ne', 'no', 'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'was'];
    // Deterministic shuffle (seeded by league) → a stable but random draw.
    let seed = hashStr(`${leagueId}|kdst`);
    const bag = [...NFL];
    for (let i = bag.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const j = seed % (i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    let pick = 0;
    for (const t of teams) {
      const roster = t.roster.map((id) => players[id]).filter(Boolean) as Player[];
      const hasK = roster.some((p) => p.pos === 'K');
      const hasDef = roster.some((p) => p.pos === 'DEF');
      if (hasK && hasDef) continue;
      const code = bag[pick % bag.length]; pick++;
      const abbr = code.toUpperCase();
      const ensure = (pos: 'K' | 'DEF') => {
        const eid = `${code}-${pos === 'K' ? 'k' : 'dst'}`;
        if (!players[eid]) {
          players[eid] = { id: eid, name: `${abbr} ${pos === 'K' ? 'K' : 'DST'}`, full: `${abbr} ${pos === 'K' ? 'K' : 'DST'}`, pos, team: abbr, stats: { ...Z } };
        }
        if (!t.roster.includes(eid)) t.roster.push(eid);
      };
      if (!hasK) ensure('K');
      if (!hasDef) ensure('DEF');
    }
  }

  // Seed by record then points-for (standings order).
  teams.sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
  teams.forEach((t, i) => { t.seed = i + 1; });

  // Schedule: pair each week's matchups by matchup_id.
  const schedule: ScheduleGame[] = [];
  for (let wi = 0; wi < weeks; wi++) {
    const byMatch = new Map<number, SleeperMatch[]>();
    for (const m of matchupsByWeek[wi]) {
      if (m.matchup_id == null) continue;
      (byMatch.get(m.matchup_id) ?? byMatch.set(m.matchup_id, []).get(m.matchup_id)!).push(m);
    }
    for (const pair of byMatch.values()) {
      if (pair.length < 2) continue;
      const [h, a] = pair;
      schedule.push({ week: wi + 1, homeId: teamIdOf(h.roster_id), awayId: teamIdOf(a.roster_id), homeScore: Math.round(h.points * 100) / 100, awayScore: Math.round(a.points * 100) / 100 });
    }
  }

  setRuntimeHeadshots(runtimeHeadshots);

  const league: League = {
    id: leagueId,
    name: detail.name,
    format: formatLabel(detail),
    season: Number(detail.season) || 2025,
    teams,
    schedule,
  };
  return { built: { league, players, weeks }, youTeamId };
}
