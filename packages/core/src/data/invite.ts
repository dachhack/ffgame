// THE INVITE LINK (v0.291.0) — one league, one URL, sendable to anyone.
//
// Founder: "allow post to board for commish and portable/sendable link for
// commish and players."
//
// THE LINK ALREADY WORKED; NOTHING BUILT ONE. `?code=XXXX` has been a complete
// path for a long time — App.tsx reads it off the landing URL, stashes it as
// `dripInviteCode` so it survives the magic-link bounce to a different origin,
// and the redeem form picks it up and joins on arrival. Every share button in
// the app was nevertheless handing out a bare CODE and the words
// "dripfantasy.com", leaving the recipient to type four characters into a form
// they had to find first. This module is the missing half.
//
// WHY THE ORIGIN IS HARDCODED and not `platform().url.redirectBase()`: that
// resolves to a deep link on native (`dripfantasy://auth`), which is exactly
// the thing a shared link must not be — it opens nothing on a phone without the
// app, which is every recipient worth recruiting.

/** The public site. A shared link has to reach someone who has never installed
 *  anything, so this is the web origin on both hosts. */
export const SITE_ORIGIN = 'https://dripfantasy.com';

/** The joinable URL for an invite code. */
export const inviteLink = (code: string): string =>
  `${SITE_ORIGIN}/?code=${encodeURIComponent(code.trim().toUpperCase())}`;

/** The whole message a recruiter sends — the same words from every surface.
 *
 *  The CODE is repeated in plain text under the link deliberately: SMS and some
 *  chat clients strip or mangle query strings, and a recruit who can still read
 *  "ABCD" out of the message can finish the job by hand. */
export function inviteMessage(o: { league?: string | null; code: string; seatsOpen?: number | null }): string {
  const code = o.code.trim().toUpperCase();
  const named = o.league?.trim() ? `"${o.league.trim()}"` : 'my league';
  const seats = o.seatsOpen && o.seatsOpen > 0
    ? ` ${o.seatsOpen} seat${o.seatsOpen === 1 ? '' : 's'} open.`
    : '';
  return `Join ${named} on Drip Fantasy — real-time fantasy football.${seats}\n\n`
    + `${inviteLink(code)}\n\n`
    + `(or enter invite code ${code} at ${SITE_ORIGIN})`;
}
