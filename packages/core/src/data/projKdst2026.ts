// GENERATED — StatHead 2026 PROJECTED KICKER AND TEAM-DEFENCE LINES.
// Source: Stathead MCP `get_projections` (stathead-mcp 1.0.70, position K and
// DST), as_of 2026-08-19T20:12:09.434Z.
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
// `fum_rec`, `def_td`, `st_td` and `safety` are league rates: StatHead publish
// one number for all 32 teams, because no team-level signal survives ten
// seasons. They vary slightly here only because the schedule factor below
// scales every component, not because anyone thinks Denver recovers more
// fumbles than Dallas.
//
// ── SCHEDULE STRENGTH IS ALREADY IN THESE NUMBERS (1.0.70) ─────────────────
// StatHead now apply per-team, per-position 2026 schedule difficulty to the K
// and DST season lines before serving them. **DO NOT re-apply it** from their
// `get_schedule_strength` tool — the factors are published as data AND baked
// into these two positions, and multiplying again double-counts. They are
// deliberately NOT applied to QB/RB/WR/TE, whose weekly matchup multipliers
// normalise to mean 1 and so move points between weeks without moving a season
// total. We have not applied them to the skill positions either: StatHead say
// plainly they cannot backtest a skill-position schedule adjustment (they keep
// no historical projection-base snapshots to test against), and an unbacktested
// multiplier on 445 players is exactly the kind of guess this project refuses.
// The cost is an acknowledged asymmetry — a defence's easy slate is in its
// projection, a receiver's is not — and that is the honest side of the trade.
//
// IT ROUGHLY DOUBLED THE SPREAD. Before the schedule was applied the whole
// 32-team defence board ran 6.4 to 5.0 points a game; it now runs 7.0 (DEN) to
// 4.5 (DAL). Worth knowing when reading the accuracy note above, because the
// RMSE figures StatHead quote were measured BEFORE this was applied — a wider
// spread makes the board look more decisive without anything yet showing it
// forecasts better. If anything that sharpens the rule rather than softening
// it: re-price with these, don't rank on them.
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
// The kicker pull carries no `team`, which is why the roster call is in the
// list: our pool rosters TEAM units, so a named kicker has to be resolved to
// one. Re-check the mapping on every refresh — a team changing its starting
// kicker moves the whole line.
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
const KICK_CSV = `ari-k,7.60,7.30,9.60,8.80,9.80,7.70,7.20,4.80,40.20,38
atl-k,7.70,7.70,9.80,9.30,10,8.20,7.40,5.20,41,38.70
bal-k,7.50,7.40,9.50,8.90,9.80,7.80,7.20,4.90,39.30,37.10
buf-k,7.20,7,9.10,8.40,9.30,7.30,6.90,4.60,44.20,41.80
car-k,7.20,7,9.10,8.50,9.30,7.40,6.90,4.60,37,34.90
chi-k,7.50,7.40,9.50,9,9.80,7.80,7.20,4.90,43.10,40.70
cin-k,7.50,7.40,9.50,8.90,9.70,7.80,7.20,4.90,41.70,39.50
cle-k,7.20,7.10,9.10,8.50,9.30,7.50,6.90,4.70,35.90,33.90
dal-k,8.20,8.10,10.40,9.80,10.60,8.60,7.80,5.40,43.40,41
den-k,7.50,7.30,9.50,8.80,9.70,7.70,7.10,4.90,39.10,37
det-k,7.60,7.50,9.60,9,9.90,7.90,7.30,5,46,43.50
gb-k,7.30,7.20,9.30,8.70,9.50,7.60,7,4.80,41.50,39.20
hou-k,8.60,8.50,10.90,10.20,11.10,9,8.20,5.70,41.60,39.30
ind-k,7.60,7.40,9.70,9,9.90,7.80,7.30,4.90,41.50,39.20
jax-k,7.50,7.50,9.60,9,9.80,7.90,7.20,5,42.50,40.20
kc-k,7.70,7.60,9.80,9.20,10,8,7.40,5.10,39.50,37.40
la-k,7.40,7.30,9.40,8.80,9.60,7.70,7.10,4.80,45.50,43
lac-k,7.80,7.80,10,9.40,10.20,8.20,7.50,5.20,39.40,37.20
lv-k,7.50,7.30,9.60,8.90,9.80,7.70,7.20,4.90,33.30,31.50
mia-k,7.70,7.50,9.70,9.10,9.90,7.90,7.30,5,39.10,36.90
min-k,8,7.90,10.10,9.60,10.40,8.40,7.60,5.30,38.20,36.10
ne-k,7.30,7.10,9.30,8.60,9.50,7.50,7,4.70,41.20,38.90
no-k,7.80,7.70,9.90,9.30,10.20,8.10,7.50,5.10,34.60,32.70
nyg-k,7,6.90,8.90,8.30,9.10,7.20,6.70,4.60,37.70,35.60
nyj-k,7.30,7.20,9.30,8.70,9.50,7.60,7,4.80,35.10,33.20
phi-k,7.30,7.10,9.30,8.60,9.50,7.50,7,4.70,39.50,37.40
pit-k,7.70,7.70,9.80,9.30,10,8.10,7.40,5.10,40.40,38.10
sea-k,8.10,7.90,10.20,9.60,10.40,8.40,7.70,5.30,44.60,42.20
sf-k,7.80,7.70,9.90,9.30,10.10,8.10,7.40,5.10,44.10,41.70
tb-k,7.90,7.80,10.10,9.50,10.30,8.30,7.60,5.20,40.80,38.50
ten-k,7.50,7.30,9.50,8.80,9.70,7.70,7.10,4.80,36.50,34.50
was-k,7.60,7.40,9.60,8.90,9.80,7.80,7.20,4.90,41,38.70`;

