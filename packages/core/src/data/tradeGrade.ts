// WHAT IS THIS TRADE WORTH? (v0.444.0)
//
// The gap list: "Trade analyzer or grades — ESPN (IBM watsonx), Yahoo Plus
// Trade Hub. Drip today: None." Both of theirs are a letter and a shrug: an
// opaque number from a model you cannot inspect, which is exactly the wrong
// shape for the argument it lands in the middle of. A manager who is told
// "B−" learns nothing; a manager who is told "you are giving up 34 projected
// points over replacement and getting back 41, and here is each player's
// number" can disagree with the arithmetic, which is the honest version of
// the same feature.
//
// SO: VALUE OVER REPLACEMENT, in this league's own scoring.
//
//   · A player's value is his PROJECTED SEASON POINTS under the league's
//     scoring catalog (engine/projScoring, which is already what the draft
//     room and the player cards read) minus the projection of the REPLACEMENT
//     at his position — the best player at that position who would still be
//     sitting in the pool if every team filled its starting spots.
//   · Replacement depth = teams × starting spots that accept the position.
//     That is why a QB is worth little in a 1-QB twelve-team league and a
//     great deal in a superflex one, with no special case for either: the
//     league's own lineup spec moves the replacement line.
//   · A player projected BELOW replacement is worth zero, not a negative.
//     Giving away a bench body is not a cost; the other side can sign the
//     same production off the wire.
//
// PICKS AND DOLLARS. A pick is valued from data rather than from a constant
// (v0.448.0): a STARTUP slot by the player who will still be on the board
// when it comes round, a ROOKIE pick by what the dynasty market pays for it,
// converted into this league's points through the pool itself. The UI still
// says "estimated" beside it, because nobody knows where a pick will land.
// FAAB and cap dollars are reported as themselves rather than
// converted into points: a dollar is not a point, and pretending otherwise is
// how a grade starts lying.
//
// WHAT THIS IS NOT: a verdict on whether to accept. It does not know that you
// are 1-6 and rebuilding, that your league trades for fun, or that the man
// you are getting has a coach who hates him. The copy says "projected points",
// never "you win".
import { projectedPoints, leagueCatalogOf } from '../engine/projScoring';
import { leagueSlotDefs, leagueSuperflex, type ClassicSlotDef } from '../engine/classic';
import { dynFor } from './dyn2026';
import { pickMarketValue, type PickFormat } from './pickValues2026';

// projectedPoints answers PER WEEK (the bake stores a weekly rate). A trade is
// argued about in season points — "he is worth forty points to me over the
// rest of the year" — so everything below is scaled once, here, and the unit
// is stated in every sentence the UI prints.
const WEEKS = 17;

export interface GradePlayer { slug: string; pos: string; team?: string | null; sleeperId?: string | null; }
export interface GradePick { season: string; round: number; kind?: string | null; }
export interface GradeSide {
  /** Players leaving this seat. */
  players: GradePlayer[];
  picks?: GradePick[];
  /** Positive = this seat SENDS dollars. */
  faab?: number;
  cap?: number;
}
export interface GradeLine { slug: string; pos: string; points: number; value: number; }
export interface GradeResult {
  /** Value over replacement of everything each side sends. */
  out: number; in: number;
  /** in − out, from the asking seat's point of view. */
  delta: number;
  outLines: GradeLine[]; inLines: GradeLine[];
  /** Estimated pick value, counted inside `out`/`in`. */
  outPicks: number; inPicks: number;
  faab: number; cap: number;
  /** "even" within the noise; otherwise which way it leans. */
  verdict: 'even' | 'for' | 'against';
  /** One sentence, ready to print. */
  summary: string;
  /** Did any player in the deal have no projection at all? Then the number
   *  is incomplete and the UI should say so rather than quietly under-count. */
  missing: string[];
}

/** Replacement level per position: the projection of the best player who
 *  would still be unrostered once every team has filled its starting spots.
 *  Falls back to a flat league-average when the pool is too thin to say. */
function replacementByPos(
  pool: GradePlayer[], teams: number, slots: ClassicSlotDef[],
): Map<string, number> {
  const out = new Map<string, number>();
  const byPos = new Map<string, number[]>();
  for (const p of pool) {
    const pts = projectedPoints({ id: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeperId }) * WEEKS;
    if (!Number.isFinite(pts) || pts <= 0) continue;
    const list = byPos.get(p.pos) ?? [];
    list.push(pts);
    byPos.set(p.pos, list);
  }
  for (const [pos, list] of byPos) {
    list.sort((a, b) => b - a);
    // How many of this position the league starts: a spot counts when it
    // accepts the position at all, so a FLEX raises the RB, WR and TE lines
    // together — which is what a flex does to a real market.
    const spots = slots.filter((s) => ((s.pos ?? []) as string[]).includes(pos)).length;
    const depth = Math.max(1, Math.round(teams * Math.max(spots, 0.5)));
    out.set(pos, list[Math.min(depth, list.length - 1)] ?? 0);
  }
  return out;
}

