// WHERE A PLAY STOPPED FLYING AND STARTED BEING CARRIED (v0.332.0).
//
// Founder, looking at a punt on the field visual: "we've got a double line
// thing going on."
//
// Both FieldViews — web and native — split the last play into an AIR segment
// and a CARRY segment, and both computed the split point with their own copy of
// this arithmetic. The native file even carries a comment saying it is a port
// "at the SAME geometry" and must not drift. This is that geometry, once.
//
// ── THE BUG THE SPLIT PRODUCED ─────────────────────────────────────────────
// Both segments were drawn on the same horizontal line. For a PASS that is
// right: the run-after continues in the same direction, so air and carry meet
// end to end. For a KICK it is wrong, because the returner runs BACK the way
// the ball came — so the runback retraced the flight path in the same colour,
// at the same width, at the same y, and read as one line drawn twice.
//
// Measured against the shared geometry (W=400, EZ=26, FX=EZ, FW=W-2*EZ):
//
//   pass + YAC        air 235-287   carry 183-235   meet end to end
//   punt + return     air  71-270   carry  71-113   OVERLAP 41.8px
//   kickoff + return  air  43-252   carry  43-130   OVERLAP 87.0px
//
// The overlap is not wrong in the DATA — the ball really did fly out and get
// run back over the same grass. It is wrong to draw two phases of one play on
// one line and leave the reader to work out which is which. The carry gets its
// own lane just below the flight path; `overlaps` is what says it needs one.

/** The fields of a GamePlay this module reads. */
export interface PlayPathInput {
  /** ESPN play type text ("Punt", "Pass Reception", …). */
  ty: string;
  /** Possession team, and the team in possession AFTER the play when it flips. */
  tm: string;
  tm2?: string | null;
  /** Start and end yards-to-endzone, in their respective teams' coordinates. */
  yl: number;
  yl2: number;
  /** Yards after catch, and return yards. */
  yac?: number | null;
  ret?: number | null;
}

/** `xOf` from the FieldViews: yards-to-endzone -> an x in field coordinates. */
export type XOf = (yte: number, tm: string) => number;

export interface PlayPath {
  /** Where the ball came down, or null when the play never split. */
  catchX: number | null;
  /** True when there is a carried phase to draw on its own lane. */
  carrying: boolean;
  /** True when the two segments cover the same stretch of field — the case
   *  that made a returned kick look like a doubled line. */
  overlaps: boolean;
}

export function playPath(cur: PlayPathInput | null | undefined, x1: number, x2: number, xOf: XOf): PlayPath {
  const none: PlayPath = { catchX: null, carrying: false, overlaps: false };
  if (!cur) return none;
  const completedPass = /Pass Reception|Passing Touchdown/.test(cur.ty);
  const team = cur.tm2 ?? cur.tm;
  // A completed pass splits at the catch: the receiver finished at yl2 having
  // run `yac` after it, so the catch sits yac yards behind him.
  const yacX = completedPass && cur.yac != null && cur.yl !== cur.yl2
    ? xOf(Math.min(100, Math.max(0, cur.yl2 + cur.yac)), team)
    : null;
  // A kick splits where it was fielded: the returner finished at yl2 having run
  // `ret`, so the catch sits ret yards behind him in HIS coordinates. A catch
  // inside the end zone maps past 100 and renders there naturally.
  const retX = cur.ret != null && /Kickoff|Punt/.test(cur.ty)
    ? xOf(Math.min(108, cur.yl2 + cur.ret), team)
    : null;
  const catchX = yacX ?? retX;
  if (catchX == null || catchX === x2) return { catchX, carrying: false, overlaps: false };
  const air = [Math.min(x1, catchX), Math.max(x1, catchX)];
  const carry = [Math.min(catchX, x2), Math.max(catchX, x2)];
  // A shared endpoint is not an overlap — that is what "meet end to end" means.
  const shared = Math.min(air[1], carry[1]) - Math.max(air[0], carry[0]);
  return { catchX, carrying: true, overlaps: shared > 0.01 };
}

