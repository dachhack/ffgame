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
import { PROJ_KICK, PROJ_DST, type ProjKickLine, type ProjDstLine } from '../data/projKdst2026';
import { PROJ_RETURN, type ProjReturnLine } from '../data/projReturns2026';
import { PROJ_HC, PROJ_PUNT, MARGIN_GAME_SD, type ProjHcLine, type ProjPuntLine } from '../data/projTeamRoles2026';
import { PROJ_FB } from '../data/projFb2026';
import { idpLineFor, type ProjIdpLine } from '../data/projIdp2026';
import { DEFAULT_CLASSIC_SCORING, normalizeClassicScoring, isRetSlot, type ClassicScoring } from './classic';
import { scopedAdjustFor } from './leagueScoring';
import { slugSleeperId } from '../data/slugMeta';

export type { ProjStatLine, ProjKickLine, ProjDstLine, ProjReturnLine, ProjHcLine, ProjPuntLine };

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

// ── KICKERS AND TEAM DEFENCES (v0.311.0) ───────────────────────────────────
// Same idea, different components, and one genuine piece of arithmetic.
//
// Until now these two positions projected at ZERO — `proj2026.ts` holds no K
// and no DST at all, so the very first line of `projectedPoints` returned 0 and
// every downstream surface printed a dash or sorted them last. So this is not
// "the projection now responds to the league", it is "there is a projection".

/** A kicker's season, priced. Bands map to the catalog's own ladder; misses are
 *  attempts minus makes, banded the same way, because a missed field goal is a
 *  scored event in most catalogs and our default charges -1 for it.
 *
 *  TWO PLACES THE BANDS DON'T LINE UP, both stated rather than hidden. The
 *  catalog splits under-20 from 20-29 and 50-59 from 60+; StatHead's bands are
 *  0-29 and 50+. We price 0-29 at the 20-29 knob and 50+ at the 50-59 knob,
 *  because a sub-20 attempt barely exists (the ball is spotted at least at the
 *  2) and a 60-yarder is a handful a season league-wide. Both default to the
 *  same value as their neighbour, so a standard league is unaffected either way
 *  — this can only matter to a league that deliberately split them, and there
 *  it errs toward the common case rather than guessing a mix.
 *
 *  `fgYd` / `fgYd30` are per-yard knobs and we have bands, not distances, so
 *  they price at band midpoints. Both default to 0, so this reaches nobody who
 *  hasn't turned them on, and a midpoint is an estimate of a real quantity
 *  rather than an invention. */
/** A season, for turning these season-total lines into the per-week number
 *  every consumer of a projection in this project expects. Same 17 as
 *  `proj2026.ts` and `projTdsPerWeek`, and for the same reason. */
const SEASON_GAMES = 17;

const FG_MID = { b0: 25, b30: 35, b40: 45, b50: 54 } as const;

export function scoreKickLine(line: ProjKickLine, sc: ClassicScoring): number {
  const band = (made: number, att: number, pts: number, missPts: number, mid: number): number =>
    made * (pts + mid * sc.fgYd + Math.max(0, mid - 30) * sc.fgYd30)
    + Math.max(0, att - made) * (sc.fgMiss + missPts);
  return band(line.fgm0, line.fga0, sc.fg20, sc.fgM20, FG_MID.b0)
    + band(line.fgm30, line.fga30, sc.fg30, sc.fgM30, FG_MID.b30)
    + band(line.fgm40, line.fga40, sc.fg40, sc.fgM40, FG_MID.b40)
    + band(line.fgm50, line.fga50, sc.fg50, sc.fgM50, FG_MID.b50)
    + line.xpm * sc.xp + Math.max(0, line.xpa - line.xpm) * sc.xpMiss;
}

