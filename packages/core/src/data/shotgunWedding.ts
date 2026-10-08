// SHOTGUN WEDDING (v0.653.0): the words both hosts print for a wedding.
// docs/shotgun-wedding.md. The card on the web (ShotgunWeddingCard) and on
// the phone read these, so a wedding never says one thing in the browser and
// another in the app.

/** 0454's house rules: who may call a wedding off, and when it is due. */
export type VetoRule = 'winner' | 'loser' | 'none';
export type DeadlineRule = 'tue20' | 'wed20' | 'thu12';
export const VETO_RULES: { id: VetoRule; label: string; info: string }[] = [
  { id: 'winner', label: 'WINNER', info: 'The team that won can call it off — winning earns the veto.' },
  { id: 'loser', label: 'LOSER', info: 'The team that lost can call it off — a mercy rule for the team just beaten.' },
  { id: 'none', label: 'NOBODY', info: 'Nobody can call it off — only new vows both sides agree to change it.' },
];
export const DEADLINE_RULES: { id: DeadlineRule; label: string; info: string }[] = [
  { id: 'tue20', label: 'TUE 8 PM', info: 'Settles before the Wednesday waiver run.' },
  { id: 'wed20', label: 'WED 8 PM', info: 'After the waiver run: a claim that would drop one of the four fails.' },
  { id: 'thu12', label: 'THU NOON', info: 'The latest — still before Thursday night\'s kickoff. A claim that would drop one of the four fails.' },
];

export interface WeddingPlayer { slug: string; name: string; pos: string | null; team: string | null }
export interface WeddingSide { roster: number; team: string; score: number | null; gives: WeddingPlayer[] }
export type WeddingStatus = 'pending' | 'declined' | 'married' | 'renegotiated' | 'failed' | 'annulled';
export interface Wedding {
  id: string; week: number; status: WeddingStatus; deadline: string; note: string | null;
  home: WeddingSide; away: WeddingSide;
  /** The matchup's winner; null on a tie. */
  winner: number | null;
  /** The seat that may call it off (0454): the winner, the loser or nobody,
   *  per the house rule the wedding was filed under. */
  veto: number | null;
  veto_rule: VetoRule;
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
  const vetoTeam = teamOf(w, w.veto ?? null);
  switch (w.status) {
    case 'declined': return `💔 ${vetoTeam ?? 'They'} called it off. Everyone keeps their players.`;
    case 'married': return '💍 Married — the original trade went through.';
    case 'renegotiated': return '💍 Married on their own vows — the original is off.';
    case 'failed': return `It couldn't go through${w.note ? ` (${w.note})` : ''}. Everyone keeps their players.`;
    case 'annulled': return 'Annulled — the commissioner turned Shotgun Wedding off.';
    default: break;
  }
  const at = weddingDeadlineLabel(w.deadline);
  if (Date.parse(w.deadline) <= nowMs) return `The ${at} deadline has passed — it goes through on the next sweep.`;
  if (w.veto_rule === 'none') return `Goes through at ${at} unless they agree on new vows — nobody can call this one off.`;
  return vetoTeam
    ? `Goes through at ${at} unless ${vetoTeam}, who ${w.veto_rule === 'loser' ? 'lost' : 'won'} ${scoreLine(w)}, calls it off.`.replace(/ (won|lost) ,/, ' $1,')
    : `Goes through at ${at} unless they agree on new vows — it was a tie${scoreLine(w) ? ` (${scoreLine(w)})` : ''}, so nobody can call it off.`;
}

/** The new vows on the table, from the reader's side. */
export function weddingCounterLine(w: Wedding): string | null {
  if (!w.counter) return null;
  const from = teamOf(w, w.counter.from) ?? 'One side';
  return `New vows from ${from}: ${weddingSends(w.home.team, w.counter.home_gives)}; ${weddingSends(w.away.team, w.counter.away_gives)}.`;
}
