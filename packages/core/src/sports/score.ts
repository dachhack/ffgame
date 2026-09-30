// SCORING A STAT LINE — points, head-to-head categories, and roto.
//
// Three ways a league turns lines into a result, all over the same totals:
//
//   • POINTS — Σ scoring[stat] × line[stat], per player, summed per team.
//     The same shape as classic.ts's table for the NFL, minus the football.
//   • H2H CATEGORIES — sum every starter's line into one team line, compute
//     each category (a total, or a ratio of totals — a team's FG% is made
//     FGM/FGA over the whole roster, never an average of percentages), and
//     compare category by category: the week is won 6-3-0 rather than by a
//     score. A category neither side registers (no goalie played: GAA is
//     0/0) is a tie, not a loss.
//   • ROTO — rank every team in the league in each category; the best gets
//     N points, the worst 1, ties split the points they span. Season
//     standings are the sum.
//
// Pure functions over StatLine, no I/O, so the worker, the web board and the
// mobile board all get the same number from the same rows.
import type { SportDef, StatLine, CategoryDef } from './types';
import { baseballCategoryInputs } from './mlb';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Add lines together. Absent keys are zero. */
export function sumLines(lines: readonly StatLine[]): StatLine {
  const out: StatLine = {};
  for (const l of lines) for (const k in l) {
    const v = l[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** A league's scoring table: the sport's defaults with the league's finite
 *  overrides laid over, unknown stats dropped — the same sanitising the
 *  classic table gets, so a stray key can't score. */
export function normalizeScoring(def: SportDef, overrides?: Record<string, unknown> | null): Record<string, number> {
  const known = new Set(def.stats.map((s) => s.id));
  const out: Record<string, number> = { ...def.scoringDefault };
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      if (!known.has(k)) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

/** Points for one game line (derived stats filled first, so a knob on `dd`
 *  or `qs` fires). Rounded to hundredths. */
export function linePoints(def: SportDef, line: StatLine, scoring?: Record<string, number> | null): number {
  const sc = scoring ?? def.scoringDefault;
  const full = def.derive(line);
  let pts = 0;
  for (const k in sc) {
    const v = full[k];
    if (v) pts += sc[k] * v;
  }
  return r2(pts);
}

/** Points across several game lines — derived per game, then summed, so a
 *  double-double counts per night and a quality start per start. */
export function linesPoints(def: SportDef, lines: readonly StatLine[], scoring?: Record<string, number> | null): number {
  let t = 0;
  for (const l of lines) t += linePoints(def, l, scoring);
  return r2(t);
}

/** Team totals ready for categories: every game line derived, summed, plus
 *  the sport's extra ratio inputs. */
export function categoryTotals(def: SportDef, lines: readonly StatLine[]): StatLine {
  const summed = sumLines(lines.map((l) => def.derive(l)));
  return def.id === 'mlb' ? baseballCategoryInputs(summed) : summed;
}

export const categoryById = (def: SportDef, id: string): CategoryDef | undefined => def.categories.find((c) => c.id === id);

/** A category's value from team totals. Null when a ratio has no
 *  denominator (nobody batted, no goalie played). */
export function categoryValue(cat: CategoryDef, totals: StatLine): number | null {
  if (cat.stat) return totals[cat.stat] ?? 0;
  if (cat.ratio) {
    const den = totals[cat.ratio.den] ?? 0;
    if (!den) return null;
    const v = ((totals[cat.ratio.num] ?? 0) / den) * (cat.ratio.scale ?? 1);
    const p = 10 ** (cat.ratio.decimals ?? 3);
    return Math.round(v * p) / p;
  }
  return null;
}

export type CatResult = 'a' | 'b' | 'tie';

export interface CategoryLine { id: string; a: number | null; b: number | null; result: CatResult }
export interface CategoriesVerdict { wins: number; losses: number; ties: number; cats: CategoryLine[]; winner: CatResult }

/** Compare two teams' totals across the league's categories. `winner` is the
 *  side with more categories; equal counts tie the week. */
export function compareCategories(def: SportDef, a: StatLine, b: StatLine, catIds: readonly string[]): CategoriesVerdict {
  const cats: CategoryLine[] = [];
  let wins = 0, losses = 0, ties = 0;
  for (const id of catIds) {
    const cat = categoryById(def, id);
    if (!cat) continue;
    const va = categoryValue(cat, a), vb = categoryValue(cat, b);
    // A ratio one side never registered (no goalie played, nobody batted) is
    // a tie rather than a loss: there is nothing to be worse than.
    let result: CatResult = 'tie';
    if (va != null && vb != null && va !== vb) {
      const aBetter = cat.lowerBetter ? va < vb : va > vb;
      result = aBetter ? 'a' : 'b';
    }
    if (result === 'a') wins++; else if (result === 'b') losses++; else ties++;
    cats.push({ id, a: va, b: vb, result });
  }
  return { wins, losses, ties, cats, winner: wins > losses ? 'a' : losses > wins ? 'b' : 'tie' };
}

export interface RotoRow { id: string; total: number; cats: Record<string, { value: number | null; points: number }> }

/** Roto standings: per category the best of N teams scores N, the worst 1,
 *  ties share (the average of the places they span); a team with no value
 *  in a ratio category takes last place in it. */
export function rotoStandings(def: SportDef, teams: readonly { id: string; totals: StatLine }[], catIds: readonly string[]): RotoRow[] {
  const rows: RotoRow[] = teams.map((t) => ({ id: t.id, total: 0, cats: {} }));
  for (const id of catIds) {
    const cat = categoryById(def, id);
    if (!cat) continue;
    const vals = teams.map((t, i) => ({ i, v: categoryValue(cat, t.totals) }));
    // Sort worst → best so index order is the place from the bottom.
    const sortable = (v: number | null) => (v == null ? (cat.lowerBetter ? Infinity : -Infinity) : v);
    vals.sort((x, y) => (cat.lowerBetter ? sortable(y.v) - sortable(x.v) : sortable(x.v) - sortable(y.v)));
    let k = 0;
    while (k < vals.length) {
      let j = k;
      while (j + 1 < vals.length && sortable(vals[j + 1].v) === sortable(vals[k].v)) j++;
      // places k+1 … j+1 (1 = worst) share their average.
      const pts = (k + 1 + j + 1) / 2;
      for (let m = k; m <= j; m++) {
        rows[vals[m].i].cats[id] = { value: vals[m].v, points: pts };
        rows[vals[m].i].total = r2(rows[vals[m].i].total + pts);
      }
      k = j + 1;
    }
  }
  return rows.sort((a, b) => b.total - a.total);
}