// ── HOW HIGH THE BALL GOES (v0.333.0) ─────────────────────────────────────
//
// Founder, on a short pass: "Looks like we have the line on the ground, and the
// arch above for the pass. It should just be arch then the yards after the
// arch."
//
// Both views drew the flight arc with a control point at a FIXED `TOP - 6` —
// the top of the field — however far the ball actually travelled. A 50-yard
// bomb got a graceful arc; a five-yard checkdown got the same apex squeezed
// into a fifth of the width, which renders as a tall narrow spike floating
// above a short flat line. Two marks that plainly belong to one play stop
// looking like one play, which is what "line on the ground AND an arch above"
// is describing.
//
// So the apex scales with how far the ball flew. A long throw keeps exactly the
// height it has today (the clamp's top end IS `TOP - 6`, so nothing regresses
// on the plays that already looked right); a short one gets a proportionate
// bump that reads as a throw rather than a flagpole.
//
// A QUADRATIC PEAKS AT HALF ITS CONTROL OFFSET, which is why the numbers here
// look twice as tall as the curve you see: `Q` reaches midway between the
// baseline and the control point, never to it.

/** Control-point Y for a flight arc between two x positions.
 *  `midY` is the baseline; `top` is the top of the field. */
export function arcControlY(x1: number, x2: number, midY: number, top: number): number {
  const dist = Math.abs((Number(x2) || 0) - (Number(x1) || 0));
  // The ceiling is today's fixed value, so long throws are untouched.
  const maxDepth = midY - (top - 6);
  // The floor keeps a very short throw visibly airborne — a pass with no arc at
  // all is indistinguishable from a run, and the whole point of the arc is that
  // the ball left the ground.
  const minDepth = Math.min(18, maxDepth);
  const depth = Math.min(maxDepth, Math.max(minDepth, dist * 0.7));
  return midY - depth;
}

// ── WHICH SIDE OF THE FIELD THE PLAY WENT (v0.335.0) ──────────────────────
//
// Founder: "If the play says right or left can we have the play draw on that
// side of the field?"
//
// ESPN's play text says so in every case that has a side: "pass short right to
// D.Laube", "pass deep left", "rush up the middle", "left tackle". The field
// drew every play down the centre line, so a checkdown to the right flat and a
// deep out to the left were the same picture.
//
// ── THE WORD BOUNDARY IS THE WHOLE PARSER ──────────────────────────────────
// Play text is full of NAMES, and the names collide with the direction words:
// Wright, Leftwich, Rightmire. `\b` handles them — "Wright" has no boundary
// before its "right" — and that is precisely the thing to have a test for
// rather than a hope about, because the failure is a play drawn on the wrong
// side, which looks exactly as plausible as the right one.
//
// FIRST MATCH WINS, because ESPN puts the direction in the action phrase
// ("pass short right to …") and any later occurrence is a tackler's surname or
// a penalty note.

export type PlaySide = 'left' | 'right' | 'middle';

/** The side named in a play's text, or null when it names none. */
export function playSide(txt?: string | null): PlaySide | null {
  const m = /\b(left|right|middle)\b/i.exec(String(txt ?? ''));
  return m ? (m[1].toLowerCase() as PlaySide) : null;
}

/** How far off the centre line to draw a play, in field units.
 *
 *  SIGN COMES FROM THE ATTACK DIRECTION, not from the word. "Right" is the
 *  OFFENSE's right, and on an overhead field an offense moving right on screen
 *  has its right hand toward the bottom — so the same word points opposite ways
 *  depending on which way the team is going, and mirrors again when the viewer
 *  flips the field. Getting this backwards draws every play on the wrong side
 *  while looking entirely reasonable, which is why it is a tested function and
 *  not an inline ternary.
 *
 *  @param attacksRightOnScreen the direction the offense moves AS DRAWN
 *         (i.e. after any flip has been applied).
 *  @param lane how far a left/right play sits from the centre line. */
export function playSideDy(
  side: PlaySide | null, attacksRightOnScreen: boolean, lane: number,
): number {
  if (side == null || side === 'middle') return 0;
  const toward = side === 'right' ? 1 : -1;      // +1 = down the screen
  return toward * (attacksRightOnScreen ? 1 : -1) * lane;
}
