// WHAT KIND OF LEAGUE ARE YOU BEING INVITED TO (v0.325.0).
//
// Founder, on a chat unfurl of an invite link: "If the league being advertised
// is a classic league, we need a different tagline."
//
// ── THE HALF THAT CANNOT BE FIXED IN CODE ─────────────────────────────────
// The UNFURL is static. dripfantasy.com is GitHub Pages (deploy.yml) — a pure
// static host that returns the same index.html for every query string — and a
// link unfurler reads meta tags without running JavaScript. So `?code=A1B2C3D4`
// cannot carry its own og:description; per-league unfurls need a server in
// front of the site, which is a hosting decision rather than a code one.
//
// index.html's copy was therefore made TRUE OF BOTH MODES instead of pitching
// drip mechanics at everyone. That is the honest fix available today.
//
// ── THE HALF THAT CAN ─────────────────────────────────────────────────────
// The app's own join screen runs JavaScript, holds the code, and since 0206/
// 0207 can ask what the league plays before anyone signs up. So the moment the
// recruit actually lands, the pitch is the right one. This is that copy, in
// core so both platforms and the parity test share ONE wording.
//
// UNSET MEANS DRIP, matching `league_game_mode`, the resolver and the board —
// a league that never chose is a drip league everywhere else, and inventing a
// different default here would make the join card disagree with the game.

export type GameMode = 'classic' | 'drip' | string;

export interface LeagueTagline {
  /** A short badge: CLASSIC / DRIP. */
  label: string;
  /** One line about what this league actually plays. */
  blurb: string;
  /** True when the mode was recognised. A league on some future mode this
   *  build has never heard of gets the neutral line rather than a wrong one —
   *  saying nothing beats pitching the wrong game. */
  known: boolean;
}

/** What is true of EVERY league here, whatever the mode — the line to fall back
 *  to, and the one the static unfurl now leads with. */
export const NEUTRAL_BLURB = 'Head-to-head fantasy football, scored live over real NFL play-by-play.';

export function taglineFor(mode?: GameMode | null): LeagueTagline {
  const m = (mode ?? '').trim().toLowerCase();
  if (m === 'classic') {
    return {
      label: 'CLASSIC',
      // No hidden picks, no effects — and said in terms of what the manager
      // DOES, since "standard scoring" alone describes half the internet.
      blurb: 'Standard scoring, open lineups — every spot locks at its own player’s kickoff, live on real NFL play-by-play.',
      known: true,
    };
  }
  if (m === 'drip') {
    return {
      label: 'DRIP',
      blurb: 'A hidden scoring metric behind every player, revealing and firing live — nukes, erasures, hot streaks — over real NFL play-by-play.',
      known: true,
    };
  }
  return { label: '', blurb: NEUTRAL_BLURB, known: false };
}

// ── WHICH GAME AM I BEING RECRUITED FOR (v0.357.3) ────────────────────────
//
// Founder: "Im starting to recruit for non-drip leagues but the site still
// draws people to the drip demo."
//
// v0.325.0 fixed the recruit who arrives HOLDING A CODE — the join screen asks
// what the league plays and pitches that. It could not fix the recruit who
// arrives with nothing, because nothing in the URL said which game they were
// sent for, and the landing page IS the drip demo: hidden metrics, power-ups,
// a nuke. Someone invited to a classic league met a pitch for the other game.
//
// `?game=classic` is that missing sentence, and it costs no server: the static
// host ignores query strings but the app reads them, the same way `?code=`
// already works. A recruiter hands out the link; the landing leads with the
// game they were actually sent for and says plainly that the demo shows the
// other one.
//
// UNSET STAYS DRIP-FIRST. A bare visit is not a classic recruit, and guessing
// would sell the ordinary version of the product to everyone.

/** The game a recruiting link says its reader was sent for, or null when the
 *  link never said. Deliberately narrow: only the two modes the product has,
 *  never a free-text value off a URL. */
export function readRecruitGame(get: (key: string) => string | null | undefined): 'drip' | 'classic' | null {
  const g = (get('game') ?? '').trim().toLowerCase();
  return g === 'classic' || g === 'drip' ? g : null;
}

/** The landing band's two lines for a visitor, given what the link said.
 *  `demoMode` is the game the demo actually plays — stated rather than
 *  assumed, so the day a classic demo exists this reads correctly without
 *  being rewritten. */
