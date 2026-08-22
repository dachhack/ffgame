// Real 2025 NFL slate per week (away @ home, final scores, time-slot window),
// from the nflverse schedule. window: tnf/early/late/snf/mnf.
import type { WindowId, GameWindow } from '../types';
import { WINDOWS } from './metrics';
import { realKickoff } from './realPbp';
import { normTeam } from './slugMeta';
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

  // ── WEEKS 15–22 (v0.286.0) ────────────────────────────────────────────────
  // The rest of 2025: weeks 15–18, then the postseason as nflverse numbers it
  // (19 wild card · 20 divisional · 21 conference · 22 Super Bowl). The FANTASY
  // regular season is still 14 weeks — these are here because the bake now runs
  // this far, and a league's playoffs default to weeks 15–17.
  //
  // Their `win` ids are read straight off each game's real kickoff (Saturday
  // slates get "sat"), which weeks 1–14 above do NOT do: those were cut before
  // the derivation existed and round Friday and 9:30am-London games into tnf
  // and early. They are left alone deliberately — drip windows key off this,
  // and re-cutting a week a live league has already played would move its
  // lineup slots underneath it.
  15: [{ away: "ATL", home: "TB", aScore: 29, hScore: 28, win: "tnf" }, { away: "WAS", home: "NYG", aScore: 29, hScore: 21, win: "early" }, { away: "NYJ", home: "JAX", aScore: 20, hScore: 48, win: "early" }, { away: "LAC", home: "KC", aScore: 16, hScore: 13, win: "early" }, { away: "ARI", home: "HOU", aScore: 20, hScore: 40, win: "early" }, { away: "BAL", home: "CIN", aScore: 24, hScore: 0, win: "early" }, { away: "LV", home: "PHI", aScore: 0, hScore: 31, win: "early" }, { away: "BUF", home: "NE", aScore: 35, hScore: 31, win: "early" }, { away: "CLE", home: "CHI", aScore: 3, hScore: 31, win: "early" }, { away: "DET", home: "LA", aScore: 34, hScore: 41, win: "late" }, { away: "GB", home: "DEN", aScore: 26, hScore: 34, win: "late" }, { away: "IND", home: "SEA", aScore: 16, hScore: 18, win: "late" }, { away: "CAR", home: "NO", aScore: 17, hScore: 20, win: "late" }, { away: "TEN", home: "SF", aScore: 24, hScore: 37, win: "late" }, { away: "MIN", home: "DAL", aScore: 34, hScore: 26, win: "snf" }, { away: "MIA", home: "PIT", aScore: 15, hScore: 28, win: "mnf" }],
  16: [{ away: "LA", home: "SEA", aScore: 37, hScore: 38, win: "tnf" }, { away: "PHI", home: "WAS", aScore: 29, hScore: 18, win: "sat" }, { away: "GB", home: "CHI", aScore: 16, hScore: 22, win: "sat" }, { away: "NYJ", home: "NO", aScore: 6, hScore: 29, win: "early" }, { away: "BUF", home: "CLE", aScore: 23, hScore: 20, win: "early" }, { away: "KC", home: "TEN", aScore: 9, hScore: 26, win: "early" }, { away: "CIN", home: "MIA", aScore: 45, hScore: 21, win: "early" }, { away: "MIN", home: "NYG", aScore: 16, hScore: 13, win: "early" }, { away: "LAC", home: "DAL", aScore: 34, hScore: 17, win: "early" }, { away: "TB", home: "CAR", aScore: 20, hScore: 23, win: "early" }, { away: "JAX", home: "DEN", aScore: 34, hScore: 20, win: "late" }, { away: "ATL", home: "ARI", aScore: 26, hScore: 19, win: "late" }, { away: "LV", home: "HOU", aScore: 21, hScore: 23, win: "late" }, { away: "PIT", home: "DET", aScore: 29, hScore: 24, win: "late" }, { away: "NE", home: "BAL", aScore: 28, hScore: 24, win: "snf" }, { away: "SF", home: "IND", aScore: 48, hScore: 27, win: "mnf" }],
  17: [{ away: "DAL", home: "WAS", aScore: 30, hScore: 23, win: "tnf" }, { away: "DET", home: "MIN", aScore: 10, hScore: 23, win: "tnf" }, { away: "DEN", home: "KC", aScore: 20, hScore: 13, win: "tnf" }, { away: "HOU", home: "LAC", aScore: 20, hScore: 16, win: "sat" }, { away: "BAL", home: "GB", aScore: 41, hScore: 24, win: "sat" }, { away: "ARI", home: "CIN", aScore: 14, hScore: 37, win: "early" }, { away: "SEA", home: "CAR", aScore: 27, hScore: 10, win: "early" }, { away: "NE", home: "NYJ", aScore: 42, hScore: 10, win: "early" }, { away: "TB", home: "MIA", aScore: 17, hScore: 20, win: "early" }, { away: "JAX", home: "IND", aScore: 23, hScore: 17, win: "early" }, { away: "NO", home: "TEN", aScore: 34, hScore: 26, win: "early" }, { away: "PIT", home: "CLE", aScore: 6, hScore: 13, win: "early" }, { away: "NYG", home: "LV", aScore: 34, hScore: 10, win: "late" }, { away: "PHI", home: "BUF", aScore: 13, hScore: 12, win: "late" }, { away: "CHI", home: "SF", aScore: 38, hScore: 42, win: "snf" }, { away: "LA", home: "ATL", aScore: 24, hScore: 27, win: "mnf" }],
  18: [{ away: "CAR", home: "TB", aScore: 14, hScore: 16, win: "sat" }, { away: "SEA", home: "SF", aScore: 13, hScore: 3, win: "sat" }, { away: "TEN", home: "JAX", aScore: 7, hScore: 41, win: "early" }, { away: "IND", home: "HOU", aScore: 30, hScore: 38, win: "early" }, { away: "CLE", home: "CIN", aScore: 20, hScore: 18, win: "early" }, { away: "DAL", home: "NYG", aScore: 17, hScore: 34, win: "early" }, { away: "NO", home: "ATL", aScore: 17, hScore: 19, win: "early" }, { away: "GB", home: "MIN", aScore: 3, hScore: 16, win: "early" }, { away: "DET", home: "CHI", aScore: 19, hScore: 16, win: "late" }, { away: "ARI", home: "LA", aScore: 20, hScore: 37, win: "late" }, { away: "WAS", home: "PHI", aScore: 24, hScore: 17, win: "late" }, { away: "KC", home: "LV", aScore: 12, hScore: 14, win: "late" }, { away: "NYJ", home: "BUF", aScore: 8, hScore: 35, win: "late" }, { away: "MIA", home: "NE", aScore: 10, hScore: 38, win: "late" }, { away: "LAC", home: "DEN", aScore: 3, hScore: 19, win: "late" }, { away: "BAL", home: "PIT", aScore: 24, hScore: 26, win: "snf" }],
  19: [{ away: "LA", home: "CAR", aScore: 34, hScore: 31, win: "sat" }, { away: "GB", home: "CHI", aScore: 27, hScore: 31, win: "sat" }, { away: "BUF", home: "JAX", aScore: 27, hScore: 24, win: "early" }, { away: "SF", home: "PHI", aScore: 23, hScore: 19, win: "late" }, { away: "LAC", home: "NE", aScore: 3, hScore: 16, win: "snf" }, { away: "HOU", home: "PIT", aScore: 30, hScore: 6, win: "mnf" }],
  20: [{ away: "BUF", home: "DEN", aScore: 30, hScore: 33, win: "sat" }, { away: "SF", home: "SEA", aScore: 6, hScore: 41, win: "sat" }, { away: "HOU", home: "NE", aScore: 16, hScore: 28, win: "late" }, { away: "LA", home: "CHI", aScore: 20, hScore: 17, win: "snf" }],
  21: [{ away: "NE", home: "DEN", aScore: 10, hScore: 7, win: "late" }, { away: "LA", home: "SEA", aScore: 27, hScore: 31, win: "snf" }],
  22: [{ away: "SEA", home: "NE", aScore: 29, hScore: 13, win: "snf" }],
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
  if (Array.isArray(games) && games.length) { RUNTIME_SLATE[week] = games; derivedCache.delete(week); }
}
/** Drop all live overrides → revert to the baked 2025 slate (the force-resolve /
 *  demo path resolves baked 2025 data, so it must use the 2025 slate). */
