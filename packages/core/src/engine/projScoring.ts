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
// the projection's COMPONENTS. `projStats2026.ts` supplies them.
//
// WHY IT IS A RATIO RATHER THAN A REPLACEMENT:
//
//     projected = PROJ_2026[slug] × ( score(line, leagueCatalog)
//                                   / score(line, standardCatalog) )
//
// Any consistent scaling of the line cancels, so the line's absolute level can
// never overwrite the baked projection's. It asks one question only: "how much
// more, or less, is this player's production worth under THIS league's rules?"
// That gives the invariant which makes the whole thing safe to ship: a league
// on the standard catalog gets a ratio of exactly 1, so **every existing
// league's projections are unchanged to the decimal**.
//
// v0.309.0 MADE THE DENOMINATOR EXACT. v0.308.0 had to build the line from
// SLEEPER, because StatHead served only a scalar — so the numerator and the
// denominator were two different models' opinions of the same player, and 77 of
// 445 players had no line at all and silently sat at a ratio of 1. StatHead
// 1.0.67 ships their own components. Scoring them under the standard catalog
// now reproduces StatHead's served season total to a mean residual of -0.06
// points per SEASON, and the join is 445/445. The ratio's denominator IS the
// projection it divides into.
//
// WHAT THE RATIO CAN AND CANNOT SEE. The line carries passing yards / TDs /
// interceptions, rushing yards / TDs, and receptions / yards / TDs. That is the
// core of scoring for QB/RB/WR/TE and the great majority of the points. It does
// NOT carry yardage or reception milestones (pass300, rush100, rec100), splash
// touchdowns (40+/50+), kicking, DST, IDP, return yardage, first downs or
// two-point conversions — StatHead confirmed those do not exist anywhere in
// their pool, so this is a source limit, not a plumbing one. A league that
// tunes only those sees a ratio of 1 and an unadjusted projection. Absent
// components are missing from BOTH sides of the ratio, so they never distort
// it; they simply are not reflected. A kicker or defence has no line at all,
// and falls back to 1 by the same rule that catches an unbaked player.
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
//
// NOT INITIALISED TO `DEFAULT_CLASSIC_SCORING` (v0.310.0): `classic.ts` now
// imports this module, and this module imports `classic.ts` for the catalog
// type and the default. That cycle is fine while every reference to the default
// sits INSIDE a function body — evaluated after both modules have finished —
// and a crash if one sits at the top level. Whichever module the bundler
// reaches first would then read the other's un-initialised const and throw
// `Cannot access 'DEFAULT_CLASSIC_SCORING' before initialization`. Hence null
// meaning "the standard catalog", resolved by `cat()` at call time.
let catalog: ClassicScoring | null = null;
const cat = (): ClassicScoring => catalog ?? DEFAULT_CLASSIC_SCORING;

export function setLeagueProjScoring(sc?: number | Partial<ClassicScoring> | null): void {
  catalog = normalizeClassicScoring(sc);
}
export function clearLeagueProjScoring(): void { catalog = null; }
export function leagueProjScoring(): ClassicScoring { return cat(); }

/** THE CATALOG A LEAGUE ACTUALLY SCORES BY (v0.310.0). A league stores its
 *  adjustments in `scoring` and its per-reception value in `ppr`, SEPARATELY —
 *  and the thing that scores a game is the two merged (`resolve.js` builds
 *  exactly this before every classic resolve, and each board memoises it before
 *  every live point). v0.308.0 installed `gm.scoring` alone on the projection
 *  side, so a half-PPR league scored its receivers at ½ and projected them at
 *  1: the same row under two rulebooks, which is the bug that whole change
 *  exists to prevent, hiding in the one knob that isn't in `scoring`.
 *
 *  Every surface now installs THROUGH THIS, so the merge happens in one place
 *  and cannot be half-remembered at the next call site. */
export function leagueCatalogOf(
  gm?: { scoring?: Partial<ClassicScoring> | null; ppr?: number | string | null } | null,
): Partial<ClassicScoring> {
  const ppr = Number(gm?.ppr);
  return { ...(gm?.scoring ?? {}), ...(Number.isFinite(ppr) ? { ppr } : {}) };
}

/** How much this league's rules are worth to this player, as a multiple of the
 *  standard catalog. Exactly 1 when we have no line, when the line scores
 *  nothing under standard rules (kickers, defences), or when the league hasn't
 *  changed anything the line can see. */
export function leagueProjRatio(slug: string, pos: string, sc?: ClassicScoring): number {
  const line = PROJ_LINES[slug];
  if (!line) return 1;
  const base = scoreProjLine(line, pos, DEFAULT_CLASSIC_SCORING);
  if (!(base > 0)) return 1;
  const mine = scoreProjLine(line, pos, sc ?? cat());
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