// ── WHAT A PICK IS WORTH (v0.448.0) ──────────────────────────────────────
// v0.444.0 priced a pick at an invented fraction of a replacement starter —
// [0, 0.85, 0.45, 0.22, 0.1, 0.05] — with a comment admitting it was blunt.
// It was the one number in this file that came from nowhere, inside a
// feature whose entire argument is "you can disagree with the arithmetic".
//
// There are two kinds of pick in this app and they want two different
// answers, neither of which needs inventing:
//
//   A STARTUP SLOT (0190) is a pick in a draft of THESE players. It is worth
//   the player who will still be there when it comes round — which we can
//   look up, because the pool and its projections are right here. No market,
//   no curve, no estimate of an estimate: the 18th-best man left in a
//   12-team league's second round is a row we can read.
//
//   A ROOKIE PICK is an asset in a draft that has not happened, of players
//   who are not in the pool. What it is worth is what it TRADES for, and
//   that is a market question with a market answer: the dynasty board
//   (pickValues2026 — the same board, and the same scale, as dyn2026). We
//   turn that market value into this league's own points by reading it off
//   the pool: find the players who trade for about the same, and ask what
//   THEY are worth over replacement here. A pick that trades for what the
//   14th receiver trades for is worth what the 14th receiver is worth.
//
// The old share table survives as the fallback for a league with no dynasty
// values loaded at all, which is the only case where neither answer exists.
const PICK_SHARE = [0, 0.85, 0.45, 0.22, 0.1, 0.05];

/** The market-value ↔ value-over-replacement curve, read off THIS league's
 *  pool: one point per player the dynasty board prices and the projections
 *  reach, sorted by market value. */
function marketCurve(pool: GradePlayer[], repl: Map<string, number>): { v: number; vor: number }[] {
  const pts: { v: number; vor: number }[] = [];
  for (const p of pool) {
    const v = dynFor(p.slug);
    if (!v || v <= 0) continue;
    const season = projectedPoints({ id: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeperId }) * WEEKS;
    if (!Number.isFinite(season) || season <= 0) continue;
    pts.push({ v, vor: Math.max(0, season - (repl.get(p.pos) ?? 0)) });
  }
  return pts.sort((a, b) => b.v - a.v);
}

/** Read a market value off that curve: the average value-over-replacement of
 *  the players who trade for about the same. Several neighbours rather than
 *  the single nearest one, because a dynasty value is a long-horizon opinion
 *  and this season's projection is not — the players either side of a price
 *  disagree, and the middle of them is the honest answer. */
