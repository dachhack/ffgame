// Real 2025 NFL slate per week (away @ home, final scores, time-slot window),
// from the nflverse schedule. window: tnf/early/late/snf/mnf.
import type { WindowId } from '../types';
import { WINDOWS } from './metrics';
import { realKickoff } from './realPbp';
export interface NflGame { away: string; home: string; aScore: number; hScore: number; win: WindowId; kickoff?: number; }
export const NFL_SLATE: Record<number, NflGame[]> = {
  1: [{ away: "DAL", home: "PHI", aScore: 20, hScore: 24, win: "tnf" }, { away: "KC", home: "LAC", aScore: 21, hScore: 27, win: "tnf" }, { away: "TB", home: "ATL", aScore: 23, hScore: 20, win: "early" }, { away: "CIN", home: "CLE", aScore: 17, hScore: 16, win: "early" }, { away: "MIA", home: "IND", aScore: 8, hScore: 33, win: "early" }, { away: "CAR", home: "JAX", aScore: 10, hScore: 26, win: "early" }, { away: "LV", home: "NE", aScore: 20, hScore: 13, win: "early" }, { away: "ARI", home: "NO", aScore: 20, hScore: 13, win: "early" }, { away: "PIT", home: "NYJ", aScore: 34, hScore: 32, win: "early" }, { away: "NYG", home: "WAS", aScore: 6, hScore: 21, win: "early" }, { away: "TEN", home: "DEN", aScore: 12, hScore: 20, win: "late" }, { away: "SF", home: "SEA", aScore: 17, hScore: 13, win: "late" }, { away: "DET", home: "GB", aScore: 13, hScore: 27, win: "late" }, { away: "HOU", home: "LA", aScore: 9, hScore: 14, win: "late" }, { away: "BAL", home: "BUF", aScore: 40, hScore: 41, win: "snf" }, { away: "MIN", home: "CHI", aScore: 27, hScore: 24, win: "mnf" }],
  2: [{ away: "WAS", home: "GB", aScore: 18, hScore: 27, win: "tnf" }, { away: "CLE", home: "BAL", aScore: 17, hScore: 41, win: "early" }, { away: "JAX", home: "CIN", aScore: 27, hScore: 31, win: "early" }, { away: "NYG", home: "DAL", aScore: 37, hScore: 40, win: "early" }, { away: "CHI", home: "DET", aScore: 21, hScore: 52, win: "early" }, { away: "NE", home: "MIA", aScore: 33, hScore: 27, win: "early" }, { away: "SF", home: "NO", aScore: 26, hScore: 21, win: "early" }, { away: "BUF", home: "NYJ", aScore: 30, hScore: 10, win: "early" }, { away: "SEA", home: "PIT", aScore: 31, hScore: 17, win: "early" }, { away: "LA", home: "TEN", aScore: 33, hScore: 19, win: "early" }, { away: "CAR", home: "ARI", aScore: 22, hScore: 27, win: "late" }, { away: "DEN", home: "IND", aScore: 28, hScore: 29, win: "late" }, { away: "PHI", home: "KC", aScore: 20, hScore: 17, win: "late" }, { away: "ATL", home: "MIN", aScore: 22, hScore: 6, win: "snf" }, { away: "TB", home: "HOU", aScore: 20, hScore: 19, win: "mnf" }, { away: "LAC", home: "LV", aScore: 20, hScore: 9, win: "mnf" }],
  3: [{ away: "MIA", home: "BUF", aScore: 21, hScore: 31, win: "tnf" }, { away: "ATL", home: "CAR", aScore: 0, hScore: 30, win: "early" }, { away: "GB", home: "CLE", aScore: 10, hScore: 13, win: "early" }, { away: "HOU", home: "JAX", aScore: 10, hScore: 17, win: "early" }, { away: "CIN", home: "MIN", aScore: 10, hScore: 48, win: "early" }, { away: "PIT", home: "NE", aScore: 21, hScore: 14, win: "early" }, { away: "LA", home: "PHI", aScore: 26, hScore: 33, win: "early" }, { away: "NYJ", home: "TB", aScore: 27, hScore: 29, win: "early" }, { away: "IND", home: "TEN", aScore: 41, hScore: 20, win: "early" }, { away: "LV", home: "WAS", aScore: 24, hScore: 41, win: "early" }, { away: "DEN", home: "LAC", aScore: 20, hScore: 23, win: "late" }, { away: "NO", home: "SEA", aScore: 13, hScore: 44, win: "late" }, { away: "DAL", home: "CHI", aScore: 14, hScore: 31, win: "late" }, { away: "ARI", home: "SF", aScore: 15, hScore: 16, win: "late" }, { away: "KC", home: "NYG", aScore: 22, hScore: 9, win: "snf" }, { away: "DET", home: "BAL", aScore: 38, hScore: 30, win: "mnf" }],
  4: [{ away: "SEA", home: "ARI", aScore: 23, hScore: 20, win: "tnf" }, { away: "MIN", home: "PIT", aScore: 21, hScore: 24, win: "early" }, { away: "WAS", home: "ATL", aScore: 27, hScore: 34, win: "early" }, { away: "NO", home: "BUF", aScore: 19, hScore: 31, win: "early" }, { away: "CLE", home: "DET", aScore: 10, hScore: 34, win: "early" }, { away: "TEN", home: "HOU", aScore: 0, hScore: 26, win: "early" }, { away: "CAR", home: "NE", aScore: 13, hScore: 42, win: "early" }, { away: "LAC", home: "NYG", aScore: 18, hScore: 21, win: "early" }, { away: "PHI", home: "TB", aScore: 31, hScore: 25, win: "early" }, { away: "IND", home: "LA", aScore: 20, hScore: 27, win: "late" }, { away: "JAX", home: "SF", aScore: 26, hScore: 21, win: "late" }, { away: "BAL", home: "KC", aScore: 20, hScore: 37, win: "late" }, { away: "CHI", home: "LV", aScore: 25, hScore: 24, win: "late" }, { away: "GB", home: "DAL", aScore: 40, hScore: 40, win: "snf" }, { away: "NYJ", home: "MIA", aScore: 21, hScore: 27, win: "mnf" }, { away: "CIN", home: "DEN", aScore: 3, hScore: 28, win: "mnf" }],
  5: [{ away: "SF", home: "LA", aScore: 26, hScore: 23, win: "tnf" }, { away: "MIN", home: "CLE", aScore: 21, hScore: 17, win: "early" }, { away: "HOU", home: "BAL", aScore: 44, hScore: 10, win: "early" }, { away: "MIA", home: "CAR", aScore: 24, hScore: 27, win: "early" }, { away: "LV", home: "IND", aScore: 6, hScore: 40, win: "early" }, { away: "NYG", home: "NO", aScore: 14, hScore: 26, win: "early" }, { away: "DAL", home: "NYJ", aScore: 37, hScore: 22, win: "early" }, { away: "DEN", home: "PHI", aScore: 21, hScore: 17, win: "early" }, { away: "TEN", home: "ARI", aScore: 22, hScore: 21, win: "late" }, { away: "TB", home: "SEA", aScore: 38, hScore: 35, win: "late" }, { away: "DET", home: "CIN", aScore: 37, hScore: 24, win: "late" }, { away: "WAS", home: "LAC", aScore: 27, hScore: 10, win: "late" }, { away: "NE", home: "BUF", aScore: 23, hScore: 20, win: "snf" }, { away: "KC", home: "JAX", aScore: 28, hScore: 31, win: "mnf" }],
  6: [{ away: "PHI", home: "NYG", aScore: 17, hScore: 34, win: "tnf" }, { away: "DEN", home: "NYJ", aScore: 13, hScore: 11, win: "early" }, { away: "LA", home: "BAL", aScore: 17, hScore: 3, win: "early" }, { away: "DAL", home: "CAR", aScore: 27, hScore: 30, win: "early" }, { away: "ARI", home: "IND", aScore: 27, hScore: 31, win: "early" }, { away: "SEA", home: "JAX", aScore: 20, hScore: 12, win: "early" }, { away: "LAC", home: "MIA", aScore: 29, hScore: 27, win: "early" }, { away: "NE", home: "NO", aScore: 25, hScore: 19, win: "early" }, { away: "CLE", home: "PIT", aScore: 9, hScore: 23, win: "early" }, { away: "TEN", home: "LV", aScore: 10, hScore: 20, win: "late" }, { away: "CIN", home: "GB", aScore: 18, hScore: 27, win: "late" }, { away: "SF", home: "TB", aScore: 19, hScore: 30, win: "late" }, { away: "DET", home: "KC", aScore: 17, hScore: 30, win: "snf" }, { away: "BUF", home: "ATL", aScore: 14, hScore: 24, win: "mnf" }, { away: "CHI", home: "WAS", aScore: 25, hScore: 24, win: "mnf" }],
  7: [{ away: "PIT", home: "CIN", aScore: 31, hScore: 33, win: "tnf" }, { away: "LA", home: "JAX", aScore: 35, hScore: 7, win: "early" }, { away: "NO", home: "CHI", aScore: 14, hScore: 26, win: "early" }, { away: "MIA", home: "CLE", aScore: 6, hScore: 31, win: "early" }, { away: "LV", home: "KC", aScore: 0, hScore: 31, win: "early" }, { away: "PHI", home: "MIN", aScore: 28, hScore: 22, win: "early" }, { away: "CAR", home: "NYJ", aScore: 13, hScore: 6, win: "early" }, { away: "NE", home: "TEN", aScore: 31, hScore: 13, win: "early" }, { away: "NYG", home: "DEN", aScore: 32, hScore: 33, win: "late" }, { away: "IND", home: "LAC", aScore: 38, hScore: 24, win: "late" }, { away: "GB", home: "ARI", aScore: 27, hScore: 23, win: "late" }, { away: "WAS", home: "DAL", aScore: 22, hScore: 44, win: "late" }, { away: "ATL", home: "SF", aScore: 10, hScore: 20, win: "snf" }, { away: "TB", home: "DET", aScore: 9, hScore: 24, win: "mnf" }, { away: "HOU", home: "SEA", aScore: 19, hScore: 27, win: "mnf" }],
  8: [{ away: "MIN", home: "LAC", aScore: 10, hScore: 37, win: "tnf" }, { away: "MIA", home: "ATL", aScore: 34, hScore: 10, win: "early" }, { away: "CHI", home: "BAL", aScore: 16, hScore: 30, win: "early" }, { away: "BUF", home: "CAR", aScore: 40, hScore: 9, win: "early" }, { away: "NYJ", home: "CIN", aScore: 39, hScore: 38, win: "early" }, { away: "SF", home: "HOU", aScore: 15, hScore: 26, win: "early" }, { away: "CLE", home: "NE", aScore: 13, hScore: 32, win: "early" }, { away: "NYG", home: "PHI", aScore: 20, hScore: 38, win: "early" }, { away: "TB", home: "NO", aScore: 23, hScore: 3, win: "late" }, { away: "DAL", home: "DEN", aScore: 24, hScore: 44, win: "late" }, { away: "TEN", home: "IND", aScore: 14, hScore: 38, win: "late" }, { away: "GB", home: "PIT", aScore: 35, hScore: 25, win: "snf" }, { away: "WAS", home: "KC", aScore: 7, hScore: 28, win: "mnf" }],
  9: [{ away: "BAL", home: "MIA", aScore: 28, hScore: 6, win: "tnf" }, { away: "CHI", home: "CIN", aScore: 47, hScore: 42, win: "early" }, { away: "MIN", home: "DET", aScore: 27, hScore: 24, win: "early" }, { away: "CAR", home: "GB", aScore: 16, hScore: 13, win: "early" }, { away: "DEN", home: "HOU", aScore: 18, hScore: 15, win: "early" }, { away: "ATL", home: "NE", aScore: 23, hScore: 24, win: "early" }, { away: "SF", home: "NYG", aScore: 34, hScore: 24, win: "early" }, { away: "IND", home: "PIT", aScore: 20, hScore: 27, win: "early" }, { away: "LAC", home: "TEN", aScore: 27, hScore: 20, win: "early" }, { away: "NO", home: "LA", aScore: 10, hScore: 34, win: "late" }, { away: "JAX", home: "LV", aScore: 30, hScore: 29, win: "late" }, { away: "KC", home: "BUF", aScore: 21, hScore: 28, win: "late" }, { away: "SEA", home: "WAS", aScore: 38, hScore: 14, win: "snf" }, { away: "ARI", home: "DAL", aScore: 27, hScore: 17, win: "mnf" }],
  10: [{ away: "LV", home: "DEN", aScore: 7, hScore: 10, win: "tnf" }, { away: "ATL", home: "IND", aScore: 25, hScore: 31, win: "early" }, { away: "NO", home: "CAR", aScore: 17, hScore: 7, win: "early" }, { away: "NYG", home: "CHI", aScore: 20, hScore: 24, win: "early" }, { away: "JAX", home: "HOU", aScore: 29, hScore: 36, win: "early" }, { away: "BUF", home: "MIA", aScore: 13, hScore: 30, win: "early" }, { away: "BAL", home: "MIN", aScore: 27, hScore: 19, win: "early" }, { away: "CLE", home: "NYJ", aScore: 20, hScore: 27, win: "early" }, { away: "NE", home: "TB", aScore: 28, hScore: 23, win: "early" }, { away: "ARI", home: "SEA", aScore: 22, hScore: 44, win: "late" }, { away: "LA", home: "SF", aScore: 42, hScore: 26, win: "late" }, { away: "DET", home: "WAS", aScore: 44, hScore: 22, win: "late" }, { away: "PIT", home: "LAC", aScore: 10, hScore: 25, win: "snf" }, { away: "PHI", home: "GB", aScore: 10, hScore: 7, win: "mnf" }],
  11: [{ away: "NYJ", home: "NE", aScore: 14, hScore: 27, win: "tnf" }, { away: "WAS", home: "MIA", aScore: 13, hScore: 16, win: "early" }, { away: "CAR", home: "ATL", aScore: 30, hScore: 27, win: "early" }, { away: "TB", home: "BUF", aScore: 32, hScore: 44, win: "early" }, { away: "LAC", home: "JAX", aScore: 6, hScore: 35, win: "early" }, { away: "CHI", home: "MIN", aScore: 19, hScore: 17, win: "early" }, { away: "GB", home: "NYG", aScore: 27, hScore: 20, win: "early" }, { away: "CIN", home: "PIT", aScore: 12, hScore: 34, win: "early" }, { away: "HOU", home: "TEN", aScore: 16, hScore: 13, win: "early" }, { away: "SF", home: "ARI", aScore: 41, hScore: 22, win: "late" }, { away: "SEA", home: "LA", aScore: 19, hScore: 21, win: "late" }, { away: "BAL", home: "CLE", aScore: 23, hScore: 16, win: "late" }, { away: "KC", home: "DEN", aScore: 19, hScore: 22, win: "late" }, { away: "DET", home: "PHI", aScore: 9, hScore: 16, win: "snf" }, { away: "DAL", home: "LV", aScore: 33, hScore: 16, win: "mnf" }],
  12: [{ away: "BUF", home: "HOU", aScore: 19, hScore: 23, win: "tnf" }, { away: "NYJ", home: "BAL", aScore: 10, hScore: 23, win: "early" }, { away: "PIT", home: "CHI", aScore: 28, hScore: 31, win: "early" }, { away: "NE", home: "CIN", aScore: 26, hScore: 20, win: "early" }, { away: "NYG", home: "DET", aScore: 27, hScore: 34, win: "early" }, { away: "MIN", home: "GB", aScore: 6, hScore: 23, win: "early" }, { away: "IND", home: "KC", aScore: 20, hScore: 23, win: "early" }, { away: "SEA", home: "TEN", aScore: 30, hScore: 24, win: "early" }, { away: "JAX", home: "ARI", aScore: 27, hScore: 24, win: "late" }, { away: "CLE", home: "LV", aScore: 24, hScore: 10, win: "late" }, { away: "PHI", home: "DAL", aScore: 21, hScore: 24, win: "late" }, { away: "ATL", home: "NO", aScore: 24, hScore: 10, win: "late" }, { away: "TB", home: "LA", aScore: 7, hScore: 34, win: "snf" }, { away: "CAR", home: "SF", aScore: 9, hScore: 20, win: "mnf" }],
  13: [{ away: "GB", home: "DET", aScore: 31, hScore: 24, win: "tnf" }, { away: "KC", home: "DAL", aScore: 28, hScore: 31, win: "tnf" }, { away: "CIN", home: "BAL", aScore: 32, hScore: 14, win: "tnf" }, { away: "CHI", home: "PHI", aScore: 24, hScore: 15, win: "tnf" }, { away: "LA", home: "CAR", aScore: 28, hScore: 31, win: "early" }, { away: "SF", home: "CLE", aScore: 26, hScore: 8, win: "early" }, { away: "HOU", home: "IND", aScore: 20, hScore: 16, win: "early" }, { away: "NO", home: "MIA", aScore: 17, hScore: 21, win: "early" }, { away: "ATL", home: "NYJ", aScore: 24, hScore: 27, win: "early" }, { away: "ARI", home: "TB", aScore: 17, hScore: 20, win: "early" }, { away: "JAX", home: "TEN", aScore: 25, hScore: 3, win: "early" }, { away: "MIN", home: "SEA", aScore: 0, hScore: 26, win: "late" }, { away: "LV", home: "LAC", aScore: 14, hScore: 31, win: "late" }, { away: "BUF", home: "PIT", aScore: 26, hScore: 7, win: "late" }, { away: "DEN", home: "WAS", aScore: 27, hScore: 26, win: "snf" }, { away: "NYG", home: "NE", aScore: 15, hScore: 33, win: "mnf" }],
  14: [{ away: "DAL", home: "DET", aScore: 30, hScore: 44, win: "tnf" }, { away: "SEA", home: "ATL", aScore: 37, hScore: 9, win: "early" }, { away: "PIT", home: "BAL", aScore: 27, hScore: 22, win: "early" }, { away: "CIN", home: "BUF", aScore: 34, hScore: 39, win: "early" }, { away: "TEN", home: "CLE", aScore: 31, hScore: 29, win: "early" }, { away: "IND", home: "JAX", aScore: 19, hScore: 36, win: "early" }, { away: "WAS", home: "MIN", aScore: 0, hScore: 31, win: "early" }, { away: "MIA", home: "NYJ", aScore: 34, hScore: 10, win: "early" }, { away: "NO", home: "TB", aScore: 24, hScore: 20, win: "early" }, { away: "DEN", home: "LV", aScore: 24, hScore: 17, win: "late" }, { away: "LA", home: "ARI", aScore: 45, hScore: 17, win: "late" }, { away: "CHI", home: "GB", aScore: 21, hScore: 28, win: "late" }, { away: "HOU", home: "KC", aScore: 20, hScore: 10, win: "snf" }, { away: "PHI", home: "LAC", aScore: 19, hScore: 22, win: "mnf" }],
};

