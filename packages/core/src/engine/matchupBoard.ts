// THE CLASSIC MATCHUP BOARD — the head-to-head view a normie league actually
// wants, assembled once here so the web and the app render the same numbers.
//
// WHY THIS IS A CORE MODULE AND NOT TWO SCREENS: the board is mostly ARITHMETIC
// — live points, projected finals, who is left to play, and a win probability
// derived from those. Every one of those is a number a manager will screenshot
// and argue about, so the two hosts disagreeing about any of them is worse than
// either being ugly. The screens keep only layout; every figure below is
// computed once, right here, and tested in Node.
//
// WHAT IT DELIBERATELY DOES NOT DO: it never fetches. Callers hand it the
// lineups, the scoring function, the slate and the projections they already
// loaded for the old board. That keeps it pure, which is what makes the
// projection and win-probability maths testable at all.
import type { Pos } from '../types';
import type { ClassicSlotDef } from './classic';

/** One player as the board needs them — the caller resolves identity, we do
 *  the arithmetic. `live` is points ALREADY scored; `proj` is the full-game
 *  projection, used only for the part of the game still to come. */
export interface BoardEntry {
  slug: string;
  name: string;
  pos: string;
  team: string | null;
  /** Points on the board right now. */
  live: number;
  /** Full-game projection (season PPG is a fine stand-in). */
  proj: number;
  /** 'pre' = kickoff hasn't happened · 'live' = playing · 'done' = final.
   *  Drives BOTH the projection blend and the yet-to-play line, so it is the
   *  single most load-bearing field the caller supplies. */
  state: 'pre' | 'live' | 'done';
  /** "Sun 1:00 PM", already localised by the caller (hosts differ on Intl). */
  kickoff?: string | null;
  /** "@ CIN" / "vs CLE" / "BYE". */
  opponent?: string | null;
  /** 'Q' | 'O' | 'D' | 'IR' — rendered as a tag beside the position. */
  injury?: string | null;
}

export interface BoardSlotRow {
  slot: string;
  /** The label the manager sees: a custom spot label, else FLEX/QB/… */
  label: string;
  /** Positions this spot accepts — drives the pill's colour(s). */
  pos: Pos[];
  home: BoardEntry | null;
  away: BoardEntry | null;
}

export interface BoardSide {
  rosterId: number;
  team: string;
  avatar?: string | null;
  /** Live total across the STARTERS only — bench never counts. */
  live: number;
  /** Live + the remaining share of every starter still to play. */
  projected: number;
  /** Starters whose game hasn't finished. */
  yetToPlay: number;
  /** "2 QB, 2 RB, 4 WR" — what's left, by position, in roster order. */
  yetToPlayBreakdown: string;
  /** Win chance 0..1 — see winProbability below for what it is and isn't. */
  winPct: number;
  record?: { wins: number; losses: number; ties: number; rank?: number | null } | null;
}

