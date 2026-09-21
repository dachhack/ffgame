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