/** THE ONE PIECE OF REAL ARITHMETIC. Points allowed is scored by BRACKET, and a
 *  bracket is not a linear function — so the expected points of a defence that
 *  allows 21.3 per game is NOT the bracket that 21.3 falls in. A defence
 *  projected at 21.3 does not sit in the 21-27 tier every week; it has shutouts
 *  and it has blowouts, and the ladder pays very differently at the ends.
 *
 *  StatHead flagged this and gave the spread (sd ~ 9.4 points a game). We
 *  checked it against their own served totals rather than taking it: subtract
 *  everything else from their `projPts` and the residual is what they price
 *  points-allowed at. Integrating OUR ladder — which they have never seen —
 *  over normal(paPg, 9.4) reproduces that residual across ALL 32 defences to a
 *  mean of 0.0007 points a game, worst case 0.011 — and it still does after
 *  1.0.70 applied schedule strength on their side, which moved every line.
 *  Scoring at the mean instead is off by about 0.65 a game on a good defence,
 *  roughly a tenth of its whole projection, and always in the same direction.
 *
 *  The ladder here is `classicScorePlay`'s, copied from it: a bracket boundary
 *  that drifted between the live scorer and this one would be the same
 *  two-rulebook bug in a third coat. `paPt` is linear, so its expectation is
 *  just the mean — no integration needed for that term.
 *
 *  THE NORMAL IS AN APPROXIMATION and worth naming: real points-allowed is
 *  discrete, right-skewed, has a lump at zero and cannot equal 1. So this
 *  under-weights the shutout bracket relative to how often shutouts actually
 *  happen. We use it anyway because matching StatHead's own method is what
 *  makes our number reconcile with theirs, and because the term it feeds is
 *  worth well under a point a game. A league paying enormously for a shutout
 *  is the one case where it would read low. */
export const PA_SD = 9.4;

export function integratedPaPoints(paPg: number, sc: ClassicScoring): number {
  const bracket = (y: number): number =>
    y <= 0 ? sc.pa0 : y <= 6 ? sc.pa1 : y <= 13 ? sc.pa7 : y <= 20 ? sc.pa14
      : y <= 27 ? sc.pa21 : y <= 34 ? sc.pa28 : sc.pa35;
  let num = 0, den = 0;
  for (let y = 0; y <= 80; y++) {
    const w = Math.exp(-0.5 * ((y - paPg) / PA_SD) ** 2);
    num += w * bracket(y); den += w;
  }
  return (den > 0 ? num / den : 0) + paPg * sc.paPt;
}

/** A team defence's season, priced. `stTd` rides the catalog's return-TD knob,
 *  which is where a special-teams score lands in the live scorer too.
 *
 *  NOT CARRIED, because StatHead don't model them: blocked kicks, forced
 *  fumbles, QB hits, passes defended, interception and fumble RETURN yardage,
 *  and the yards-allowed ladder. All default to 0, so they are absent from both
 *  sides of the ratio and distort nothing — a league that tunes only those sees
 *  a ratio of 1, the same rule that governs the skill positions. */
export function scoreDstLine(line: ProjDstLine, sc: ClassicScoring): number {
  return line.sack * sc.sack + line.int * sc.dstInt + line.fumRec * sc.fumRec
    + line.defTd * sc.dstTd + line.stTd * sc.retTd + line.safety * sc.safety
    + integratedPaPoints(line.paPg, sc) * SEASON_GAMES;
}

/** A punter's season, priced. Punts and punt yards only.
 *
 *  THE AVERAGE LADDER IS DELIBERATELY ABSENT. `pta44`…`pta33` pay on a WEEK's
 *  punting average, and a season average cannot be scored against a weekly rung
 *  — the same mistake as scoring a defence's season points-allowed against the
 *  bracket its mean falls in. StatHead ship a season `punt_avg` and no per-game
 *  spread for it, so there is nothing honest to integrate. A league that has
 *  set only the ladder sees no response, which is the house rule: absent data
 *  gets no claim. */
export function scorePuntLine(line: ProjPuntLine, sc: ClassicScoring): number {
  return line.punts * sc.puntPt + line.puntYd * sc.puntYd;
}

