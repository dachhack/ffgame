// Build the full app board (the "hero board") from a REAL live league's DB data,
// so a manager sets their lineup on the authentic Matchup board against real
// rosters — not the 2025 demo re-skin. Every league member can read memberships,
// all roster lineups, and the schedule under RLS, so this assembles a BuiltLeague
// client-side. Setup-phase only for now: no play timelines (LIVE/FINAL light up
// once the real feed populates), so player stats are zeroed.
import type { BuiltLeague } from './league';
import { REG_SEASON_WEEKS } from './league';
import type { League, FantasyTeam, Player, Pos, PlayerStats, ScheduleGame } from '../types';
import { shortName } from './players';
import { slugMeta } from './slugMeta';
import { supabase } from './supabaseClient';
import { liveSlate } from './liveApi';
import { setRuntimeSlate } from './nflSlate';
import type { WindowId } from '../types';

const ZERO: PlayerStats = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const teamId = (rosterId: number) => `r${rosterId}`;

interface PoolEntry { slug: string; full: string; pos: string }

function poolToPlayer(p: PoolEntry): Player {
  const meta = slugMeta(p.slug);
  return { id: p.slug, name: shortName(p.full), full: p.full, pos: (p.pos as Pos) || meta.pos, team: meta.team, stats: { ...ZERO } };
}

/**
 * Assemble a BuiltLeague for one league from its DB rows, entered as the given
 * roster. `week` picks which week's rosters seed each team's player pool.
 */
export async function buildLiveLeague(leagueId: string, youRosterId: number, week: number): Promise<{ built: BuiltLeague; youTeamId: string }> {
  if (!supabase) throw new Error('live mode not configured');
  const sb = supabase;

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

  const players: Record<string, Player> = {};
  const teams: FantasyTeam[] = members
    .sort((a, b) => a.sleeper_roster_id - b.sleeper_roster_id)
    .map((m) => {
      const pool = poolByRoster.get(m.sleeper_roster_id) ?? [];
      const roster: string[] = [];
      for (const p of pool) {
        if (!p?.slug) continue;
        if (!players[p.slug]) players[p.slug] = poolToPlayer(p);
        roster.push(p.slug);
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

  return {
    built: { league, players, weeks: Math.min(REG_SEASON_WEEKS, Math.max(1, maxWeek || REG_SEASON_WEEKS)) },
    youTeamId: teamId(youRosterId),
  };
}
