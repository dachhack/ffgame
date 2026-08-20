// GENERATED — StatHead 2026 PROJECTED HEAD-COACH AND PUNTER LINES.
// Source: Stathead MCP `get_projections` (stathead-mcp 1.0.84, position HC and
// P), as_of 2026-08-19T23:00:03Z / 2026-08-20T01:49Z.
//
// ── THE LAST TWO POSITIONS THAT PROJECTED NOTHING ──────────────────────────
// Our pool has minted `{team}-hc` and `{team}-p` pseudo-players since 0171 and
// the live scorer has always priced them, but no projection existed for either,
// so a builder league running a coach or punter spot saw a dash. This is that
// data. StatHead built it to the shape we asked for, including the part that
// matters most:
//
// NO POINTS SCALAR, ON PURPOSE. Both positions come back with `ppg` and
// `projPts` null or absent, because there is no standard coach or punter
// scoring anywhere in fantasy — EVERY knob in our own catalog for these two
// defaults to 0. A points total would have been priced under rules nobody uses.
// So unlike every other bake in this project, these files carry components
// only, and `projScoring.ts` prices them under the league's OWN catalog
// directly rather than as a ratio against a standard that does not exist.
//
// A consequence worth stating plainly: under the default catalog a coach and a
// punter both project EXACTLY ZERO, and that is correct rather than a gap. They
// are worth nothing until a commissioner decides what they are worth.
//
// ── THE MARGIN LADDER, AND WHY WE INTEGRATE IT OURSELVES ───────────────────
// Our head-coach scoring pays a win, then a bonus by margin bracket (|m| ≤4,
// ≤9, ≤14, ≤19, ≤24, 25+), and the same on the losing side. StatHead publish
// per-bracket expected game counts, and also `margin_pg` with a per-game
// `margin_game_sd` of 12.71 — the same (mean, sd) shape as the points-allowed
// integral we already run for defences.
//
// WE USE THEIR TOTALS AND OUR OWN SHAPE, because a check said to. Integrating a
// plain normal over integer margins reproduces their win and loss counts
// closely (McVay: 9.98 against their 10.3, 6.51 against 6.6) but puts **0.52
// games at exactly zero against their 0.06** — an eight-fold overstatement of
// ties. An NFL margin distribution is not normal: overtime resolves most zeros,
// and threes and sevens dominate the middle. So the win/loss/tie TOTALS come
// from StatHead, where they are market-derived and calibrated, and the normal
// supplies only the SHAPE within each side — the share of wins that are close
// against comfortable. That way the totals can never drift from the numbers
// they published, and the brackets are our own ladder rather than a guess at
// whether their buckets line up with it.
//
// ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
// • THE PUNT-AVERAGE LADDER. Our `pta44`…`pta33` knobs are a WEEK-TOTAL fact —
//   the ladder pays on a week's average, not a season's. StatHead ship
//   `punt_avg` as a season figure and no per-game spread for it, and their own
//   note says it outright: "a season average cannot be scored against a weekly
//   rung." So we price punts and punt yards, and a league that has set only the
//   average ladder sees no projection response. Asked for; not yet available.
// • TWO-POINT CONVERSIONS (`hc2pt`). Not modelled upstream.
// • CHICAGO AND DENVER HAVE NO PUNTER ROW UPSTREAM, and are filled here with
//   StatHead's own positional-mean line — the identical 61.9 / 2938 / 24.5 row
//   they already stamp on Baltimore, Buffalo and Houston, who have no settled
//   starter either. Founder: "let's make them generic to the team like K and
//   DST. So every team has one." That is the right call for a TEAM slot and it
//   is not the false precision we refused for fullbacks: every team really does
//   employ a punter and really will punt about sixty times, so a zero would be
//   the wrong claim, whereas ten identical FULLBACKS on a board would each look
//   like a distinct projection of a distinct player.
//
// ── CAVEATS FROM StatHead, KEPT BECAUSE THEY ARE NOT OBVIOUS ───────────────
// • PUNT VOLUME BELONGS TO THE OFFENSE, NOT THE PUNTER (yoy r=+0.46), and the
//   league is punting less every year — 4.53 per team-game in 2016, 3.53 in
//   2025. A punter on a good offense is worth FEWER counting stats, so this
//   column rewards bad teams. Gross average is the one real leg skill (+0.47);
//   inside-20 rate is near noise (+0.19).
// • THIRD- AND FOURTH-DOWN CONVERSIONS BARELY BELONG TO THE COACH (yoy r=+0.18
//   and +0.27), so every team sits near the league rate. If a commissioner sets
//   those knobs meaning to separate coaches, they will not.
// • WINS COME FROM MARKET WIN PROBABILITY, and only some games have a posted
//   line yet — `lined_games` ran 5 to 9 of 17 at bake time, so the rest are
//   shrunk hard toward even. These will move as books post.
//
// REFRESH alongside proj2026.ts:
//   get_projections { position: 'HC', limit: 40, output_format: 'csv', fields:
//     'name,team,games,wins,losses,ties,points,margin_pg,margin_game_sd,lined_games,third_down_conv,fourth_down_conv' }
//   get_projections { position: 'P',  limit: 40, output_format: 'csv', fields:
//     'name,team,games,punts,punt_yd,punt_net_yd,punt_in20,punt_avg' }
// Both join by TEAM, not by the row's `sleeper_id`: the coach rows already
// carry `<team>-hc` there (StatHead built to our convention), but the punter
// rows carry the PLAYER's Sleeper id. Punters arrive sorted by volume, so the
// first row per team is the starter and later ones are backups to drop.

