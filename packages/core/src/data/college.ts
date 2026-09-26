// COLLEGE PLAYERS (0365) — identity and positions, stated once for every host.
//
// A college player's slug is `c-<espn_id>`. The slug stays the storage key the
// whole app joins on, and ESPN keeps the athlete id when a player reaches the
// NFL, so this is the one id that survives graduation without a name match.
// `c-` followed by DIGITS ONLY is the rule: slugOf(full_name) never produces
// it, while a bare `c-` prefix would catch an NFL "C. Smith" (`c-smith`).
// The database states the same rule in league_pool.level's generated
// expression; scripts/check-college.mjs pins the two against each other.
import type { Pos } from '../types';

export type Level = 'nfl' | 'college';

const COLLEGE_SLUG = /^c-(\d+)$/;

export const collegeSlug = (espnId: string | number): string => {
  const id = String(espnId).trim();
  if (!/^\d+$/.test(id)) throw new Error(`not an ESPN athlete id: ${espnId}`);
  return `c-${id}`;
};

export const isCollegeSlug = (slug: string | null | undefined): boolean =>
  !!slug && COLLEGE_SLUG.test(slug);

/** The ESPN athlete id inside a college slug, or null for any other slug. */
export const collegeEspnId = (slug: string | null | undefined): string | null =>
  (slug && COLLEGE_SLUG.exec(slug)?.[1]) || null;

export const levelOf = (slug: string | null | undefined): Level =>
  isCollegeSlug(slug) ? 'college' : 'nfl';

// ESPN college roster position → our Pos. Measured on four 2026 rosters
// (ALA, FLA, 2, 61): CB DB DE DL DT EDGE LB S · C OL QB RB TE WR · LS P PK.
// Linemen, long snappers and unlabelled athletes (ATH) are not fantasy
// players and map to null, which the worker skips.
const COLLEGE_POS: Record<string, Pos> = {
  QB: 'QB', RB: 'RB', HB: 'RB', TB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  PK: 'K', K: 'K', P: 'P',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB',
};

export const collegePos = (espnAbbr: string | null | undefined): Pos | null =>
  (espnAbbr && COLLEGE_POS[espnAbbr.trim().toUpperCase()]) || null;

/** The positions a college_player row may carry (mirrors 0365's upsert filter). */
export const COLLEGE_POSITIONS: readonly Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'P', 'FB', 'DL', 'LB', 'DB'];
