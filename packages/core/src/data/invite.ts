// THE INVITE LINK (v0.291.0) — one league, one URL, sendable to anyone.
//
// Founder: "allow post to board for commish and portable/sendable link for
// commish and players."
//
// ── THE LINK DID NOT WORK, AND THIS COMMENT USED TO SAY IT DID (v0.323.2) ──
// The original header asserted: "`?code=XXXX` has been a complete path for a
// long time — App.tsx reads it off the landing URL." That was WRONG, and it was
// wrong at the time it was written. App.tsx reads the invite code inside
// `if (p.get('live') === '1')` and nowhere else, so a bare `?code=` matched no
// branch at all: nothing stashed, nothing navigated, and the visitor landed on
// the default route — the demo board. Founder: "I want to get people into a
// classic league. It looks like following this link just goes to the demo
// board." Every invite sent since v0.291.0 went nowhere.
//
// The same lesson as v0.320.0's preseason week, in a different costume: a
// comment described a neighbouring module's behaviour, the neighbour disagreed,
// and nobody asked it. Reading App.tsx takes ten seconds.
//
// FIXED AT BOTH ENDS ON PURPOSE:
//   • this module now emits `?live=1&code=…`, the form App.tsx has always
//     understood and the form LiveOnboard's commissioner link already used;
//   • and App.tsx now ALSO accepts a bare `?code=` that looks like an invite
//     code, so the links already sent — which are out of our hands — start
//     working rather than staying broken forever.
//
// WHY THE ORIGIN IS HARDCODED and not `platform().url.redirectBase()`: that
// resolves to a deep link on native (`dripfantasy://auth`), which is exactly
// the thing a shared link must not be — it opens nothing on a phone without the
// app, which is every recipient worth recruiting.

/** The public site. A shared link has to reach someone who has never installed
 *  anything, so this is the web origin on both hosts. */
export const SITE_ORIGIN = 'https://dripfantasy.com';

/** What `gen_invite_code()` makes (migration 0002): eight hex characters,
 *  uppercased. `commish_code` (0003) is the same generator.
 *
 *  This shape is load-bearing, not decoration. `?code=` is ALSO how Supabase's
 *  PKCE flow returns an auth code, so "any ?code= is an invite" would hijack a
 *  sign-in return. A PKCE code is a long opaque token and can never be exactly
 *  eight hex characters, which makes this a safe discriminator. */
export const INVITE_CODE_RE = /^[0-9a-f]{8}$/i;

/** A one-off solo pass (0097) rides the same param and is redeemed elsewhere. */
export const SOLO_PASS_RE = /^solo-/i;

/** The joinable URL for an invite code.
 *
 *  `live=1` is not optional: it is the flag App.tsx branches on to enter Live
 *  mode, and without it the recipient lands on the marketing route. */
export const inviteLink = (code: string): string =>
  `${SITE_ORIGIN}/?live=1&code=${encodeURIComponent(code.trim().toUpperCase())}`;

/** THE OTHER LINK (v0.358.1) — for a recruit who wants to LOOK before they
 *  commit.
 *
 *  Founder: "let's add the classic link to the commish invite area. Classic
 *  league invites should get you there."
 *
 *  `inviteLink` above carries a code and goes straight to sign-in and redeem;
 *  it never shows the demo, and the join screen has pitched the right game
 *  since v0.325.0. This one carries NO code — it lands on the demo, which is
 *  where a game hint is the whole difference: a classic league's recruit gets
 *  the classic board (v0.358.0) rather than a pitch for hidden metrics and
 *  power-ups.
 *
 *  DRIP GETS THE BARE ORIGIN. Unset means drip everywhere in this codebase and
 *  the demo already opens on it, so the parameter would say nothing while
 *  making the link longer to paste and easier to mistype. */
export const previewLink = (game?: string | null): string => {
  const g = (game ?? '').trim().toLowerCase();
  return g === 'classic' ? `${SITE_ORIGIN}/?game=classic` : SITE_ORIGIN;
};

/** What a landing URL is asking for, or null when it is asking for nothing.
 *
 *  Pure, and takes a getter rather than a URL so both a `URLSearchParams` and a
 *  plain object can be passed — and so this can be tested against the exact
 *  query strings that were arriving in production.
 *
 *  RETURNS null WHEN `state` IS PRESENT. An OAuth return (`?state=yahoo&code=…`,
 *  or any provider round trip) owns its own `code`, and mistaking one for an
 *  invite would stash a secret in localStorage and skip the exchange. */
export interface InviteParams {
  /** The league invite code to stash as `dripInviteCode`. */
  invite?: string;
  /** A solo pass, stashed as `dripSoloPass`. */
  solo?: string;
  /** A commissioner claim code, stashed as `dripCommishCode`. */
  commish?: string;
  /** A DFS league code, stashed as `dripDfsCode`. */
  dfs?: string;
}
export function readInviteParams(
  get: (key: string) => string | null | undefined,
  /** TRUSTED means the URL already said `live=1` — the author asserted these
   *  params are ours, so take them at face value as the old code did. A code
   *  that fails the shape test then reaches the redeem form and fails there
   *  WITH A MESSAGE, which beats being dropped in silence.
   *
   *  Untrusted is the inference path — a bare `?code=` with nothing else
   *  vouching for it — and that is where the shape test earns its keep. */
  trusted = false,
): InviteParams | null {
  if (get('state')) return null;                       // an OAuth return owns its ?code
  const ok = (v: string) => (trusted ? v.length > 0 : INVITE_CODE_RE.test(v));
  const out: InviteParams = {};
  const code = (get('code') ?? '').trim();
  if (SOLO_PASS_RE.test(code)) out.solo = code.toUpperCase();
  else if (ok(code)) out.invite = code.toUpperCase();
  // `commish` and `dfs` are the same generator, so they take the same check.
  const commish = (get('commish') ?? '').trim();
  if (ok(commish)) out.commish = commish.toUpperCase();
  const dfs = (get('dfs') ?? '').trim();
  if (ok(dfs)) out.dfs = dfs.toUpperCase();
  return Object.keys(out).length ? out : null;
}

/** The whole message a recruiter sends — the same words from every surface.
 *
 *  The CODE is repeated in plain text under the link deliberately: SMS and some
 *  chat clients strip or mangle query strings, and a recruit who can still read
 *  "ABCD" out of the message can finish the job by hand. */
export function inviteMessage(o: { league?: string | null; code: string; seatsOpen?: number | null; game?: string | null }): string {
  const code = o.code.trim().toUpperCase();
  const named = o.league?.trim() ? `"${o.league.trim()}"` : 'my league';
  const seats = o.seatsOpen && o.seatsOpen > 0
    ? ` ${o.seatsOpen} seat${o.seatsOpen === 1 ? '' : 's'} open.`
    : '';
  // THE LOOK-FIRST LINE (v0.358.1). Only for a CLASSIC league: the bare origin
  // already opens on drip, so offering a drip recruit "or see the game first"
  // pointing at the same site the line above points at is a second URL that
  // adds nothing. A classic recruit has something to be sent somewhere else
  // for, and that is exactly the recruit this was breaking for.
  const classic = (o.game ?? '').trim().toLowerCase() === 'classic';
  const look = classic ? `\n\nNot ready to sign up? See how it plays: ${previewLink('classic')}` : '';
  return `Join ${named} on Drip Fantasy — real-time fantasy football.${seats}\n\n`
    + `${inviteLink(code)}\n\n`
    + `(or enter invite code ${code} at ${SITE_ORIGIN})${look}`;
}
