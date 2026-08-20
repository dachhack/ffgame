// GENERATED — StatHead 2026 PROJECTED FULLBACK LINES. Source: Stathead MCP
// `get_projections` (stathead-mcp 1.0.84, position FB), as_of
// 2026-08-19T23:00:03Z.
//
// ── FIVE ROWS OUT OF FIFTEEN, ON PURPOSE ───────────────────────────────────
// StatHead serve 15 fullbacks. **Ten of them are byte-identical** — 8.30 games,
// 8.50 projPts, the same rushing and receiving line to two decimal places —
// because they are the positional mean stamped on every fullback the model has
// nothing specific to say about. On a draft board those ten would each render
// as a distinct projection of a distinct player, which is false precision of
// the worst kind: it looks like knowledge.
//
// So this file carries only the five with a real, separated projection:
// Juszczyk, Ingold, Burton, Beck and Prentice. The other ten project nothing,
// which is the same answer this project gives everywhere else when the source
// has no opinion.
//
// THE CONTRAST WITH THE FILLED PUNTERS is deliberate and worth keeping. We DID
// fill Chicago's and Denver's punters with a league-mean line, because
// `chi-p` is a TEAM SLOT — Chicago will punt about sixty times whoever does it,
// so a zero would be the wrong claim. A fullback is a PERSON. There is no
// "Seattle's fullback" slot that must be filled; Robbie Ouzts either produces
// or he doesn't, and the league mean is not evidence that he will.
//
// ── THE POSITION IS DYING, AND THE NUMBERS SHOULD LOOK LIKE IT ─────────────
// StatHead were blunt and it belongs here: 22 fullbacks took a snap in 2016,
// SIX in 2025, and the whole position scored 153 PPR points last season.
// Juszczyk is the best of them at 46.2 for the SEASON — about 2.7 a week — and
// he is projected under his own 2025 actual of 57.0. These are small numbers
// by nature, not a modelling failure. Their production does persist (PPR/gm
// year-over-year r = +0.68, 27% better than the positional mean), so the
// numbers are honest; there is just not much of it.
//
// ── WHY THEY WERE MISSING UNTIL NOW ────────────────────────────────────────
// Not the position filter we assumed. nflverse labels fullbacks
// `position=RB` with `depth_chart_position=FB`, they are absent from
// StatHead's depth-order model, and the pool keeps four backs a team — so they
// were squeezed out before ever being considered. (Our own `PLAYER_BIO` shows
// the same seam: it has Andrew Beck as an RB. Harmless here, because this file
// keys by slug and scores from the line rather than trusting a position label.)
//
// ── HOW THEY SCORE ─────────────────────────────────────────────────────────
// Exactly like a running back's rushing and receiving, which is what the live
// scorer already does: `classicScorePlay` sends a fullback down the skill
// branch, and the reception premium there is `pos === 'TE' ? teRec : pos ===
// 'RB' ? rbRec : pos === 'WR' ? wrRec : 0` — so an FB earns plain `ppr` and no
// positional bonus. We price with `pos: 'FB'` for that reason, and the two
// sides agree by construction rather than by coincidence.
//
// The BASE is derived from the line under our own default catalog, like the
// kicker and defence bakes, so a standard league's projection equals the
// standard scoring of its own components. Checked: all five reproduce
// StatHead's served `projPts` to within 0.08 points a SEASON.
//
// REFRESH alongside proj2026.ts:
//   get_projections { position: 'FB', limit: 20, output_format: 'csv',
//     fields: 'name,team,games,projPts,rush_att,rush_yd,rush_td,tgt,rec,rec_yd,rec_td' }
// Keep only rows whose line DIFFERS from the others. If a sixth fullback ever
// separates from the pack, add him; if the identical block grows, it means the
// model has less to say, not more.
import { normName } from './players';
import type { ProjStatLine } from './projStats2026';

/** slug-source name,rushYd,rushTd,rec,recYd,recTd */
const FB_CSV = `Kyle Juszczyk,14.50,0.63,16.70,154,1.47
Alec Ingold,10.30,0.47,9.20,72.20,0.36
Michael Burton,12.40,0.61,6.20,42.20,0.51
Andrew Beck,5.40,0.30,5.10,37.90,0.92
Adam Prentice,17,0.21,4.10,31.40,0.20`;

/** Engine slug → projected season line, in the same shape as every other skill
 *  player's. Passing is always zero — a fullback who throws is a trick play,
 *  not a projection. */
export const PROJ_FB: Record<string, ProjStatLine> = {};
for (const line of FB_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 6) continue;
  const slug = normName(c[0]).replace(/\s+/g, '-');
  if (!slug || PROJ_FB[slug]) continue;
  const n = (i: number) => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };
  PROJ_FB[slug] = {
    passYd: 0, passTd: 0, int: 0,
    rushYd: n(1), rushTd: n(2),
    rec: n(3), recYd: n(4), recTd: n(5),
  };
}
