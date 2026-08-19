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
import type { Roof } from '../data/stadiums';
import { leagueIsGolf } from './golf';

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
  /** The roof over the VENUE, when the team is known (data/stadiums.ts). The
   *  board marks a roofed game so a manager knows weather is off the table
   *  there — it is never a claim about the weather itself. */
  roof?: Roof | null;
  /** Thursday/Sunday/Monday night — see isPrimetime. */
  primetime?: boolean;
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
  // GOLF (v0.303.0): the margin that means "ahead" runs the other way. Only the
  // SIGN of the evidence flips — the spread, the shrink and the 1%/99% floor
  // are statements about how much is still unresolved, which golf doesn't
  // change.
  const z = (leagueIsGolf() ? oppProjected - myProjected : myProjected - oppProjected) / sigma;
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

  // THE ZERO-FILL RULE (v0.303.0): a spot with the rule banks its designated
  // points when it scores nothing — INCLUDING when nobody is standing in it,
  // which is why these are indexed by spot rather than read off the entries.
  //
  // "Scores nothing" is only decidable when the spot is SETTLED. An empty spot
  // is settled from the first whistle (nobody is going to play it); a filled
  // one is settled when his game is done. A player at zero in the second
  // quarter has not scored nothing, he has not scored YET, and paying the fill
  // early would show a total that walks backwards when he catches a pass.
  const zeroOf = new Map(slots.map((d) => [d.slot, d.zeroPts ?? null]));
  const fillLive = (e: BoardEntry | null, slot: string): number => {
    const z = zeroOf.get(slot) ?? null;
    if (z == null) return e ? e.live : 0;
    if (!e) return z;
    return e.state === 'done' && e.live === 0 ? z : e.live;
  };
  const fillProj = (e: BoardEntry | null, slot: string): number => {
    const z = zeroOf.get(slot) ?? null;
    if (z == null) return e ? projectEntry(e) : 0;
    if (!e) return z;
    const p = projectEntry(e);
    return p === 0 ? z : p;
  };
  const slotOrder = slots.map((d) => d.slot);
  const side = (s: SideInput, mine: (BoardEntry | null)[], theirs: (BoardEntry | null)[]): BoardSide => {
    const played = mine.filter((e): e is BoardEntry => !!e);
    const live = r2(mine.reduce((a, e, i) => a + fillLive(e, slotOrder[i]), 0));
    const projected = r2(mine.reduce((a, e, i) => a + fillProj(e, slotOrder[i]), 0));
    // An EMPTY starting spot counts as nothing scored and nothing to come —
    // it is not "yet to play", because nobody is going to play it. Counting it
    // would tell a manager to keep waiting on a slot they simply left blank.
    const left = played.filter((e) => e.state !== 'done').length;
    const theirPlayed = theirs.filter((e): e is BoardEntry => !!e);
    const theirProjected = theirs.reduce((a, e, i) => a + fillProj(e, slotOrder[i]), 0);
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
/** ── THE WEEK'S SLATE, AS THIS MATCHUP SEES IT (v0.312.0) ──────────────────
 *
 *  Founder, on the scoreboard card: "the middle of the top is super empty.
 *  Maybe have the week's game slate with info and stats? In a chip you can
 *  select."
 *
 *  WHAT MAKES THIS DIFFERENT FROM AN NFL SCOREBOARD, and the reason it lives
 *  in the engine rather than in a host: the interesting fact about Bills-Texans
 *  is not the score, it is that THREE OF MY STARTERS ARE IN IT and two of my
 *  opponent's. A generic scoreboard is a worse version of an app the manager
 *  already has on their phone. This one answers "what is riding on this game",
 *  which nothing else can tell them.
 *
 *  Every game on the slate is returned, in kickoff order, whether or not the
 *  matchup touches it — it was asked for as "the week's game slate", and a row
 *  of chips that silently omits games would misrepresent the week. Involvement
 *  is carried per chip instead (`homeCount`/`awayCount`) so a host can dim the
 *  ones nobody is in rather than hide them.
 *
 *  POINTS FOLLOW THE BOARD'S OWN RULE: `projectEntry` is the same blend the side
 *  totals use, so a chip's numbers always sum toward the headline score above
 *  it rather than telling a second story. BENCH IS EXCLUDED for exactly the
 *  reason the side totals exclude it — a bench player in this game is not
 *  riding on it. */
export interface SlateChip {
  /** 'BUF@HOU' — stable, and the selection key a host holds. */
  key: string;
  home: string;
  away: string;
  kickoff: string | null;
  state: 'pre' | 'live' | 'done';
  /** Starters each side has in this game, and what they are worth. */
  homeCount: number;
  awayCount: number;
  homePts: number;
  awayPts: number;
  homePlayers: BoardEntry[];
  awayPlayers: BoardEntry[];
}

export function slateChips(
  starters: BoardSlotRow[],
  slate: { home: string; away: string; kickoff?: string | null }[],
  now: number,
  finalTeams?: Set<string>,
): SlateChip[] {
  const out: SlateChip[] = [];
  for (const g of slate) {
    const home = (g.home ?? '').toUpperCase();
    const away = (g.away ?? '').toUpperCase();
    if (!home || !away) continue;                     // a half-written slate row claims nothing
    const inGame = (e: BoardEntry | null): boolean => {
      const t = (e?.team ?? '').toUpperCase();
      return !!t && (t === home || t === away);
    };
    const homePlayers = starters.map((r) => r.home).filter(inGame) as BoardEntry[];
    const awayPlayers = starters.map((r) => r.away).filter(inGame) as BoardEntry[];
    const sum = (es: BoardEntry[]) => r2(es.reduce((n, e) => n + projectEntry(e), 0));
    out.push({
      key: `${away}@${home}`,
      home, away,
      kickoff: g.kickoff ?? null,
      // The game's state is its HOME team's — one game, one kickoff, and
      // entryState already folds in the inferred-final set the board built.
      state: entryState(g.kickoff, home, now, finalTeams),
      homeCount: homePlayers.length,
      awayCount: awayPlayers.length,
      homePts: sum(homePlayers),
      awayPts: sum(awayPlayers),
      homePlayers, awayPlayers,
    });
  }
  // Kickoff order, and a game with no kickoff sorts last rather than first —
  // an unknown time is not midnight.
  return out.sort((a, b) => {
    const ta = a.kickoff ? Date.parse(a.kickoff) : Number.MAX_SAFE_INTEGER;
    const tb = b.kickoff ? Date.parse(b.kickoff) : Number.MAX_SAFE_INTEGER;
    return (Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER)
         - (Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER);
  });
}

export function gameFor(team: string | null | undefined, slate: { home: string; away: string; kickoff?: string | null }[]):
  { opponent: string; kickoff: string | null; home: boolean } | null {
  if (!team) return null;
  const up = team.toUpperCase();
  const g = slate.find((x) => x.home?.toUpperCase() === up || x.away?.toUpperCase() === up);
  if (!g) return null;
  const isHome = g.home?.toUpperCase() === up;
  return { opponent: isHome ? g.away : g.home, kickoff: g.kickoff ?? null, home: isHome };
}

/** Is this player genuinely on a BYE — or do we just not know?
 *
 *  `gameFor` answers null for BOTH "this team isn't playing" and "I have no
 *  idea who this player is", and the board used to print BYE for either. That
 *  is a claim we often could not support: a player the baked slug map doesn't
 *  know (a 2026 rookie, before a re-bake) resolves with an EMPTY team, and an
 *  empty team is in nobody's slate — so a rookie starting his season opener
 *  read "BYE · No game this week" beside the real kickoff of the man next to
 *  him.
 *
 *  So a bye has to be PROVEN, and it takes two things we frequently lack:
 *    • a KNOWN team — no team, no claim;
 *    • a LOADED slate — an unsynced week would otherwise call all 32 teams
 *      idle at once.
 *  Anything else answers false, and the caller says nothing rather than
 *  something false. */
export function isBye(team: string | null | undefined, slate: { home: string; away: string }[]): boolean {
  if (!team) return false;
  if (!slate?.length) return false;
  return gameFor(team, slate as { home: string; away: string; kickoff?: string | null }[]) == null;
}

/** Which TEAM's building a game is played in — the home side. Neutral-site
 *  games (London, Munich, São Paulo) are wrong here and knowably so; see the
 *  limits documented in data/stadiums.ts. */
export function venueTeam(team: string, g: { opponent: string; home: boolean }): string {
  return g.home ? team : g.opponent;
}

/** Is this kickoff in PRIMETIME — the Thursday/Sunday/Monday night windows a
 *  manager plans around?
 *
 *  Derived, not fetched: 7pm ET or later. The NFL's night windows all kick
 *  8:15–8:20pm ET and no afternoon window starts past 4:25, so the boundary has
 *  a wide margin either side of it — which matters, because this is the one
 *  place a timezone slip would show up as a wrong icon. Everything is evaluated
 *  in AMERICA/NEW_YORK regardless of where the reader is sitting: primetime is
 *  a property of the game, not of who's looking at it, and a west-coast reader
 *  must not see a 5:15pm local Monday nighter lose its marker. */
export function isPrimetime(kickoff: string | null | undefined): boolean {
  if (!kickoff) return false;
  const t = Date.parse(kickoff);
  if (!Number.isFinite(t)) return false;
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
      .format(new Date(t));
    const hour = Number(h);
    return Number.isFinite(hour) && hour >= 19;
  } catch {
    return false;   // no tz database — say nothing rather than guess
  }
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