/** The share of a coach's WINS (and, separately, LOSSES) that land in each of
 *  the catalog's six margin brackets.
 *
 *  Brackets are `classicScorePlay`'s, copied from it: |m| ≤4, ≤9, ≤14, ≤19,
 *  ≤24, else. The shape comes from a normal on `marginPg`; the TOTALS do not —
 *  see the docblock in `projTeamRoles2026.ts` for why (a plain normal
 *  overstates ties eightfold, because NFL margins are lumpy and overtime
 *  resolves most zeros). So these are normalised to sum to 1 within each side,
 *  and the caller multiplies by StatHead's own win and loss counts. */
export function marginBracketShares(marginPg: number, sd = MARGIN_GAME_SD): { win: number[]; loss: number[] } {
  const win = [0, 0, 0, 0, 0, 0], loss = [0, 0, 0, 0, 0, 0];
  let wTot = 0, lTot = 0;
  for (let m = -70; m <= 70; m++) {
    if (m === 0) continue;                       // a tie is not a margin bracket
    const w = Math.exp(-0.5 * ((m - marginPg) / sd) ** 2);
    const a = Math.abs(m);
    const b = a <= 4 ? 0 : a <= 9 ? 1 : a <= 14 ? 2 : a <= 19 ? 3 : a <= 24 ? 4 : 5;
    if (m > 0) { win[b] += w; wTot += w; } else { loss[b] += w; lTot += w; }
  }
  for (let i = 0; i < 6; i++) {
    win[i] = wTot > 0 ? win[i] / wTot : 0;
    loss[i] = lTot > 0 ? loss[i] / lTot : 0;
  }
  return { win, loss };
}

/** A head coach's season, priced. Result + margin ladder + points + downs,
 *  exactly the fields `classicScorePlay`'s `HC` branch scores. */
export function scoreHcLine(line: ProjHcLine, sc: ClassicScoring): number {
  const { win, loss } = marginBracketShares(line.marginPg);
  const wm = [sc.hcWm1, sc.hcWm5, sc.hcWm10, sc.hcWm15, sc.hcWm20, sc.hcWm25];
  const lm = [sc.hcLm1, sc.hcLm5, sc.hcLm10, sc.hcLm15, sc.hcLm20, sc.hcLm25];
  let out = line.wins * sc.hcWin + line.losses * sc.hcLoss + line.ties * sc.hcTie
    + line.points * sc.hcPts
    + line.thirdDown * sc.hc3dc + line.fourthDown * sc.hc4dc;
  for (let i = 0; i < 6; i++) out += line.wins * win[i] * wm[i] + line.losses * loss[i] * lm[i];
  return out;
}

/** The projected season points of a K or DST under one catalog, or null for
 *  anyone who is neither. */
function scoreKdst(slug: string, sc: ClassicScoring, sleeperId?: string | null): number | null {
  // A DEFENDER FIRST, and resolved by IDENTITY rather than by name — this is
  // the only bake in the project where two live players share a slug, so the
  // id has to be consulted before anything keyed on the name is. See
  // `idpLineFor`; a colliding slug with no id resolves to nothing rather than
  // to whichever man sorted first.
  const idp = idpLineFor(slug, sleeperId);
  if (idp) return scoreIdpLine(idp, sc);
  const k = PROJ_KICK[slug];
  if (k) return scoreKickLine(k, sc);
  const d = PROJ_DST[slug];
  if (d) return scoreDstLine(d, sc);
  const h = PROJ_HC[slug];
  if (h) return scoreHcLine(h, sc);
  const p = PROJ_PUNT[slug];
  if (p) return scorePuntLine(p, sc);
  // A FULLBACK is a skill player who simply never made the main bake — the
  // pool keeps four backs a team and nflverse labels him an RB, so he was
  // squeezed out before being considered. He scores exactly like one, priced at
  // `pos: 'FB'` because the live scorer's reception premium is RB/WR/TE only
  // and a fullback earns plain PPR.
  const f = PROJ_FB[slug];
  if (f) return scoreProjLine(f, 'FB', sc);
  return null;
}

/** Is this a team pseudo-player whose catalog knobs ALL default to zero — a
 *  head coach or a punter? Those cannot be priced as a ratio against a standard
 *  scoring, because there is no standard: the denominator would be 0. They are
 *  priced directly under whatever the league installed, which is why they need
 *  their own branch in `projectedPoints` rather than riding `kdstBase`. */
