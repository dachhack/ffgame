// THE SPORT MARKET ON THE CLIENT (v0.627.0) — ADP and projections for a
// daily-sport league's pools, lineup rows and cards, from sport_league_market.
//
// A projection is last season's actuals: a player's per-game rate (his
// season line scored under THIS league's table, over his games played) times
// the games his team has — this week's remaining dates for the week, the
// games left in the season for the season. No model, no feed: the founder's
// ask was "from previous season actuals", and that is exactly what it is.
//
// Module-level like poolSort's NFL maps, and cleared the same way: a screen
// installs its league's market and nothing outlives the league.
import type { SportDef, StatLine } from './types';
import { seasonPoints } from './card';
import { parsePlayerKey, SPORTS } from './index';
import { sportSettingsOf } from './league';
import { normalizeScoring } from './score';

export interface SportMarketRow { slug: string; adp: number | null; gp: number; season_line: StatLine | null; team: string | null }
export interface SportMarketPayload {
  ok: boolean; error?: string;
  sport?: string; season?: string; week?: number; from?: string; to?: string; today?: string;
  rows?: SportMarketRow[];
  /** team → the dates it plays in the current period */
  week_games?: Record<string, string[]>;
  /** team → games left in the season from today */
  season_left?: Record<string, number>;
  calendar?: boolean;
  adp_at?: string | null;
}

interface Installed {
  def: SportDef;
  scoring: Record<string, number>;
  today: string;
  rows: Map<string, SportMarketRow>;
  weekGames: Record<string, string[]>;
  seasonLeft: Record<string, number>;
  calendar: boolean;
  adpAt: string | null;
}
let installed: Installed | null = null;

/** Install a league's market under its scoring table. */
export function installSportMarket(def: SportDef, scoring: Record<string, number>, r: SportMarketPayload): void {
  if (!r?.ok) return;
  installed = {
    def, scoring, today: r.today ?? new Date().toISOString().slice(0, 10),
    rows: new Map((r.rows ?? []).map((x) => [x.slug, x])),
    weekGames: r.week_games ?? {}, seasonLeft: r.season_left ?? {},
    calendar: !!r.calendar, adpAt: r.adp_at ?? null,
  };
}
export function clearSportMarket(): void { installed = null; }
export const sportMarketInstalled = (): boolean => installed != null;
export const sportMarketMeta = (): { adpAt: string | null; calendar: boolean; today: string } | null =>
  installed ? { adpAt: installed.adpAt, calendar: installed.calendar, today: installed.today } : null;

const isSportKey = (slug: string) => parsePlayerKey(slug) != null;

/** Consensus ADP, or null. */
export function sportAdpFor(slug: string): number | null {
  if (!installed || !isSportKey(slug)) return null;
  const v = installed.rows.get(slug)?.adp;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Points per game under the league's table — last season's rate. Null
 *  without a line or games played. */
export function sportPpgFor(slug: string): number | null {
  if (!installed || !isSportKey(slug)) return null;
  const r = installed.rows.get(slug);
  if (!r?.season_line || !r.gp) return null;
  return seasonPoints(installed.def, r.season_line, installed.scoring) / r.gp;
}

/** The dates the player's team still plays in this period (today included). */
export function sportGamesLeftThisWeek(slug: string, today = installed?.today): string[] {
  if (!installed || !isSportKey(slug)) return [];
  const team = installed.rows.get(slug)?.team;
  if (!team) return [];
  const t = today ?? installed.today;
  return (installed.weekGames[team] ?? []).filter((d) => d >= t);
}

/** This week's projection: the rate × the games left in the period. Null
 *  without a rate; 0 when the team is done for the week. */
export function sportWeekProjFor(slug: string, today?: string): number | null {
  const ppg = sportPpgFor(slug);
  if (ppg == null) return null;
  return ppg * sportGamesLeftThisWeek(slug, today).length;
}

/** The season projection: the rate × the games left in the season. Null
 *  without a rate or a calendar. */
export function sportSeasonProjFor(slug: string): number | null {
  const ppg = sportPpgFor(slug);
  if (ppg == null || !installed) return null;
  const team = installed.rows.get(slug)?.team;
  const left = team ? installed.seasonLeft[team] : undefined;
  return left != null ? ppg * Number(left) : null;
}

/** Games left in the season for the player's team, when the calendar knows. */
export function sportSeasonGamesLeft(slug: string): number | null {
  if (!installed || !isSportKey(slug)) return null;
  const team = installed.rows.get(slug)?.team;
  const left = team ? installed.seasonLeft[team] : undefined;
  return left != null ? Number(left) : null;
}

/** Install from what a screen already holds — the league's game-mode info
 *  (its sport and sport block) — under the league's own scoring table. A
 *  non-sport league installs nothing. */
export function installSportMarketFor(gm: { sport?: string | null; sport_settings?: unknown } | null | undefined, r: SportMarketPayload): boolean {
  const sport = gm?.sport;
  if (!sport || sport === 'nfl' || !(sport in SPORTS)) return false;
  const def = SPORTS[sport as keyof typeof SPORTS];
  const ss = sportSettingsOf({ sport: gm?.sport_settings });
  installSportMarket(def, normalizeScoring(def, ss?.scoring ?? {}), r);
  return true;
}