export function clearRuntimeSlate(): void {
  for (const k of Object.keys(RUNTIME_SLATE)) delete RUNTIME_SLATE[Number(k)];
  derivedCache.clear();
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
  // NORMALISED on both sides, for the reason spelled out on windowForTeam below
  // — this compared raw strings while its neighbour normalised, so a player on
  // LAR / WSH / JAC matched no game at all. Same slate, same codes, and the same
  // silent miss: the game slate preview simply left that player out rather than
  // listing him against the wrong game.
  const want = normTeam(team);
  return (slateFor(week) || []).find((g) => normTeam(g.home) === want || normTeam(g.away) === want);
}

/** The time-slot window a team plays in for a given week, or null (bye). */
export function windowForTeam(week: number, team?: string | null): WindowId | null {
  if (!team) return null;
  // NORMALISE the input. The map is keyed by the slate's codes, and the slate
  // says LA / WAS / JAX while feeds and player rows say LAR / WSH / JAC. An
  // un-normalised lookup misses silently and the player lands in no window at
  // all — invisible everywhere rather than visibly wrong, which is the harder
  // failure to notice.
  return deriveWeek(week).teamWin.get(normTeam(team)) ?? null;
}

/** Every real NFL game scheduled in a given time-slot window that week. */
export function gamesInWindow(week: number, win: WindowId): NflGame[] {
  return deriveWeek(week).gamesByWin.get(win) ?? [];
}

