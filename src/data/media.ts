// Image URLs: ESPN team logos + player headshots, and real Sleeper manager/team
// avatars (pulled from the Sleeper public API for league 1181483840740397056).
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

// Manager/team avatar by Sleeper owner_id — team upload if set, else the user
// avatar thumbnail.
const TEAM_AVATAR: Record<string, string> = {
  '201719736654888960': 'https://sleepercdn.com/uploads/1b276783d898a0edb3b3ed23997873ac.jpg',
  '316273968032018432': 'https://sleepercdn.com/uploads/0e3911c52168f89e16a992d51ca80443.jpg',
  '374789106846400512': 'https://sleepercdn.com/avatars/thumbs/3ba9b13839d8aae42305608dfbb1bfe2',
  '564590438169468928': 'https://sleepercdn.com/uploads/0b15be2a37bc3a8146f7b57da1a2e593.jpg',
  '641065208403525632': 'https://sleepercdn.com/uploads/a82a0db55af840bf4c8b1ecae064e532.jpg',
  '721059160816455680': 'https://sleepercdn.com/uploads/55ec1b3db19457e0d7a894d9bbab0c36.jpg',
  '723227693008637952': 'https://sleepercdn.com/uploads/469ab44d715a2ea358c02263476cdafe.jpg',
  '737067142029148160': 'https://sleepercdn.com/avatars/thumbs/0ca74246fb64b5b553f65b62553e1cde',
  '737411069647142912': 'https://sleepercdn.com/uploads/f2f2b66c35188f1e20e2ce0ce2ac5e6f',
  '765446581272072192': 'https://sleepercdn.com/uploads/0404678480afbea839a60ea9785e6919.jpg',
};
export function avatarUrl(ownerId?: string | null): string | null {
  return (ownerId && TEAM_AVATAR[ownerId]) || null;
}
