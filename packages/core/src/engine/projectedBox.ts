// THE BOX SCORE BEFORE ANYONE HAS PLAYED (v0.413.0).
//
// Founder: "on a non-existing feed, just open the fields with a kick off time
// and no data. The box score can contain projected starters and fantasy
// projections until kick off."
//
// gameBoxScore accumulates from PLAYS, so before kickoff it is empty and has
// nothing honest to say. This is the other half: who is expected to start, and
// what the league's own scoring projects them for. It is a PROJECTION and the
// screens that render it say so — it never claims to be a stat line.
//
// WHERE THE DEPTH CHART COMES FROM: there isn't one. We have a per-player
// projection and a player→team map, and "the highest-projected quarterback on
// this roster" is a serviceable stand-in for QB1 precisely because the
// projection already folds in the job — a backup projects like a backup. It is
// not a depth chart and this file does not pretend otherwise; a starter who is
// projected below his backup will be listed second, and that is the honest
// consequence of deriving depth from value.
//
// THE NUMBER IS THE LEAGUE'S. projFor runs the projection through whatever
// scoring catalog the screen installed, so a TE-premium league's tight ends
// project like TE-premium tight ends here, exactly as they do in the pool and
// on the lineup rows. Nothing is baked in twice.
import type { Pos } from '../types';
import { PROJ_2026 } from '../data/proj2026';
import { slugMeta, normTeam } from '../data/slugMeta';
import { projFor } from '../data/poolSort';

export interface ProjectedRow {
  slug: string;
  pos: Pos;
  team: string;
  /** Projected points, already through the league's scoring. */
  proj: number;
}
export interface ProjectedBox { home: ProjectedRow[]; away: ProjectedRow[] }

/** How many of each the sheet lists, in the order it lists them — one starting
 *  lineup's worth, plus the flex depth a manager is actually choosing between.
 *  Deliberately not "everyone with a projection": a box score of fifty-three
 *  names is a roster, not a lineup. */
const DEPTH: [Pos, number][] = [['QB', 1], ['RB', 2], ['WR', 3], ['TE', 1], ['K', 1], ['DEF', 1]];

/** Every skill player the projection set files under a team, plus that team's
 *  two units. The units are synthesised rather than looked up because they are
 *  team-keyed by construction (`sea-k`, `sea-dst`) and live in a different bake
 *  from the skill positions — which is exactly why projFor, not PROJ_2026, is
 *  what values them. */
function candidatesFor(team: string): { slug: string; pos: Pos }[] {
  const T = normTeam(team);
  if (!T) return [];
  const out: { slug: string; pos: Pos }[] = [];
  for (const slug of PROJ_2026.keys()) {
    const m = slugMeta(slug);
    if (normTeam(m.team) !== T) continue;
    out.push({ slug, pos: m.pos });
  }
  const lower = T.toLowerCase();
  out.push({ slug: `${lower}-k`, pos: 'K' }, { slug: `${lower}-dst`, pos: 'DEF' });
  return out;
}

/** One team's projected starters, deepest position group first in DEPTH order.
 *
 *  A position the projection set cannot value at all contributes nothing —
 *  a row reading "—" is worse than no row, and a zero would be a claim. */
export function projectedStarters(team: string): ProjectedRow[] {
  const T = normTeam(team);
  const valued = candidatesFor(T)
    .map((c) => ({ ...c, team: T, proj: projFor(c.slug, c.pos) }))
    .filter((r): r is ProjectedRow => typeof r.proj === 'number' && Number.isFinite(r.proj));
  const out: ProjectedRow[] = [];
  for (const [pos, n] of DEPTH) {
    out.push(...valued.filter((r) => r.pos === pos).sort((a, b) => b.proj - a.proj).slice(0, n));
  }
  return out;
}

/** Both sides of a game that has not kicked off. Teams arrive in whichever
 *  vocabulary the caller has (the feed's LAR/WSH or the slate's LA/WAS), so
 *  both go through normTeam — the same fix gameBoxScore carries, for the same
 *  reason. */
export function projectedBox(home: string, away: string): ProjectedBox {
  return { home: projectedStarters(home), away: projectedStarters(away) };
}
