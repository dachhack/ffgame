// GENERATED — StatHead 2026 PROJECTED KICKER AND TEAM-DEFENCE LINES.
// Source: Stathead MCP `get_projections` (stathead-mcp 1.0.69, position K and
// DST), as_of 2026-08-19T14:17:42.640Z — the same pull and instant as
// `proj2026.ts` and `projStats2026.ts`.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
// Until now a kicker or a defence projected at **zero**, everywhere. Not
// "unadjusted" — absent: `proj2026.ts` is 445 rows of QB/RB/WR/TE and nothing
// else, so `PROJ_2026.get('den-k')` was undefined and `projectedPoints`
// returned 0 on its first line. The draft board printed a dash, waivers sorted
// every kicker and defence BELOW players the source has never heard of, and
// `slateAwareProj` valued all 32 defences identically, so auto-slot picked one
// in whatever order the roster happened to arrive.
//
// ── OUR JOIN IS BY TEAM, BOTH TIMES ────────────────────────────────────────
// This app does not roster named kickers. `kdstEntries` mints one pseudo-player
// per team per unit — `den-k`, `den-dst` — so a projection has to arrive at a
// TEAM, not a person. Defences come that way already. Kickers do not, so the
// bake joins StatHead's named kicker to his team through their own 2026 roster
// and keys the result to `{code}-k`. All 32 teams resolve, one kicker each, no
// duplicates and no gaps — checked in the generator and again in parity.
//
// One wrinkle worth writing down: StatHead's ROSTER endpoint says `AZ` where
// their PROJECTION endpoint says `ARI`, and our `normTeam` knows neither. The
// generator maps it. Nothing at runtime ever sees `AZ`, because this file
// stores our own codes.
//
// ── WHAT THE NUMBERS ARE, AND WHAT THEY ARE NOT ────────────────────────────
// StatHead were unusually direct about this, and it belongs here rather than in
// a commit message. Backtested 2023–25 against actual points per game, their
// kicker model beats a flat league mean by ~3% on RMSE and their DEFENCE model
// beats it by NOTHING — assuming every defence is league-average scores
// slightly better. Both carry modest ordering signal (r ~ 0.25–0.29). The cause
// is the position, not the modelling: team field-goal attempts are almost
// unforecastable year to year (r = +0.08), kicker accuracy skill is small
// (split-half r = +0.18), and defensive reliability runs +0.30 on points
// allowed, +0.21 sacks, +0.11 interceptions. They shrink each component by its
// own measured reliability, which is why the projected spread is so much
// narrower than the realised one.
//
// SO: USE THESE TO RE-PRICE, NOT TO RANK. The value here is that a league with
// its own kicker or defence scoring finally sees a projection that RESPONDS to
// it — a 50+ field goal worth 6, a points-allowed ladder the commissioner
// rewrote. The ordering is close to a coin flip and we do not present it as a
// ranking. We take it anyway because the alternative was zero, and a narrow
// honest spread beats an arbitrary one: across all 32 defences the projection
// runs about 6.4 down to 5.0 points a game, which is roughly what a board
// SHOULD look like when the signal is this thin.
//
// `fum_rec`, `def_td`, `st_td` and `safety` are league rates — identical for
// every team, because no team-level signal survives ten seasons. They are real
// values rather than placeholders, and they will never differentiate anybody.
//
// ── THE LEVEL IS OURS, NOT THEIRS (and this is deliberate) ─────────────────
// Every other bake in this project stores StatHead's own points. These two
// store only the STAT LINE, and `projScoring.ts` prices it under our default
// catalog to get the level. The reason is concrete: StatHead score a kicker
// 3/3/4/5 by band plus 1 per extra point and apply NO MISS PENALTY (verified —
// their line reproduces their own `projPts` that way to within 0.5 points a
// season across all 32). Our default catalog charges -1 for a missed field goal
// and -1 for a missed extra point, which is 7-8 points a season on a real
// kicker. Storing their total would have meant a "standard" league whose
// projection did not equal the standard scoring of its own components, breaking
// the reconciliation the whole subsystem rests on. Pricing the line ourselves
// makes it exact by construction.
//
// REFRESH alongside proj2026.ts, from the same pull:
//   get_projections { position: 'K',   limit: 40, output_format: 'csv',
//     fields: 'name,projPts,fga,fgm,fga_0-29,fgm_0-29,fga_30-39,fgm_30-39,fga_40-49,fgm_40-49,fga_50+,fgm_50+,xpa,xpm' }
//   get_projections { position: 'DST', limit: 40, output_format: 'csv',
//     fields: 'name,projPts,pts_allow_pg,sack,def_int,fum_rec,def_td,st_td,safety' }
//   get_rosters     { season: 2026, position: 'K', fields: 'player_name,team' }
// The band field names carry a literal '+' and hyphens (`fga_50+`, `fga_0-29`);
// nothing else is accepted and an unknown name is dropped SILENTLY, so check
// the response actually contains the columns before baking it.