function isZeroDefaultRole(slug: string): boolean {
  return PROJ_HC[slug] != null || PROJ_PUNT[slug] != null;
}

/** THE LEVEL, PRICED BY US. Unlike every other bake in this project these two
 *  files store only a stat line, so the baked number is our own standard
 *  scoring of it — see the docblock in `projKdst2026.ts` for why (StatHead
 *  charge nothing for a missed kick; we charge -1, which is 7-8 points a season
 *  on a real kicker, and storing their total would have broken the
 *  reconciliation the subsystem rests on).
 *
 *  Memoised because `optimalLineup` values a roster on every fill and the
 *  points-allowed integration is an 81-step loop. */
const kdstBaseCache = new Map<string, number>();

/** Do we have ANY projection for this player? The pools ask, because "no
 *  projection" and "a projection of zero" have to sort differently — and the
 *  K/DST bake lives in a different file from the skill bake, so a presence
 *  check against `PROJ_2026` alone would have quietly kept every kicker and
 *  defence at the bottom of the list this change exists to lift them off. */
export function hasProjection(slug: string, sleeperId?: string | null): boolean {
  return PROJ_2026.has(slug) || PROJ_KICK[slug] != null || PROJ_DST[slug] != null
    || PROJ_HC[slug] != null || PROJ_PUNT[slug] != null || PROJ_FB[slug] != null
    || idpLineFor(slug, sleeperId) != null;
}

export function kdstBase(slug: string, sleeperId?: string | null): number {
  // KEYED ON THE IDENTITY, not the slug alone: both Byron Youngs answer to
  // `byron-young`, and a slug-keyed cache would serve the linebacker's 4.1 a
  // week to the lineman on every render after the first.
  const key = sleeperId ? `${slug}|${sleeperId}` : slug;
  const hit = kdstBaseCache.get(key);
  if (hit !== undefined) return hit;
  const total = scoreKdst(slug, DEFAULT_CLASSIC_SCORING, sleeperId);
  const perWeek = total == null ? 0 : Math.round((total / SEASON_GAMES) * 10) / 10;
  kdstBaseCache.set(key, perWeek);
  return perWeek;
}

/** A return line, priced. The catalog pays `retYd` on ANY return yard and
 *  stacks `krYd` / `prYd` on top by kind, which is exactly how the live scorer
 *  reads a return play — so the two sides cannot disagree about a returner.
 *
 *  NOT CARRIED: return counts, fair catches, and the yardage a returner gains
 *  on a play that is then wiped by penalty. None of those are priced by any
 *  knob we have. */
export function scoreReturnLine(line: ProjReturnLine, sc: ClassicScoring): number {
  return line.prYd * (sc.retYd + sc.prYd)
    + line.krYd * (sc.retYd + sc.krYd)
    + line.retTd * sc.retTd;
}

/** A defender's line, priced. Every knob the catalog exposes for an IDP that
 *  StatHead give us a component for, and nothing else.
 *
 *  ASSISTS ARE DERIVED. `tackles`, `solo` and `assist` are linearly dependent
 *  and the bake stores the first two, so the assist count is the remainder —
 *  clamped at zero because a rounding artefact must never pay a negative
 *  bonus. The catalog treats solo and assist as PREMIUMS ON TOP of the
 *  per-tackle point rather than as replacements for it, which is exactly how
 *  `classicScorePlay` reads a live tackle: `sc.idpTackle + (tt === 's' ?
 *  sc.idpSolo : tt === 'a' ? sc.idpAst : 0)`. So the two sides agree by
 *  construction rather than by coincidence.
 *
 *  THE THRESHOLD BONUSES ARE PAID AGAINST GAME COUNTS, not against a season
 *  mean. `w2sack` and `w3pd` are expected NUMBERS OF GAMES that clear the bar,
 *  already integrated upstream over the per-game distribution — so they
 *  multiply the per-game bonus directly. Scoring a season total against a
 *  weekly threshold is the error StatHead warn about and it is a large one:
 *  Micah Parsons averages 0.51 sacks a game and so never clears "2+ in a
 *  game", yet clears it 1.47 times a season.
 *
 *  ALL THREE weekly thresholds are priced (v0.318.0). `idpTackle10` was the
 *  one gap in v0.317.0 and StatHead shipped `weeks_10plus_tackle` in 1.0.87 —
 *  integrated over a NEGATIVE BINOMIAL rather than the calibrated Poisson the
 *  other two use, because the Poisson error on tackles is level-dependent (9.4x
 *  at 2 a game, 1.03x at 8) so no single constant fixes it. The bake's docblock
 *  carries the measurement.
 *
 *  NOT PRICED, because the source has no component for them: sack yards,
 *  interception and fumble return yards, the 50+ yard return-TD bonuses, and
 *  safeties. See the bake's docblock. */
