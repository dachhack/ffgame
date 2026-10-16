// TIERS INSIDE ONE LEAGUE (0507, v0.728.0). Founder: "Looks like relegation
// is between linked leagues at seasons end. Lets also make within season
// within league relegation." The league's divisions are the tiers, top to
// bottom; each tier plays only inside itself; every PERIOD (2–6 weeks) the
// bottom movers of a tier swap with the top movers of the tier below on the
// period's record, points scored breaking ties. Pure — both clients and the
// check read it; the database is the authority on every move.

export interface TierTeam { roster_id: number; team: string; wins: number; losses: number; points: number }
export interface TierTable { tier: string; rank: number; teams: TierTeam[] }
export interface TierMove { after_week: number; roster_id: number; team: string; direction: 'up' | 'down'; from_tier: string; to_tier: string }
export interface LeagueTiersState {
  ok: boolean; error?: string; on: boolean;
  period?: number; movers?: number; start?: number;
  /** The current period's weeks (its table is these weeks' record). */
  period_from?: number; period_to?: number; last_regular?: number;
  tiers?: TierTable[]; moves?: TierMove[];
}

export const TIER_PERIODS = [2, 3, 4, 5, 6] as const;
export const TIER_MOVERS = [1, 2, 3] as const;

/** Where a team in a tier's table stands if the period ended now: going up,
 *  going down, or staying. The top tier has no "up", the bottom no "down". */
export function tierZone(tierIndex: number, tierCount: number, place: number, size: number, movers: number): 'up' | 'down' | null {
  if (tierIndex > 0 && place < movers) return 'up';
  if (tierIndex < tierCount - 1 && place >= size - movers) return 'down';
  return null;
}

/** "Weeks 5–8" — the current period. */
export const periodLabel = (s: LeagueTiersState): string =>
  s.period_from != null && s.period_to != null ? (s.period_from === s.period_to ? `Week ${s.period_from}` : `Weeks ${s.period_from}–${s.period_to}`) : '';

/** The latest boundary's moves, as one line: "After week 4: Hawks ▲ Premier · Owls ▼ Championship". */
export function lastTierMovesLine(s: LeagueTiersState): string | null {
  const m = s.moves ?? [];
  if (!m.length) return null;
  const wk = Math.max(...m.map((x) => x.after_week));
  const last = m.filter((x) => x.after_week === wk);
  return `After week ${wk}: ${last.map((x) => `${x.team} ${x.direction === 'up' ? '▲' : '▼'} ${x.to_tier}`).join(' · ')}`;
}

export const TIERS_INFO = 'Your divisions become tiers, top to bottom, and each tier plays only inside itself.\n\n'
  + 'Every period (2–6 weeks) the bottom teams of each tier swap with the top teams of the tier below, on that period\'s record — points scored break ties. Then the next period is scheduled inside the new tiers.\n\n'
  + 'Only the current period\'s weeks are on the schedule. Turning tiers on or off rebuilds the schedule from the next week that hasn\'t started; a lineup already saved for those weeks is set again.';