// ── Dynamic game windows ──────────────────────────────────────────────────────
// A week's lineup windows are DERIVED from its real kickoffs: games are clustered
// by start time (a game more than an hour after a window's first kickoff opens its
// own window), and each window gets slots = min(3, ceil(games / 3)). A normal week
// reproduces the fixed five — TNF / Sun-early ×3 / Sun-late ×2 / SNF / MNF = 8
// slots — while an odd week (e.g. the 2026 Week-1 Wednesday opener) grows an extra
// 1-slot window. When the slate carries no real kickoffs (the baked 2025 demo), we
// fall back to the fixed WINDOWS model, grouped by each game's baked `win`.
const WIN_HOUR = 3_600_000;

interface DerivedWeek { windows: GameWindow[]; teamWin: Map<string, string>; gamesByWin: Map<string, NflGame[]>; }
const derivedCache = new Map<number, DerivedWeek>();

function etWeekday(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(ms);
}
/** A cluster's window id + headline labels, from its earliest kickoff (ET day +
 *  hour). Sunday splits by kickoff hour into the familiar morning/1pm/4pm/night
 *  buckets; every other weekday is its own named slate. */
function winMetaFor(ms: number): { id: string; label: string; sub: string } {
  const wd = etWeekday(ms);
  const hr = etSod(ms) / 3600;
  switch (wd) {
    case 'Thu': return { id: 'tnf', label: 'TNF', sub: 'Thursday Night' };
    case 'Wed': return { id: 'wed', label: 'WED', sub: 'Wednesday' };
    case 'Fri': return { id: 'fri', label: 'FRI', sub: 'Friday' };
    case 'Sat': return { id: 'sat', label: 'SAT', sub: 'Saturday' };
    case 'Tue': return { id: 'tue', label: 'TUE', sub: 'Tuesday' };
    case 'Mon': return { id: 'mnf', label: 'MNF', sub: 'Monday Night' };
    default: // Sunday — bucket by kickoff hour
      if (hr < 11) return { id: 'am', label: 'SUN AM', sub: 'Sunday Morning' };
      if (hr < 15) return { id: 'early', label: 'SUN 1PM', sub: 'Sunday Early' };
      if (hr < 18) return { id: 'late', label: 'SUN 4PM', sub: 'Sunday Late' };
      return { id: 'snf', label: 'SNF', sub: 'Sunday Night' };
  }
}

/** Window id per kickoff (parallel array), via the same greedy clustering that
 *  builds a week's lineup windows: kickoffs sort ascending, a game joins the
 *  open cluster while it starts within an hour of the cluster's first kickoff,
 *  and each cluster is named by winMetaFor — with a numeric suffix when a base
 *  id repeats (two separate Thursday slates → tnf, tnf2). Exported for the
 *  server's slate writer (server/src/poll/scoreboard.js): the `win` it stores
 *  in nfl_slate keys per-window sealing (lock.js) AND the 0058 DB lock trigger,
 *  so it must equal the id the client stamps on picks for the same game. */