export function recruitFraming(recruited: 'drip' | 'classic' | null, demoMode: GameMode = 'drip'): {
  /** The headline: what this visitor was sent here for. */
  lead: string;
  /** What that game is, in one line. */
  blurb: string;
  /** True when the demo below plays a DIFFERENT game than the one they were
   *  recruited for — the case that needs saying out loud. */
  mismatch: boolean;
} {
  const demo = taglineFor(demoMode);
  if (!recruited) {
    return {
      lead: `Two games, one league app. This demo plays ${demo.label || 'DRIP'}.`,
      blurb: NEUTRAL_BLURB,
      mismatch: false,
    };
  }
  const t = taglineFor(recruited);
  const mismatch = recruited !== (demoMode ?? '').trim().toLowerCase();
  return {
    lead: mismatch
      ? `You're being invited to a ${t.label} league. The demo below plays ${demo.label || 'DRIP'} — our other game.`
      : `You're being invited to a ${t.label} league. That's what the demo below plays.`,
    blurb: t.blurb,
    mismatch,
  };
}

// ── WHAT ELSE A SEASON CAN BE (v0.358.0) ──────────────────────────────────
//
// Founder: "We want to show off all the scoring options and game formats/modes."
//
// The scoring options are DEMONSTRABLE — the landing re-scores one real week
// at each reception value, with best ball and golf on and off, and the numbers
// move. These are the ones that are not: a format decides how a SEASON goes,
// so nothing about it can happen inside a single week. Describing them is the
// honest option, and describing them badly — pitching drip mechanics at a
// classic recruit — is the thing v0.325.0 exists to prevent, so the words live
// here with the rest of the mode copy and check-tagline holds them to it.
export interface FormatNote {
  /** What a manager calls it. */
  name: string;
  /** What it changes, in one line, from the manager's side of the screen. */
  line: string;
}

/** How the season ENDS differently. */
export const FORMAT_NOTES: FormatNote[] = [
  { name: 'Guillotine', line: 'The lowest score each week is eliminated and their whole roster hits the wire. Last team standing takes it.' },
  { name: 'Vampire', line: 'One seat is the vampire. Win the week and they take a player from anybody, giving one back.' },
  { name: 'Golf', line: 'The lowest weekly total wins. Every scoring value stays exactly the same — only the target moves.' },
];

/** What CARRIES from one season to the next. */
export const CONTINUITY_NOTES: FormatNote[] = [
  { name: 'Redraft', line: 'Everyone starts empty every year. The draft is the whole season\u2019s roster decision.' },
  { name: 'Keeper', line: 'Hold a set number of players through the offseason and give up the picks they cost.' },
  { name: 'Dynasty', line: 'Keep the lot. Rookie drafts each spring, and future picks you can trade years ahead.' },
  { name: 'Contract', line: 'Every player carries a salary and a term under a cap. Auction bids ARE the salaries — extend, tag or let them walk.' },
];

/** How the roster gets FILLED. */
export const DRAFT_NOTES: FormatNote[] = [
  { name: 'Snake', line: 'Pick order reverses each round. The usual.' },
  { name: 'Linear', line: 'Same order every round — the wooden spoon gets first pick eighteen times.' },
  { name: 'Auction', line: 'Nominate and bid. Anyone can own anyone, if the budget stretches.' },
];

// ── IS THERE ROOM, AND IS THE DOOR OPEN (v0.326.0) ────────────────────────
//
// Founder: "Can we have a commish option to close the waiting room. Just
// 'League Full'."
//
// The three states a recruit holding an invite link can be in, decided in one
// place so the join screen, the preview card and the test cannot drift:
//
//   'seat'      — a seat is free; the link seats you on arrival.
//   'waitlist'  — full, but the commissioner still takes waiters (0125).
//   'full'      — full AND the waiting room is closed (0208). Nothing to join.
//
// SEATS BEAT THE FLAG. Closing the waiting room is not closing the league, and
// a commissioner who closed it and then freed a seat has not accidentally
// barred the door — so `seats > 0` answers 'seat' whatever the flag says.
//
// UNKNOWN IS NOT 'full'. A preview from a build older than 0208 carries no
// seats and no flag, and guessing 'full' would turn a joinable league away.
// Absent means "say nothing special", which is what 'seat' renders as.

export type JoinDoor = 'seat' | 'waitlist' | 'full';

export function joinDoorFor(o: { seatsOpen?: number | null; waitlistOpen?: boolean | null }): JoinDoor {
  // NULL IS ABSENCE, NOT ZERO — and `Number(null)` is 0, which would quietly
  // turn "this build didn't tell me" into "no seats left" and bar a joinable
  // league. Checked before the coercion, deliberately.
  if (o.seatsOpen === null || o.seatsOpen === undefined) return 'seat';
  const seats = Number(o.seatsOpen);
  if (!Number.isFinite(seats) || seats > 0) return 'seat';
  return o.waitlistOpen === false ? 'full' : 'waitlist';
}
