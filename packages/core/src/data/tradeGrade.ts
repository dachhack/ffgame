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
// PICKS AND DOLLARS. A future pick is valued as a FRACTION of a replacement
// starter's season — a first is most of one, a fourth is a rounding error —
// and the UI says "estimated" beside it, because nobody knows where a pick
// will land. FAAB and cap dollars are reported as themselves rather than
// converted into points: a dollar is not a point, and pretending otherwise is
// how a grade starts lying.
//
// WHAT THIS IS NOT: a verdict on whether to accept. It does not know that you
// are 1-6 and rebuilding, that your league trades for fun, or that the man
// you are getting has a coach who hates him. The copy says "projected points",
// never "you win".
import { projectedPoints, leagueCatalogOf } from '../engine/projScoring';
import { leagueSlotDefs, type ClassicSlotDef } from '../engine/classic';

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

/** A future pick's estimated value, as a fraction of one replacement starter's
 *  season. Deliberately blunt and deliberately labelled: a first is most of a
 *  starter, a late rookie pick is nearly nothing. */
const PICK_SHARE = [0, 0.85, 0.45, 0.22, 0.1, 0.05];
function pickValue(pick: GradePick, replacementStarter: number): number {
  const share = PICK_SHARE[Math.min(Math.max(pick.round, 1), PICK_SHARE.length - 1)] ?? 0.02;
  return Math.round(replacementStarter * share * 10) / 10;
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
  const outPicks = (opts.send.picks ?? []).reduce((a, p) => a + pickValue(p, replStarter), 0);
  const inPicks = (opts.receive.picks ?? []).reduce((a, p) => a + pickValue(p, replStarter), 0);
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