export function windowIdsFromKickoffs(kickoffs: number[]): string[] {
  const order = kickoffs.map((k, i) => [k, i] as const).sort((a, b) => a[0] - b[0]);
  const ids = new Array<string>(kickoffs.length);
  const usedBase = new Map<string, number>();
  let cluster: number[] = [];
  let anchor = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const meta = winMetaFor(anchor);
    const n = usedBase.get(meta.id) ?? 0; usedBase.set(meta.id, n + 1);
    const id = n === 0 ? meta.id : `${meta.id}${n + 1}`; // disambiguate a repeated bucket
    for (const i of cluster) ids[i] = id;
  };
  for (const [k, i] of order) {
    if (!cluster.length || k - anchor <= WIN_HOUR) { if (!cluster.length) anchor = k; cluster.push(i); }
    else { flush(); cluster = [i]; anchor = k; }
  }
  flush();
  return ids;
}

/** Cluster a week's slate into its real game windows (memoized per week). Falls
 *  back to the fixed five when kickoffs aren't fully known. */
function deriveWeek(week: number): DerivedWeek {
  const cached = derivedCache.get(week);
  if (cached) return cached;
  const slate = slateFor(week) ?? [];
  const kicks = slate.filter((g) => typeof g.kickoff === 'number') as (NflGame & { kickoff: number })[];
  let result: DerivedWeek;
  if (!slate.length || kicks.length !== slate.length) {
    // No (complete) real kickoffs → fixed five-window model, grouped by baked `win`.
    const gamesByWin = new Map<string, NflGame[]>();
    const teamWin = new Map<string, string>();
    for (const g of slate) {
      const arr = gamesByWin.get(g.win) ?? gamesByWin.set(g.win, []).get(g.win)!;
      arr.push(g);
      teamWin.set(g.home, g.win); teamWin.set(g.away, g.win);
    }
    result = { windows: WINDOWS, teamWin, gamesByWin };
  } else {
    // Group by the shared clustering (id order follows kickoff order).
    const sorted = [...kicks].sort((a, b) => a.kickoff - b.kickoff);
    const ids = windowIdsFromKickoffs(sorted.map((g) => g.kickoff));
    const windows: GameWindow[] = [];
    const teamWin = new Map<string, string>();
    const gamesByWin = new Map<string, NflGame[]>();
    sorted.forEach((g, i) => {
      const id = ids[i];
      const arr = gamesByWin.get(id) ?? gamesByWin.set(id, []).get(id)!;
      arr.push(g);
      teamWin.set(g.home, id); teamWin.set(g.away, id);
    });
    for (const [id, games] of gamesByWin) { // insertion order = kickoff order
      const k0 = Math.min(...games.map((g) => g.kickoff ?? Infinity));
      const meta = winMetaFor(k0);
      // Slots per window. The regular season keeps ceil(games/3) capped at 3,
      // which reproduces the classic 1/3/2/1/1 board on a normal Sunday.
      // PRESEASON is shaped differently — its games bunch into a few dense
      // Thursday/Friday/Saturday clusters — so it's more generous: 3+ games in a
      // window earns 2 slots, 5+ earns 3. That deliberately puts MORE slots on
      // the board than the 8 a manager can fill, which is the practice-week
      // decision: not "fill everything", but which windows to contest.
      const slots = isPreseasonWeek(week)
        ? (games.length >= 5 ? 3 : games.length >= 3 ? 2 : 1)
        : Math.min(3, Math.ceil(games.length / 3));
      windows.push({ id, label: meta.label, sub: meta.sub, slots, time: kickoffLabel(k0) });
    }
    result = { windows, teamWin, gamesByWin };
  }
  derivedCache.set(week, result);
  return result;
}

/** The lineup windows for a week — derived from the real slate when kickoffs are
 *  known, else the fixed five. Ordered by kickoff. */
export function windowsForWeek(week: number): GameWindow[] {
  return deriveWeek(week).windows;
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
  return new Date(SEASON_START + ((week - 1) * 7 + (WIN_DAY_OFFSET[win] ?? 3)) * DAY);
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
  const wins = windowsForWeek(week);
  return wins.find((w) => gamesInWindow(week, w.id).length > 0) ?? wins[0] ?? WINDOWS[0];
}

