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
import { slugMeta, normTeam } from '../data/slugMeta';
import type { Pos } from '../theme';

export interface BoxRow {
  slug: string;
  pos: Pos;
  team: string;
  /** Already formatted with the shared `fmtStat`, so the box score and the
   *  cards phrase the same numbers the same way. */
  stat: string;
  line: StatLine;
  /** Involvement score. No longer the primary sort (v0.338.3) — it is the
   *  TIEBREAK, and the one that orders defenders, for whom "yards" is not a
   *  measure of anything. Exposed so the assertions can pin the ordering
   *  rather than infer it. */
  weight: number;
  /** SCRIMMAGE yards — passing, rushing and receiving, at full value. The sort
   *  key within a position group.
   *
   *  Two deliberate exclusions. Not `weigh`'s discounted passing: that discount
   *  exists to compare a QB against a RB, and inside a group of QBs it only
   *  distorts the answer. And NOT RETURN YARDS (v0.338.4, founder's call) —
   *  a receiver with 14 receiving and 86 on kick returns is not the best
   *  receiver in the game, and ranking him as one is exactly what a box score
   *  is being read to avoid. Returns still count in `weigh`, so they break
   *  ties and still rank a pure returner ahead of someone who did nothing. */
  yards: number;
  /** Which half of the box score this row belongs to. */
  side: 'off' | 'def';
}

/** The defensive positions. Everything else — including K, P and the returner
 *  slot — sits on the offensive half, which is where a box score reader looks
 *  for them.
 *
 *  NOT `matchupBoard`'s POS_ORDER, which is the closest existing list and
 *  cannot serve: it ranks FB after DB, so it does not encode an offense /
 *  defense split at all. Ordering a lineup and ordering a box score are
 *  different questions and this is the one place that needs the split. */
const DEF_POS = new Set<string>(['DEF', 'DL', 'LB', 'DB']);

/** Reading order within each half. Conventional football order on offense;
 *  the team unit first on defense, then front to back. */
const POS_RANK: Record<string, number> = {
  QB: 0, RB: 1, FB: 2, WR: 3, TE: 4, K: 5, P: 6, RET: 7, HC: 8,
  DEF: 0, DL: 1, LB: 2, DB: 3,
};

/** The box score's yards, exported so the exclusion is assertable rather than
 *  a claim in a comment. */
export const scrimmageYards = (s: StatLine): number => s.passYds + s.rushYds + s.recYds;

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
  // BOTH VOCABULARIES, ONE CODE (v0.343.2). `home`/`away` arrive in the FEED's
  // vocabulary (ESPN's: LAR, WSH, JAC) while slugMeta answers in the SLATE's
  // (LA, WAS, JAX) — so a raw compare silently dropped every Rams player from
  // a NO@LAR box score while the Saints column filled normally (the founder's
  // "weird that only saints have stats?" screenshot). normTeam on both sides
  // is the whole fix; an unrecognised code still just never matches.
  const H = normTeam(home ?? ''), A = normTeam(away ?? '');
  const out: GameBox = { home: [], away: [] };
  if (!H || !A) return out;
  for (const slug of realPbpSlugs(week)) {
    const meta = slugMeta(slug);
    const team = normTeam(meta.team ?? '');
    if (team !== H && team !== A) continue;
    const plays = realRawPlays(slug, week);
    if (!plays || !plays.length) continue;
    const line = statlineFrom(plays, clock);
    if (!hasStats(line)) continue;
    const pos = (meta.pos ?? 'WR') as Pos;
    (team === H ? out.home : out.away).push({
      slug, pos, team, line, weight: weigh(line), stat: fmtStat(pos, line),
      yards: scrimmageYards(line), side: DEF_POS.has(pos) ? 'def' : 'off',
    });
  }
  out.home.sort(boxRowOrder); out.away.sort(boxRowOrder);
  return out;
}

