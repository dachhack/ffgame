// GENERATED — StatHead 2026 PROJECTED RETURN LINES. Source: Stathead MCP
// `get_projections` (stathead-mcp 1.0.74), as_of 2026-08-19T23:00:03.171Z.
//
// ── WHAT THIS UNBLOCKS ─────────────────────────────────────────────────────
// v0.311.2 made a RETURN-ONLY spot project ZERO, deliberately: `RET` is a slot
// identity rather than a position, a player scored there banks return
// production ONLY, and we had no return projection of any kind — so showing his
// rushing and receiving line was worse than showing nothing. This is the data
// that was missing. The spot can now be priced like every other one.
//
// ── THE JOIN IS CLEAN, AND THAT IS NOT LUCK ────────────────────────────────
// 105 returners, 105 distinct slugs, ZERO collisions, and every one already
// present in `proj2026.ts`. That holds because a RET spot accepts RB/WR/TE/FB
// only (`slotEligiblePos`), so this file never has to name a defender —
// StatHead merge return roles onto defensive backs too, and the defensive pool
// is where our name-keyed identity breaks down (three live collisions there:
// two Byron Youngs, two Byron Murphys, two Jaylon Joneses). Restricting this
// bake to the positions a RET spot can actually hold sidesteps that entirely.
// If a future spot type accepts DBs, this file cannot simply be widened —
// fix the identity model first.
//
// ── WHAT THE NUMBERS ARE ───────────────────────────────────────────────────
// Punt-return yards, kick-return yards and return touchdowns, as season totals
// already scaled to each player's own projected games. We keep the two yardage
// buckets SEPARATE because the catalog prices them separately: `retYd` pays on
// any return yard, and `krYd` / `prYd` stack an extra rate on top by kind. A
// single combined figure could not serve a league that pays more for punt
// returns than kick returns, which is a real configuration.
//
// StatHead's own caveats, worth keeping because they are not obvious:
//   • KICKOFF VOLUME HAS BEEN REWRITTEN BY RULE, TWICE. Returns per team-game
//     went 1.08 (2023) → 1.69 (2024) → 3.82 (2025), so any multi-year average
//     is wrong by a factor of two. Their rates come from 2025 alone. We would
//     have got this wrong on our own.
//   • RETURN JOBS TURN OVER — only 47% of players with 8+ returns repeat — so
//     volume is anchored on the current depth chart rather than last year's
//     usage.
//   • RETURN AVERAGE IS MOSTLY LEAGUE RATE (punt yards-per-return year-over-year
//     r=0.17, kick 0.40) and return TDs are the league rate per return for
//     everyone. So the yardage differentiates by ROLE and volume, not by skill,
//     and the touchdown column differentiates by nothing at all.
//
// UNDER THE DEFAULT CATALOG A RETURN SPOT IS STILL WORTH ALMOST NOTHING, and
// that is correct rather than a bug: `retYd`, `krYd` and `prYd` all default to
// 0, so only `retTd` (6) scores. The best returner here projects about a
// quarter of a point a week under stock rules — which is exactly what the LIVE
// scorer would pay him. The point of this file is that a league which turns the
// yardage knobs on now sees a projection that responds.
//
// REFRESH alongside proj2026.ts, from the same pull:
//   get_projections { limit: 1000, output_format: 'csv', sort_by: 'ret_yd',
//     fields: 'name,position,games,pr,pr_yd,kr,kr_yd,ret_yd,ret_td,pr_role,kr_role' }
// `sort_by: 'ret_yd'` IS LOAD-BEARING: the tool projects columns from the FIRST
// ROW of the result set and applies that shape to every row, so a bulk pull
// sorted by ppg starts with a non-returner and silently drops every return
// column — for everyone, in csv and jsonl alike. Sorting a returner to the top
// is what makes the fields appear at all. Verify the response actually contains
// `pr_yd` before baking it.
import { normName } from './players';

/** A season's projected return production, in the buckets a catalog prices. */
export interface ProjReturnLine {
  /** Punt-return yards. Pays `retYd + prYd`. */
  prYd: number;
  /** Kick-return yards. Pays `retYd + krYd`. */
  krYd: number;
  /** Return touchdowns — fractional on purpose, and a league rate for everyone. */
  retTd: number;
}