export function scoreIdpLine(line: ProjIdpLine, sc: ClassicScoring): number {
  const assists = Math.max(0, line.tackles - line.solo);
  return line.tackles * sc.idpTackle + line.solo * sc.idpSolo + assists * sc.idpAst
    + line.tfl * sc.idpTfl
    + line.sack * sc.idpSack
    + line.qbHit * sc.idpQbHit
    + line.pd * sc.idpPd
    + line.int * sc.idpInt
    + line.ff * sc.idpFf
    + line.fumRec * sc.idpFr
    + line.defTd * sc.idpTd
    + line.w2sack * sc.idpSack2
    + line.w3pd * sc.idpPd3
    + line.w10tk * sc.idpTackle10;
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
  // ── WHICH ppr WINS (0209) ────────────────────────────────────────────────
  // `ppr` has two homes: settings_json.ppr (0157's, surfaced as `gm.ppr`) and
  // the scoring catalog, where 0209 gave it a box. Both writers write both, so
  // for anything saved from today on they agree and the order is moot.
  //
  // THE ORDER IS FOR THE ROWS THAT PREDATE THAT. The catalog copy only exists
  // if something wrote it, so its presence means "a commissioner set this
  // deliberately" — it goes LAST and wins. The old spread had `gm.ppr` last,
  // and since league_game_mode COALESCES that to 1 it is never absent: a ppr
  // saved into the catalog would have been overwritten by the default on every
  // read, and the new field would have looked like it saved and done nothing.
  const ppr = Number(gm?.ppr);
  return { ...(Number.isFinite(ppr) ? { ppr } : {}), ...(gm?.scoring ?? {}) };
}

/** How much this league's rules are worth to this player, as a multiple of the
 *  standard catalog. Exactly 1 when we have no line, when the line scores
 *  nothing under standard rules (kickers, defences), or when the league hasn't
 *  changed anything the line can see. */
export function leagueProjRatio(
  slug: string, pos: string, sc?: ClassicScoring, sleeperId?: string | null,
): number {
  const cur = sc ?? cat();
  // A kicker or a defence is priced from its OWN components, not the skill
  // line — which it doesn't have, and which would otherwise fall straight
  // through to the `return 1` below and leave both positions unadjustable.
  const kd = scoreKdst(slug, DEFAULT_CLASSIC_SCORING, sleeperId);
  if (kd != null) return kd > 0 ? (scoreKdst(slug, cur, sleeperId) as number) / kd : 1;
  const line = PROJ_LINES[slug];
  if (!line) return 1;
  const base = scoreProjLine(line, pos, DEFAULT_CLASSIC_SCORING);
  if (!(base > 0)) return 1;
  const mine = scoreProjLine(line, pos, cur);
  return mine / base;
}

/** Projected touchdowns per WEEK — what a per-TD scoped bonus (0145) has to be
 *  multiplied by. The line is a season total and PROJ_2026 is a per-week value,
 *  so the season is 17 here for the same reason it is there. */
