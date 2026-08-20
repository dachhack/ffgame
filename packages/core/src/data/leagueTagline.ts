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
