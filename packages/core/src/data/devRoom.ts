// THE DEV ROOM's pure helpers (v0.658.0) — the invite link and message, and
// the issue link a filed line shows. Shared by both hosts.
import { SITE_ORIGIN, INVITE_CODE_RE } from './invite';

export const ISSUES_REPO = 'dachhack/ffgame';

/** The link an invited tester taps. `live=1` puts the site in Live mode, and
 *  `room` is read by App.tsx (readDevRoomParam) and joined after sign-in. */
export const devRoomLink = (code: string): string =>
  `${SITE_ORIGIN}/?live=1&room=${encodeURIComponent(code.trim().toUpperCase())}`;

/** The whole message the founder sends. The code is repeated in plain text,
 *  for the chat clients that mangle a link (the league invite's rule). */
export function devRoomInviteMessage(o: { room: string; code: string }): string {
  const code = o.code.trim().toUpperCase();
  return `You're invited to the ${o.room.trim() || 'Drip Fantasy dev room'} — tell us what to build and what's broken.\n\n`
    + `${devRoomLink(code)}\n\n`
    + `(or open the Drip Fantasy app → Dev room → enter code ${code})`;
}

/** A dev-room code off a landing URL, or null. Same eight-hex shape as every
 *  other invite code, which keeps it from ever matching an OAuth return. */
export function readDevRoomParam(get: (key: string) => string | null | undefined): string | null {
  if (get('state')) return null;
  const c = (get('room') ?? '').trim();
  return INVITE_CODE_RE.test(c) ? c.toUpperCase() : null;
}

/** Normalise a typed code: spaces and case are forgiven. */
export const cleanDevCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

export const issueUrl = (n: number): string => `https://github.com/${ISSUES_REPO}/issues/${n}`;

export const TAG_LABEL = { idea: '💡 IDEA', bug: '🐞 BUG' } as const;
