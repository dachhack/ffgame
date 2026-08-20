// QUICK REACTIONS (0210).
//
// Founder: "can we have quick reactions in chat..Like thumbs up, agree, fire,
// surprise etc."
//
// ── WHY A FIXED SET ────────────────────────────────────────────────────────
// Six, closed. Free-text emoji would give every message an unbounded number of
// distinct values (so the server's per-message aggregate stops being a small
// fixed row), a moderation surface nobody asked for, and a strip that cannot
// lay itself out because it does not know what is coming. A closed set renders
// as the same six chips every time — which is the point of a QUICK reaction:
// you are choosing, not composing.
//
// ── THIS LIST IS DUPLICATED IN SQL, AND THAT IS CHECKED ────────────────────
// `_chat_reaction_ok` in migration 0210 holds the same six. SQL cannot import
// TypeScript, so the duplication is unavoidable — but it is not unchecked:
// scripts/check-mentions.mjs READS THE MIGRATION and asserts the two lists are
// identical. A reaction the client offers and the server rejects is a button
// that does nothing, and that failure is invisible until someone taps it.

export interface ChatReaction {
  emoji: string;
  /** What it MEANS, for the accessible name and the long-press hint. The emoji
   *  alone is not a label: a screen reader says "fire", which is not what the
   *  tap communicates. */
  label: string;
}

export const CHAT_REACTIONS: readonly ChatReaction[] = [
  { emoji: '👍', label: 'agree' },
  { emoji: '👎', label: 'disagree' },
  { emoji: '🔥', label: 'fire' },
  { emoji: '😂', label: 'funny' },
  { emoji: '😮', label: 'surprised' },
  { emoji: '💯', label: 'this' },
] as const;

/** The emoji alone, in order — the order the strip renders in. */
export const CHAT_REACTION_EMOJI: readonly string[] = CHAT_REACTIONS.map((r) => r.emoji);

export function reactionLabel(emoji: string): string {
  return CHAT_REACTIONS.find((r) => r.emoji === emoji)?.label ?? emoji;
}

/** One message's reactions as the server sends them. */
export interface ChatReactionCount { emoji: string; n: number; mine: boolean }

/** Fold the server's counts into the FIXED order above, so the strip does not
 *  reshuffle under the reader's thumb as counts change.
 *
 *  The server orders by count (biggest first), which is right for a summary and
 *  wrong for a row of controls: a chip that moves between the moment you look
 *  at it and the moment you tap it is a chip you tap wrong. Unknown emoji —
 *  rows written before a future list change — are kept, at the end, rather than
 *  silently dropped: a count that exists should be shown by whoever holds it. */
export function orderedReactions(counts: ChatReactionCount[] | null | undefined): ChatReactionCount[] {
  const got = new Map((counts ?? []).filter((c) => c && c.emoji).map((c) => [c.emoji, c]));
  const known = CHAT_REACTION_EMOJI.map((e) => got.get(e)).filter(Boolean) as ChatReactionCount[];
  const extra = (counts ?? []).filter((c) => c && c.emoji && !CHAT_REACTION_EMOJI.includes(c.emoji));
  return [...known, ...extra];
}
