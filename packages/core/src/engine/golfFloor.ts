// ── THE FLOOR ABOVE ZERO (v0.429.0) ─────────────────────────────────────────
//
// Founder: "Players need to get close to zero without actually getting zero.
// Is there a way we can get the AI to pick those players? A lot of players
// with like 3 points projected will actually get zero so it takes a lot of
// logic to decide who to play that probably has a floor above zero."
//
// In golf the lowest total wins, and a starting spot that scores NOTHING takes
// the league's zero-fill (usually 10) instead — the worst thing that can
// happen to it. So the player you want is the one who will score a LITTLE,
// every week, and the number that matters is not his projection but how
// likely he is to post a zero. The fills (optimalLineup, the best-ball fill,
// the unmanaged seat) ranked by projection alone, which in golf means the
// LOWEST projection above zero — exactly the 1-to-3-point bodies who most
// often post nothing.
//
// ── THE MODEL, AND WHERE IT CAME FROM ────────────────────────────────────────
// A player's week is zero when he touches the ball zero times — no reception,
// no carry (a carry for no gain is 0.0, and a catch is a point in PPR). If
// touches arrive roughly at random with a weekly rate λ, the chance of none is
// e^(−λ). Checked against 2025 game logs (StatHead, every WR weeks 1–6 and
// every RB weeks 1–4, 1,135 player-weeks), binned by each player's mean
// touches (receptions + carries) per week:
//
//     touches/wk   0–0.5  0.5–1  1–1.5  1.5–2   2–3   3–4   4–6  6–10  10+
//     zero weeks    .87    .48    .31    .21    .07   .05   .02   .01  .01
//     e^(−λ)        .88    .49    .30    .19    .09   .03   .01   .00  .00
//
// A least-squares fit of e^(−cλ) gives c = 1.02, and a floor of 0.01 covers
// the healthy scratch and the goose egg on real usage. So: no scaling, no
// position term — the Poisson rate IS the model, and the one knob is the
// floor. The rate itself comes from the baked season projection
// (projStats2026: receptions and rushing yards, over 17 games, yards at a
// league-average 4.3 a carry), which is what the fills already rank by.
//
// EXPECTED GOLF SCORE. With p the zero chance and Z the spot's zero-fill,
// the projection P is the mean over games PLAYED, so the mean given a non-zero
// is P/(1−p), and the expected golf score is
//     (1−p)·P/(1−p) + p·Z  =  P + p·Z.
// A designation folds in as a chance of not playing at all (r): the score
// becomes P·(1−r) + (r + (1−r)·p)·Z. Q and D still play too often to bench
// by rule in a normal league (v0.252.0) — here they are not benched, they
// are PRICED, which is the difference golf makes.
import { PROJ_LINES, PROJ_LINE_POS } from '../data/projStats2026';

/** The healthy scratch and the goose egg on real usage: the fitted floor. */
export const ZERO_FLOOR = 0.01;
/** The bake's season is 17 games (projTdsPerWeek divides by the same). */
export const PROJ_GAMES = 17;
/** Rushing yards per carry, to read carries off a yards projection. */
export const YDS_PER_CARRY = 4.3;
/** A quarterback's "touch": ten attempts (~70 yards) is one unit of rate, so a
 *  full-time starter sits near zero risk and a 500-yard backup near two-thirds. */
export const QB_YDS_PER_UNIT = 70;
/** Kickers and defences have no stat line here; a kicker blanks in a shutout
 *  with no attempts, a defence almost never posts exactly zero. */
export const K_ZERO = 0.03;
export const DST_ZERO = 0.02;
/** A player the bake has never heard of: his projection is all we know, and
 *  at roughly two points a touch it stands in for the rate. */
export const PTS_PER_TOUCH = 2.2;

/** How likely a designation is to keep a player OFF the field this week. Q
 *  plays about four times in five; D about one in four. O and IR never. */
export function playRisk(status?: string | null): number {
  switch (String(status ?? '').toUpperCase()) {
    case 'O': case 'IR': return 1;
    case 'D': return 0.75;
    case 'Q': return 0.2;
    default: return 0;
  }
}

/** Expected touches a week from the baked season line, or null when the
 *  bake has no line for him. */
export function touchesPerGame(slug: string): number | null {
  const line = PROJ_LINES[slug];
  if (!line) return null;
  const pos = PROJ_LINE_POS[slug] ?? '';
  const carries = Math.max(0, line.rushYd) / YDS_PER_CARRY;
  const passUnits = pos === 'QB' ? Math.max(0, line.passYd) / QB_YDS_PER_UNIT : 0;
  return (Math.max(0, line.rec) + carries + passUnits) / PROJ_GAMES;
}

/** The chance a healthy, active player posts exactly nothing this week. */
export function zeroProbability(p: { id: string; pos?: string | null }, proj: number): number {
  const pos = String(p.pos ?? PROJ_LINE_POS[p.id] ?? '').toUpperCase();
  if (pos === 'K') return K_ZERO;
  if (pos === 'DST' || pos === 'DEF' || pos === 'D/ST') return DST_ZERO;
  const lam = touchesPerGame(p.id);
  if (lam != null) return ZERO_FLOOR + (1 - ZERO_FLOOR) * Math.exp(-lam);
  if (!(proj > 0)) return 1;
  return ZERO_FLOOR + (1 - ZERO_FLOOR) * Math.exp(-proj / PTS_PER_TOUCH);
}

/** What a spot is EXPECTED to score in golf when this player stands in it:
 *  his projection, plus the zero-fill weighted by the chance of a blank —
 *  from his usage, and from a designation that may keep him off the field.
 *  With no zero-fill on the spot only the designation costs anything. */
export function golfExpectedScore(
  p: { id: string; pos?: string | null },
  proj: number,
  zeroPts: number | null | undefined,
  noPlay = 0,
): number {
  const r = Math.min(1, Math.max(0, noPlay));
  const pz = r + (1 - r) * zeroProbability(p, proj);
  const z = zeroPts != null && Number.isFinite(zeroPts) ? Math.max(0, zeroPts) : 0;
  return proj * (1 - r) + pz * z;
}