// ── Live slate override ───────────────────────────────────────────────────────
// The baked NFL_SLATE above is 2025 (the demo + the baked-2025 force-resolve
// path). For LIVE play it would be wrong — a 2026 week reuses 2025's matchups and
// byes because both are keyed by bare week number. So the live current-season
// schedule is injected at runtime (mirrors realPbp's setSyntheticWeeks): the
// worker derives it from the ESPN scoreboard (windowFromKickoff), and the client
// loads it from the nfl_slate table — both call setRuntimeSlate. When a week is
// overridden, every slate lookup below uses it; otherwise it falls back to the
// baked 2025 data. (Scores are unknown for a future game → 0/0; only home/away/
// win drive slate-gating + the K/DST bye check.)
const RUNTIME_SLATE: Record<number, NflGame[]> = {};
export function setRuntimeSlate(week: number, games: NflGame[]): void {
  if (Array.isArray(games) && games.length) RUNTIME_SLATE[week] = games;
}
/** Drop all live overrides → revert to the baked 2025 slate (the force-resolve /
 *  demo path resolves baked 2025 data, so it must use the 2025 slate). */
export function clearRuntimeSlate(): void {
  for (const k of Object.keys(RUNTIME_SLATE)) delete RUNTIME_SLATE[Number(k)];
}
/** The slate for a week — the live override if one's been set, else baked 2025. */
function slateFor(week: number): NflGame[] | undefined {
  return RUNTIME_SLATE[week] ?? NFL_SLATE[week];
}