/** A season's projected head-coaching, in the facts a catalog can price. */
export interface ProjHcLine {
  wins: number; losses: number; ties: number;
  /** Team points scored across the season — our `hcPts` is per point. */
  points: number;
  /** Average scoring margin per game, and the spread the ladder integrates. */
  marginPg: number;
  /** Season totals; our knobs are per conversion. */
  thirdDown: number; fourthDown: number;
}

/** A season's projected punting. `in20` is carried for the day a knob prices
 *  it — nothing in the catalog does yet, and StatHead rate it near noise. */
export interface ProjPuntLine {
  punts: number; puntYd: number; in20: number;
}

/** The per-game margin spread StatHead fitted (RMSE 12.71 against actual game
 *  margins, versus 14.60 for prior-season margin and 14.38 for guessing zero —
 *  last year's margin is worse than assuming every game is a coin flip). */
export const MARGIN_GAME_SD = 12.71;

/** slug,wins,losses,ties,points,marginPg,thirdDown,fourthDown */
const HC_CSV = `ari-hc,6.30,10.70,0.06,338.70,-4.16,87,14.50
atl-hc,7.40,9.50,0.06,358.40,-1.83,82,15
bal-hc,9.70,7.20,0.06,436.90,2.22,84.80,15.30
buf-hc,9.50,7.40,0.06,460.10,1.76,88.40,16.40
car-hc,7.80,9.20,0.06,328.50,-1.19,83.10,17.90
chi-hc,9,8,0.06,431,0.88,89,16
cin-hc,8.90,8,0.06,422.80,0.75,87.40,15
cle-hc,7.30,9.60,0.06,291.50,-1.93,84,14.50
dal-hc,8.40,8.50,0.06,455.30,-0.12,85.40,17
den-hc,8.60,8.40,0.06,383.30,0.18,87.90,14
det-hc,9.80,7.20,0.06,470.20,2.29,84.80,16
gb-hc,9,7.90,0.06,402.50,1.01,88.20,15.50
hou-hc,9.10,7.80,0.06,394.90,1.14,86.60,14.20
ind-hc,8.20,8.70,0.06,433.60,-0.46,85,16
jax-hc,9.10,7.90,0.06,443.20,1.04,85.20,15.50
kc-hc,9.30,7.70,0.06,383,1.41,84.80,17.50
la-hc,10.30,6.60,0.06,486.70,3.29,82.80,16.40
lac-hc,8.80,8.10,0.06,381.60,0.75,90.10,14.60
lv-hc,6.70,10.30,0.06,271.90,-3.11,82.60,14.80
mia-hc,6.80,10.10,0.06,339.70,-2.89,81.60,14.30
min-hc,8.70,8.20,0.06,362.90,0.45,80.60,15.30
ne-hc,9.40,7.50,0.06,448.70,1.74,85.10,15.80
no-hc,7.90,9.10,0.06,329.80,-1.04,85.80,15
nyg-hc,7.90,9,0.06,382.60,-0.97,86.40,16
nyj-hc,6.60,10.40,0.06,303.90,-3.33,84.20,16
phi-hc,9.20,7.70,0.06,388.60,1.32,84.10,14.80
pit-hc,8.50,8.40,0.06,384.40,0.09,84.50,14.80
sea-hc,10,6.90,0.06,455.10,2.62,84.90,13
sf-hc,9.60,7.30,0.06,438.40,2.11,89.30,14.40
tb-hc,8.40,8.50,0.06,389,-0.09,87,14.80
ten-hc,7,10,0.06,305.80,-2.59,83.20,15.50
was-hc,7.70,9.20,0.06,370.90,-1.31,82.40,15.50`;

/** slug,punts,puntYd,in20 */
const P_CSV = `ari-p,65.90,3180,25.80
atl-p,61,2871,23.80
bal-p,61.90,2938,24.50
buf-p,61.90,2938,24.50
car-p,59,2777,24.10
chi-p,61.90,2938,24.50
cin-p,62.50,3046,25.40
cle-p,72.70,3456,27.80
dal-p,59.10,2848,23.20
den-p,61.90,2938,24.50
det-p,60,2865,24.30
gb-p,60.40,2897,23.50
hou-p,61.90,2938,24.50
ind-p,61.70,2960,24.60
jax-p,63.10,3023,25.50
kc-p,60.50,2888,24.30
la-p,59.30,2800,23.80
lac-p,65.50,3080,25.90
lv-p,64.90,3134,25.70
mia-p,63,2930,25.20
min-p,68.40,3217,26.30
ne-p,66.80,3187,26.70
no-p,62.40,2979,24.70
nyg-p,59.70,2851,24.10
nyj-p,66,3108,26.90
phi-p,64.20,3089,24.40
pit-p,73.40,3485,29.60
sea-p,65.20,3133,25.80
sf-p,66.70,3116,26.40
tb-p,66.70,3116,26.40
ten-p,64.50,3065,26.10
was-p,63.50,2997,25.90`;

