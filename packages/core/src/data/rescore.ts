// THE COMMISSIONER'S RE-SCORE (0353) — the arithmetic both halves share.
//
// The worker decides, per matchup, whether a re-score MOVED it and whether it
// FLIPPED the result; the web console and the app sheet then say so. If those
// were three separate judgements they would disagree at the edges — a 0.04
// wobble called a change on one screen and not the other, a tie read as a win
// — so the rule lives here once and scripts/check-rescore.mjs holds it.

export interface RescoreSide { home: number | null; away: number | null }

export interface RescoreMatchup {
  id: string;
  home_roster_id: number; away_roster_id: number;
  home_team?: string | null; away_team?: string | null;
  was: RescoreSide; now: RescoreSide;
  moved: boolean; flipped: boolean;
}

export interface RescoreResult {
  matchups: RescoreMatchup[];
  /** How many matchups moved / changed hands. */
  changed: number; flipped: number;
  /** Seats with no saved lineup that week — fielded from TODAY's roster and
   *  injury report by the re-score, so the commissioner should know. */
  autofilled?: { roster_id: number; team?: string | null }[];
  /** An apply that rebuilt the week's report says whether it did. */
  report?: 'rebuilt' | 'failed' | null;
}

/** Finals round to one decimal (resolve.js `round`); anything under half a
 *  tenth is the same number said twice. */
export const RESCORE_EPS = 0.05;

/** Who won: 'home', 'away' or 'tie'. Null when either side has no score. */
export function winnerOf(s: RescoreSide): 'home' | 'away' | 'tie' | null {
  if (s.home == null || s.away == null) return null;
  const h = Number(s.home), a = Number(s.away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (Math.abs(h - a) < RESCORE_EPS) return 'tie';
  return h > a ? 'home' : 'away';
}

/** Did this matchup move, and did its result change hands? A matchup that had
 *  no stamped final counts as moved (it has a number now), never as flipped
 *  (there was no result to flip). */
export function rescoreDiff(was: RescoreSide, now: RescoreSide): { moved: boolean; flipped: boolean } {
  const unstamped = was.home == null || was.away == null;
  const moved = unstamped
    || Math.abs(Number(was.home) - Number(now.home)) >= RESCORE_EPS
    || Math.abs(Number(was.away) - Number(now.away)) >= RESCORE_EPS;
  const a = winnerOf(was), b = winnerOf(now);
  return { moved, flipped: !unstamped && a != null && b != null && a !== b };
}

/** Build a result from before/after pairs — the worker's one call. */
export function rescoreResult(rows: Omit<RescoreMatchup, 'moved' | 'flipped'>[],
                              autofilled: RescoreResult['autofilled'] = []): RescoreResult {
  const matchups = rows.map((r) => ({ ...r, ...rescoreDiff(r.was, r.now) }));
  return {
    matchups,
    changed: matchups.filter((m) => m.moved).length,
    flipped: matchups.filter((m) => m.flipped).length,
    autofilled,
  };
}

const f1 = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1));

/** "Team A 101.2 → 104.6" — one side of one line, for both screens. */
export function sideLine(team: string, was: number | null, now: number | null): string {
  return Math.abs(Number(was) - Number(now)) < RESCORE_EPS && was != null
    ? `${team} ${f1(now)}`
    : `${team} ${f1(was)} → ${f1(now)}`;
}

/** The headline a console prints over a finished preview or apply. */
export function rescoreHeadline(r: RescoreResult | null | undefined, applied: boolean): string {
  if (!r) return '';
  const n = r.matchups.length;
  if (!r.changed) return `No change — all ${n} matchup${n === 1 ? '' : 's'} score exactly as stored.`;
  const moved = `${r.changed} of ${n} matchup${n === 1 ? '' : 's'} ${applied ? 'moved' : 'would move'}`;
  const flip = r.flipped
    ? `, and ${r.flipped} result${r.flipped === 1 ? '' : 's'} ${applied ? 'changed hands' : 'would change hands'}`
    : '';
  return `${moved}${flip}.`;
}

/** The warning a preview carries when some seats had no saved lineup. */
export function autofillWarning(r: RescoreResult | null | undefined): string | null {
  const seats = r?.autofilled ?? [];
  if (!seats.length) return null;
  const names = seats.map((s) => s.team || `Roster ${s.roster_id}`).join(', ');
  return `${names} saved no lineup that week. A re-score fields ${seats.length === 1 ? 'that seat' : 'those seats'} from the roster and injury report as they are TODAY, which may not be who was there that week.`;
}
