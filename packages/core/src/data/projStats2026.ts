// GENERATED — StatHead 2026 PROJECTED STAT LINES, baked so a projection can be
// re-scored under a league's own catalog. Source: Stathead MCP `get_projections`
// (stathead-mcp 1.0.67), as_of 2026-08-19T14:17:42.640Z — the SAME pull, the
// same 445-row pool and the same instant as `proj2026.ts`.
//
// WHY THIS FILE EXISTS. `proj2026.ts` is one number per player. A league's
// catalog values passing yards, receptions and touchdowns separately, so a
// scalar cannot be re-scored — the projection needs COMPONENTS. These are they.
//
// ── WHY IT WAS RE-BAKED OFF StatHead (v0.309.0) ────────────────────────────
// v0.308.0 shipped this file off SLEEPER's projected stat lines, because
// StatHead served only a scalar. That was a compromise with a real flaw. The
// ratio in `projScoring.ts` divides one scoring of a line by another scoring of
// THE SAME line, and any consistent scaling cancels — but only if both sides
// describe the same player. Sleeper's line is a DIFFERENT projection: its shape
// (this back's carries against his catches) was Sleeper's opinion, applied as a
// ratio to StatHead's level. Close, never wildly wrong, but two models.
//
// We asked StatHead for their own components. 1.0.67 ships them, and this file
// is now baked from them. Two things follow, and both are asserted in
// `scripts/check-proj-scoring.mjs` rather than merely claimed here:
//
//   1. THE DENOMINATOR IS NOW EXACT. Scoring these lines under the standard
//      catalog reproduces StatHead's own served season total (`projPts`) to a
//      mean residual of -0.06 points per SEASON across all 445 rows, worst case
//      2.50. `leagueProjRatio`'s denominator is no longer an approximation of
//      the projection it divides into — it is that projection, re-derived.
//
//   2. COVERAGE IS 445/445. The Sleeper bake joined on sleeper_id and reached
//      368 of 445 players; the other 77 silently fell back to a ratio of 1, so
//      a custom-scoring league quietly showed them at stock PPR. This pull is
//      the same pool as `proj2026.ts`, so every row joins — by NAME, through
//      the same `normName` slug that file builds, verified 1:1 with no
//      collisions and no misses.
//
// SEASON TOTALS, not per-week. Nothing here is read as a level — `projScoring`
// uses these only as a RATIO between two catalogs, and any consistent scaling
// cancels — except `projTdsPerWeek`, which divides by the same 17 the
// projection bake does. Touchdown counts are fractional on purpose (a model's
// expected TDs, not a whole number); do not round them into the CSV.
//
// WHAT StatHead GIVES, AND ONLY THIS: passing yards / TDs / interceptions,
// rushing yards / TDs, receptions / yards / TDs. 1.0.67 also serves pass_att,
// pass_cmp, tgt and rush_att — left out here because no default catalog field
// prices them; add them when a league knob needs them. Fumbles, first downs,
// two-point conversions and the yardage / reception milestones do not exist
// anywhere in StatHead's pool — confirmed with them directly — and neither does
// any K or DST decomposition. See the docblock in `engine/projScoring.ts` for
// what that means for a league that tunes only those fields: the ratio is 1 and
// the projection stands unadjusted.
//
// REFRESH alongside proj2026.ts, from the same call:
//   get_projections { limit: 1000, output_format: 'csv',
//     fields: 'name,position,pass_yd,pass_td,pass_int,rush_yd,rush_td,rec,rec_yd,rec_td' }
import { normName } from './players';

/** A season's projected production, in the fields a catalog can price. */
export interface ProjStatLine {
  passYd: number; passTd: number; int: number;
  rushYd: number; rushTd: number;
  rec: number; recYd: number; recTd: number;
}

