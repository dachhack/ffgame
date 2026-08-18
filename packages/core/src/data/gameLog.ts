// THE GAME LOG (v0.284.0) — a player's season, week by week, scored under one
// league's own rules.
//
// It lives in core rather than in either host's card because both render it and
// the numbers must agree to the decimal; and it scores through
// `classicPointsFrom`, which is the SAME body the board and the worker use, so
// a log can never quote a week differently than the matchup that played it.
//
// WHY NOT THE ENGINE'S PLAY CACHE: `classicPoints` reads plays from a module
// map the live board owns — one week at a time. A season's log would have to
// install eighteen weeks over the board's, and the board would then score the
// wrong week. The rows come from `playerSeasonPlays` instead and never touch
// that cache.
//
// DRIP LEAGUES get the statline and no points column. Drip scoring is
// per-window, per-metric, with power-ups applied on top — there is no
// season-long "he was worth N" to print, and inventing one by scoring him under
// classic rules his league doesn't use would be a lie with a decimal point.
import type { Player, Pos } from '../types';
import { classicPointsFrom, type ClassicScoring } from '../engine/classic';
import { liveRowsToPbp } from './realPbp';
import { nflGameForTeam } from './nflSlate';
import { statlineFrom, rawPlaysFrom, fmtStat, type RawPlay } from '../engine/sim';
import type { LivePlayRow } from './liveApi';

export interface GameLogWeek {
  week: number;
  /** "@ LAR" / "vs SEA", or null when the slate doesn't place him that week. */
  opponent: string | null;
  /** The week's counting line, already formatted for the position. */
  line: string;
  /** Points under the league's scoring — null in a drip league (see header). */
  points: number | null;
  /** He has rows this week but they add to nothing (a DNP after being active). */
  blank: boolean;
}

/** Build the log. `rows` is playerSeasonPlays' output; `scoring` null = drip. */
export function buildGameLog(
  player: { id: string; name: string; pos: string; team?: string | null },
  rows: Record<number, LivePlayRow[]>,
  scoring: Partial<ClassicScoring> | null,
): GameLogWeek[] {
  const weeks = Object.keys(rows).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const out: GameLogWeek[] = [];
  for (const week of weeks) {
    // liveRowsToPbp keys by slug and does the row → RawPlay conversion the
    // board uses; taking his own array back out keeps one converter.
    // liveRowsToPbp is the board's own row → RealPlay converter; rawPlaysFrom
    // is the board's own RealPlay → engine mapping. Two shared steps rather
    // than a third decoding of the same rows.
    const plays: RawPlay[] = rawPlaysFrom(liveRowsToPbp(rows[week])[player.id] ?? []);
    const p: Player = { id: player.id, name: player.name, full: player.name, pos: player.pos as Pos, team: player.team ?? '', stats: ZERO() };
    const g = nflGameForTeam(week, player.team);
    out.push({
      week,
      opponent: g ? `${g.home === player.team ? 'vs' : '@'} ${g.home === player.team ? g.away : g.home}` : null,
      line: fmtStat(player.pos as Pos, statlineFrom(plays, Number.MAX_SAFE_INTEGER), true),
      points: scoring ? classicPointsFrom(plays, p, scoring) : null,
      blank: plays.length === 0,
    });
  }
  return out;
}

const ZERO = () => ({
  games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0,
  targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0,
});
