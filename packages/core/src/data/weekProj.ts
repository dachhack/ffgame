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
