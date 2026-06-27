// Image URLs: ESPN team logos + player headshots, plus per-team crest avatars
// for the sanitized Drip Test League demo (2025 league logos, no real owners).
import { HEADSHOTS } from './headshots';

// ESPN team logo by NFL abbreviation. ESPN accepts the standard abbr lowercased
// for every team in this league (la/lar/was/wsh all resolve), so no remap.
export function teamLogo(abbr?: string | null): string | null {
  if (!abbr) return null;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
}

/** Build an ESPN headshot URL from a raw ESPN player id. */
export function espnHeadshot(espnId?: string | null): string | null {
  if (!espnId) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
}

// Runtime headshots, keyed by engine player id, for a loaded Sleeper league —
// built from the Sleeper directory's espn_id so roster players outside the baked
// crosswalk still get a real photo. Baked HEADSHOTS win; this fills the gaps.
let runtimeHeadshots: Record<string, string> = {};
/** Install per-player headshot URLs for the active (Sleeper) league. */
export function setRuntimeHeadshots(map: Record<string, string>): void { runtimeHeadshots = map; }
/** Drop runtime headshots (back to the baked demo league). */
export function clearRuntimeHeadshots(): void { runtimeHeadshots = {}; }

/** ESPN headshot for a player slug, or null (→ fall back to the team logo). */
export function headshot(playerId?: string | null): string | null {
  if (!playerId) return null;
  return HEADSHOTS[playerId] ?? runtimeHeadshots[playerId] ?? null;
}

// Manager/team avatar by owner_id. The Drip Test League demo uses synthetic
// "dt-N" owner ids, each mapped to a fabricated team's 2025 league logo (the
// same per-team avatars seeded into the live DB Drip Test League) so the demo
// shows distinct crests without exposing any real manager's avatar.
const SLEEPER_AVATAR = (h: string) => `https://sleepercdn.com/avatars/${h}`;
const TEAM_AVATAR: Record<string, string> = {
  'dt-1': SLEEPER_AVATAR('9ae315a03fbf83b23065f1d98e405388'),  // Taco Time Titans
  'dt-2': SLEEPER_AVATAR('f90b463e2c283c2215a3fd26f6780b7e'),  // Cheeseburger Chargers
  'dt-3': SLEEPER_AVATAR('b43cbd8b189f309a4299a862b914766b'),  // Beach Day Ballers
  'dt-4': SLEEPER_AVATAR('7a7b3ea2741db8850467f4daee51c29b'),  // Cookout Crew
  'dt-5': SLEEPER_AVATAR('46aafc267ae278acf0cc1c366ded78ae'),  // Surf's Up Sharks
  'dt-6': SLEEPER_AVATAR('e4a1d6c5eb9b041f79fa802a037aa4ca'),  // Poolside Punters
  'dt-7': SLEEPER_AVATAR('22525678eac3ef2f9ae65fc6dd5671c3'),  // Ballpark Blitz
  'dt-8': SLEEPER_AVATAR('ccbb3f6090d4c7deb0d6b8f63a67ded6'),  // Road Trip Raiders
  'dt-9': SLEEPER_AVATAR('a11f2ed658865776c8087287eaf17d51'),  // Gone Fishing Phins
  'dt-10': SLEEPER_AVATAR('0da38888462c687a9b64d04079344b2f'), // Chicken Nuggies
  'dt-11': SLEEPER_AVATAR('580df1d9bf71a3e817564ce0d4adbdeb'), // Smash Mouth Maulers
  'dt-12': SLEEPER_AVATAR('5fc9f197eafa919d157000d0c7e0eb36'), // Dunder Mifflin Dynamos
};
export function avatarUrl(ownerId?: string | null): string | null {
  return (ownerId && TEAM_AVATAR[ownerId]) || null;
}