/** OFFENSE, THEN POSITION, THEN YARDS (v0.338.3, founder's call).
 *
 *  It used to be one flat involvement ranking, which put a 6-tackle linebacker
 *  above a 46-yard receiver and made the list impossible to scan for "how did
 *  the backs do" — the question a box score exists to answer.
 *
 *  `weight` survives as the TIEBREAK, and it is doing real work rather than
 *  padding the chain: every defender has 0 yards, so within LB or DB it is
 *  `weight` that does the whole ordering — tackles, sacks and picks, which is
 *  the only sensible reading of "highest at the top" for a player who gains
 *  none. The slug is last so the order is total and stable.
 *
 *  Exported so it can be asserted on its own: `gameBoxScore` reads a week's
 *  play table through module globals, so pinning the order through it would
 *  mean installing a PBP week to test a comparator. The rule is the part with
 *  judgement in it, and this is the part to assert. */
export const boxRowOrder = (a: BoxRow, b: BoxRow): number =>
    (a.side === b.side ? 0 : a.side === 'off' ? -1 : 1)
    || ((POS_RANK[a.pos] ?? 99) - (POS_RANK[b.pos] ?? 99))
    || (b.yards - a.yards)
    || (b.weight - a.weight)
    || a.slug.localeCompare(b.slug);

// ── THE TAB SPLIT (v0.343.2) ───────────────────────────────────────────────
// Founder: "the box score gets cut off. Let's have a tab for offense and a tab
// for defense. if a player has multiple designations (Travis Hunter) put them
// in both positions."
//
// Membership is decided by the STAT LINE, not the roster tag: a tab shows
// everyone who DID something on that side of the ball. That is what makes the
// two-way case fall out for free — a player with catches and tackles simply
// qualifies for both tabs — and it keeps a tab from padding itself with
// zero lines (a WR whose only stat is a tackle after an interception appears
// under DEFENSE, where his stat is, not under OFFENSE with an 0/0 line).

/** Any offensive, kicking or return involvement. Yardage compares ≠ 0, not
 *  > 0 — a back with three carries for −4 yards is still in the game. */
export const offInvolved = (s: StatLine): boolean =>
  s.carries > 0 || s.targets > 0 || s.rec > 0 || s.fg > 0 || s.xp > 0
  || s.passYds !== 0 || s.rushYds !== 0 || s.recYds !== 0
  || s.passTds > 0 || s.rushTds > 0 || s.recTds > 0
  || s.retYds !== 0 || s.retTds > 0;

/** Any defensive splash. */
export const defInvolved = (s: StatLine): boolean =>
  s.tackles > 0 || s.sacks > 0 || s.ints > 0 || s.fumrec > 0
  || s.dtd > 0 || s.safety > 0;

/** One tab of a team's column: every row involved on that side of the ball.
 *
 *  A row crossing onto the tab OPPOSITE its listed position (the two-way case)
 *  is re-phrased through that side's lens — the defense tab shows the tackles,
 *  not a second copy of the receiving line — and sorts AFTER the tab's native
 *  rows, by involvement: the natives keep `boxRowOrder`'s position-then-yards
 *  reading, and the visitors line up behind them where a reader expects the
 *  odd case to be. Rows are copies; the underlying box is never mutated. */
export function boxTabRows(rows: BoxRow[], tab: 'off' | 'def'): BoxRow[] {
  const involved = tab === 'off' ? offInvolved : defInvolved;
  const native: BoxRow[] = [], visiting: BoxRow[] = [];
  for (const r of rows) {
    // The fallback keeps a row whose line somehow satisfies neither predicate
    // (hasStats admits freak zero-sum yardage lines) on its own side's tab
    // rather than dropping it from both.
    if (!(involved(r.line) || (r.side === tab && !offInvolved(r.line) && !defInvolved(r.line)))) continue;
    if (r.side === tab) { native.push(r); continue; }
    const lens: Pos = tab === 'def' ? 'DB'
      : r.line.carries > 0 && r.line.rec === 0 ? 'RB' : 'WR';
    visiting.push({ ...r, stat: fmtStat(lens, r.line) });
  }
  visiting.sort((a, b) => (b.weight - a.weight) || a.slug.localeCompare(b.slug));
  return [...native, ...visiting];
}