const num = (c: string[], i: number): number => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };

/** Engine slug (`{code}-hc`) → projected season head-coaching line. */
export const PROJ_HC: Record<string, ProjHcLine> = {};
for (const line of HC_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 8) continue;
  PROJ_HC[c[0].trim()] = {
    wins: num(c, 1), losses: num(c, 2), ties: num(c, 3),
    points: num(c, 4), marginPg: num(c, 5),
    thirdDown: num(c, 6), fourthDown: num(c, 7),
  };
}

/** Engine slug (`{code}-p`) → projected season punting line. */
export const PROJ_PUNT: Record<string, ProjPuntLine> = {};
for (const line of P_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 4) continue;
  PROJ_PUNT[c[0].trim()] = { punts: num(c, 1), puntYd: num(c, 2), in20: num(c, 3) };
}

// ── WHO THESE ACTUALLY ARE (display only) ──────────────────────────────────
// Founder: "Maybe we can pull the starter from rosters, that's just color
// though. Do we have current head coach or some way to get that — they can
// change mid season."
//
// THE PROJECTION IS THE TEAM'S, NOT THE PERSON'S, and that is what makes a
// mid-season change harmless: `den-hc` is "Denver's head coach", so firing one
// and hiring another leaves the slot, the roster row and every stored lineup
// untouched. Only the NAME below goes stale, and a stale name is a cosmetic
// bug rather than a scoring one. Nothing reads this map to score anything.
//
// Both come from the same 1.0.84 pull as the lines above — the coach rows carry
// the current 2026 staff (Jesse Minter at Baltimore, Todd Monken at Cleveland,
// Robert Saleh at Tennessee), so a refresh picks up changes for free. The two
// filled punters have no name on purpose: there is no starter to name, and the
// pool already renders "CHI Punter".
const ROLE_NAME_CSV = `la-hc,Sean McVay
sea-hc,Mike Macdonald
det-hc,Dan Campbell
bal-hc,Jesse Minter
sf-hc,Kyle Shanahan
buf-hc,Sean McDermott
ne-hc,Mike Vrabel
kc-hc,Andy Reid
phi-hc,Nick Sirianni
hou-hc,DeMeco Ryans
jax-hc,Liam Coen
chi-hc,Ben Johnson
gb-hc,Matt LaFleur
cin-hc,Zac Taylor
lac-hc,Jim Harbaugh
min-hc,Kevin O'Connell
den-hc,Sean Payton
pit-hc,Mike McCarthy
dal-hc,Brian Schottenheimer
tb-hc,Todd Bowles
ind-hc,Shane Steichen
no-hc,Kellen Moore
nyg-hc,John Harbaugh
car-hc,Dave Canales
was-hc,Dan Quinn
atl-hc,Raheem Morris
cle-hc,Todd Monken
ten-hc,Robert Saleh
mia-hc,Jeff Hafley
lv-hc,Klint Kubliak
nyj-hc,Aaron Glenn
ari-hc,Jonathan Gannon
pit-p,Cameron Johnston
cle-p,Corey Bojorquez
min-p,Johnny Hekker
ne-p,Bryce Baringer
ari-p,Blake Gillikin
lv-p,AJ Cole
sea-p,Michael Dickson
tb-p,Riley Dixon
sf-p,Corliss Waitman
nyj-p,Austin McNamara
phi-p,Braden Mann
lac-p,J.K. Scott
ten-p,Tommy Townsend
cin-p,Ryan Rehkow
jax-p,Logan Cooke
was-p,Tress Way
no-p,Ryan Wright
ind-p,Rigoberto Sanchez
bal-p,Luke Elzinga
buf-p,Tommy Doman
hou-p,Jack Stonehouse
mia-p,Bradley Pinion
gb-p,Daniel Whelan
kc-p,Matt Araiza
atl-p,Jake Bailey
det-p,Jack Fox
nyg-p,Jordan Stout
dal-p,Bryan Anger
la-p,Ethan Evans
car-p,Sam Martin`;

/** Engine slug → the human currently in that role, for a card or a tooltip.
 *  Absent for a filled row. Never used in scoring. */
export const TEAM_ROLE_NAME: Record<string, string> = {};
for (const line of ROLE_NAME_CSV.split('\n')) {
  const i = line.indexOf(',');
  if (i < 1) continue;
  TEAM_ROLE_NAME[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