/** slug,prYd,krYd,retTd */
const RETURN_CSV = `ameer-abdullah,32.60,261.80,0.13
anthony-gould,157.70,628.30,0.39
ashton-dulin,16.40,258.20,0.10
austin-trammell,65.60,96.40,0.10
bam-knight,16.40,234.60,0.11
bhayshul-tuten,17.50,620.90,0.24
blake-corum,19.90,248.90,0.11
brashard-smith,57.30,346.50,0.18
brian-robinson,19.90,191.30,0.09
britain-covey,161.60,107.90,0.20
bucky-irving,17.50,123.90,0.06
charlie-jones,194.40,762.20,0.47
chase-brown,19.90,135.80,0.07
chimere-dike,251.90,1230.10,0.68
chris-collier,16.40,450,0.19
christian-kirk,21.10,74.60,0.05
chuba-hubbard,17.50,142.70,0.07
dameon-pierce,10.50,138.80,0.06
demario-douglas,29.60,91.80,0.07
derius-davis,165.80,531.60,0.35
devin-duvernay,228.10,767.40,0.51
devin-neal,14,197.40,0.09
devin-singletary,19.90,180,0.09
dylan-laube,19.90,509.50,0.21
dylan-sampson,17.50,283.40,0.13
emanuel-wilson,19.90,168.50,0.08
emari-demercado,16.40,118.70,0.06
eric-gray,17.60,147.90,0.07
gary-brightwell,9.40,168.20,0.08
george-holani,14,282.60,0.12
greg-dortch,186.90,330.70,0.31
gunner-olszewski,162.60,329.80,0.28
isaiah-davis,18.70,247.70,0.11
isaiah-williams,243.50,428.10,0.38
isiah-pacheco,16.40,121.80,0.06
jacob-cowing,223,93.20,0.26
jacob-saylors,15.20,843.10,0.32
jahan-dotson,31.50,86.10,0.06
jalen-tolbert,17.60,113.70,0.06
jayden-reed,47.60,51.70,0.07
jaylen-warren,18.70,172.60,0.08
jaylin-lane,227.40,127.50,0.26
jaylin-noel,276.40,800.70,0.56
jerome-ford,16.40,254.20,0.11
john-metchie,16.40,134.70,0.07
jordan-whittington,17.50,582.40,0.23
josh-downs,82.90,97.40,0.12
justice-hill,14,151.90,0.07
kaden-wetjen,172.90,670.20,0.42
kaleb-johnson,14,201,0.09
kalif-raymond,263.40,130.10,0.30
kameron-johnson,228.70,415.30,0.37
kavontae-turpin,154,900,0.48
keaton-mitchell,16.40,350.60,0.14
kendre-miller,12.90,281.80,0.12
kene-nwangwu,14,611.40,0.24
kenneth-gainwell,16.40,499.40,0.21
khalil-shakir,124,106.20,0.17
kimani-vidal,16.40,163,0.08
kyle-williams,17.50,506.10,0.21
kyren-williams,30.80,100.50,0.07
ladd-mcconkey,37.40,91.80,0.07
lequint-allen,18.70,418.10,0.17
luke-mccaffrey,14,610.10,0.23
luther-burden,17.50,196.20,0.09
malachi-corley,16.40,565.70,0.23
malik-washington,209.40,811.40,0.50
marvin-mims,247.80,573.20,0.43
matthew-golden,57.60,86.10,0.09
mecole-hardman,77,79.80,0.11
myles-price,261.30,1144.30,0.68
nikko-remigio,236.10,771.50,0.53
olamide-zaccheaus,48.90,88.70,0.08
parker-washington,209,143.40,0.24
pierre-strong,16.40,201.50,0.09
rachaad-white,19.90,108.50,0.06
rasheen-ali,17.50,706.50,0.28
rashid-shaheed,242.80,602.50,0.45
ray-davis,19.90,709.20,0.28
rico-dowdle,19.90,156.60,0.08
rj-harvey,19.90,299.90,0.14
romeo-doubs,58.20,95.20,0.10
ronnie-rivers,11.70,223.70,0.10
samaje-perine,17.50,201.50,0.09
savion-williams,16.40,524.20,0.21
sean-tucker,19.90,375.20,0.16
skyy-moore,186,681.40,0.44
tahj-brooks,16.40,238.80,0.11
tank-bigsby,17.50,187.70,0.09
tank-dell,77.30,92.40,0.11
tory-horton,162.80,63.10,0.17
tre-tucker,114.40,397.60,0.26
treveyon-henderson,19.90,221.50,0.10
trevor-etienne,197.40,787.60,0.50
trey-palmer,71.30,87.90,0.11
ty-johnson,19.90,205.90,0.10
tyjae-spears,16.40,142.10,0.07
tyler-badie,18.70,301.60,0.13
tyler-goodson,14,129.60,0.06
tyquan-thornton,16.40,244.60,0.11
tyrone-tracy,17.50,141.50,0.07
will-shipley,17.50,655.20,0.26
xavier-smith,220.80,233.10,0.31
zachariah-branch,172.90,670.20,0.42
zavion-thomas,43.30,670.20,0.29`;

/** Engine slug → projected season return line. Same `normName` slug as
 *  `proj2026.ts`, verified 1:1 with no collisions across all 105 rows. */
export const PROJ_RETURN: Record<string, ProjReturnLine> = {};
for (const line of RETURN_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 4) continue;
  const slug = normName(c[0]).replace(/\s+/g, '-');
  if (!slug || PROJ_RETURN[slug]) continue;
  const n = (i: number) => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };
  PROJ_RETURN[slug] = { prYd: n(1), krYd: n(2), retTd: n(3) };
}