function vorForMarket(curve: { v: number; vor: number }[], v: number, neighbours = 9): number | null {
  if (curve.length < 5) return null;
  const near = curve
    .map((c) => ({ vor: c.vor, d: Math.abs(c.v - v) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, neighbours);
  return near.reduce((a, c) => a + c.vor, 0) / near.length;
}

interface PickCtx {
  replacementStarter: number;
  /** Every projected player in the pool, best first — a startup slot drafts
   *  from exactly this. */
  board: number[];
  curve: { v: number; vor: number }[];
  teams: number;
  fmt: PickFormat;
  season: number;
}

/** A pick's value, in this league's projected points over replacement. */
function pickValue(pick: GradePick, ctx: PickCtx): number {
  const round = Math.max(1, Math.round(pick.round));
  // A STARTUP SLOT: the man still sitting there when it comes round. The
  // middle of the round, because the slot within it is not passed here —
  // the same "an unknown slot is the middle" rule the market side uses.
  if (pick.kind === 'startup' && ctx.board.length) {
    const idx = Math.round((round - 1) * ctx.teams + ctx.teams / 2) - 1;
    const pts = ctx.board[Math.min(Math.max(idx, 0), ctx.board.length - 1)];
    // Over replacement, like every other line in this grade. A slot deep
    // enough to draft a replacement-level player is worth nothing, which is
    // right: that production is on the wire for free.
    if (Number.isFinite(pts)) return Math.max(0, Math.round((pts - ctx.replacementStarter) * 10) / 10);
  }
  // A ROOKIE PICK: what the market pays, priced in this league's points.
  const mv = pickMarketValue(pick.season ?? ctx.season, round, ctx.fmt);
  if (mv != null) {
    const vor = vorForMarket(ctx.curve, mv);
    if (vor != null) return Math.round(vor * 10) / 10;
  }
  // No board and no curve: the old blunt share, kept so a league with no
  // dynasty data at all still gets a number rather than a zero.
  const share = PICK_SHARE[Math.min(round, PICK_SHARE.length - 1)] ?? 0.02;
  return Math.round(ctx.replacementStarter * share * 10) / 10;
}

export function gradeTrade(opts: {
  /** What the seat being graded SENDS. */
  send: GradeSide;
  /** What it RECEIVES. */
  receive: GradeSide;
  /** The league's whole player pool — the market the replacement line is
   *  read off. */
  pool: GradePlayer[];
  teams: number;
  /** The league's lineup spec, so a superflex league prices a QB like one. */
  slots?: { roster?: unknown; slots?: unknown } | null;
  /** The league's scoring, so a TE-premium league says so in the numbers. */
  scoring?: unknown;
  /** The league's season, so a pick for "next year" is priced as next
   *  year's. Defaults to the calendar year. */
  season?: number;
}): GradeResult {
  if (opts.scoring !== undefined) leagueCatalogOf(opts.scoring as never);
  const slotDefs = leagueSlotDefs(opts.slots as never) ?? [];
  const repl = replacementByPos(opts.pool ?? [], Math.max(opts.teams || 10, 2), slotDefs);
  // One replacement STARTER — the average of the replacement lines — is the
  // unit picks are priced in.
  const replStarter = (() => {
    const vals = [...repl.values()].filter((v) => v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();
  const missing: string[] = [];

  const line = (p: GradePlayer): GradeLine => {
    const pts = projectedPoints({ id: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeperId }) * WEEKS;
    if (!Number.isFinite(pts) || pts <= 0) missing.push(p.slug);
    const over = Math.max(0, (pts || 0) - (repl.get(p.pos) ?? 0));
    return { slug: p.slug, pos: p.pos, points: Math.round((pts || 0) * 10) / 10, value: Math.round(over * 10) / 10 };
  };
  const outLines = (opts.send.players ?? []).map(line);
  const inLines = (opts.receive.players ?? []).map(line);
  // What the picks are priced against (v0.448.0): the board a startup slot
  // drafts from, the market curve a rookie pick is read off, and which of
  // the market's two formats this lineup is. A league that starts more
  // quarterbacks than it has teams is a superflex market, which is the same
  // fact the replacement line above already moves on — no special case, one
  // question asked twice.
  // `leagueSuperflex` is THE rule (v0.456.0) — it also counts a lone SFLX
  // spot with no plain QB, which a bare "more than one QB spot" missed.
  const superflex = leagueSuperflex(opts.slots as never);
  const pickCtx: PickCtx = {
    replacementStarter: replStarter,
    board: (opts.pool ?? [])
      .map((p) => projectedPoints({ id: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeperId }) * WEEKS)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b - a),
    curve: marketCurve(opts.pool ?? [], repl),
    teams: Math.max(opts.teams || 10, 2),
    fmt: superflex ? 'sf' : '1qb',
    season: opts.season ?? new Date().getFullYear(),
  };
  const outPicks = (opts.send.picks ?? []).reduce((a, p) => a + pickValue(p, pickCtx), 0);
  const inPicks = (opts.receive.picks ?? []).reduce((a, p) => a + pickValue(p, pickCtx), 0);
  const out = outLines.reduce((a, l) => a + l.value, 0) + outPicks;
  const inV = inLines.reduce((a, l) => a + l.value, 0) + inPicks;
  const delta = Math.round((inV - out) * 10) / 10;
  const faab = (opts.receive.faab ?? 0) - (opts.send.faab ?? 0);
  const cap = (opts.receive.cap ?? 0) - (opts.send.cap ?? 0);

  // "Even" is a BAND, not a point. A projection carries far more error than
  // a few points, so a grade that flips from "wins" to "loses" over three
  // points of a 300-point season is pretending to a precision it does not
  // have. Twelve season points is about two thirds of a point a week.
  const band = Math.max(12, (out + inV) * 0.12);
  const verdict: GradeResult['verdict'] = Math.abs(delta) <= band ? 'even' : delta > 0 ? 'for' : 'against';
  const money = [
    faab ? `${faab > 0 ? '+' : ''}$${faab} FAAB` : '',
    cap ? `${cap > 0 ? '+' : ''}$${cap} cap` : '',
  ].filter(Boolean).join(' · ');
  const summary =
    (verdict === 'even'
      ? `Close to even — ${delta > 0 ? '+' : ''}${delta} projected points over replacement`
      : verdict === 'for'
        ? `Leans your way — +${delta} projected points over replacement`
        : `Leans their way — ${delta} projected points over replacement`)
    + (money ? ` · ${money}` : '')
    + (outPicks + inPicks > 0 ? ' · picks estimated' : '');

  return {
    out: Math.round(out * 10) / 10, in: Math.round(inV * 10) / 10, delta,
    outLines, inLines,
    outPicks: Math.round(outPicks * 10) / 10, inPicks: Math.round(inPicks * 10) / 10,
    faab, cap, verdict, summary, missing: [...new Set(missing)],
  };
}