/** A season's projected kicking, in the bands a catalog can price. Attempts
 *  come along because a MISS is a scored event in most catalogs, and
 *  attempts - makes is the only way to count one. */
export interface ProjKickLine {
  fga0: number; fgm0: number;      // 0-29 yards
  fga30: number; fgm30: number;    // 30-39
  fga40: number; fgm40: number;    // 40-49
  fga50: number; fgm50: number;    // 50+
  xpa: number; xpm: number;
}

/** A season's projected team defence. `paPg` is points allowed PER GAME, and
 *  it is emphatically not to be scored at its own value — see
 *  `integratedPaPoints` in projScoring.ts for why, and by how much. */
export interface ProjDstLine {
  paPg: number; sack: number; int: number; fumRec: number;
  defTd: number; stTd: number; safety: number;
}

/** slug,fga0,fgm0,fga30,fgm30,fga40,fgm40,fga50,fgm50,xpa,xpm */
const KICK_CSV = `ari-k,7.60,7.30,9.60,8.80,9.80,7.70,7.20,4.80,40.30,38.10
atl-k,7.70,7.60,9.70,9.30,9.90,8.10,7.30,5.10,40.80,38.60
bal-k,7.60,7.40,9.60,9,9.80,7.80,7.30,4.90,39.70,37.50
buf-k,7.20,7,9.20,8.50,9.40,7.40,6.90,4.60,44.70,42.20
car-k,7.10,7,9,8.40,9.20,7.30,6.80,4.60,36.70,34.60
chi-k,7.50,7.40,9.60,9,9.80,7.90,7.20,5,43.20,40.80
cin-k,7.50,7.30,9.50,8.90,9.70,7.70,7.20,4.90,41.60,39.30
cle-k,7.10,6.90,8.90,8.40,9.10,7.30,6.70,4.60,35.30,33.40
dal-k,8.20,8.10,10.40,9.80,10.70,8.60,7.90,5.40,43.60,41.20
den-k,7.60,7.40,9.60,8.90,9.80,7.80,7.20,4.90,39.60,37.50
det-k,7.50,7.40,9.50,8.90,9.70,7.80,7.20,4.90,45.50,43
gb-k,7.40,7.20,9.40,8.70,9.60,7.60,7.10,4.80,41.80,39.50
hou-k,8.50,8.40,10.70,10.10,11,8.80,8.10,5.60,41,38.80
ind-k,7.80,7.60,9.90,9.20,10.10,8,7.50,5,42.40,40.10
jax-k,7.50,7.50,9.60,9,9.80,7.90,7.20,5,42.50,40.20
kc-k,7.70,7.60,9.80,9.10,10,8,7.40,5,39.30,37.20
la-k,7.40,7.30,9.40,8.80,9.60,7.70,7.10,4.80,45.50,43
lac-k,7.90,7.90,10.10,9.50,10.30,8.30,7.60,5.30,39.80,37.60
lv-k,7.60,7.40,9.60,8.90,9.80,7.70,7.20,4.90,33.40,31.60
mia-k,7.70,7.50,9.70,9.10,9.90,7.90,7.30,5,39.10,36.90
min-k,8,7.90,10.20,9.60,10.40,8.40,7.70,5.30,38.30,36.20
ne-k,7.40,7.10,9.30,8.60,9.50,7.50,7,4.70,41.50,39.20
no-k,7.70,7.50,9.80,9.10,10,8,7.40,5,34,32.10
nyg-k,7,6.90,8.90,8.30,9.10,7.20,6.70,4.60,37.70,35.60
nyj-k,7.40,7.30,9.40,8.80,9.60,7.70,7.10,4.90,35.40,33.50
phi-k,7.30,7.20,9.30,8.60,9.50,7.50,7,4.70,39.60,37.50
pit-k,7.80,7.70,9.90,9.30,10.10,8.20,7.40,5.20,40.60,38.40
sea-k,8.10,7.90,10.20,9.60,10.50,8.40,7.70,5.30,44.70,42.20
sf-k,7.70,7.60,9.70,9.20,10,8,7.30,5.10,43.50,41.10
tb-k,7.80,7.70,9.90,9.30,10.10,8.10,7.40,5.10,40.10,37.90
ten-k,7.50,7.30,9.50,8.80,9.70,7.70,7.20,4.80,36.60,34.60
was-k,7.50,7.40,9.60,8.90,9.80,7.80,7.20,4.90,40.90,38.60`;

