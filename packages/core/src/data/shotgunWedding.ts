// SHOTGUN WEDDING (v0.653.0): the words both hosts print for a wedding.
// docs/shotgun-wedding.md. The card on the web (ShotgunWeddingCard) and on
// the phone read these, so a wedding never says one thing in the browser and
// another in the app.

export interface WeddingPlayer { slug: string; name: string; pos: string | null; team: string | null }
export interface WeddingSide { roster: number; team: string; score: number | null; gives: WeddingPlayer[] }
export type WeddingStatus = 'pending' | 'declined' | 'married' | 'renegotiated' | 'failed' | 'annulled';
export interface Wedding {
  id: string; week: number; status: WeddingStatus; deadline: string; note: string | null;
  home: WeddingSide; away: WeddingSide;
  /** The seat that may call it off; null on a tie. */
  winner: number | null;
  counter: { from: number; at: string; home_gives: WeddingPlayer[]; away_gives: WeddingPlayer[] } | null;
  my_seat: number | null;
  can_decline: boolean; can_counter: boolean; can_accept: boolean;
  /** Both active rosters, for composing new vows — only on your own, pending wedding. */
  rosters: { home: WeddingPlayer[]; away: WeddingPlayer[] } | null;
}

/** "8 PM ET Tue" — the deadline as members read it. */
export function weddingDeadlineLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '8 PM ET';
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)) {
    p[x.type] = x.value;
  }
  const mins = p.minute && p.minute !== '00' ? `:${p.minute}` : '';
  return `${p.hour}${mins} ${String(p.dayPeriod ?? '').toUpperCase()} ET ${p.weekday}`.replace(/\s+/g, ' ').trim();
}

export const weddingPlayerTag = (p: WeddingPlayer) => (p.pos ? `${p.name} (${p.pos})` : p.name);
export const weddingSends = (team: string, gives: WeddingPlayer[]) =>
  `${team} sends ${gives.map(weddingPlayerTag).join(', ') || 'nobody'}`;

const teamOf = (w: Wedding, seat: number | null) =>
  seat == null ? null : seat === w.home.roster ? w.home.team : seat === w.away.roster ? w.away.team : null;
const scoreLine = (w: Wedding) =>
  w.home.score != null && w.away.score != null ? `${w.home.score}–${w.away.score}` : '';

/** One sentence: where this wedding stands. */
export function weddingStatusLine(w: Wedding, nowMs: number = Date.now()): string {
  const winner = teamOf(w, w.winner);
  switch (w.status) {
    case 'declined': return `💔 ${winner ?? 'The winner'} called it off. Everyone keeps their players.`;
    case 'married': return '💍 Married — the original trade went through.';
    case 'renegotiated': return '💍 Married on their own vows — the original is off.';
    case 'failed': return `It couldn't go through${w.note ? ` (${w.note})` : ''}. Everyone keeps their players.`;
    case 'annulled': return 'Annulled — the commissioner turned Shotgun Wedding off.';
    default: break;
  }
  const at = weddingDeadlineLabel(w.deadline);
  if (Date.parse(w.deadline) <= nowMs) return `The ${at} deadline has passed — it goes through on the next sweep.`;
  return winner
    ? `Goes through at ${at} unless ${winner}, who won ${scoreLine(w)}, calls it off.`.replace(' won ,', ' won,')
    : `Goes through at ${at} unless they agree on new vows — it was a tie${scoreLine(w) ? ` (${scoreLine(w)})` : ''}, so nobody can call it off.`;
}

/** The new vows on the table, from the reader's side. */
export function weddingCounterLine(w: Wedding): string | null {
  if (!w.counter) return null;
  const from = teamOf(w, w.counter.from) ?? 'One side';
  return `New vows from ${from}: ${weddingSends(w.home.team, w.counter.home_gives)}; ${weddingSends(w.away.team, w.counter.away_gives)}.`;
}