export function projTdsPerWeek(slug: string, sleeperId?: string | null): number {
  const line = PROJ_LINES[slug];
  if (line) return (line.passTd + line.rushTd + line.recTd) / SEASON_GAMES;
  // A defender returns them too, and a per-TD scoped bonus has to see those on
  // the same terms as a receiver's.
  const idp = idpLineFor(slug, sleeperId);
  if (idp) return idp.defTd / SEASON_GAMES;
  // A defence scores touchdowns too, and a per-TD scoped bonus has to see them.
  // A kicker has none, and says so rather than falling through to a skill line
  // he doesn't have.
  const d = PROJ_DST[slug];
  return d ? (d.defTd + d.stTd) / SEASON_GAMES : 0;
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
  player: { id: string; pos: string; team?: string | null; sleeperId?: string | null },
  slot?: string | null,
  slotPos?: string[] | null,
): number {
  // The pool has carried a Sleeper id since 0205 and the IDP bake is keyed by
  // it. A caller holding a pool row passes it directly; every other caller
  // falls back to the id a board installed with `setSlugMetaOverrides`, which
  // is why none of the six projection call sites had to change. Away from a
  // pool both are absent and the bake still resolves 960 of its 963 defenders
  // by name — only the three colliding slugs go unpriced, which is the honest
  // answer to "which Byron Young is this".
  const sid = player.sleeperId ?? slugSleeperId(player.id);
  // A RETURN-ONLY SPOT PROJECTS NOTHING (v0.311.2). `RET` is a SLOT identity,
  // not a position: a player scored there banks return production ONLY, and
  // `classicPoints` enforces that with a `posOverride` the live column has
  // always passed. The projected column never did — it received the slot's
  // NAME while the live column received its SPEC — so a RET spot showed a
  // receiver's whole PPR line next to a live number that can only ever pay
  // return yardage. Under the default catalog that is the starkest version of
  // the bug in this whole subsystem: `retYd`/`krYd`/`prYd` all default to 0 and
  // only `retTd` scores, so live is almost always 0 against a projection of 10+.
  //
  // v0.313.0: StatHead now ship return components, so this is a real projection
  // rather than the honest zero v0.311.2 had to show. A player with no return
  // line still projects nothing — most of the league never returns a kick, and
  // his rushing and receiving remain mute in this spot.
  if (slotPos && isRetSlot(slotPos)) {
    const rl = PROJ_RETURN[player.id];
    if (!rl) return 0;
    const perWeek = scoreReturnLine(rl, cat()) / SEASON_GAMES;
    const radj = scopedAdjustFor(player, { slot });
    // The scoped layers apply here exactly as they do anywhere else NOW that
    // the value is known — v0.311.2 withheld them only because a flat bonus on
    // top of an unknown is false precision. The per-TD bonus pays against
    // projected RETURN touchdowns, the only ones that score in this spot.
    return Math.round((perWeek * radj.mult + radj.pts + radj.td * (rl.retTd / SEASON_GAMES)) * 10) / 10;
  }
  // A COACH OR A PUNTER IS PRICED DIRECTLY (v0.315.0). Every catalog knob for
  // both defaults to 0, so their `kdstBase` is 0 and the `if (!base)` guard
  // below would return zero even under a league that pays them — and the ratio
  // they would otherwise ride divides by that same zero. They get the league's
  // OWN scoring of their line, with no standard to compare against, because
  // there is no standard coach or punter scoring anywhere in fantasy.
  if (isZeroDefaultRole(player.id)) {
    const raw = scoreKdst(player.id, cat(), sid) ?? 0;
    if (!raw) return 0;                          // a league that pays them nothing
    const zadj = scopedAdjustFor(player, { slot });
    return Math.round((raw / SEASON_GAMES * zadj.mult + zadj.pts) * 10) / 10;
  }
  const base = PROJ_2026.get(player.id) ?? kdstBase(player.id, sid);
  if (!base) return 0;
  const scaled = base * leagueProjRatio(player.id, player.pos, undefined, sid);
  const adj = scopedAdjustFor(player, { slot });
  const out = scaled * adj.mult + adj.pts + adj.td * projTdsPerWeek(player.id, sid);
  return Math.round(out * 10) / 10;
}

/** Convenience for callers that hold a slug and a position rather than a
 *  player object — the draft board's PROJ column. */
export const projectedFor = (slug: string, pos: string, sleeperId?: string | null): number =>
  projectedPoints({ id: slug, pos, sleeperId });
