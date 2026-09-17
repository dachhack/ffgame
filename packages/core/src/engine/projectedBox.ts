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
import { slugMeta, normTeam, liveTeamFor } from '../data/slugMeta';
import { LIVE_SEASON } from '../data/realPbp';
import { projFor } from '../data/poolSort';
import { injuryFor, type InjuryStatus } from '../data/injuries';

export interface ProjectedRow {
  slug: string;
  pos: Pos;
  team: string;
  /** Projected points, already through the league's scoring. */
  proj: number;
  /** The week's designation, when a week was given — 'Q' or 'D' on a man who
   *  is still expected to play. 'O' and 'IR' never reach a row; they are what
   *  takes a man OFF the sheet. Null with no week, and null for the fit. */
  injury: InjuryStatus | null;
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
    // THE LIVE TEAM, NOT THE BAKE'S (v0.414.0). slugMeta's team comes from
    // BAKED_SLUGS, which is deliberately a player's MAJORITY 2025 team — the
    // baked play stream's possession gating is written against it, so it must
    // stay that way. It is simply the wrong question here, and v0.413.0 asked
    // it: Kenneth Walker signed for KC and was still listed as a Seattle
    // starter, while Rashid Shaheed — an actual Seahawk — was filed under New
    // Orleans and missing from the sheet entirely.
    //
    // liveTeamFor is the answer this file should have used from the start.
    // Its own comment records this same bug being fixed for the app's picker
    // ("we still have Doubs as GB"); it also normalises, which teamFor alone
    // does not — that layer answers LAR where the slate says LA.
    if (liveTeamFor(slug, null, LIVE_SEASON) !== T) continue;
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
export function projectedStarters(team: string, week?: number | null): ProjectedRow[] {
  const T = normTeam(team);
  const valued = candidatesFor(T)
    .map((c) => ({
      ...c, team: T, proj: projFor(c.slug, c.pos),
      injury: week != null ? injuryFor(week, c.slug) : null,
    }))
    .filter((r): r is ProjectedRow => typeof r.proj === 'number' && Number.isFinite(r.proj))
    // A MAN WHO IS OUT IS NOT A PROJECTED STARTER (v0.415.0).
    //
    // Founder, on Seattle's quarterbacks: "Lock is the QB2 but Darnold is hurt
    // and out this week." Exactly right, and it is the case that shows why
    // projection order alone cannot answer this: Darnold outprojects Lock over
    // a season and will score nothing on Sunday. The sheet had him starting.
    //
    // Only 'O' and 'IR' take a man off — they are the unambiguous ones.
    // Questionable and Doubtful stay, carrying their tag, because a
    // questionable starter usually plays and guessing otherwise would swap a
    // real starter out on a coin flip. The manager can see the letter and
    // decide; that is a judgement the screen should not make for him.
    .filter((r) => r.injury !== 'O' && r.injury !== 'IR');
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
export function projectedBox(home: string, away: string, week?: number | null): ProjectedBox {
  return { home: projectedStarters(home, week), away: projectedStarters(away, week) };
}