// ── Real kickoff times (when the week's play-by-play is loaded) ───────────────
// epoch ms → ET seconds-of-day.
function etSod(ms: number): number {
  // formatToParts, NOT format(). Coercing `format()` to a number assumes the
  // engine returns a bare "20" for an hour-only format, and Hermes's formatjs
  // polyfill does not — it returns a patterned string, `+"..."` is NaN, and the
  // window header rendered "NaN:NaNa" on device while every browser was fine.
  // Parts are addressed by type, so no pattern can surprise this.
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24;
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return (Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60;
}
// seconds-of-day → compact slot label e.g. "1:00p" (matches the window labels).
function fmtSodShort(sod: number): string {
  const x = ((Math.floor(sod) % 86400) + 86400) % 86400;
  const h = Math.floor(x / 3600), mm = Math.floor((x % 3600) / 60);
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
}
// ── Preseason weeks ──────────────────────────────────────────────────────────
// Preseason is namespaced as OFFSET board weeks (ESPN preseason week N → board
// week 100 + N) so a league can run real 2026 preseason matchups without
// colliding with the already-loaded regular-season weeks 1-3. The slate/plays for
// these weeks are written by the worker (seasonType=1) at the same offset.
export const PRESEASON_BASE = 100;
/** Is this a preseason (offset) board week? */
export const isPreseasonWeek = (week: number): boolean => week > PRESEASON_BASE;
/** The 1-based preseason week number for an offset board week (101 → 1). */
export const preseasonWeekNum = (week: number): number => week - PRESEASON_BASE;
/** The POSTSEASON weeks, as nflverse numbers them and the bake carries them
 *  (v0.286.0). They are real weeks of real football with real play-by-play —
 *  they are simply not weeks any fantasy league plays, so nothing schedules
 *  them; they show up where a player's SEASON is listed. */
export const POSTSEASON_LABEL: Record<number, string> = { 19: 'WC', 20: 'DIV', 21: 'CONF', 22: 'SB' };
export const isPostseasonWeek = (week: number): boolean => week >= 19 && week <= 22;

/** A board week as a PLAYER should read it: "PRE 2" for the preseason offset
 *  weeks, "WC"/"DIV"/"CONF"/"SB" for the postseason, "WK 5" otherwise. Raw
 *  board weeks leak the +100 namespace — "WK 102" means nothing to anyone
 *  outside this file, and neither does "WK 22". */
export const weekLabel = (week: number): string =>
  (isPreseasonWeek(week) ? `PRE ${preseasonWeekNum(week)}`
    : POSTSEASON_LABEL[week] ? POSTSEASON_LABEL[week]
    : `WK ${week}`);

/** The same, stripped for a narrow column: "P2" / "WC" / "5". */
export const weekTick = (week: number): string =>
  (isPreseasonWeek(week) ? `P${preseasonWeekNum(week)}`
    : POSTSEASON_LABEL[week] ?? String(week));

/** How many preseason weeks a preseason league carries. FOUR for 2026: ESPN's
 *  preseason is the Hall of Fame game (week 1) plus each team's three outings
 *  (weeks 2-4). Mirrored by preseason_week_count() in SQL (migration 0112) —
 *  bump together. */
export const PRESEASON_WEEKS = 4;
/** The preseason BOARD weeks a practice league is seeded at — [101, 102, 103].
 *  Everything that has to touch all three (the clone, the deep-pool seed, the
 *  0110 RPC guards) counts from here rather than re-typing the literals. */
export const PRESEASON_BOARD_WEEKS: number[] =
  Array.from({ length: PRESEASON_WEEKS }, (_, i) => PRESEASON_BASE + i + 1);

// ── Live-test timeline (super-admin preseason testing) ───────────────────────
// When a league flips on live-test mode, the board anchors its window schedule to
// the moment it was enabled and compresses it: window i kicks off a couple minutes
// after the last, so Setup → Locked → Live → Final can be watched in real minutes
// without waiting for the real slate. Set from the board (setTestTimeline) so every
// window-time lookup below returns the compressed schedule automatically.
let TEST_ANCHOR: number | null = null;
const TEST_SETUP_LEAD_MS = 180_000; // 3m of setup before the first window kicks
const TEST_STEP_MS = 120_000;       // 2m between successive window kickoffs
export const TEST_LOCK_LEAD_MS = 60_000;  // window locks 1m before its (test) kickoff

/** How long before its own kickoff a window's picks stop being editable.
 *
 *  THE RULE, not a display hint. The authority is the DB — migration 0102's
 *  enforce_window_lock rejects any client write once
 *  `window_kickoff - interval '1 hour' <= now()` — and the worker derives
 *  matchup.lock_at from the same lead (server/src/config.js lockLeadMs). This is
 *  the CLIENT's copy of that number, and it lives in core so the web board and
 *  the app cannot hold different ones.
 *
 *  They did. The app compared against the raw kickoff, so it showed a window as
 *  open, and offered its picker, for the whole hour the database was already
 *  refusing the write — the one hour where being wrong actually costs a lineup.
 *  Three copies of a rule is how that happens; the two clients now share one.
 *
 *  Changing this alone changes nothing real. The trigger is what locks. */
export const LOCK_LEAD_MS = 3_600_000;
export const TEST_GAME_MS = 120_000;      // a window reads LIVE for 2m, then FINAL
/** Enable/disable the compressed live-test timeline (anchor = epoch ms, null = off). */
export function setTestTimeline(anchorMs: number | null): void { TEST_ANCHOR = anchorMs; }
export function testTimelineOn(): boolean { return TEST_ANCHOR != null; }

/** Earliest real kickoff (epoch ms) among a window's games, or null if unknown
 *  (week not loaded). In live-test mode, the compressed anchor-relative kickoff. */
export function windowKickoffMs(week: number, win: WindowId): number | null {
  if (TEST_ANCHOR != null) {
    const idx = windowsForWeek(week).findIndex((w) => w.id === win);
    return idx >= 0 ? TEST_ANCHOR + TEST_SETUP_LEAD_MS + idx * TEST_STEP_MS : null;
  }
  let min: number | null = null;
  for (const g of gamesInWindow(week, win)) {
    // Prefer the slate's scheduled kickoff (known pre-season); fall back to the
    // real first-snap from play-by-play once the week is live.
    const k = (typeof g.kickoff === 'number' ? g.kickoff : null) ?? realKickoff(week, g.home) ?? realKickoff(week, g.away);
    if (k != null && (min == null || k < min)) min = k;
  }
  return min;
}

/** A game window reads "in progress" for this long after kickoff, then FINAL.
 *  Both hosts carried their own literal `4 * 3_600_000` until v0.340.1. */
export const GAME_WINDOW_MS = 4 * 3_600_000;

export type WindowPhase = 'setup' | 'locked' | 'live' | 'final';

/** THE WINDOW STATE MACHINE — one implementation of the timeline every board
 *  renders: SETUP until the lock lead (1h, compressed in live-test mode),
 *  LOCKED until kickoff, LIVE for GAME_WINDOW_MS, then FINAL.
 *
 *  Until v0.340.1 the web derived this in Matchup.tsx, the app derived FINAL
 *  in its own lambda (with its own copy of the 4h literal) and kicked-ness in
 *  a third place — three hand-synced machines, the same shape the scoring
 *  rules were in before scoringRules.ts.
 *
 *  `held` — an admin lock-hold: the SERVER is accepting edits, so every
 *  window reads SETUP; a board showing 🔒 over an open database is lying.
 *  `matchupFinal` — the worker settled the whole week (matchup.status
 *  'final'): every window reads FINAL whatever the clock says.
 *  An UNKNOWN kickoff reads SETUP here (the web's long-standing behavior).
 *  The app's lock gating additionally fails safe — no known kickoff once the
 *  week has started counts as locked — off SERVER-sent kickoff times; that
 *  policy and data source are deliberately its own (see LivePicks.winLockMs),
 *  because the DB's enforce_window_lock is the actual authority there. */
export function windowPhase(week: number, win: WindowId, nowMs: number, opts?: { held?: boolean; matchupFinal?: boolean }): WindowPhase {
  if (opts?.matchupFinal) return 'final';
  if (opts?.held) return 'setup';
  const k = windowKickoffMs(week, win);
  if (k == null) return 'setup';
  const lockLead = testTimelineOn() ? TEST_LOCK_LEAD_MS : LOCK_LEAD_MS;
  const gameDur = testTimelineOn() ? TEST_GAME_MS : GAME_WINDOW_MS;
  if (nowMs >= k + gameDur) return 'final';
  if (nowMs >= k) return 'live';
  if (nowMs >= k - lockLead) return 'locked';
  return 'setup';
}

/** The instant a window's picks stop being editable (epoch ms), or null when the
 *  week's kickoffs aren't known yet.
 *
 *  Kickoff minus the lead — and the TEST lead when the compressed live-test
 *  timeline is on, so a rehearsal locks a minute before its fake kickoff rather
 *  than an hour before, which on a 2-minute window would be "already locked". */
export function windowLockMs(week: number, win: WindowId): number | null {
  const k = windowKickoffMs(week, win);
  return k == null ? null : k - (testTimelineOn() ? TEST_LOCK_LEAD_MS : LOCK_LEAD_MS);
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
