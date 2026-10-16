// THE FIELD IN PERSPECTIVE, LIKE SLEEPER'S (v0.730.0).
//
// Founder, over a screenshot of Sleeper's game screen: "Let's mirror the
// sleeper field view. Stretched to the edges and a bit over. Draw the same
// goal posts."
//
// Both FieldViews used to tilt a flat 400×130 drawing with a 3D transform
// (CSS `rotateX(20deg)` on the web, the RN equivalent on the phone). That gives
// a gentle trapezoid, but everything on the field tilts with it: a headshot
// near the far sideline is squashed, and anything that should STAND on the
// field — Sleeper's goal posts, the ball carrier's pin — lies down flat. And
// the phone and the browser do not agree on what a perspective of 560 means.
//
// So the projection is done here, in plain arithmetic, and both views draw the
// projected points: the turf, end zones, yard lines and arcs go through
// `fieldPt`; the marks that stand up (posts, the ball badge, the carrier) are
// placed at a projected point and drawn upright. Same numbers on both hosts.
//
// ── THE MODEL ────────────────────────────────────────────────────────────
// The field keeps its flat coordinates (x 0–400, y TOP–BOT, the near sideline
// at BOT). A point `f` of the way from the near sideline to the far one shrinks
// toward the centre by s = 1 / (1 + f·K) and rises by A·(1 − s)/(1 − s_far):
// a ground plane seen through a pinhole, so a yard line stays a straight line
// and the far sideline is FAR_SCALE as wide as the near one. FAR_SCALE 0.66 is
// Sleeper's: their far sideline is about two thirds of their near one.

/** The flat field every view draws in — unchanged since the first FieldView. */
export const FIELD_W = 400;
export const FIELD_H = 130;
export const FIELD_EZ = 26;
export const FIELD_TOP = 12;
export const FIELD_BOT = FIELD_H - 16;
export const FIELD_MID = (FIELD_TOP + FIELD_BOT) / 2;

/** How wide the far sideline draws next to the near one. */
export const FAR_SCALE = 0.66;
const K = 1 / FAR_SCALE - 1;
/** Height of the projected field, near sideline to far, in drawing units. */
export const PROJ_DEPTH = 58;
/** Where the near sideline sits. The room above the far sideline is for what
 *  stands on the field: the posts, the carrier's pin, a high kick. */
export const PROJ_NEAR_Y = 92;
/** The projected drawing's height (its width is FIELD_W). */
export const PROJ_H = PROJ_NEAR_Y + 2;

/** How far the drawing runs past each screen edge when it bleeds, as a share
 *  of the screen's width. Sleeper's near corners sit just off the screen. */
export const BLEED_OVER = 0.05;

/** The scale a point at flat `y` draws at: 1 on the near sideline. */
export function fieldScale(y: number): number {
  const f = (FIELD_BOT - y) / (FIELD_BOT - FIELD_TOP);
  return 1 / (1 + f * K);
}

/** Screen y for flat y. */
export function fieldY(y: number): number {
  return PROJ_NEAR_Y - PROJ_DEPTH * (1 - fieldScale(y)) / (1 - FAR_SCALE);
}

/** A flat field point, projected. */
export function fieldPt(x: number, y: number): { x: number; y: number } {
  const s = fieldScale(y);
  return { x: FIELD_W / 2 + (x - FIELD_W / 2) * s, y: fieldY(y) };
}

/** Screen x for flat x at flat y (linear in x — an animated x can be
 *  interpolated through it: see `fieldXRange`). */
export function fieldX(x: number, y: number): number {
  return FIELD_W / 2 + (x - FIELD_W / 2) * fieldScale(y);
}

/** Where flat x = 0 and x = FIELD_W land at flat y — the output range that
 *  maps an animated flat x to screen x on that row. */
export function fieldXRange(y: number): [number, number] {
  return [fieldX(0, y), fieldX(FIELD_W, y)];
}

/** A flat rectangle (x0..x1, y0..y1) as a projected polygon's `points`. */
export function fieldQuad(x0: number, y0: number, x1: number, y1: number): string {
  return [fieldPt(x0, y0), fieldPt(x1, y0), fieldPt(x1, y1), fieldPt(x0, y1)]
    .map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

export interface ProjPath { d: string; len: number; end: { x: number; y: number } }

/** A flat polyline, projected: its SVG path and its drawn length (for the
 *  stroke-draw animation, which needs the length of what is ON SCREEN). */
export function projPolyline(pts: Array<[number, number]>, lift?: (t: number) => number): ProjPath {
  const out = pts.map(([x, y], i) => {
    const p = fieldPt(x, y);
    return { x: p.x, y: p.y - (lift ? lift(pts.length > 1 ? i / (pts.length - 1) : 1) : 0) };
  });
  let len = 0;
  for (let i = 1; i < out.length; i++) len += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
  const d = out.map((p, i) => `${i ? 'L' : 'M'} ${round(p.x)} ${round(p.y)}`).join(' ');
  return { d, len, end: out[out.length - 1] ?? { x: 0, y: 0 } };
}

/** A flat quadratic (the flight arc), sampled and projected. `lift` raises
 *  the screen point by lift(t) along the way (a made field goal climbs to
 *  the crossbar). */
export function projQuad(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, lift?: (t: number) => number): ProjPath {
  const pts: Array<[number, number]> = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
  }
  return projPolyline(pts, lift);
}

// ── THE GOAL POSTS ───────────────────────────────────────────────────────
// Sleeper's: gold, standing on each end line halfway between the sidelines, a
// short post up to the crossbar and two uprights above it, drawn upright
// rather than lying on the grass.

export const POST_COLOR = '#F2B53A';
/** Post height to the crossbar, crossbar half-width, upright height — screen units. */
export const POST_STEM = 12;
export const POST_HALF = 7;
export const POST_UP = 24;

/** The post on an end line (flat x = 0 or FIELD_W), as one SVG path, and the
 *  point between the uprights a made kick flies through. */
export function goalPost(endX: number): { d: string; base: { x: number; y: number }; through: { x: number; y: number } } {
  const b = fieldPt(endX, FIELD_MID);
  const bar = b.y - POST_STEM;
  const d = `M ${round(b.x)} ${round(b.y)} L ${round(b.x)} ${round(bar)}`
    + ` M ${round(b.x - POST_HALF)} ${round(bar - POST_UP)} L ${round(b.x - POST_HALF)} ${round(bar)}`
    + ` L ${round(b.x + POST_HALF)} ${round(bar)} L ${round(b.x + POST_HALF)} ${round(bar - POST_UP)}`;
  return { d, base: b, through: { x: b.x, y: bar - POST_UP * 0.55 } };
}

const round = (n: number) => Math.round(n * 100) / 100;
