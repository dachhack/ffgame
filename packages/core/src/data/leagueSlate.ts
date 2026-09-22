// THE SHELF'S OWN LANGUAGE (0347) — how a league row says what is happening.
//
// Founder: "Matchup summary per league and a notification for unread chats."
//
// The numbers come from `my_league_slate`; this is the small layer that turns
// a pair of scores into the sentence a person actually reads at a glance, and
// it lives in core so the app and the web say the same words. Two clients
// each inventing "are we winning" is how one of them ends up congratulating
// you on a game you lost.
import type { LeagueSlateRow, SlateSide } from './liveApi';

/** "2-0", or "1-0-1" once there is a tie to report.
 *
 *  A tie is dropped when there are none rather than printed as a trailing -0,
 *  because most leagues never have one and "2-0-0" reads like a third column
 *  you are supposed to understand. */
export function recordLabel(r: SlateSide['record']): string | null {
  if (!r) return null;
  const { wins = 0, losses = 0, ties = 0 } = r;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export type Verdict = 'won' | 'lost' | 'tied' | 'leading' | 'trailing' | 'level';

/** Where this seat stands in the game on the card.
 *
 *  FINAL AND LIVE ARE DIFFERENT SENTENCES. A finished game is won or lost; a
 *  game in progress is only ever leading or trailing, and calling a 40-point
 *  lead in the first quarter a "win" is the kind of confidence a scoreboard
 *  has no business having. `status` decides which vocabulary is used, and a
 *  week with no scores yet gets neither.
 *
 *  Null when there is nothing to judge: no game, or a fixture whose scores
 *  have not been published (both sides null before the first kickoff). */
export function verdictOf(game: LeagueSlateRow['game']): Verdict | null {
  if (!game) return null;
  const me = game.me?.points, opp = game.opp?.points;
  if (me == null || opp == null) return null;
  const done = game.status === 'final';
  if (me === opp) return done ? 'tied' : 'level';
  if (me > opp) return done ? 'won' : 'leading';
  return done ? 'lost' : 'trailing';
}

/** Is this row worth the eye — a live game, or unread chat? Drives nothing
 *  but ordering and emphasis; a quiet league is still a league and is never
 *  hidden. */
export function isLoud(row: LeagueSlateRow): boolean {
  const u = row.unread;
  return !!(row.game?.me?.live || row.game?.opp?.live
    || (u && ((u.league ?? 0) > 0 || (u.dm ?? 0) > 0)));
}

/** Unread, as a badge: the count and whether any of it NAMES you.
 *
 *  League chat and DMs add up because the badge answers "is there something
 *  for me in here", which does not care which room it is in — but a mention
 *  is louder than a count, so it is carried separately rather than folded in.
 *  Zero comes back as null so a caller renders nothing rather than a 0. */
export function unreadBadge(row: LeagueSlateRow): { n: number; mention: boolean } | null {
  const u = row.unread;
  if (!u) return null;
  const n = (u.league ?? 0) + (u.dm ?? 0);
  if (n <= 0) return null;
  return { n, mention: (u.mention ?? 0) > 0 };
}

/** One line for a seat: "dachhack (1-0-1)". The record is dropped rather than
 *  faked when the standings have nothing to say yet — a bare (0-0) on week 1
 *  is noise. */
export function sideLabel(s: SlateSide | null | undefined): string {
  if (!s) return '—';
  const name = s.team || `Seat ${s.roster_id}`;
  const rec = recordLabel(s.record);
  return rec ? `${name} (${rec})` : name;
}

/** The scoreboard's two numbers, formatted the way every other score in the
 *  product is: two decimals, and an em dash where a score does not exist yet
 *  rather than a 0.00 that claims a game was played and nobody scored. */
export function scoreLabel(p: number | null | undefined): string {
  return p == null ? '—' : p.toFixed(2);
}

/** Leagues in the order a person wants to see them: anything live or unread
 *  first, then by name. A list that never moves is easier to navigate, so the
 *  only thing allowed to reorder it is something actually happening. */
export function sortSlate(rows: readonly LeagueSlateRow[]): LeagueSlateRow[] {
  return [...rows].sort((a, b) => {
    const la = isLoud(a) ? 0 : 1, lb = isLoud(b) ? 0 : 1;
    return la - lb || (a.name ?? '').localeCompare(b.name ?? '');
  });
}