/** name,pos,passYd,passTd,int,rushYd,rushTd,rec,recYd,recTd */
const LINES_CSV = `Christian McCaffrey,RB,0,0,0,1539,16,86,910,4
Jahmyr Gibbs,RB,0,0,0,1750,19,70,587,4
Jonathan Taylor,RB,0,0,0,1696,20,62,541,2
Justin Fields,QB,489,3,2,162,0,0,0,0
Josh Allen,QB,3942,25,11,445,11,0,0,0
Bijan Robinson,RB,0,0,0,1377,13,64,694,3
Nick Mullens,QB,242,2,1,58,0,0,0,0
De'Von Achane,RB,0,0,0,1222,9,77,632,3
Jalen Hurts,QB,3664,24,7,357,9,0,0,0
Drake Maye,QB,4144,25,9,384,5,0,0,0
Tyrod Taylor,QB,490,3,2,115,0,0,0,0
Spencer Rattler,QB,479,3,2,123,0,0,0,0
Puka Nacua,WR,0,0,0,108,1,105,1525,6.20
Trevor Lawrence,QB,3875,25,11,290,8,0,0,0
Amon-Ra St. Brown,WR,0,0,0,19,0,122,1563,8
Ashton Jeanty,RB,0,0,0,1490,10,60,434,2
Joe Milton III,QB,259,2,1,31,0,0,0,0
Trey Lance,QB,242,1,1,71,0,0,0,0
Kyle Allen,QB,246,2,1,27,0,0,0,0
Jacoby Brissett,QB,3669,24,8,292,4,0,0,0
Marcus Mariota,QB,683,4,2,162,0,0,0,0
Mac Jones,QB,495,3,3,112,0,0,0,0
Josh Jacobs,RB,0,0,0,1232,13,36,282,2
Bo Nix,QB,3741,24,9,301,6,0,0,0
Jaxson Dart,QB,3471,20,7,399,5,0,0,0
Caleb Williams,QB,3846,24,6,309,4,0,0,0
Ja'Marr Chase,WR,0,0,0,35,0,107,1389,6.50
Tyson Bagent,QB,240,2,1,23,0,0,0,0
Teddy Bridgewater,QB,260,2,1,19,0,0,0,0
Behren Morton,QB,259,2,1,19,0,0,0,0
Jalen Milroe,QB,248,2,1,23,0,0,0,0
Chase Brown,RB,0,0,0,1195,11,58,433,3
CeeDee Lamb,WR,0,0,0,0,0,85,1380,4.70
Justin Herbert,QB,3878,24,13,411,3,0,0,0
Derrick Henry,RB,0,0,0,1537,15,26,252,1
Joe Flacco,QB,740,5,3,97,0,0,0,0
Daniel Jones,QB,3404,21,9,152,5,0,0,0
Matthew Stafford,QB,4148,31,7,1,1,0,0,0
Dak Prescott,QB,4141,25,9,163,3,0,0,0
Javonte Williams,RB,0,0,0,1369,13,32,179,2
Malik Willis,QB,3150,20,0,222,2,0,0,0
Jared Goff,QB,4156,27,7,63,1,0,0,0
Jaxon Smith-Njigba,WR,0,0,0,31,0,102,1570,4.70
Jayden Daniels,QB,3189,19,7,302,3,0,0,0
Tua Tagovailoa,QB,481,3,2,65,0,0,0,0
Davis Mills,QB,478,3,2,71,0,0,0,0
Mason Rudolph,QB,234,1,1,61,0,0,0,0
Ty Simpson,QB,259,2,1,8,0,0,0,0
Cam Skattebo,RB,0,0,0,750,9,51,462,2
Baker Mayfield,QB,3804,24,11,315,2,0,0,0
Trey McBride,TE,0,0,0,0,0,114,1261,7.80
Joe Burrow,QB,3453,24,9,68,2,0,0,0
C.J. Stroud,QB,3588,22,9,181,3,0,0,0
Jordan Love,QB,3674,22,7,160,2,0,0,0
James Cook III,RB,0,0,0,1249,13,35,317,2
Lamar Jackson,QB,3240,20,10,243,3,0,0,0
Saquon Barkley,RB,0,0,0,1109,12,38,310,2
Patrick Mahomes,QB,3666,21,11,204,3,0,0,0
Bryce Young,QB,3636,24,12,209,4,0,0,0
Tyler Huntley,QB,694,4,3,114,0,0,0,0
Aaron Rodgers,QB,3736,24,7,112,3,0,0,0
Chris Olave,WR,0,0,0,-25,0,97,1375,4.70
Brock Purdy,QB,3715,24,17,154,3,0,0,0
Rashee Rice,WR,0,0,0,54,0,86,1092,4.30
Omarion Hampton,RB,0,0,0,908,9,49,354,2
Tyler Shough,QB,3591,19,9,203,3,0,0,0
J.J. McCarthy,QB,665,4,2,90,0,0,0,0
Jameis Winston,QB,463,3,2,59,0,0,0,0
Mitchell Trubisky,QB,222,1,1,51,0,0,0,0
Chuba Hubbard,RB,0,0,0,1071,10,33,266,2
Riley Leonard,QB,730,4,2,58,0,0,0,0
Kyler Murray,QB,3101,18,8,213,3,0,0,0
Geno Smith,QB,3184,19,18,246,7,0,0,0
Michael Penix Jr.,QB,3604,20,5,77,2,0,0,0
Drake London,WR,0,0,0,0,0,82,1222,4.90
Cam Ward,QB,3554,20,7,172,4,0,0,0
A.J. Brown,WR,0,0,0,0,0,84,1135,6
Carson Beck,QB,489,3,2,32,0,0,0,0
Breece Hall,RB,0,0,0,1116,10,33,333,1
Justin Jefferson,WR,0,0,0,15,1.10,94,1309,4.40
Sam Darnold,QB,3975,24,15,105,1,0,0,0
D'Andre Swift,RB,0,0,0,1102,11,28,253,2
Jake Browning,QB,238,1,1,39,0,0,0,0
Quinshon Judkins,RB,0,0,0,964,10,34,259,1
Kyren Williams,RB,0,0,0,1130,10,35,300,2
TreVeyon Henderson,RB,0,0,0,1122,11,35,249,2
Zay Flowers,WR,0,0,0,68,0.90,84,1329,3.60
Quinn Ewers,QB,675,4,2,49,0,0,0,0
Wan'Dale Robinson,WR,0,0,0,12,0,91,1167,4.10
Kenneth Walker,RB,0,0,0,1002,10,41,396,1
Fernando Mendoza,QB,454,3,2,30,0,0,0,0
Shedeur Sanders,QB,3089,17,22,343,3,0,0,0
Davante Adams,WR,0,0,0,0,0,73,1045,6.30
Malik Nabers,WR,0,0,0,0,0,68,1051,4.20
Kirk Cousins,QB,3405,20,9,28,2,0,0,0
Bucky Irving,RB,0,0,0,696,8,42,413,2
Marvin Harrison Jr.,WR,0,0,0,0,0,72,1029,6
Nico Collins,WR,0,0,0,24,0,72,1162,3.50
Cole Payton,QB,229,1,1,24,0,0,0,0
Kenny Pickett,QB,227,1,1,29,0,0,0,0
Jarrett Stidham,QB,234,1,1,24,0,0,0,0
Tucker Kraft,TE,0,0,0,0,0,73,1028,3.20
Ladd McConkey,WR,0,0,0,0,0,85,1134,4
Bhayshul Tuten,RB,0,0,0,852,11,27,239,1
Brock Bowers,TE,0,0,0,0,0,86,1007,3.70
Garrett Wilson,WR,0,0,0,0,0,74,951,3.70
DK Metcalf,WR,0,0,0,61,1.10,65,984,4.60
Brian Thomas Jr.,WR,0,0,0,45,0,75,987,4.20
Tee Higgins,WR,0,0,0,0,0,67,1058,4.80
Zach Charbonnet,RB,0,0,0,1048,11,21,161,1
Emeka Egbuka,WR,0,0,0,33,0,74,1225,4.50
Tyler Warren,TE,0,0,0,0,0,93,1091,4
Colston Loveland,TE,0,0,0,0,0,81,1036,4.40
Travis Etienne Jr.,RB,0,0,0,941,7,39,372,2
DeVonta Smith,WR,0,0,0,0,0,81,1146,4.70
Jameson Williams,WR,0,0,0,24,0,69,1185,5
Travis Kelce,TE,0,0,0,0,0,86,1100,3.40
Kenneth Gainwell,RB,0,0,0,596,5,61,480,2
Jaylen Warren,RB,0,0,0,821,7,33,285,2
Sam LaPorta,TE,0,0,0,0,0,69,872,4.80
Aaron Jones Sr.,RB,0,0,0,584,7,39,318,2
Tony Pollard,RB,0,0,0,921,9,31,234,1
RJ Harvey,RB,0,0,0,768,9,35,295,2
Courtland Sutton,WR,0,0,0,0,0,72,1076,4.50
George Pickens,WR,0,0,0,3,0,71,1074,4.60
Tetairoa McMillan,WR,0,0,0,0,0,71,1090,4.20
Jaylen Waddle,WR,0,0,0,21,0,66,1032,3.50
Deshaun Watson,QB,662,4,5,33,0,0,0,0
Cade Klubnik,QB,424,2,3,47,0,0,0,0
Calvin Ridley,WR,0,0,0,0,0,49,692,2.10
George Kittle,TE,0,0,0,0,0,69,911,3.40
David Montgomery,RB,0,0,0,1033,8,25,209,1
Rome Odunze,WR,0,0,0,0,0,59,889,5.20
Rhamondre Stevenson,RB,0,0,0,597,6,34,341,2
Bam Knight,RB,0,0,0,554,5,36,291,2
Marvin Mims Jr.,WR,0,0,0,26,0,64,811,4.40
Quentin Johnston,WR,0,0,0,16,0,56,858,2.90
Rico Dowdle,RB,0,0,0,794,7,34,277,2
Michael Pittman Jr.,WR,0,0,0,0,0,82,909,3.70
Jacory Croskey-Merritt,RB,0,0,0,915,10,20,166,1
Jordan Mason,RB,0,0,0,906,8,23,148,1
Jake Ferguson,TE,0,0,0,0,0,88,767,4
Zavion Thomas,WR,0,0,0,81,1,51,730,2.90
Hunter Henry,TE,0,0,0,0,0,70,911,4.40
Dalton Kincaid,TE,0,0,0,0,0,58,859,3.50
Tyrone Tracy Jr.,RB,0,0,0,566,6,35,307,1
Terry McLaurin,WR,0,0,0,0,0,55,893,3.40
Tyler Allgeier,RB,0,0,0,877,9,21,167,1
Greg Dulcich,TE,0,0,0,0,0,62,843,2.70
Jakobi Meyers,WR,0,0,0,0,0,56,908,4
Dallas Goedert,TE,0,0,0,0,0,65,720,3.70
Harold Fannin Jr.,TE,0,0,0,0,0,70,805,3
Tre Tucker,WR,0,0,0,93,0,63,865,3.20
Jordan Addison,WR,0,0,0,182,1.50,44,690,3
Chig Okonkwo,TE,0,0,0,0,0,73,842,3.60
J.K. Dobbins,RB,0,0,0,879,7,13,83,1
Makai Lemon,WR,0,0,0,0,0,55,732,2.80
DJ Moore,WR,0,0,0,61,1.50,60,852,3
Parker Washington,WR,0,0,0,58,0,51,826,4.20
Oronde Gadsden,TE,0,0,0,0,0,56,803,2.70
Jerry Jeudy,WR,0,0,0,10,0,65,864,3.30
Carnell Tate,WR,0,0,0,0,0,49,634,4.90
Rachaad White,RB,0,0,0,679,7,33,227,1
Blake Corum,RB,0,0,0,860,8,18,129,1
Christian Watson,WR,0,0,0,5,0,51,814,2.90
Pat Freiermuth,TE,0,0,0,0,0,59,739,2.90
Josh Downs,WR,0,0,0,0,0,47,962,2.20
Romeo Doubs,WR,0,0,0,0,0,56,764,4.10
Kyle Monangai,RB,0,0,0,738,8,20,181,1
Brenen Thompson,WR,0,0,0,43,0,50,653,2.50
Dalton Schultz,TE,0,0,0,0,0,71,741,3.30
Mark Andrews,TE,0,0,0,0,0,70,753,3.10
Alec Pierce,WR,0,0,0,-3,0,61,697,2.30
Dylan Sampson,RB,0,0,0,376,6,34,297,1
AJ Barner,TE,0,0,0,0,0,69,737,3.10
Justice Hill,RB,0,0,0,420,4,22,199,1
Jalen Nailor,WR,0,0,0,37,0,56,872,2.10
Brenton Strange,TE,0,0,0,0,0,53,701,2.90
Tank Bigsby,RB,0,0,0,673,6,16,141,1
Colby Parkinson,TE,0,0,0,0,0,56,613,3.40
Tyjae Spears,RB,0,0,0,372,4,35,254,1
Kyle Pitts Sr.,TE,0,0,0,0,0,62,724,3.50
Rashid Shaheed,WR,0,0,0,85,0,58,712,2.50
Jayden Higgins,WR,0,0,0,0,0,55,745,3.70
Cade Otton,TE,0,0,0,0,0,55,640,2.70
Chris Godwin Jr.,WR,0,0,0,0,0,39,516,2.70
Keon Coleman,WR,0,0,0,0,0,49,581,2.70
Khalil Shakir,WR,0,0,0,0,0,57,648,2.60
Michael Carter,RB,0,0,0,367,4,28,251,1
Mike Evans,WR,0,0,0,0,0,41,603,3.10
Michael Wilson,WR,0,0,0,0,0,46,722,4.40
Malik Washington,WR,0,0,0,135,1.40,55,522,2.70
Isaiah Likely,TE,0,0,0,0,0,52,646,2
Woody Marks,RB,0,0,0,560,6,20,178,1
Britain Covey,WR,0,0,0,24,0,30,385,2.50
Evan Engram,TE,0,0,0,0,0,56,608,3.20
Chris Rodriguez Jr.,RB,0,0,0,527,6,12,109,1
Jordyn Tyson,WR,0,0,0,0,0,41,537,3.70
T.J. Hockenson,TE,0,0,0,0,0,55,564,2.40
Sam Roush,TE,0,0,0,0,0,43,523,3.30
Ricky Pearsall,WR,0,0,0,0,0,36,448,2.80
Isiah Pacheco,RB,0,0,0,408,6,18,121,1
Theo Johnson,TE,0,0,0,0,0,48,611,2
James Conner,RB,0,0,0,242,3,9,70,1
Jayden Reed,WR,0,0,0,15,0,27,323,1.80
Xavier Worthy,WR,0,0,0,111,1.50,37,534,1.50
Jalen Coker,WR,0,0,0,0,0,37,494,2.70
Samaje Perine,RB,0,0,0,538,5,16,114,1
Braelon Allen,RB,0,0,0,280,3,10,82,1
Isaiah Davis,RB,0,0,0,355,3,33,306,1
Brian Robinson,RB,0,0,0,576,6,18,121,1
Dontayvion Wicks,WR,0,0,0,0,0,36,457,4
Jack Bech,WR,0,0,0,0,0,43,579,2.30
Alvin Kamara,RB,0,0,0,273,2,30,226,1
Kayshon Boutte,WR,0,0,0,38,0,39,567,2.10
Emari Demercado,RB,0,0,0,461,3,19,163,1
Gunnar Helm,TE,0,0,0,0,0,54,544,2.10
Mike Gesicki,TE,0,0,0,0,0,41,506,3.30
Xavier Legette,WR,0,0,0,0,0,44,532,2
Kenyon Sadiq,TE,0,0,0,0,0,43,438,2.30
Omar Cooper Jr.,WR,0,0,0,-15,0,37,550,1.70
KC Concepcion,WR,0,0,0,0,0,38,530,1.40
Matthew Golden,WR,0,0,0,48,0,40,500,1.80
DeMario Douglas,WR,0,0,0,14,0,37,582,2.80
Juwan Johnson,TE,0,0,0,0,0,46,634,1.60
Xavier Hutchinson,WR,0,0,0,0,0,40,493,3.40
Andrei Iosivas,WR,0,0,0,24,0,34,512,2.60
Pat Bryant,WR,0,0,0,117,1.80,31,335,1.80
Cooper Kupp,WR,0,0,0,0,0,42,566,1.80
Jaylen Wright,RB,0,0,0,296,4,12,106,1
Chimere Dike,WR,0,0,0,86,0,45,501,2
Darnell Mooney,WR,0,0,0,0,0,35,519,2.20
Rashod Bateman,WR,0,0,0,0,0,35,484,1.70
Jaydon Blue,RB,0,0,0,214,3,8,61,1
Tory Horton,WR,0,0,0,0,0,25,333,2.30
Jaylin Noel,WR,0,0,0,30,2.10,36,461,2.10
Dawson Knox,TE,0,0,0,0,0,41,500,2.10
Oscar Delp,TE,0,0,0,0,0,38,426,1.80
Keaton Mitchell,RB,0,0,0,406,2,17,141,1
Jake Tonges,TE,0,0,0,0,0,31,353,1.80
Jauan Jennings,WR,0,0,0,0,0,38,508,1.20
Denzel Boston,WR,0,0,0,0,0,39,488,0
Tank Dell,WR,0,0,0,16,0,32,426,2.20
Greg Dortch,WR,0,0,0,0,0,31,447,2
Mason Taylor,TE,0,0,0,0,0,44,465,0
Devin Neal,RB,0,0,0,221,2,19,154,1
Devin Singletary,RB,0,0,0,425,5,18,155,0
Kaleb Johnson,RB,0,0,0,227,4,11,90,1
De'Zhaun Stribling,WR,0,0,0,-6,0,28,475,1.60
Jackson Hawes,TE,0,0,0,0,0,31,379,2.80
Emanuel Wilson,RB,0,0,0,491,4,13,96,1
Kendre Miller,RB,0,0,0,246,2,13,107,1
Troy Franklin,WR,0,0,0,0,0,37,507,2.20
Zachariah Branch,WR,0,0,0,15,0,34,354,2.10
David Njoku,TE,0,0,0,0,0,32,335,1.90
Ty Johnson,RB,0,0,0,283,4,20,211,1
Trey Palmer,WR,0,0,0,0,0,29,396,2.20
Chris Brooks,RB,0,0,0,261,3,31,228,0
LeQuint Allen Jr.,RB,0,0,0,263,3,20,152,2
Ray Davis,RB,0,0,0,371,4,16,138,1
Chris Brazzell,WR,0,0,0,-8,0,33,349,2.10
Antonio Williams,WR,0,0,0,45,0.60,25,339,1.80
Will Kacmarek,TE,0,0,0,0,0,29,304,3.20
Sean Tucker,RB,0,0,0,360,4,16,120,1
Ameer Abdullah,RB,0,0,0,120,2,23,178,2
Adonai Mitchell,WR,0,0,0,0,0,31,381,2.80
Caleb Douglas,WR,0,0,0,0,0,29,387,1.40
Elic Ayomanor,WR,0,0,0,0,0,25,448,2.50
Darnell Washington,TE,0,0,0,0,0,28,353,1.80
Michael Mayer,TE,0,0,0,0,0,30,330,1.80
Trevor Etienne,RB,0,0,0,507,4,8,59,0
Jaren Kanak,TE,0,0,0,0,0,26,383,1.40
Kyle Williams,WR,0,0,0,0,0,27,433,1.30
Ja'Tavion Sanders,TE,0,0,0,0,0,36,326,1.50
Malik Davis,RB,0,0,0,328,3,6,50,0
Darius Slayton,WR,0,0,0,0,0,26,410,1.30
Max Klare,TE,0,0,0,0,0,27,283,2.40
Nikko Remigio,WR,0,0,0,0,0,21,426,1.40
Jordan Whittington,WR,0,0,0,13,0,28,341,1.30
KaVontae Turpin,WR,0,0,0,61,0,22,344,1.40
Ryan Flournoy,WR,0,0,0,42,0,24,325,1.60
Ted Hurst,WR,0,0,0,1,0,22,338,1.40
Luther Burden III,WR,0,0,0,28,0,25,321,1.40
Luke McCaffrey,WR,0,0,0,0,0,18,293,1.10
Brashard Smith,RB,0,0,0,150,2,24,192,1
Jaylin Lane,WR,0,0,0,11,0,23,336,1.50
Skyler Bell,WR,0,0,0,0,0,20,229,3.30
Isaiah Williams,WR,0,0,0,62,0,25,257,1.40
Tommy Tremble,TE,0,0,0,0,0,27,294,1.40
Tyquan Thornton,WR,0,0,0,0,0,21,267,1.90
Malachi Corley,WR,0,0,0,0,0,26,328,0
Zavier Scott,RB,0,0,0,159,2,15,121,0
Jalen Tolbert,WR,0,0,0,0,0,17,325,1.30
Ollie Gordon II,RB,0,0,0,260,4,10,78,0
Jawhar Jordan,RB,0,0,0,158,2,5,34,0
Devin Duvernay,WR,0,0,0,0,0,21,332,2.10
Kimani Vidal,RB,0,0,0,252,2,9,84,0
Luke Musgrave,TE,0,0,0,0,0,22,238,1.50
Jerome Ford,RB,0,0,0,102,1,23,137,0
Nick Westbrook-Ikhine,WR,0,0,0,0,0,20,239,1.40
AJ Dillon,RB,0,0,0,180,2,3,25,0
Kaden Wetjen,WR,0,0,0,0,0,18,248,1.20
Olamide Zaccheaus,WR,0,0,0,0,0,18,267,1.40
Noah Gray,TE,0,0,0,0,0,23,254,0.80
Marquez Valdes-Scantling,WR,0,0,0,0,0,16,194,1.10
Mitchell Evans,TE,0,0,0,0,0,23,245,0.90
Germie Bernard,WR,0,0,0,0,0,17,196,1.70
Jeremy Ruckert,TE,0,0,0,0,0,22,228,0.70
Tyler Badie,RB,0,0,0,31,0,24,198,1
Jack Endries,TE,0,0,0,0,0,18,197,1.40
Elijah Higgins,TE,0,0,0,0,0,19,210,2.40
Rivaldo Fairweather,TE,0,0,0,0,0,17,195,1.40
Ben Sinnott,TE,0,0,0,0,0,14,160,1.30
Ulysses Bentley IV,RB,0,0,0,61,2,2,15,0
Josh Oliver,TE,0,0,0,0,0,16,195,1.40
Elijah Arroyo,TE,0,0,0,0,0,16,197,1.40
Isaac TeSlaa,WR,0,0,0,15,0,18,177,1.40
Luke Schoonmaker,TE,0,0,0,0,0,19,211,1
Jalen McMillan,WR,0,0,0,29,0,8,119,0.70
Kaelon Black,RB,0,0,0,166,2,7,52,0
Jordan James,RB,0,0,0,166,2,7,52,0
George Holani,RB,0,0,0,176,2,3,25,0
Rasheen Ali,RB,0,0,0,35,0,18,151,1
Jonathon Brooks,RB,0,0,0,175,2,6,44,0
Christian Kirk,WR,0,0,0,0,0,13,168,1.30
Dyami Brown,WR,0,0,0,0,0,14,163,1.20
Tim Patrick,WR,0,0,0,0,0,15,202,0.70
DJ Giddens,RB,0,0,0,93,2,2,17,0
Dont'e Thornton Jr.,WR,0,0,0,0,0,12,174,1
Xavier Smith,WR,0,0,0,0,0,15,247,0.70
Jadarian Price,RB,0,0,0,212,2,3,22,0
Demond Claiborne,RB,0,0,0,133,2,7,48,0
Cedric Tillman,WR,0,0,0,59,0,13,145,0.60
Anthony Gould,WR,0,0,0,39,0,10,149,0.70
Andrew Ogletree,TE,0,0,0,0,0,13,151,0.70
Josh Whyle,TE,0,0,0,0,0,11,127,0
Tyler Conklin,TE,0,0,0,0,0,11,144,0
Seth McGowan,RB,0,0,0,122,2,6,42,0
John Metchie III,WR,0,0,0,0,0,12,151,1
Tutu Atwell,WR,0,0,0,0,0,9,117,0.80
Raheim Sanders,RB,0,0,0,95,1,3,27,0
Mike Washington Jr.,RB,0,0,0,144,1,6,43,0
Chris Collier,RB,0,0,0,144,1,6,43,0
Eli Stowers,TE,0,0,0,0,0,11,110,1.50
Eli Raridon,TE,0,0,0,0,0,13,138,0.70
Phil Mafah,RB,0,0,0,61,1,2,12,0
Chris Bell,WR,0,0,0,0,0,11,138,0.90
Ahmani Marshall,RB,0,0,0,126,1,6,46,0
Malachi Fields,WR,0,0,0,0,0,10,145,0.70
Austin Hooper,TE,0,0,0,0,0,11,140,0.70
Jonah Coleman,RB,0,0,0,120,1,6,41,0
Donovan Edwards,RB,0,0,0,101,1,7,51,0
Jaret Patterson,RB,0,0,0,90,1,3,24,0
Josh Williams,RB,0,0,0,64,1,2,13,0
Savion Williams,WR,0,0,0,7,0,10,133,0.70
Skyy Moore,WR,0,0,0,26,0,12,134,0.70
MarShawn Lloyd,RB,0,0,0,129,1,5,35,0
Pierre Strong,RB,0,0,0,129,1,5,35,0
Adam Randall,RB,0,0,0,107,1,6,47,0
Nicholas Singleton,RB,0,0,0,110,1,6,44,0
Davis Allen,TE,0,0,0,0,0,10,109,1.30
Eli Heidenreich,RB,0,0,0,112,1,5,38,0
Kaytron Allen,RB,0,0,0,114,1,5,34,0
Jam Miller,RB,0,0,0,97,1,6,38,0
Jeremiyah Love,RB,0,0,0,127,1,4,30,0
Brock Wright,TE,0,0,0,0,0,8,78,0.70
Will Shipley,RB,0,0,0,55,0,12,95,0
Cash Jones,RB,0,0,0,103,1,5,37,0
Brittain Brown,RB,0,0,0,60,1,1,10,0
Jarquez Hunter,RB,0,0,0,109,1,4,30,0
Elijah Sarratt,WR,0,0,0,0,0,9,109,0.80
Jahan Dotson,WR,0,0,0,0,0,9,106,1
Grant Calcaterra,TE,0,0,0,0,0,8,85,0.70
Marlin Klein,TE,0,0,0,0,0,12,117,0
Tahj Brooks,RB,0,0,0,73,2,1,12,0
Emmett Johnson,RB,0,0,0,78,1,5,36,0
Frank Gore Jr.,RB,0,0,0,84,1,4,32,0
Colbie Young,WR,0,0,0,0,0,7,141,0
Bryce Lance,WR,0,0,0,0,0,8,102,0.70
Kameron Johnson,WR,0,0,0,0,0,10,121,0.70
Terrell Jennings,RB,0,0,0,65,1,1,12,0
Gary Brightwell,RB,0,0,0,67,0,3,19,0
Jahdae Walker,WR,0,0,0,0,0,5,66,0.70
Gunner Olszewski,WR,0,0,0,0,0,9,107,0.70
Anthony Firkser,TE,0,0,0,0,0,4,46,0.70
Jacob Cowing,WR,0,0,0,0,0,7,92,0.70
Luke Farrell,TE,0,0,0,0,0,7,82,0.70
Nate Boerkircher,TE,0,0,0,0,0,7,76,0.90
Mecole Hardman,WR,0,0,0,0,0,4,49,0.40
C.J. Daniels,WR,0,0,0,0,0,7,85,0.60
Emmanuel Henderson,WR,0,0,0,0,0,7,83,0.50
Matthew Hibner,TE,0,0,0,0,0,7,75,0.70
Kalif Raymond,WR,0,0,0,0,0,7,84,0.80
Eric Gray,RB,0,0,0,53,0,2,14,0
Vinny Anthony,WR,0,0,0,0,0,6,76,0.70
Charlie Kolar,TE,0,0,0,0,0,8,104,0
Ian Thomas,TE,0,0,0,0,0,5,57,0.70
Cole Kmet,TE,0,0,0,0,0,7,71,0.90
Devaughn Vele,WR,0,0,0,0,0,5,65,0.40
Kendrick Law,WR,0,0,0,0,0,6,69,0.50
Ashton Dulin,WR,0,0,0,0,0,6,78,0
Derius Davis,WR,0,0,0,0,0,5,66,0.40
Josh Cameron,WR,0,0,0,0,0,6,70,0.40
Jaheim Bell,TE,0,0,0,0,0,6,59,0.70
Justin Joly,TE,0,0,0,0,0,5,56,0.70
Tre' Harris,WR,0,0,0,17,0,6,90,0
Austin Trammell,WR,0,0,0,0,0,4,63,0
Joe Royer,TE,0,0,0,0,0,5,56,0.50
Noah Fant,TE,0,0,0,0,0,6,72,0
Malik Benson,WR,0,0,0,0,0,4,55,0.40
Ja'Kobi Lane,WR,0,0,0,0,0,5,58,0.40
Carsen Ryan,TE,0,0,0,0,0,5,51,0.40
Roman Wilson,WR,0,0,0,0,0,4,46,0.40
Nate Adkins,TE,0,0,0,0,0,4,43,0
Julian Hill,TE,0,0,0,0,0,4,38,0.50
Tanner Hudson,TE,0,0,0,0,0,3,35,0.50
British Brooks,RB,0,0,0,89,0,0,0,0
Foster Moreau,TE,0,0,0,0,0,4,48,0
Tanner Koziol,TE,0,0,0,0,0,4,42,0.50
D.J. Rogers,TE,0,0,0,0,0,4,40,0.40
Daniel Bellinger,TE,0,0,0,0,0,4,40,0.40
Dylan Laube,RB,0,0,0,23,0,6,48,0
Josh Cuevas,TE,0,0,0,0,0,4,39,0.40
Seydou Traore,TE,0,0,0,0,0,4,41,0.40
Mo Alie-Cox,TE,0,0,0,0,0,4,46,0
Kene Nwangwu,RB,0,0,0,54,0,1,12,0
John Michael Gyllenborg,TE,0,0,0,0,0,4,50,0
Bauer Sharp,TE,0,0,0,0,0,4,49,0
Charlie Woerner,TE,0,0,0,0,0,4,38,0
Charlie Jones,WR,0,0,0,0,0,3,41,0.30
Dameon Pierce,RB,0,0,0,25,0,1,12,0
Harrison Bryant,TE,0,0,0,0,0,2,25,0
Kendrick Bourne,WR,0,0,0,0,0,2,27,0.30
Marquise Brown,WR,0,0,0,0,0,3,37,0
Kenny Fletcher,TE,0,0,0,0,0,3,32,0
Ronnie Rivers,RB,0,0,0,39,0,0,0,0
Myles Price,WR,0,0,0,0,0,3,35,0
Reggie Virgil,WR,0,0,0,0,0,2,31,0
Tyler Goodson,RB,0,0,0,22,0,1,10,0
Chris Manhertz,TE,0,0,0,0,0,1,15,0
Ben Yurosek,TE,0,0,0,0,0,1,14,0
Cyrus Allen,WR,0,0,0,12,0,1,16,0
Jacob Saylors,RB,0,0,0,20,0,0,0,0
Roschon Johnson,RB,0,0,0,14,0,0,0,0
Sione Vaki,RB,0,0,0,7,0,0,0,0`;

/** Engine slug → projected season stat line. Same slug convention as
 *  `proj2026.ts` — that is the join, and it is total: 445 lines, 445 rows. */
export const PROJ_LINES: Record<string, ProjStatLine> = {};
/** Engine slug → the position StatHead projected him at, for a caller that
 *  scores a line without a player record in hand. */
export const PROJ_LINE_POS: Record<string, string> = {};
for (const line of LINES_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 10) continue;
  const slug = normName(c[0]).replace(/\s+/g, '-');
  if (!slug || PROJ_LINES[slug]) continue;
  const n = (i: number) => { const v = Number(c[i]); return Number.isFinite(v) ? v : 0; };
  PROJ_LINES[slug] = {
    passYd: n(2), passTd: n(3), int: n(4),
    rushYd: n(5), rushTd: n(6),
    rec: n(7), recYd: n(8), recTd: n(9),
  };
  PROJ_LINE_POS[slug] = (c[1] ?? '').trim().toUpperCase();
}
