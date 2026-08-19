// LEAGUE-AWARE PROJECTIONS (v0.308.0, founder: "do we have what we need to be
// able to adjust the projections for the scoring adjustments by league and
// roster spot?").
//
// We did not, and the gap was visible on every board in a custom-scoring
// league. LIVE points go through the league's 64-field catalog, then
// `scopedAdjustFor` with the SPOT in hand (0197). PROJECTED points were
// `PROJ_2026.get(slug)` — a single PPR-shaped number with nothing applied. One
// row, two rulebooks: a league paying ×1.5 on running backs showed live points
// at ×1.5 and projected points at ×1.0, and a league paying 6 for a passing
// touchdown projected its quarterbacks as though it paid 4.
//
// THE PROBLEM IS THAT YOU CANNOT RE-SCORE A SCALAR. A catalog values passing
// yards, receptions and touchdowns separately, so adjusting a projection needs
// the projection's COMPONENTS. `projStats2026.ts` supplies them — Sleeper's
// projected stat line, joined on the sleeper_id the projection bake already
// carries.
//
// HOW THE TWO SOURCES ARE COMBINED, and why it is a ratio rather than a
// replacement. StatHead's number stays the authority on HOW GOOD a player is;
// Sleeper's line is used only for the SHAPE of his production:
//
//     projected = PROJ_2026[slug] × ( score(line, leagueCatalog)
//                                   / score(line, standardCatalog) )
//
// Any consistent scaling of the line cancels, so this never lets Sleeper's
// absolute level overwrite StatHead's — it asks one question only: "how much
// more, or less, is this player's production worth under THIS league's rules?"
// It also gives the invariant that makes the change safe to ship: a league on
// the standard catalog gets a ratio of exactly 1, so **every existing league's
// projections are unchanged to the decimal**.
//
// WHAT THE RATIO CAN AND CANNOT SEE. The line carries passing yards / TDs /
// interceptions, rushing yards / TDs, and receptions / yards / TDs. That is the
// core of scoring for QB/RB/WR/TE and the great majority of the points. It does
// NOT carry yardage or reception milestones (pass300, rush100, rec100), splash
// touchdowns (40+/50+), kicking, DST, IDP, return yardage, first downs or
// two-point conversions — so a league that tunes only those sees a ratio of 1
// and an unadjusted projection. Absent components are missing from BOTH sides
// of the ratio, so they never distort it; they simply are not reflected. A
// kicker or defence has an all-zero line, scores zero under both catalogs, and
// falls back to 1 by the same rule that catches a player we have no line for.
import { PROJ_2026 } from '../data/proj2026';
import { PROJ_LINES, type ProjStatLine } from '../data/projStats2026';
import { DEFAULT_CLASSIC_SCORING, normalizeClassicScoring, type ClassicScoring } from './classic';
import { scopedAdjustFor } from './leagueScoring';

export type { ProjStatLine };

/** A projected stat line scored under one catalog. Only the fields the line
 *  actually carries — see the docblock on what that leaves out. */
export function scoreProjLine(line: ProjStatLine, pos: string, sc: ClassicScoring): number {
  const p = pos.toUpperCase();
  // Per-reception value is the catalog's PPR plus whatever premium the league
  // pays this position — the TE-premium knob is the single most common reason a
  // league's projections should differ from a stock PPR board.
  const perRec = sc.ppr
    + (p === 'TE' ? sc.teRec : 0)
    + (p === 'RB' ? sc.rbRec : 0)
    + (p === 'WR' ? sc.wrRec : 0);
  return line.passYd * sc.passYd + line.passTd * sc.passTd + line.int * sc.int
    + line.rushYd * sc.rushYd + line.rushTd * sc.rushTd
    + line.rec * perRec + line.recYd * sc.recYd + line.recTd * sc.recTd;
}

// ── The installed league catalog ────────────────────────────────────────────
// Same contract as every other per-league engine cache (setLeagueScoring,
// setLeagueGolf, setLeagueFlags): a screen installs it on load and clears it on
// exit; the worker sets it before each matchup. Absent means the standard
// catalog, which is what every drip league and every untouched classic league
// already scores by.
let catalog: ClassicScoring = DEFAULT_CLASSIC_SCORING;

export function setLeagueProjScoring(sc?: number | Partial<ClassicScoring> | null): void {
  catalog = normalizeClassicScoring(sc);
}
export function clearLeagueProjScoring(): void { catalog = DEFAULT_CLASSIC_SCORING; }
export function leagueProjScoring(): ClassicScoring { return catalog; }

/** How much this league's rules are worth to this player, as a multiple of the
 *  standard catalog. Exactly 1 when we have no line, when the line scores
 *  nothing under standard rules (kickers, defences), or when the league hasn't
 *  changed anything the line can see. */
export function leagueProjRatio(slug: string, pos: string, sc: ClassicScoring = catalog): number {
  const line = PROJ_LINES[slug];
  if (!line) return 1;
  const base = scoreProjLine(line, pos, DEFAULT_CLASSIC_SCORING);
  if (!(base > 0)) return 1;
  const mine = scoreProjLine(line, pos, sc);
  return mine / base;
}

/** Projected touchdowns per WEEK — what a per-TD scoped bonus (0145) has to be
 *  multiplied by. The line is a season total and PROJ_2026 is a per-week value,
 *  so the season is 17 here for the same reason it is there. */
export function projTdsPerWeek(slug: string): number {
  const line = PROJ_LINES[slug];
  if (!line) return 0;
  return (line.passTd + line.rushTd + line.recTd) / 17;
}

/** THE ANSWER TO THE FOUNDER'S QUESTION: this player's projection for a week,
 *  under this league's rules, in this spot.
 *
 *  Three layers, in the order the live scorer applies them, so the two paths
 *  can only agree:
 *    1. the league's CATALOG, as a ratio on the baked projection;
 *    2. the league's SCOPED bonuses — multiplier, flat points, and the per-TD
 *       bonus against projected touchdowns — with the SPOT in hand, so a rule
 *       that pays "the FLEX ×1.5" shows up in the FLEX's projection and nowhere
 *       else;
 *    3. nothing about the spot's zero-fill, deliberately — that rule is about a
 *       spot scoring NOTHING, and it is applied by the board where an empty
 *       spot is a thing that exists (a player who is projected has not scored
 *       nothing).
 *
 *  `slot` omitted means "not in a lineup", exactly as `scopedAdjustFor` reads
 *  it: a spot-scoped rule stands aside rather than paying where there is no
 *  spot. */
export function projectedPoints(
  player: { id: string; pos: string; team?: string | null },
  slot?: string | null,
): number {
  const base = PROJ_2026.get(player.id) ?? 0;
  if (!base) return 0;
  const scaled = base * leagueProjRatio(player.id, player.pos);
  const adj = scopedAdjustFor(player, { slot });
  const out = scaled * adj.mult + adj.pts + adj.td * projTdsPerWeek(player.id);
  return Math.round(out * 10) / 10;
}

/** Convenience for callers that hold a slug and a position rather than a
 *  player object — the draft board's PROJ column. */
export const projectedFor = (slug: string, pos: string): number =>
  projectedPoints({ id: slug, pos });
