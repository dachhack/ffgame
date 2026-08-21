// THE GAME'S BOX SCORE (v0.336.0).
//
// Founder: "let's have a small chip at the bottom of the field visual. when you
// click it, you get a pop up with all the players in that game by team and
// their current stat lines."
//
// The field already shows the last play and the game log shows every play. What
// neither answers is the ordinary question you ask while watching — "who is
// actually doing anything out there" — including players nobody in the league
// rosters, which is exactly why it cannot be built from the matchup's picks.
//
// ── IT READS THE SAME NUMBERS THE CARDS DO ─────────────────────────────────
// `statlineFrom` over `realRawPlays`, which is the accumulation the player cards
// and the board already use. A box score that computed its own totals would be
// a second opinion, and the first argument it lost would be about whether the
// board or the box score was lying.
//
// ── EMPTY LINES ARE DROPPED ────────────────────────────────────────────────
// A live week's play table contains every player the poller has ever written a
// row for, and a listing padded with a hundred names at 0-0 is not a box score,
// it is a roster. Only players who have DONE something appear.

import { statlineFrom, realRawPlays, fmtStat, type StatLine } from './sim';
import { realPbpSlugs } from '../data/realPbp';
import { slugMeta } from '../data/slugMeta';
import type { Pos } from '../theme';

export interface BoxRow {
  slug: string;
  pos: Pos;
  team: string;
  /** Already formatted with the shared `fmtStat`, so the box score and the
   *  cards phrase the same numbers the same way. */
  stat: string;
  line: StatLine;
  /** What the sort ran on — exposed so a caller can show it if it ever wants
   *  to, and so the test can assert the ordering rather than infer it. */
  weight: number;
}

export interface GameBox {
  home: BoxRow[];
  away: BoxRow[];
}

/** Total yards from scrimmage + return, plus a heavy nudge for scores. Not a
 *  fantasy projection and deliberately not one: this orders a BOX SCORE, where
 *  the useful answer is "who has the ball been going to", the same in every
 *  league whatever its scoring. */
function weigh(s: StatLine): number {
  const yards = s.passYds * 0.4 + s.rushYds + s.recYds + s.retYds;
  const tds = s.passTds + s.rushTds + s.recTds + s.retTds + s.dtd;
  const def = s.sacks * 12 + s.ints * 20 + s.fumrec * 15 + s.tackles * 2 + s.safety * 20;
  return yards + tds * 25 + def;
}

/** True when a line has any counting stat at all. */
export function hasStats(s: StatLine): boolean {
  return weigh(s) !== 0
    || s.carries > 0 || s.targets > 0 || s.rec > 0 || s.fg > 0 || s.xp > 0;
}

/** Everyone with stats in one game, split by team and ordered by involvement.
 *
 *  `clock` is the game-clock position the rest of the screen is showing, so
 *  scrubbing the log scrubs the box score with it rather than always reporting
 *  the present. */
export function gameBoxScore(week: number, home: string, away: string, clock: number): GameBox {
  const H = (home ?? '').toUpperCase(), A = (away ?? '').toUpperCase();
  const out: GameBox = { home: [], away: [] };
  if (!H || !A) return out;
  for (const slug of realPbpSlugs(week)) {
    const meta = slugMeta(slug);
    const team = (meta.team ?? '').toUpperCase();
    if (team !== H && team !== A) continue;
    const plays = realRawPlays(slug, week);
    if (!plays || !plays.length) continue;
    const line = statlineFrom(plays, clock);
    if (!hasStats(line)) continue;
    const pos = (meta.pos ?? 'WR') as Pos;
    (team === H ? out.home : out.away).push({
      slug, pos, team, line, weight: weigh(line), stat: fmtStat(pos, line),
    });
  }
  const bySlug = (a: BoxRow, b: BoxRow) => (b.weight - a.weight) || a.slug.localeCompare(b.slug);
  out.home.sort(bySlug); out.away.sort(bySlug);
  return out;
}
