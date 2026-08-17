// WHERE THE GAME IS PLAYED — home-stadium roof by NFL team.
//
// The matchup board marks a game as indoor so a manager reading "Sun 1:00 PM
// @ IND" knows weather is off the table there and on the table in Buffalo.
// That is a fact about a building, so it lives here as data rather than being
// inferred from anything.
//
// WHAT THIS IS NOT: a weather feed. Sleeper's board (the reference for this
// design) shows sun/rain/snow from a forecast; we have no forecast, and a sun
// icon we made up would be worse than no icon. So the only claim made here is
// ROOF, which we can state without guessing.
//
// FOUR KINDS, because "indoor" is not one thing:
//   • dome        — permanently enclosed. Never weather.
//   • retractable — enclosed OR open at the operator's discretion, decided
//                   game by game and often on the day. Marked, but the tooltip
//                   says "retractable" rather than claiming it will be shut.
//   • canopy      — fixed roof with open sides (SoFi). Rain off the field,
//                   wind and cold still in play.
//   • open        — outdoors.
//
// TWO KNOWN LIMITS, both stated rather than papered over:
//   1. This is HAND-MAINTAINED and goes stale when a team moves or opens a new
//      building. Current for the 2026 season (Tennessee's new domed stadium
//      opens 2027; Buffalo's new Highmark is open-air).
//   2. It keys on the HOME TEAM, so a NEUTRAL-SITE game — London, Munich, São
//      Paulo, a relocation after a hurricane — reads as the nominal home
//      team's building, which is wrong. The slate carries no venue column, so
//      the alternative is no marker at all; a handful of wrong roof icons a
//      season is the accepted cost, and `roofFor` returning null for an
//      unknown team means a marker is never invented.

import { normTeam } from './slugMeta';

export type Roof = 'dome' | 'retractable' | 'canopy' | 'open';

/** Home-stadium roof by team abbreviation, 2026 season. */
export const STADIUM_ROOF: Record<string, Roof> = {
  ARI: 'retractable',   // State Farm Stadium
  ATL: 'retractable',   // Mercedes-Benz Stadium
  BAL: 'open',          // M&T Bank Stadium
  BUF: 'open',          // Highmark Stadium (new build, open air)
  CAR: 'open',          // Bank of America Stadium
  CHI: 'open',          // Soldier Field
  CIN: 'open',          // Paycor Stadium
  CLE: 'open',          // Huntington Bank Field
  DAL: 'retractable',   // AT&T Stadium
  DEN: 'open',          // Empower Field at Mile High
  DET: 'dome',          // Ford Field
  GB: 'open',           // Lambeau Field
  HOU: 'retractable',   // NRG Stadium
  IND: 'retractable',   // Lucas Oil Stadium
  JAX: 'open',          // EverBank Stadium
  KC: 'open',           // GEHA Field at Arrowhead
  // THE SLATE'S CODES, not the broadcast ones: the Rams are LA here, exactly
  // as nfl_slate and slugMeta spell them (see normTeam). Keyed the other way
  // round this table would answer null for both SoFi teams and quietly drop
  // their roof marker forever — roofFor normalizes, and a probe pins it.
  LA: 'canopy',         // SoFi Stadium (shared) — the Rams
  LAC: 'canopy',        // SoFi Stadium (shared) — the Chargers
  LV: 'dome',           // Allegiant Stadium
  MIA: 'open',          // Hard Rock — the canopy covers the SEATS, not the field
  MIN: 'dome',          // U.S. Bank Stadium
  NE: 'open',           // Gillette Stadium
  NO: 'dome',           // Caesars Superdome
  NYG: 'open',          // MetLife Stadium (shared)
  NYJ: 'open',          // MetLife Stadium (shared)
  PHI: 'open',          // Lincoln Financial Field
  PIT: 'open',          // Acrisure Stadium
  SEA: 'open',          // Lumen Field — partial cover over seating, field open
  SF: 'open',           // Levi's Stadium
  TB: 'open',           // Raymond James Stadium
  TEN: 'open',          // Nissan Stadium (the domed replacement opens 2027)
  WAS: 'open',          // Northwest Stadium
};

/** The roof over a team's home games — null when the team isn't known, so a
 *  caller never has to distinguish "outdoors" from "no idea". */
export function roofFor(team: string | null | undefined): Roof | null {
  if (!team) return null;
  return STADIUM_ROOF[normTeam(team)] ?? null;
}

/** Is this game played under a roof of any kind? A retractable roof counts —
 *  it's the only honest answer without a gameday report, and the caller says
 *  WHICH kind in the tooltip rather than claiming the roof will be closed. */
export function isRoofed(team: string | null | undefined): boolean {
  const r = roofFor(team);
  return r != null && r !== 'open';
}

/** What to call the roof on screen. */
export const ROOF_LABEL: Record<Roof, string> = {
  dome: 'Indoors — domed',
  retractable: 'Retractable roof',
  canopy: 'Roofed, open sides',
  open: 'Outdoors',
};