/** slug,paPg,sack,int,fumRec,defTd,stTd,safety */
const DST_CSV = `ari-dst,24.35,39.20,11.70,7.70,0.87,0.85,0.37
atl-dst,23.21,42.20,12.30,7.70,0.87,0.85,0.37
bal-dst,22.76,40,11.90,7.70,0.87,0.85,0.37
buf-dst,22.40,39.40,12.20,7.70,0.87,0.85,0.37
car-dst,23.74,38.40,12.10,7.70,0.87,0.85,0.37
chi-dst,23.24,39.90,12.60,7.70,0.87,0.85,0.37
cin-dst,24.43,39.50,12.20,7.70,0.87,0.85,0.37
cle-dst,22.89,42.40,11.60,7.70,0.87,0.85,0.37
dal-dst,25.30,40.60,11.60,7.70,0.87,0.85,0.37
den-dst,21.29,45.90,12,7.70,0.87,0.85,0.37
det-dst,22.87,41.40,12.20,7.70,0.87,0.85,0.37
gb-dst,22.28,40.10,11.90,7.70,0.87,0.85,0.37
hou-dst,21.61,42.60,12.80,7.70,0.87,0.85,0.37
ind-dst,23.35,40.10,12.30,7.70,0.87,0.85,0.37
jax-dst,22.48,38.80,12.40,7.70,0.87,0.85,0.37
kc-dst,21.69,40,11.80,7.70,0.87,0.85,0.37
la-dst,22.45,41.70,12.40,7.70,0.87,0.85,0.37
lac-dst,21.60,41.90,12.60,7.70,0.87,0.85,0.37
lv-dst,23.78,39.90,11.60,7.70,0.87,0.85,0.37
mia-dst,23.39,40,11.70,7.70,0.87,0.85,0.37
min-dst,22.02,42.30,12.10,7.70,0.87,0.85,0.37
ne-dst,22.21,39.50,11.80,7.70,0.87,0.85,0.37
no-dst,22.85,41.10,11.90,7.70,0.87,0.85,0.37
nyg-dst,23.92,40.70,11.50,7.70,0.87,0.85,0.37
nyj-dst,24.64,38.70,10.90,7.70,0.87,0.85,0.37
phi-dst,21.63,41,12.20,7.70,0.87,0.85,0.37
pit-dst,22.49,41.50,12.40,7.70,0.87,0.85,0.37
sea-dst,21.64,41.90,12.50,7.70,0.87,0.85,0.37
sf-dst,23.08,37.60,11.50,7.70,0.87,0.85,0.37
tb-dst,23.16,40.40,11.90,7.70,0.87,0.85,0.37
ten-dst,24.62,40.20,11.50,7.70,0.87,0.85,0.37
was-dst,23.93,40.80,11.60,7.70,0.87,0.85,0.37`;

const num = (c: string[], i: number): number => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };

/** Engine slug (`{code}-k`) → projected season kicking line. */
export const PROJ_KICK: Record<string, ProjKickLine> = {};
for (const line of KICK_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 11) continue;
  PROJ_KICK[c[0].trim()] = {
    fga0: num(c, 1), fgm0: num(c, 2),
    fga30: num(c, 3), fgm30: num(c, 4),
    fga40: num(c, 5), fgm40: num(c, 6),
    fga50: num(c, 7), fgm50: num(c, 8),
    xpa: num(c, 9), xpm: num(c, 10),
  };
}

/** Engine slug (`{code}-dst`) → projected season team-defence line. */
export const PROJ_DST: Record<string, ProjDstLine> = {};
for (const line of DST_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 8) continue;
  PROJ_DST[c[0].trim()] = {
    paPg: num(c, 1), sack: num(c, 2), int: num(c, 3), fumRec: num(c, 4),
    defTd: num(c, 5), stTd: num(c, 6), safety: num(c, 7),
  };
}
