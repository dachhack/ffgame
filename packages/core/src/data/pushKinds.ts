// THE NOTIFICATION TYPES, ONE LIST (v0.708.0). Founder: "Any app notification
// additions we could do? League event timing, player status, roster QC,
// player events like TDs and big plays" → "Let's do them all but work through
// tuning and turn off/on options for each."
//
// Each type is a per-device switch (push_token.prefs, 0153), read by the
// phone's and the web's settings and by the worker's sender, so the three can
// never disagree about what a switch means or where it starts. A switch the
// member never touched takes `defaultOn`: the live play-by-play types start
// OFF (a Sunday of pings nobody asked for gets the whole app muted), the rest
// start on.

export interface PushKind {
  key: string;
  label: string;
  /** One line for the ⓘ sheet. */
  info: string;
  defaultOn: boolean;
}

export const PUSH_KINDS: PushKind[] = [
  { key: 'lineup', label: 'lineup locks soon', info: 'An empty spot an hour before it locks, and a weekly squad not built before kickoff.', defaultOn: true },
  { key: 'status', label: 'starter ruled out', info: 'A player in your lineup is ruled OUT, doubtful, on IR, or inactive at the 90-minute list — while there is still time to swap.', defaultOn: true },
  { key: 'rosterqc', label: 'lineup check', info: 'The night before your first game: a starter on bye, an empty spot, or a starter ruled out. Only when something is wrong.', defaultOn: true },
  { key: 'timing', label: 'league deadlines', info: 'The evening before your waiver run, the trade deadline’s week, and contract lengths locking within a day.', defaultOn: true },
  { key: 'result', label: 'results & the sweat', info: 'Your final score each week, and the score and who is left to play before the week’s last game day.', defaultOn: true },
  { key: 'bigplay', label: 'your big plays', info: 'Live: a touchdown or a 20+ yard play by one of your starters. At most 3 a player a game.', defaultOn: false },
  { key: 'oppplay', label: 'opponent’s big plays', info: 'Live: the same, for your opponent’s starters.', defaultOn: false },
  { key: 'coin', label: 'drip coin', info: 'Drip coin earned, and when you can afford a play before the week locks.', defaultOn: true },
  { key: 'chat', label: 'mentions & DMs', info: 'Someone names you in league chat, or messages you directly.', defaultOn: true },
  { key: 'trades', label: 'trade offers', info: 'Offers to you, answers to yours, and your shotgun wedding’s vows.', defaultOn: true },
  { key: 'waivers', label: 'waiver results', info: 'Your claims won or lost when the waiver run settles.', defaultOn: true },
  { key: 'draft', label: 'draft alerts', info: 'The draft is about to start, and it is your pick.', defaultOn: true },
  { key: 'members', label: 'new managers', info: 'Commissioners: someone joined or claimed a seat.', defaultOn: true },
  // 0273: one key for both format events — a manager who wants one wants the other.
  { key: 'format', label: 'chopped & bitten', info: 'The guillotine took your team, or a vampire fed on you.', defaultOn: true },
];

/** NO ICONS IN A NOTIFICATION (v0.708.2, founder: "Don't use the icons for
 *  alerts or in the alert settings. Just the drip icon in the alert."). The
 *  sender runs every title and body through this, so no detector, old or new,
 *  can put an emoji beside the app's own icon. Arrows and ◎ are text and stay. */
export function plainText(s: string): string {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s{2,}/g, ' ').replace(/^[\s·:—-]+/, '').trim();
}

const DEFAULTS = new Map(PUSH_KINDS.map((k) => [k.key, k.defaultOn]));

/** Is this type on for a device? Its switch if touched, else the type's default (unknown types: on). */
export function pushKindOn(prefs: Record<string, unknown> | null | undefined, key: string): boolean {
  const v = prefs?.[key];
  return typeof v === 'boolean' ? v : (DEFAULTS.get(key) ?? true);
}

/** The prefs after flipping one switch. */
export const flipPushKind = (prefs: Record<string, boolean>, key: string): Record<string, boolean> =>
  ({ ...prefs, [key]: !pushKindOn(prefs, key) });
