// THE GHOST'S PLAYER CARD (v0.527.0) — one set of words for every host.
//
// Founder: "in all versions, let's put the ghost on a card like he is an
// actual player. That would be humorous." The web board, the app board and
// the live cards all draw a Ghost-held spot as a player card, and they all
// read him from here so the joke lands the same everywhere.
import { GHOST_PLAYER, GHOST_POINTS } from '../engine/sim';

export const GHOST_CARD = {
  /** First initial + surname, like every other card. */
  name: GHOST_PLAYER.name,
  /** Position · team, where a real card says "WR · DET". */
  pos: 'SPIRIT',
  team: GHOST_PLAYER.team,
  /** The metric plate: the only stat he has ever had. */
  metric: `Flat ${GHOST_POINTS} Pts`,
  /** The small print at the foot of the card. */
  line: 'UNDRAFTED · UNDEAD',
} as const;

/** Is this the Ghost (the resolver's phantom player id)? */
export const isGhostSlug = (slug: string | null | undefined): boolean => slug === GHOST_PLAYER.id;
