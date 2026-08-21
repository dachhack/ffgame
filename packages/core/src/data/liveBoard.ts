// Build the full app board (the "hero board") from a REAL live league's DB data,
// so a manager sets their lineup on the authentic Matchup board against real
// rosters — not the 2025 demo re-skin. Every league member can read memberships,
// all roster lineups, and the schedule under RLS, so this assembles a BuiltLeague
// client-side. Setup-phase only for now: no play timelines (LIVE/FINAL light up
// once the real feed populates), so player stats are zeroed.
import type { BuiltLeague } from './league';
import { REG_SEASON_WEEKS } from './league';
import type { League, FantasyTeam, Player, Pos, PlayerStats, ScheduleGame } from '../types';
import { shortName, teamForName, normName } from './players';
import { slugMeta, normTeam, setSlugMetaOverrides } from './slugMeta';
import { entrySlug, entryTeam, type PoolEntry } from './poolEntry';
import { getSupabase } from './supabaseClient';
import { liveSlate } from './liveApi';
import { setRuntimeSlate } from './nflSlate';
import type { WindowId } from '../types';

const ZERO: PlayerStats = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const teamId = (rosterId: number) => `r${rosterId}`;

// starters_json's two shapes are read by the shared reader (poolEntry.ts) — the
// definition used to live here, which is exactly why myPool could be written
// without knowing about it. The real NFL team (team/nflTeam) is carried when the
// sync provides it; older rows don't have it, so we also resolve from the slug
// map and the stats DB by name.

function poolToPlayer(p: PoolEntry): Player {
  const slug = entrySlug(p);
  const meta = slugMeta(slug);
  const pos = (p.pos as Pos) || meta.pos;
  const full = p.full || slug.replace(/-/g, ' ');
  // Resolve the NFL team so the player lands in a real game window rather than
  // being silently dropped: the sync's carried team first (most current), then the
  // baked slug map, then the stats DB by name.
  const team = normTeam(entryTeam(p)) || meta.team || teamForName(full);
  // Kickers are played as the TEAM's kicker, not a specific name — key/label them
  // like the engine's team-keyed K ("kc-k" → "KC K"), matching the demo board.
  if (pos === 'K' && team) {
    return { id: `${team.toLowerCase()}-k`, name: `${team} K`, full: `${team} Kicker`, pos: 'K', team, stats: { ...ZERO } };
  }
  const id = slug || normName(full).replace(/\s+/g, '-');
  return { id, name: shortName(full), full, pos, team, stats: { ...ZERO } };
}

/** Pool rows → `setSlugMetaOverrides` input (v0.337.2).
 *
 *  `poolToPlayer` already prefers a row's pos/team over the bake, so the ENGINE
 *  players were always fine. Everything else on the web's live surface was not:
 *  those screens read `slugMeta` directly — cardTable for the team logo,
 *  playerCard and ui.tsx for the injury badge — and a 2026 player the 2025 bake
 *  has never heard of resolved to WR with an EMPTY team. The app's boards
 *  installed around that in 0200.1; the web's live screens never did, which
 *  left them the last surface reading the raw fallback.
 *
 *  Each row is resolved EXACTLY as `poolToPlayer` resolves it, for one specific
 *  reason: the ESPN shape of `starters_json` is `{ slug, full, pos }` with NO
 *  team, and `slugMeta` consults the overlay BEFORE the bake — so mapping a row
 *  straight through would install `team: ''` and MASK a real baked team,
 *  turning a working player into a bye. Falling back through `meta.team` and
 *  `teamForName` means this overlay can only ever ADD information, never
 *  subtract it, and never disagrees with the Player the engine built from the
 *  same row.
 *
 *  Sleeper-shaped rows carry `sleeper_id`, so identities ride along on the same
 *  pass (0205): `setSlugMetaOverrides` installs an id whenever the row has one,
 *  independently of whether it had a position. An ESPN row without one simply
 *  contributes nothing.
 *
 *  Pure and export-only-for-testing: the whole rule is stateable without a
 *  database or a screen, so it is asserted directly (scripts/check-live-meta.mjs). */
export function poolMetaRows(rows: PoolEntry[]): { slug: string; pos: Pos; team: string; sleeperId?: string | null }[] {
  return rows.flatMap((p) => {
    const slug = entrySlug(p);
    if (!slug) return [];
    const meta = slugMeta(slug);
    const full = p.full || slug.replace(/-/g, ' ');
    return [{
      slug,
      pos: ((p.pos as Pos) || meta.pos),
      team: normTeam(entryTeam(p)) || meta.team || teamForName(full) || '',
      sleeperId: p.sleeper_id,
    }];
  });
}