/** slug,paPg,sack,int,fumRec,defTd,stTd,safety */
const DST_CSV = `ari-dst,25.21,37.70,11.30,7.40,0.83,0.82,0.36
atl-dst,22.73,43.40,12.60,7.90,0.89,0.87,0.38
bal-dst,22.48,40.70,12.10,7.80,0.88,0.86,0.38
buf-dst,21.72,40.80,12.70,8,0.90,0.88,0.39
car-dst,24.41,37.50,11.80,7.50,0.85,0.83,0.36
chi-dst,23.38,39.50,12.50,7.60,0.86,0.84,0.37
cin-dst,23.83,40.90,12.60,8,0.90,0.88,0.39
cle-dst,22.41,43.70,12,7.90,0.89,0.88,0.39
dal-dst,26.69,38.30,10.90,7.20,0.82,0.80,0.35
den-dst,20.08,48.80,12.70,8.20,0.92,0.90,0.40
det-dst,22.17,42.90,12.60,8,0.90,0.88,0.39
gb-dst,22.79,39,11.60,7.50,0.84,0.83,0.36
hou-dst,21.97,41.80,12.50,7.50,0.85,0.83,0.37
ind-dst,22.77,41.40,12.70,7.90,0.90,0.88,0.39
jax-dst,23.28,37.60,12,7.40,0.84,0.82,0.36
kc-dst,21.09,41.10,12.20,7.90,0.89,0.87,0.38
la-dst,22.68,41,12.20,7.60,0.85,0.84,0.37
lac-dst,21.17,42.90,12.90,7.90,0.89,0.87,0.38
lv-dst,22.96,41.50,12.10,8,0.90,0.88,0.39
mia-dst,22.95,40.50,11.80,7.80,0.88,0.86,0.38
min-dst,23.25,39.70,11.30,7.20,0.81,0.80,0.35
ne-dst,21.61,40.60,12.10,7.90,0.89,0.87,0.38
no-dst,22.23,42.40,12.30,7.90,0.89,0.88,0.39
nyg-dst,25.08,38.60,10.90,7.30,0.82,0.81,0.36
nyj-dst,23.45,40.70,11.50,8.10,0.91,0.89,0.39
phi-dst,23.04,38.20,11.40,7.20,0.81,0.79,0.35
pit-dst,22.29,42.20,12.60,7.80,0.88,0.86,0.38
sea-dst,22.02,40.90,12.10,7.50,0.85,0.83,0.36
sf-dst,23.16,37.30,11.40,7.60,0.86,0.84,0.37
tb-dst,23.33,40.20,11.80,7.60,0.86,0.85,0.37
ten-dst,24.88,39.90,11.40,7.60,0.86,0.84,0.37
was-dst,25.19,38.60,11,7.30,0.82,0.80,0.35`;

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
