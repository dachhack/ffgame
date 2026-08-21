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