/**
 * Assemble a BuiltLeague for one league from its DB rows, entered as the given
 * roster. `week` picks which week's rosters seed each team's player pool.
 */
export async function buildLiveLeague(leagueId: string, youRosterId: number, week: number): Promise<{ built: BuiltLeague; youTeamId: string }> {
  const sb = await getSupabase();
  if (!sb) throw new Error('live mode not configured');

  const [membersRes, schedRes, poolsRes, leagueRes] = await Promise.all([
    sb.from('league_membership').select('sleeper_roster_id, team_name, avatar_url').eq('league_id', leagueId),
    sb.from('matchup').select('week, home_roster_id, away_roster_id').eq('league_id', leagueId),
    sb.from('sleeper_lineup').select('roster_id, starters_json').eq('league_id', leagueId).eq('week', week),
    sb.from('league').select('name, season').eq('id', leagueId).maybeSingle(),
  ]);

  const members = (membersRes.data ?? []) as { sleeper_roster_id: number; team_name: string | null; avatar_url: string | null }[];
  // roster_id → its pool of players for this week.
  const poolByRoster = new Map<number, PoolEntry[]>();
  for (const row of (poolsRes.data ?? []) as { roster_id: number; starters_json: PoolEntry[] | null }[]) {
    poolByRoster.set(row.roster_id, Array.isArray(row.starters_json) ? row.starters_json : []);
  }

  // Install the league's own meta before ANY of it is read — see
  // `poolMetaRows` for why the resolution is not just the row mapped through.
  setSlugMetaOverrides(poolMetaRows([...poolByRoster.values()].flat()));

  const players: Record<string, Player> = {};
  const excluded: string[] = []; // rostered players we couldn't map to an NFL team
  const teams: FantasyTeam[] = members
    .sort((a, b) => a.sleeper_roster_id - b.sleeper_roster_id)
    .map((m) => {
      const pool = poolByRoster.get(m.sleeper_roster_id) ?? [];
      const roster: string[] = [];
      for (const p of pool) {
        if (!p || !entrySlug(p)) continue;
        const pl = poolToPlayer(p); // K is remapped to the team's kicker id
        // No resolvable NFL team → the engine can't slot them in any window and
        // they'd vanish from the board. Track for the audit below.
        if (!pl.team) excluded.push(`${pl.full} (${pl.pos})`);
        if (!players[pl.id]) players[pl.id] = pl;
        roster.push(pl.id);
      }
      return {
        id: teamId(m.sleeper_roster_id),
        name: m.team_name || `Roster ${m.sleeper_roster_id}`,
        owner: m.team_name || `Roster ${m.sleeper_roster_id}`,
        ownerId: teamId(m.sleeper_roster_id),
        seed: 0, wins: 0, losses: 0, pf: 0, pa: 0,
        roster,
      } satisfies FantasyTeam;
    });

  const schedule: ScheduleGame[] = ((schedRes.data ?? []) as { week: number; home_roster_id: number; away_roster_id: number }[])
    .map((g) => ({ week: g.week, homeId: teamId(g.home_roster_id), awayId: teamId(g.away_roster_id), homeScore: 0, awayScore: 0 }));

  const maxWeek = schedule.reduce((n, g) => Math.max(n, g.week), 0);
  const lg = leagueRes.data as { name: string | null; season: string | null } | null;
  const league: League = {
    id: leagueId,
    name: lg?.name || 'Your league',
    format: `${teams.length}-team league`,
    season: Number(lg?.season) || new Date().getUTCFullYear(),
    teams,
    schedule,
  };

  // Inject the real current-season NFL slate for this week so the window pools
  // gate correctly (falls back to the baked slate if the week isn't loaded yet).
  try {
    const slate = await liveSlate(week, lg?.season ?? undefined);
    if (slate.length) setRuntimeSlate(week, slate.map((s) => ({ away: s.away, home: s.home, aScore: 0, hScore: 0, win: s.win as WindowId, kickoff: s.kickoff ? Date.parse(s.kickoff) : undefined })));
  } catch { /* no live slate yet — window gating falls back to the baked slate */ }

  // Audit: surface any rostered players excluded because we can't resolve their
  // NFL team (so they never land in a window). Re-syncing the league carries the
  // real team through starters_json and clears these; this log names who's affected.
  if (excluded.length) {
    // eslint-disable-next-line no-console
    console.warn(`[hero board] wk${week}: ${excluded.length} rostered player(s) have no resolvable NFL team and won't appear in any window — re-sync the league to fix:`, excluded);
  }

  return {
    built: { league, players, weeks: Math.min(REG_SEASON_WEEKS, Math.max(1, maxWeek || REG_SEASON_WEEKS)) },
    youTeamId: teamId(youRosterId),
  };
}
