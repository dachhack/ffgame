// CATCH UP (v0.649.0): where a reader left off in a chat.
//
// Opening a chat lands on the newest message; that is where the conversation
// is. But a member who missed forty messages wants the FIRST one they have
// not seen, and the page RPCs (0452) now say where that is: `last_read` is
// the newest id they had seen before this open, `unread` how many sit above
// it. This turns that into the one thing the screens need — which message to
// jump to and what the pill should say — so the web and the phone agree.

export interface CatchUp {
  /** Messages above the reader's mark, as the server counted them. */
  count: number;
  /** The oldest LOADED message above the mark — where "catch up" lands. When
   *  the page does not reach back that far it is the oldest loaded message,
   *  and the pill says so with a "+". */
  targetId: number;
  /** True when the page did not reach the reader's mark. */
  more: boolean;
}

/**
 * `messages` oldest first, as the screens keep them. Null when there is
 * nothing to catch up on: no mark data (an older server), nothing unread, or
 * only one new message — that one is the newest, on screen the moment the
 * chat opens, and a pill pointing at it would be noise.
 */
export function catchUpOf(
  messages: readonly { id: number }[] | null | undefined,
  mark: { last_read?: number; unread?: number } | null | undefined,
): CatchUp | null {
  if (!messages?.length || !mark || mark.last_read == null || !mark.unread || mark.unread < 2) return null;
  const first = messages.find((m) => m.id > (mark.last_read ?? 0));
  if (!first) return null;
  // More unread than the page holds: every loaded message is new, and the
  // pill's target (the oldest loaded) is not yet the first one they missed.
  return { count: mark.unread, targetId: first.id, more: mark.unread > messages.length };
}

/** The pill's words. */
export const catchUpLabel = (c: CatchUp) => `↑ ${c.count}${c.more ? '+' : ''} new · catch up`;