export interface MatchupBoard {
  week: number;
  locked: boolean;
  home: BoardSide;
  away: BoardSide;
  starters: BoardSlotRow[];
  bench: { home: BoardEntry[]; away: BoardEntry[] };
  ir: { home: BoardEntry[]; away: BoardEntry[] };
  taxi: { home: BoardEntry[]; away: BoardEntry[] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What a starter is expected to finish on.
 *
 *  A player who is DONE is worth exactly what they scored — no projection can
 *  improve on a final. A player who hasn't started is worth their projection.
 *  The interesting case is LIVE, and the naive answer (`live + proj`) is
 *  badly wrong: it hands a player who already went off for 20 another full
 *  projection, so a team that has played well reads as if it will play the
 *  whole game twice.
 *
 *  Instead a live player is worth `max(live, proj)` — they keep what they've
 *  banked, and the projection acts as a floor for the rest of the game rather
 *  than a bonus on top. It's deliberately conservative: without a play-clock
 *  fraction (which the pbp stream doesn't carry) any attempt to prorate the
 *  remaining game is a guess dressed up as arithmetic. */
export function projectEntry(e: BoardEntry): number {
  if (e.state === 'done') return e.live;
  if (e.state === 'pre') return e.proj;
  return Math.max(e.live, e.proj);
}

/** Win chance from the projected margin.
 *
 *  A logistic on the projected margin, with the spread NARROWING as the games
 *  finish: with everyone still to play a 10-point projected edge is weak
 *  evidence, and with one player left it is nearly decisive. `sigma` shrinks
 *  from ~28 (a full slate of unplayed starters, roughly the week-to-week
 *  standard deviation of a fantasy team's score) toward 3 as they finish.
 *
 *  This is a PRESENTATION number, not a market. It exists so the header can
 *  say something honest about who is ahead in a way a raw margin can't — 12
 *  points up with everyone done is over, 12 up with eight to play is nothing.
 *  It is never used to score, settle or pay anything. */
export function winProbability(myProjected: number, oppProjected: number, myLeft: number, oppLeft: number): number {
  const left = myLeft + oppLeft;
  const sigma = Math.max(3, 28 * Math.sqrt(left / 18));
  const z = (myProjected - oppProjected) / sigma;
  const p = 1 / (1 + Math.exp(-z * 1.6));
  // Never claim certainty while anything is unresolved — a 100% that then
  // loses is the one number nobody forgives.
  if (left > 0) return Math.min(0.99, Math.max(0.01, p));
  return Math.min(1, Math.max(0, p));
}

/** "2 QB, 2 RB, 4 WR" — positions still to play, most-common first, in the
 *  conventional roster order rather than alphabetical, because a manager reads
 *  this as a lineup and not as a list. */
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P'];
export function yetToPlayBreakdown(entries: BoardEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.state === 'done') continue;
    counts.set(e.pos, (counts.get(e.pos) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      const ia = POS_ORDER.indexOf(a[0]), ib = POS_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([pos, n]) => `${n} ${pos}`)
    .join(', ');
}

export interface SideInput {
  rosterId: number;
  team: string;
  avatar?: string | null;
  record?: BoardSide['record'];
  /** slot name → the player in it (null for an empty spot). */
  starters: Record<string, BoardEntry | null>;
  bench?: BoardEntry[];
  ir?: BoardEntry[];
  taxi?: BoardEntry[];
}

/** Assemble the whole board. Pure: same inputs, same numbers, both hosts. */
export function buildMatchupBoard(input: {
  week: number;
  locked: boolean;
  slots: ClassicSlotDef[];
  /** Display label per slot — the caller passes slotDisplayName's result so
   *  a commissioner's custom spot label ("Only NFC Players") survives here. */
  labelFor: (d: ClassicSlotDef) => string;
  home: SideInput;
  away: SideInput;
}): MatchupBoard {
  const { week, locked, slots, labelFor, home, away } = input;

  const starters: BoardSlotRow[] = slots.map((d) => ({
    slot: d.slot,
    label: labelFor(d),
    pos: d.pos,
    home: home.starters[d.slot] ?? null,
    away: away.starters[d.slot] ?? null,
  }));

  const side = (s: SideInput, mine: (BoardEntry | null)[], theirs: (BoardEntry | null)[]): BoardSide => {
    const played = mine.filter((e): e is BoardEntry => !!e);
    const live = r2(played.reduce((a, e) => a + e.live, 0));
    const projected = r2(played.reduce((a, e) => a + projectEntry(e), 0));
    // An EMPTY starting spot counts as nothing scored and nothing to come —
    // it is not "yet to play", because nobody is going to play it. Counting it
    // would tell a manager to keep waiting on a slot they simply left blank.
    const left = played.filter((e) => e.state !== 'done').length;
    const theirPlayed = theirs.filter((e): e is BoardEntry => !!e);
    const theirProjected = theirPlayed.reduce((a, e) => a + projectEntry(e), 0);
    const theirLeft = theirPlayed.filter((e) => e.state !== 'done').length;
    return {
      rosterId: s.rosterId,
      team: s.team,
      avatar: s.avatar ?? null,
      live,
      projected,
      yetToPlay: left,
      yetToPlayBreakdown: yetToPlayBreakdown(played),
      winPct: winProbability(projected, theirProjected, left, theirLeft),
      record: s.record ?? null,
    };
  };

  const homeStarters = starters.map((r) => r.home);
  const awayStarters = starters.map((r) => r.away);

  return {
    week,
    locked,
    home: side(home, homeStarters, awayStarters),
    away: side(away, awayStarters, homeStarters),
    starters,
    bench: { home: home.bench ?? [], away: away.bench ?? [] },
    ir: { home: home.ir ?? [], away: away.ir ?? [] },
    taxi: { home: home.taxi ?? [], away: away.taxi ?? [] },
  };
}

/** Kickoff + opponent for a player's NFL team in a week, from the slate the
 *  board already loads. Returns BYE when the team simply isn't playing —
 *  which is the honest reading of "no game in this week's slate", and the one
 *  case a manager needs flagged before lock. */
export function gameFor(team: string | null | undefined, slate: { home: string; away: string; kickoff?: string | null }[]):
  { opponent: string; kickoff: string | null; home: boolean } | null {
  if (!team) return null;
  const up = team.toUpperCase();
  const g = slate.find((x) => x.home?.toUpperCase() === up || x.away?.toUpperCase() === up);
  if (!g) return null;
  const isHome = g.home?.toUpperCase() === up;
  return { opponent: isHome ? g.away : g.home, kickoff: g.kickoff ?? null, home: isHome };
}

/** 'pre' | 'live' | 'done' for a player, from their game's kickoff and whether
 *  the league's play stream has moved past it.
 *
 *  `finalTeams` is the set of NFL teams whose game this week is FINAL — the
 *  caller knows this from the feed. Without it every started game would read
 *  as 'live' forever and the projection would never settle, which is exactly
 *  the bug that makes a finished team's total keep drifting. */
export function entryState(
  kickoff: string | null | undefined,
  team: string | null | undefined,
  now: number,
  finalTeams?: Set<string>,
): 'pre' | 'live' | 'done' {
  const up = (team ?? '').toUpperCase();
  if (up && finalTeams?.has(up)) return 'done';
  if (!kickoff) return 'pre';
  const t = Date.parse(kickoff);
  if (!Number.isFinite(t)) return 'pre';
  return t <= now ? 'live' : 'pre';
}