/** Whether we have a slate for a week (live override or baked) — gates slate-aware UI. */
export const hasSlate = (week: number): boolean => !!slateFor(week);

/** The NFL game a team plays in a given week, or undefined (bye). */
export function nflGameForTeam(week: number, team?: string | null): NflGame | undefined {
  if (!team) return undefined;
  return (slateFor(week) || []).find((g) => g.home === team || g.away === team);
}

/** The time-slot window a team plays in for a given week, or null (bye). */
export function windowForTeam(week: number, team?: string | null): WindowId | null {
  return nflGameForTeam(week, team)?.win ?? null;
}

/** Every real NFL game scheduled in a given time-slot window that week. */
export function gamesInWindow(week: number, win: WindowId): NflGame[] {
  return (slateFor(week) || []).filter((g) => g.win === win);
}

// ── Calendar dates ──────────────────────────────────────────────────────────
// Week 1 opens on the Thursday after Labor Day (first Monday of September); each
// later week shifts by 7 days, windows fall on Thu / Sun / Mon within the week.
// The season year is set when a league loads (setSeasonYear) so 2026 leagues show
// 2026 dates, not the baked 2025 opener.
function seasonStartUTC(year: number): number {
  const sep1 = new Date(Date.UTC(year, 8, 1));
  const toMonday = (1 - sep1.getUTCDay() + 7) % 7; // Sep 1 → first Monday (Labor Day)
  return Date.UTC(year, 8, 1 + toMonday + 3);      // Labor Day + 3 = Thursday kickoff
}
let SEASON_START = seasonStartUTC(2025); // default: the baked 2025 season (demo)
/** Point the calendar at a season's opener (Thu after Labor Day). */
export function setSeasonYear(year: number): void {
  if (Number.isFinite(year) && year > 2000 && year < 2100) SEASON_START = seasonStartUTC(year);
}
const DAY = 86_400_000;
const WIN_DAY_OFFSET: Record<WindowId, number> = { tnf: 0, early: 3, late: 3, snf: 3, mnf: 4 };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar date a given window is played on, that week. */
export function windowDate(week: number, win: WindowId): Date {
  return new Date(SEASON_START + ((week - 1) * 7 + WIN_DAY_OFFSET[win]) * DAY);
}

