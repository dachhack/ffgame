// WHO STARTS THIS WEEK (0293, v0.416.0).
//
// Founder, on a projected lineup that had Sam Darnold starting: "Lock is the
// QB2 but Darnold is hurt and out this week."
//
// The sheet ranked by PROJECTION, so taking the injured man off promoted the
// third-stringer rather than the backup — Drew Lock has no projection at all,
// and a player the projection set has never valued cannot be sorted into view.
// This is the layer that knows him.
//
// Sleeper's depth_chart_order, published daily by the worker. It is re-ordered
// for AVAILABILITY week to week, which is exactly the question a pre-kickoff
// sheet asks — and the reason it disagrees with ESPN's, which is the SEASON
// chart and still has Darnold at QB1.
//
// COVERAGE IS PARTIAL AND THAT IS FINE. About 71% of active skill players
// carry an order; the rest are mostly deep bench. Absence means "no rank", not
// "ranked last", so a consumer falls back to whatever it was doing before
// rather than burying an unranked man.
//
// Same synchronous-cache shape as injuries and team overrides, because the
// pool builders and render paths that read it cannot await.

export interface DepthRow { slug: string; team: string; pos: string; depth: number }

let bySlug = new Map<string, DepthRow>();
let byTeam = new Map<string, DepthRow[]>();

/** Replace the cache (rows straight from player_depth). */
export function setDepthChart(rows: DepthRow[]): void {
  bySlug = new Map();
  byTeam = new Map();
  for (const r of rows ?? []) {
    if (!r?.slug || !Number.isFinite(r.depth)) continue;
    const row: DepthRow = { slug: r.slug, team: (r.team ?? '').toUpperCase(), pos: (r.pos ?? '').toUpperCase(), depth: r.depth };
    bySlug.set(row.slug, row);
    const list = byTeam.get(row.team);
    if (list) list.push(row); else byTeam.set(row.team, [row]);
  }
  for (const list of byTeam.values()) list.sort((a, b) => a.depth - b.depth);
}

export function clearDepthChart(): void { bySlug = new Map(); byTeam = new Map(); }

/** True once a chart has been loaded — lets a caller tell "no rank for him"
 *  apart from "no chart at all", which are different failures. */
export function hasDepthChart(): boolean { return bySlug.size > 0; }

/** This player's rank, 1 = starter. Null when the chart doesn't rank him. */
export function depthFor(slug: string): number | null {
  return bySlug.get(slug)?.depth ?? null;
}

/** Everyone the chart ranks on a team, deepest first — the candidates a sheet
 *  can draw from even when the projection set has never heard of them. */
export function depthForTeam(team: string): DepthRow[] {
  return byTeam.get((team ?? '').toUpperCase()) ?? [];
}
