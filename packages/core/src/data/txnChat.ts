// THE WIRE, IN CHAT (v0.405.0).
//
// Founder: "we need an add/drop log that also includes a waiver report when it
// runs and a trade report when it happens. All this goes in chat."
//
// Migration 0290 posts the sentence — the server composes it, because the
// server is where the names are and because push reads the same body. This
// file decides how the sentence LOOKS: an icon and a tone per kind, the same
// shape draftLog.ts uses for the draft room, so the web bubble and the app
// bubble cannot end up disagreeing about which colour a trade is.

/** What 0290 puts in league_message.txn. Extra keys are ignored on purpose. */
export interface TxnPayload {
  kind?: string;
  roster_id?: number | null;
  add?: string | null;
  drop?: string | null;
  from_roster?: number | null;
  to_roster?: number | null;
  won?: number;
  lost?: number;
}

export interface TxnLook {
  icon: string;
  tone: 'you' | 'warn' | 'dim' | 'text';
  /** A short label for a compact surface; the body carries the detail. */
  label: string;
}

/**
 * An unknown kind is a newer server talking to an older client, which happens
 * on every release — the app updates when somebody gets round to it. It gets
 * the neutral look rather than nothing, so the line still reads.
 */
export function txnLook(txn: TxnPayload | null | undefined): TxnLook {
  switch (txn?.kind) {
    case 'add':    return { icon: '🟢', tone: 'you',  label: 'ADD' };
    case 'drop':   return { icon: '🔻', tone: 'dim',  label: 'DROP' };
    case 'waiver': return { icon: '📋', tone: 'warn', label: 'WAIVERS' };
    case 'trade':  return { icon: '🤝', tone: 'warn', label: 'TRADE' };
    // 0321: a trade out for a league vote, and the ruling the floor gave it.
    case 'vote':   return { icon: '🗳', tone: 'warn', label: 'TRADE VOTE' };
    // 0325: the week's awards, and a badge the commissioner pinned on somebody.
    case 'award':  return { icon: '🏅', tone: 'you',  label: 'AWARDS' };
    case 'badge':  return { icon: '🎖', tone: 'you',  label: 'BADGE' };
    default:       return { icon: '·',  tone: 'dim',  label: 'MOVE' };
  }
}

/**
 * The body already opens with the icon (0290 composes it that way so a push
 * notification and a chat bubble read alike). A bubble that draws its own icon
 * would print it twice, so this strips the leading one.
 */
export function txnBody(body: string, look: TxnLook): string {
  const b = String(body ?? '');
  return b.startsWith(look.icon) ? b.slice(look.icon.length).trimStart() : b;
}

/** ── THE WAIVER RUN, IN FULL (0344) ─────────────────────────────────────────
 *
 *  Founder: "can we have the daily waiver report be clickable in chat and open
 *  a detailed report?"
 *
 *  0290's chat line is `left(btrim(body), 500)`. A quiet Tuesday fits; a busy
 *  FAAB Wednesday does not, and it truncates at exactly the wrong end — the
 *  losers and their reasons are last in the sentence, and "why didn't I get
 *  him" is the only question a waiver report exists to answer.
 *
 *  So the line gains a door, and this is what is behind it. */
export interface WaiverRunEntry {
  roster_id: number;
  team: string | null;
  add_slug: string;
  add: string | null;
  drop_slug: string | null;
  drop: string | null;
  /** FAAB leagues only; null elsewhere, where a 0 would read as "bid nothing"
   *  rather than "this league does not bid". */
  bid: number | null;
  /** Losers only: the reason `process_waivers` recorded. */
  why?: string;
  /** A linked group (0316) — these claims stand or fall together, and a loser
   *  whose partner failed is not the same story as one who was outbid. */
  group_id?: string | null;
  group_seq?: number | null;
  group_max?: number | null;
}
export interface WaiverRunReport {
  ok?: boolean;
  error?: string;
  /** False when no run can be found at that instant — an empty sheet would
   *  otherwise read as a run in which nobody won anything. */
  found?: boolean;
  at?: string | null;
  mode?: 'rolling' | 'standings' | 'faab';
  won?: WaiverRunEntry[];
  lost?: WaiverRunEntry[];
  /** The wire AFTER the run: who is up next, and what is left to spend. */
  order?: { roster_id: number; team: string | null; priority: number | null; faab: number | null }[];
}

/** Is this chat line a waiver run that can be opened? A txn bubble of any
 *  other kind has nothing behind it, and drawing a tap target on one would
 *  promise a sheet that never arrives. */
export function isWaiverRun(txn: TxnPayload | null | undefined): boolean {
  return txn?.kind === 'waiver';
}

/** One line for the sheet, so both hosts phrase a claim the same way. The chat
 *  BODY is the server's sentence and stays as it is; this is the per-row
 *  version, which has room to say what the sentence had to compress. */
export function waiverRunLine(e: WaiverRunEntry, mode?: string): string {
  const who = e.team || `Roster ${e.roster_id}`;
  const bid = mode === 'faab' && e.bid != null ? ` $${e.bid}` : '';
  const drop = e.drop ? ` · dropped ${e.drop}` : '';
  const why = e.why ? ` — ${e.why}` : '';
  return `${who}${bid} · ${e.add ?? e.add_slug}${drop}${why}`;
}
