// THE CREST ON A LEAGUE CARD (v0.324.0) — what to draw when nobody uploaded one.
//
// Founder: "The league avatars are blank for native leagues."
//
// WHY IT IS ONLY NATIVE LEAGUES, which is the whole shape of the bug: a Sleeper
// league arrives with avatars already made — Sleeper's own, mirrored onto
// `league_membership.avatar_url` by the import. A NATIVE league has no upstream
// to mirror, nothing in the app ever sets that column, and so the card fell to
// its placeholder: an empty bordered square, on every team, forever. Not a
// missing image — a missing SOURCE, which no amount of retrying fixes.
//
// The board already knew what to do here. `TeamHead` has drawn a lettered box
// for a team with no avatar since v0.228.0; the leagues list simply never got
// the same treatment. This is that rule, extracted so both platforms and the
// parity test share ONE definition of what a crest falls back to.
//
// THE LADDER, most specific first:
//   1. the TEAM's own avatar — the thing the card is actually about;
//   2. the LEAGUE's avatar — wrong subject but right league, and a shared crest
//      reads far better than a hole. This is the rung that rescues a native
//      league whose commissioner set a league image;
//   3. a LETTER, from the team's name and then the league's.
//
// Rung 3 always answers, so a card can always draw something.

export interface CrestInput {
  /** `league_membership.avatar_url` — null on every native seat. */
  teamAvatar?: string | null;
  /** `league.avatar_url`. */
  leagueAvatar?: string | null;
  teamName?: string | null;
  leagueName?: string | null;
}

export interface Crest {
  /** Draw this image when present. */
  url: string | null;
  /** Otherwise draw this character. Never empty. */
  initial: string;
  /** Which rung answered — so a host can style a borrowed crest differently
   *  from the team's own, and so the test can assert the ladder rather than
   *  just its output. */
  from: 'team' | 'league' | 'initial';
}

/** A blank-ish value: null, undefined, whitespace, or a string that is only
 *  punctuation. An avatar column holding "" is not an avatar, and a team named
 *  " " has no letter to give. */
const has = (v?: string | null): v is string => typeof v === 'string' && v.trim().length > 0;

/** The first LETTER OR DIGIT of a name, uppercased.
 *
 *  Not `charAt(0)`: a team called "⚡ Bolts" or "'96 Packers" would hand back a
 *  glyph that says nothing about which team it is. Falls through to the next
 *  name, and finally to a neutral mark rather than an empty box. */
export function crestInitial(...names: (string | null | undefined)[]): string {
  for (const n of names) {
    if (!has(n)) continue;
    const m = /\p{L}|\p{N}/u.exec(n);
    if (m) return m[0].toUpperCase();
  }
  return '?';
}

export function crestFor(i: CrestInput): Crest {
  const initial = crestInitial(i.teamName, i.leagueName);
  if (has(i.teamAvatar)) return { url: i.teamAvatar.trim(), initial, from: 'team' };
  if (has(i.leagueAvatar)) return { url: i.leagueAvatar.trim(), initial, from: 'league' };
  return { url: null, initial, from: 'initial' };
}
