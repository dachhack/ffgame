// THIS WEEK, IN THIS LEAGUE'S SCORING (v0.447.0).
//
// 0330 put a MULTIPLIER in the weekly row instead of only a total, and this
// file is the two lines that make it worth having.
//
// THE ARITHMETIC. StatHead's weekly feed is the season projection split
// across the schedule: every week is the player's season line scaled by one
// number — his opponent's defence-vs-position, a home/away nudge, or the
// market's implied team total where a line is posted, renormalized so the
// season sums back to itself. ONE number, applied to the WHOLE line: the
// feed says so explicitly about receptions (rec_w = recPG × pts_w / ppg),
// which is the component a custom catalog is most likely to price
// differently.
//
// Scoring is linear in the stat line. So scaling the line by `mult` and then
// scoring it under this league's catalog, and scoring it under this league's
// catalog and then scaling by `mult`, are the same number. We already
// compute the second factor for every league — `projectedPoints` runs the
// baked StatHead line through the league's own 64-field catalog — so:
//
//     week, in this league = projectedPoints(player) × mult
//
// is not an approximation of a re-scored weekly projection. It IS one.
//
// WHEN IT FALLS BACK. No multiplier (the source served points only, or the
// player's season rate is zero and cannot be scaled), or no baked projection
// for the player at all, and we hand back the source's own PPR total with
// `scored: false` — right for a stock league, honest everywhere else, and
// the flag is there so a screen can say which it is showing rather than
// quietly implying the league's rules were applied.
import { projectedPoints } from '../engine/projScoring';
import type { WeekProjRow } from './liveApi';

export interface WeekPoints {
  /** Points for the week. */
  pts: number;
  /** Were the league's own scoring rules applied, or is this the source's PPR? */
  scored: boolean;
  /** 'BUF' / '@ KC' — ready to print, empty when the week has no opponent. */
  matchup: string;
  /** 'OUT' / 'RES' / 'backup' / null, straight from the source. */
  status: string | null;
  source: string;
  /** THE NUMBER IS CONDITIONAL (v0.451.0). The source's line for a depth-2+
   *  player is a rate conditional on him PLAYING, not an expectation that he
   *  will — the source audit found Nick Mullens at 18.5 beside ESPN's 0 for
   *  the same week, which is two answers to two different questions. A screen
   *  that ranks on this number must not rank a backup above a starter. */
  conditional: boolean;
  /** Our own injury designation, and whether it moved the number (0333). */
  inj: string | null;
  adjusted: boolean;
}

/** The week's number for one player, in this league's scoring where that is
 *  possible. `row` is one entry of `league_week_projections(...).rows`. */
export function weekPointsFor(
  player: { slug: string; pos: string; team?: string | null; sleeperId?: string | null },
  row: WeekProjRow | null | undefined,
): WeekPoints | null {
  if (!row) return null;
  const matchup = row.opp ? `${row.home === false ? '@ ' : ''}${row.opp}` : '';
  const base = {
    matchup, status: row.status ?? null, source: row.source ?? 'espn',
    conditional: row.status === 'backup',
    inj: row.inj ?? null, adjusted: !!row.adjusted,
  };
  // `null` means the source served no multiplier; ZERO means he is out, and
  // is a real multiplier. Number(null) is 0, which would quietly turn the
  // first case into the second — hence the explicit null check.
  const mult = row.mult == null ? NaN : Number(row.mult);
  if (Number.isFinite(mult)) {
    const season = projectedPoints({ id: player.slug, pos: player.pos, team: player.team, sleeperId: player.sleeperId });
    if (Number.isFinite(season) && season > 0) {
      return { ...base, pts: Math.round(season * mult * 10) / 10, scored: true };
    }
  }
  const pts = Number(row.pts);
  if (!Number.isFinite(pts)) return null;
  return { ...base, pts: Math.round(pts * 10) / 10, scored: false };
}

/** THE MATCHUP, GRADED (v0.639.1). v0.639.0 printed two words off the
 *  per-player multiplier; the founder: "We need it to be more linear with
 *  more distinction. Red / orange / yellow / yellow-green / green." And:
 *  "Do we have strength or team matchup or position matchup?" We do — the
 *  feed publishes `defVsPos`, one factor per defense per position: what
 *  that defense concedes to the position against the league average,
 *  blended across last season and this one, shrunk and clamped to ±18%.
 *  The worker stores it (0443) and the week RPC serves it beside the rows.
 *
 *  So the grade is the POSITION MATCHUP: his opponent's factor against his
 *  position, as a percent, in five bands. The per-player multiplier is the
 *  fallback when the table has no entry (it folds the same factor together
 *  with home field and the posted total, so it says the same thing, less
 *  cleanly) — `basis` tells a screen which one it is reading. */
export type MatchupBand = 1 | 2 | 3 | 4 | 5;
export interface MatchupGrade {
  /** 1 tough … 5 soft. */
  band: MatchupBand;
  /** The factor as a whole percent against average: −8, 0, +12. */
  pct: number;
  /** 'def': the opponent's defense-vs-position factor. 'week': the player's week multiplier. */
  basis: 'def' | 'week';
}
/** Red / orange / yellow / yellow-green / green. Fixed, not themed: the
 *  scale has to read the same on every board and in both modes. */
export const MATCHUP_BAND_COLOR: Record<MatchupBand, string> = {
  1: '#D9403A', 2: '#E3812A', 3: '#D4A90A', 4: '#8DB600', 5: '#2EA043',
};
export const MATCHUP_BAND_WORD: Record<MatchupBand, string> = {
  1: 'tough', 2: 'hard', 3: 'even', 4: 'good', 5: 'soft',
};
/** The factor's band. ±3% is even; ±8% is the next step; past that the ends. */
export function matchupBand(factor: number): MatchupBand {
  return factor <= 0.92 ? 1 : factor <= 0.97 ? 2 : factor < 1.03 ? 3 : factor < 1.08 ? 4 : 5;
}
/** The feed's position keys: our DEF is its DST; everything else is itself. */
const defPos = (pos: string): string => (pos === 'DEF' ? 'DST' : pos);
export function matchupGrade(
  row: WeekProjRow | null | undefined,
  pos: string,
  defVsPos?: Record<string, Record<string, number>> | null,
): MatchupGrade | null {
  if (!row) return null;
  const f = row.opp ? Number(defVsPos?.[row.opp]?.[defPos(pos)]) : NaN;
  if (Number.isFinite(f) && f > 0) return { band: matchupBand(f), pct: Math.round((f - 1) * 100), basis: 'def' };
  // No table entry: the week multiplier. Null when the source served none,
  // and at ZERO — that is "out", which the injury tag already says.
  const mult = row.mult == null ? NaN : Number(row.mult);
  if (!Number.isFinite(mult) || mult <= 0) return null;
  return { band: matchupBand(mult), pct: Math.round((mult - 1) * 100), basis: 'week' };
}
/** "+12%" / "−8%" / "0%" — the pill's text. */
export const matchupGradeLabel = (g: MatchupGrade): string =>
  g.pct === 0 ? '0%' : `${g.pct > 0 ? '+' : '\u2212'}${Math.abs(g.pct)}%`;
