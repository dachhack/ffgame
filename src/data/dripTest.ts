// The Drip Test League: the real "Console Warriors" Sleeper league fetched live
// through the normal sim builder, then re-skinned with fake team names + the 2025
// league-logo avatars. Real NFL players + real scoring are untouched — only the
// league's "users" (team names + crests) are fabricated, so we can dogfood the
// full app board on a sanitized league. This mirrors the DB seed
// (server/scripts/gen-fake-league.mjs) so a player's team name matches across the
// live home and the board.
import { buildSleeperLeague } from './buildLeague';
import type { BuiltLeague } from './league';

// Console Warriors — the roster/schedule source the seed clones.
export const CONSOLE_WARRIORS_ID = '1313930509658652672';

// 12 fake teams (name + crest), applied in roster-id order to match the seed.
// `owner` is a synthetic id mapped to the crest avatar in data/media.ts (dt-N).
const SKIN: { name: string; owner: string }[] = [
  { name: 'Taco Time Titans', owner: 'dt-1' },
  { name: 'Cheeseburger Chargers', owner: 'dt-2' },
  { name: 'Beach Day Ballers', owner: 'dt-3' },
  { name: 'Cookout Crew', owner: 'dt-4' },
  { name: 'Surf’s Up Sharks', owner: 'dt-5' },
  { name: 'Poolside Punters', owner: 'dt-6' },
  { name: 'Ballpark Blitz', owner: 'dt-7' },
  { name: 'Road Trip Raiders', owner: 'dt-8' },
  { name: 'Gone Fishing Phins', owner: 'dt-9' },
  { name: 'Chicken Nuggies', owner: 'dt-10' },
  { name: 'Smash Mouth Maulers', owner: 'dt-11' },
  { name: 'Dunder Mifflin Dynamos', owner: 'dt-12' },
];

const rosterNum = (id: string): number => { const m = /^r(\d+)$/.exec(id); return m ? Number(m[1]) : 0; };

/**
 * Build the Drip Test League ready for the full board. Fetches the real league,
 * then overrides each team's name + crest with the fake skin (roster-id order).
 * `youRosterId` (the caller's sleeper_roster_id from their league membership) sets
 * which team is YOU; falls back to the first team.
 */
export async function buildDripTestLeague(
  youRosterId: number | null,
  onProgress?: (note: string) => void,
): Promise<{ built: BuiltLeague; youTeamId: string }> {
  const { built } = await buildSleeperLeague(CONSOLE_WARRIORS_ID, '', onProgress, { addKdst: true });
  // Skin in roster-id order so the assignment matches the DB seed exactly.
  const inRosterOrder = [...built.league.teams].sort((a, b) => rosterNum(a.id) - rosterNum(b.id));
  inRosterOrder.forEach((t, i) => { const s = SKIN[i % SKIN.length]; t.name = s.name; t.owner = s.name; t.ownerId = s.owner; });
  const youTeamId = youRosterId != null && built.league.teams.some((t) => t.id === `r${youRosterId}`)
    ? `r${youRosterId}`
    : (inRosterOrder[0]?.id ?? built.league.teams[0]?.id ?? '');
  return { built, youTeamId };
}
