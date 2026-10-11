// SALARY PRICING (v0.666.0) — docs/dfs-bullseye.md §15. Founder: "What's the
// process for updating the prices to make sure they align with how every
// position is likely to score?"
//
// THE OLD RULE was $400 per projected point, flat across positions: a 20-point
// quarterback cost what a 20-point running back cost, and a 20-point back is
// rare where a 20-point quarterback is Tuesday. DFS sites price on VALUE OVER
// REPLACEMENT at the position: what a player projects beyond the body anyone
// can roster for the minimum at his spot. That is what this does, and it
// calibrates the rate per board so the budget means the same thing every
// week — the all-studs lineup (the best body at each of the default nine
// spots) lands just OVER the budget (TARGET_SHARE), so a squad is always
// fillable and never free of trade-offs.
//
// Pure: rows in, priced rows out; the worker (pods.js) calls it when it builds
// a week's board, a probe pins the calibration, and the audit CLI reads it
// back. Positions without a weekly projection (HC, P, FB, IDP) sit at the
// floor — a flyer; a league that pays coaches sees its own projection in the
// builder (contestBuilder.leagueWeekProj), not a price.

export interface PriceRow { slug: string; pos: string; proj: number }
export interface PricedRow<R extends PriceRow = PriceRow> { row: R; salary: number; vorp: number }
export interface PricingOpts {
  /** The budget the default nine spots are calibrated to. */
  budget?: number;
  /** The floor. */
  minSalary?: number;
  /** Where the all-studs lineup should land, as a share of the budget: just
   *  over 1 means the best body at every spot is not quite affordable. */
  targetShare?: number;
  /** How many of each position a 12-team league starts — the replacement
   *  level is the next body after them. */
  starters?: Record<string, number>;
  /** The default spots the calibration fills: one of each key, N times. */
  lineup?: Record<string, number>;
  /** The rate's sane bounds, $ per point over replacement. */
  rateMin?: number; rateMax?: number;
}
export const SALARY_FLOOR = 3000;
export const SALARY_BUDGET = 50000;
export const TARGET_SHARE = 1.08;
/** Starters across a 12-team league with the default nine: who is "a
 *  starter" at each position, so the replacement is the man after them. */
export const STARTERS_12: Record<string, number> = { QB: 12, RB: 24, WR: 36, TE: 12, K: 12, DEF: 12 };
/** The default nine. */
export const DEFAULT_LINEUP: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };
export const RATE_MIN = 150;
export const RATE_MAX = 1500;

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Replacement level per position: the projection of the first body past the
 *  league's starters, by projection; 0 where the board is thinner than that. */
export function replacementLevels(rows: PriceRow[], starters: Record<string, number> = STARTERS_12): Map<string, number> {
  const byPos = new Map<string, number[]>();
  for (const r of rows) {
    if (!byPos.has(r.pos)) byPos.set(r.pos, []);
    byPos.get(r.pos)!.push(Math.max(0, Number(r.proj) || 0));
  }
  const out = new Map<string, number>();
  for (const [pos, list] of byPos) {
    const n = starters[pos];
    if (n == null) { out.set(pos, 0); continue; }   // no replacement notion: floor pricing
    list.sort((a, b) => b - a);
    out.set(pos, list[n] ?? 0);
  }
  return out;
}

/** The rate, $ per point over replacement, that lands the all-studs default
 *  lineup at targetShare × budget. */
export function calibrateRate(rows: PriceRow[], repl: Map<string, number>, o: Required<Pick<PricingOpts, 'budget' | 'minSalary' | 'targetShare' | 'lineup' | 'rateMin' | 'rateMax'>>): number {
  let vorpTop = 0; let spots = 0;
  for (const [pos, n] of Object.entries(o.lineup)) {
    const best = rows.filter((r) => r.pos === pos).map((r) => Math.max(0, Number(r.proj) || 0)).sort((a, b) => b - a).slice(0, n);
    spots += n;
    for (const p of best) vorpTop += Math.max(0, p - (repl.get(pos) ?? 0));
  }
  if (!spots || vorpTop <= 0) return o.rateMin;
  const spend = o.targetShare * o.budget - spots * o.minSalary;
  return Math.min(o.rateMax, Math.max(o.rateMin, spend / vorpTop));
}

/** Price a board. Deterministic for a given set of rows. */
export function priceBoard<R extends PriceRow>(rows: R[], opts: PricingOpts = {}): { priced: PricedRow<R>[]; rate: number; replacement: Map<string, number> } {
  const o = {
    budget: opts.budget ?? SALARY_BUDGET, minSalary: opts.minSalary ?? SALARY_FLOOR, targetShare: opts.targetShare ?? TARGET_SHARE,
    starters: opts.starters ?? STARTERS_12, lineup: opts.lineup ?? DEFAULT_LINEUP, rateMin: opts.rateMin ?? RATE_MIN, rateMax: opts.rateMax ?? RATE_MAX,
  };
  const replacement = replacementLevels(rows, o.starters);
  const rate = calibrateRate(rows, replacement, o);
  const priced = rows.map((row) => {
    const vorp = o.starters[row.pos] == null ? 0 : Math.max(0, (Number(row.proj) || 0) - (replacement.get(row.pos) ?? 0));
    return { row, vorp, salary: Math.max(o.minSalary, round100(o.minSalary + rate * vorp)) };
  });
  return { priced, rate, replacement };
}

/** What the all-studs default lineup costs on a priced board, and the budget
 *  share — the calibration's own readout. */
export function studsCost(priced: { row: PriceRow; salary: number }[], lineup: Record<string, number> = DEFAULT_LINEUP): number {
  let cost = 0;
  for (const [pos, n] of Object.entries(lineup)) {
    cost += priced.filter((p) => p.row.pos === pos).sort((a, b) => b.row.proj - a.row.proj).slice(0, n).reduce((s, p) => s + p.salary, 0);
  }
  return cost;
}
