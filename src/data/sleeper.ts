// Live Sleeper data via Sleeper's free public read API (api.sleeper.app), called
// straight from the browser. NOTE: the build-time DRIP league was pulled through
// Stathead's get_sleeper_* MCP tools, but that MCP isn't reachable from the
// deployed static app — so this runtime feature uses Sleeper's public API
// directly (same data). No auth, CORS-enabled.
const BASE = 'https://api.sleeper.app/v1';
const CDN = 'https://sleepercdn.com/avatars/thumbs';

export interface SleeperUser { userId: string; username: string; displayName: string; avatar: string | null; }
export interface SleeperLeague {
  leagueId: string; name: string; totalRosters: number; status: string; avatar: string | null;
  format: string;   // e.g. "Dynasty · Superflex"
  scoring: string;  // "PPR" | "Half-PPR" | "Standard"
  starters: number; // starting-lineup size
}
export interface SleeperStanding {
  rosterId: number; teamName: string; owner: string; avatar: string | null;
  wins: number; losses: number; ties: number; pf: number; pa: number; playerCount: number;
}

export function sleeperAvatarUrl(id: string | null): string | null {
  return id ? `${CDN}/${id}` : null;
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sleeper ${r.status}`);
  return r.json();
}

/** Resolve a Sleeper username to its account, or null if no such user. */
export async function resolveUser(username: string): Promise<SleeperUser | null> {
  const u = username.trim().replace(/^@/, '');
  if (!u) return null;
  const d = (await getJson(`${BASE}/user/${encodeURIComponent(u)}`)) as Record<string, unknown> | null;
  if (!d || !d.user_id) return null;
  return { userId: String(d.user_id), username: String(d.username ?? u), displayName: String(d.display_name ?? d.username ?? u), avatar: (d.avatar as string) ?? null };
}

function fmt(lg: Record<string, unknown>): { format: string; scoring: string; starters: number } {
  const rp = (lg.roster_positions as string[]) ?? [];
  const sf = rp.includes('SUPER_FLEX') || rp.filter((p) => p === 'QB').length >= 2;
  const st = (lg.settings as Record<string, number>) ?? {};
  const ss = (lg.scoring_settings as Record<string, number>) ?? {};
  const base = st.best_ball ? 'Best Ball' : st.type === 2 ? 'Dynasty' : st.type === 1 ? 'Keeper' : 'Redraft';
  const rec = ss.rec ?? 0;
  const scoring = rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half-PPR' : 'Standard';
  const format = sf ? `${base} · Superflex` : base;
  return { format, scoring, starters: rp.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length };
}

/** All of a user's leagues for a season (NFL), newest formats included. */
export async function getLeagues(userId: string, season = '2025'): Promise<SleeperLeague[]> {
  const d = (await getJson(`${BASE}/user/${userId}/leagues/nfl/${season}`)) as Record<string, unknown>[] | null;
  return (d ?? []).map((lg) => ({
    leagueId: String(lg.league_id),
    name: String(lg.name ?? 'League'),
    totalRosters: Number(lg.total_rosters ?? 0),
    status: String(lg.status ?? ''),
    avatar: (lg.avatar as string) ?? null,
    ...fmt(lg),
  }));
}

/** League standings (team, record, points), joined from rosters + users. */
export async function getStandings(leagueId: string): Promise<{ name: string; standings: SleeperStanding[] }> {
  const [league, rosters, users] = (await Promise.all([
    getJson(`${BASE}/league/${leagueId}`),
    getJson(`${BASE}/league/${leagueId}/rosters`),
    getJson(`${BASE}/league/${leagueId}/users`),
  ])) as [Record<string, unknown>, Record<string, unknown>[], Record<string, unknown>[]];
  const byId = new Map<string, Record<string, unknown>>();
  for (const u of users ?? []) byId.set(String(u.user_id), u);
  const standings: SleeperStanding[] = (rosters ?? []).map((r) => {
    const s = (r.settings as Record<string, number>) ?? {};
    const u = r.owner_id != null ? byId.get(String(r.owner_id)) : undefined;
    const meta = (u?.metadata as Record<string, string>) ?? {};
    return {
      rosterId: Number(r.roster_id),
      teamName: meta.team_name || (u ? String(u.display_name) : `Roster ${r.roster_id}`),
      owner: u ? String(u.display_name) : '—',
      avatar: (u?.avatar as string) ?? null,
      wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0,
      pf: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      pa: (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
      playerCount: ((r.players as string[]) ?? []).length,
    };
  }).sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
  return { name: String(league?.name ?? 'League'), standings };
}