// ET calendar parts for an epoch-ms — so a window's real day matches its ET
// kickoff (a Wed-night opener reads "Wed", not the computed Thursday).
function etParts(ms: number): { wd: string; mo: string; da: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(ms));
  return {
    wd: p.find((x) => x.type === 'weekday')?.value ?? '',
    mo: p.find((x) => x.type === 'month')?.value ?? '',
    da: Number(p.find((x) => x.type === 'day')?.value ?? 0),
  };
}
/** Every real kickoff (epoch ms) among a week's games, from the loaded slate. */
function weekKickoffs(week: number): number[] {
  return (slateFor(week) || []).map((g) => g.kickoff).filter((k): k is number => typeof k === 'number');
}

/** e.g. "Thu, Sep 4" for a window — the real kickoff day when the slate carries it
 *  (so odd weeks like a Wednesday opener read correctly), else the computed slot. */
export function windowDateLabel(week: number, win: WindowId): string {
  const ms = windowKickoffMs(week, win);
  if (ms != null) { const { wd, mo, da } = etParts(ms); return `${wd}, ${mo} ${da}`; }
  const d = windowDate(week, win);
  return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The week's date span, first → last game, e.g. "Sep 4 – 8" — real kickoffs when
 *  loaded (so it spans a Wed-night opener through Monday), else computed. */
export function weekDateRange(week: number): string {
  const ks = weekKickoffs(week);
  if (ks.length) {
    const lo = etParts(Math.min(...ks)), hi = etParts(Math.max(...ks));
    const b = lo.mo === hi.mo ? `${hi.da}` : `${hi.mo} ${hi.da}`;
    return `${lo.mo} ${lo.da} – ${b}`;
  }
  const thu = windowDate(week, 'tnf');
  const mon = windowDate(week, 'mnf');
  const a = `${MO[thu.getUTCMonth()]} ${thu.getUTCDate()}`;
  const b = thu.getUTCMonth() === mon.getUTCMonth() ? `${mon.getUTCDate()}` : `${MO[mon.getUTCMonth()]} ${mon.getUTCDate()}`;
  return `${a} – ${b}`;
}

// ── Lineup lock ───────────────────────────────────────────────────────────
// Lineups lock one hour before the week's first game kicks off.
/** A window's scheduled kickoff as seconds-of-day (ET), parsed from its `time`
 *  label e.g. "Thu 8:15p". */
function slotKickoffSod(timeStr: string): number {
  const t = timeStr.split(' ')[1] ?? timeStr;
  const m = /(\d+):(\d+)([ap])/i.exec(t);
  if (!m) return 13 * 3600;
  let h = (+m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 3600 + (+m[2]) * 60;
}
function fmtTimeOfDay(sod: number): string {
  const x = ((Math.floor(sod) % 86400) + 86400) % 86400;
  const h = Math.floor(x / 3600);
  const mm = Math.floor((x % 3600) / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
/** The first window that week that actually has games (earliest kickoff). */
function firstGameWindow(week: number) {
  return WINDOWS.find((w) => gamesInWindow(week, w.id).length > 0) ?? WINDOWS[0];
}

// ── Real kickoff times (when the week's play-by-play is loaded) ───────────────
// epoch ms → ET seconds-of-day.
function etSod(ms: number): number {
  const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(ms) % 24;
  const m = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: '2-digit' }).format(ms);
  return h * 3600 + m * 60;
}
// seconds-of-day → compact slot label e.g. "1:00p" (matches the window labels).
function fmtSodShort(sod: number): string {
  const x = ((Math.floor(sod) % 86400) + 86400) % 86400;
  const h = Math.floor(x / 3600), mm = Math.floor((x % 3600) / 60);
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
}
/** Earliest real kickoff (epoch ms) among a window's games, or null if unknown
 *  (week not loaded). */
export function windowKickoffMs(week: number, win: WindowId): number | null {
  let min: number | null = null;
  for (const g of gamesInWindow(week, win)) {
    // Prefer the slate's scheduled kickoff (known pre-season); fall back to the
    // real first-snap from play-by-play once the week is live.
    const k = (typeof g.kickoff === 'number' ? g.kickoff : null) ?? realKickoff(week, g.home) ?? realKickoff(week, g.away);
    if (k != null && (min == null || k < min)) min = k;
  }
  return min;
}
/** A window's kickoff as ET seconds-of-day — the real first-snap time when the
 *  week is loaded, else the scheduled slot time. Base for the live wall clock. */
export function windowKickoffSod(week: number, win: WindowId): number {
  const ms = windowKickoffMs(week, win);
  if (ms != null) return etSod(ms);
  const w = WINDOWS.find((x) => x.id === win);
  return w ? slotKickoffSod(w.time) : 13 * 3600;
}
/** A single game's real kickoff as "Wed 8:20p" (ET day + time). */
export function kickoffLabel(ms: number): string {
  return `${etParts(ms).wd} ${fmtSodShort(etSod(ms))}`;
}

/** A window's compact kickoff label e.g. "1:00p" — real when loaded, else slot. */
export function windowTimeLabel(week: number, win: WindowId): string {
  const ms = windowKickoffMs(week, win);
  if (ms != null) return fmtSodShort(etSod(ms));
  const w = WINDOWS.find((x) => x.id === win);
  return w ? (w.time.split(' ').slice(1).join(' ')) : '';
}
/** Lineup-lock label: the actual date + time one hour before the week's first
 *  game kicks off, e.g. "Thu, Sep 4 · 7:15 PM ET". Uses the real kickoff when
 *  the week is loaded, else the scheduled slot time. */
export function weekLockLabel(week: number): string {
  const w = firstGameWindow(week);
  const lockSod = windowKickoffSod(week, w.id) - 3600;
  return `${windowDateLabel(week, w.id)} · ${fmtTimeOfDay(lockSod)} ET`;
}
