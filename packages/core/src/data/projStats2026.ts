// GENERATED — StatHead 2026 PROJECTED STAT LINES, baked so a projection can be
// re-scored under a league's own catalog. Source: Stathead MCP `get_projections`
// as_of 2026-08-26T12:16:06.765Z — the SAME pull, the
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
const LINES_CSV = `Jahmyr Gibbs,RB,0,0,0,1744,19,70,587,4
Jonathan Taylor,RB,0,0,0,1741,20,63,544,2
Christian McCaffrey,RB,0,0,0,1329,14,78,814,4
Bijan Robinson,RB,0,0,0,1381,13,63,681,3
Josh Allen,QB,3942,25,11,441,11,0,0,0
Amon-Ra St. Brown,WR,0,0,0,19,0,122,1563,8
Ashton Jeanty,RB,0,0,0,1439,10,61,437,2
Jalen Hurts,QB,3664,24,7,357,9,0,0,0
Drake Maye,QB,4144,25,9,384,5,0,0,0
Puka Nacua,WR,0,0,0,109,1,105,1521,6.30
De'Von Achane,RB,0,0,0,1222,9,65,516,3
Derrick Henry,RB,0,0,0,1567,16,25,237,1
Trevor Lawrence,QB,3875,24,11,294,8,0,0,0
Chase Brown,RB,0,0,0,1194,10,59,436,3
Bo Nix,QB,3741,24,9,310,6,0,0,0
Caleb Williams,QB,3846,24,6,313,4,0,0,0
James Cook III,RB,0,0,0,1284,13,37,336,2
Ja'Marr Chase,WR,0,0,0,35,0,108,1388,6.50
Jaxon Smith-Njigba,WR,0,0,0,42,0,100,1551,4.80
Trey McBride,TE,0,0,0,0,0,113,1258,7.90
Justin Herbert,QB,3878,24,13,411,3,0,0,0
Matthew Stafford,QB,4148,31,7,1,1,0,0,0
Dak Prescott,QB,4141,25,9,163,3,0,0,0
Jacoby Brissett,QB,3669,24,8,292,4,0,0,0
Justin Jefferson,WR,0,0,0,16,1.10,102,1423,4.60
Josh Jacobs,RB,0,0,0,1229,13,36,284,2
Jaxson Dart,QB,3471,20,7,399,5,0,0,0
Jared Goff,QB,4156,27,7,63,1,0,0,0
Baker Mayfield,QB,3804,24,11,314,2,0,0,0
Bryce Young,QB,3636,24,12,209,4,0,0,0
Aaron Rodgers,QB,3736,24,7,111,3,0,0,0
Bucky Irving,RB,0,0,0,969,10,48,438,2
Javonte Williams,RB,0,0,0,1278,12,31,176,2
TreVeyon Henderson,RB,0,0,0,1142,12,35,248,2
Saquon Barkley,RB,0,0,0,1099,12,35,279,2
Kenneth Walker,RB,0,0,0,1030,11,42,399,1
Chris Olave,WR,0,0,0,-29,0,95,1268,5.60
C.J. Stroud,QB,3588,22,9,181,3,0,0,0
Kyren Williams,RB,0,0,0,1130,10,35,298,2
CeeDee Lamb,WR,0,0,0,0,0,84,1381,4.70
Jordan Love,QB,3674,22,7,159,2,0,0,0
Cam Ward,QB,3554,20,7,172,4,0,0,0
Zay Flowers,WR,0,0,0,72,0.90,84,1290,3.70
Patrick Mahomes,QB,3666,21,11,204,3,0,0,0
Daniel Jones,QB,3404,21,9,152,5,0,0,0
Brock Purdy,QB,3715,24,17,154,3,0,0,0
Sam Darnold,QB,3975,24,15,105,1,0,0,0
D'Andre Swift,RB,0,0,0,1099,11,28,246,2
Tyler Shough,QB,3591,19,9,203,3,0,0,0
Malik Willis,QB,3150,20,0,222,2,0,0,0
Jayden Daniels,QB,3189,19,7,301,3,0,0,0
Omarion Hampton,RB,0,0,0,899,9,48,345,2
Joe Burrow,QB,3453,24,9,68,2,0,0,0
Michael Penix Jr.,QB,3604,20,5,77,2,0,0,0
Breece Hall,RB,0,0,0,1113,10,29,280,1
Cam Skattebo,RB,0,0,0,750,9,49,440,2
Drake London,WR,0,0,0,0,0,83,1205,4.90
A.J. Brown,WR,0,0,0,0,0,84,1131,6
Lamar Jackson,QB,3240,20,10,243,3,0,0,0
Geno Smith,QB,3184,18,18,246,7,0,0,0
Chuba Hubbard,RB,0,0,0,1066,10,32,255,1
Emeka Egbuka,WR,0,0,0,30,0,80,1217,4.20
Wan'Dale Robinson,WR,0,0,0,16,0,90,1093,4.70
Rashee Rice,WR,0,0,0,54,0,86,1092,4.30
Tyler Warren,TE,0,0,0,0,0,93,1090,4
Jadarian Price,RB,0,0,0,1068,12,25,195,0
Ladd McConkey,WR,0,0,0,0,0,84,1132,4.10
DeVonta Smith,WR,0,0,0,0,0,79,1112,5.10
Jameson Williams,WR,0,0,0,24,0,69,1185,5
Kyler Murray,QB,3101,18,8,213,3,0,0,0
Travis Kelce,TE,0,0,0,0,0,87,1101,3.30
Quinshon Judkins,RB,0,0,0,964,10,30,222,1
Nico Collins,WR,0,0,0,22,0,73,1202,3.30
Davante Adams,WR,0,0,0,0,0,73,1037,6.30
Kirk Cousins,QB,3405,20,9,28,2,0,0,0
David Montgomery,RB,0,0,0,1033,9,27,230,1
Marvin Harrison Jr.,WR,0,0,0,0,0,73,1031,5.90
Colston Loveland,TE,0,0,0,0,0,80,1029,4.50
Travis Etienne Jr.,RB,0,0,0,943,7,32,289,2
Brock Bowers,TE,0,0,0,0,0,86,1007,3.70
Bhayshul Tuten,RB,0,0,0,852,11,27,233,1
Tony Pollard,RB,0,0,0,956,10,27,191,1
Courtland Sutton,WR,0,0,0,0,0,73,1078,4.40
George Pickens,WR,0,0,0,4,0,70,1074,4.70
Tetairoa McMillan,WR,0,0,0,0,0,71,1075,4.40
Brian Thomas Jr.,WR,0,0,0,38,0,76,987,4.10
Tee Higgins,WR,0,0,0,0,0,68,1059,4.70
RJ Harvey,RB,0,0,0,693,9,36,300,2
DK Metcalf,WR,0,0,0,66,1.20,64,949,4.80
Shedeur Sanders,QB,3089,17,22,343,3,0,0,0
Jacory Croskey-Merritt,RB,0,0,0,954,10,20,164,1
Malik Nabers,WR,0,0,0,0,0,68,1037,4.30
Rico Dowdle,RB,0,0,0,846,7,32,254,2
Tucker Kraft,TE,0,0,0,0,0,73,1027,3.20
Jordan Mason,RB,0,0,0,947,9,24,157,1
Jaylen Waddle,WR,0,0,0,21,0,68,1032,3.40
Jaylen Warren,RB,0,0,0,820,7,31,261,2
Michael Pittman Jr.,WR,0,0,0,0,0,81,885,3.90
Jake Ferguson,TE,0,0,0,0,0,87,765,4.10
Rhamondre Stevenson,RB,0,0,0,624,7,35,354,2
Garrett Wilson,WR,0,0,0,0,0,73,893,4.20
Hunter Henry,TE,0,0,0,0,0,70,912,4.40
Aaron Jones Sr.,RB,0,0,0,603,7,39,314,2
Sam LaPorta,TE,0,0,0,0,0,69,867,4.80
Jeremiyah Love,RB,0,0,0,875,7,25,207,1
Tre Tucker,WR,0,0,0,94,0,64,865,3.10
DJ Moore,WR,0,0,0,59,1.40,60,866,2.90
Chig Okonkwo,TE,0,0,0,0,0,73,835,3.70
Rome Odunze,WR,0,0,0,0,0,58,878,5.30
George Kittle,TE,0,0,0,0,0,67,877,3.70
Marvin Mims Jr.,WR,0,0,0,25,0,64,817,4.20
Carnell Tate,WR,0,0,0,0,0,65,841,3.90
Blake Corum,RB,0,0,0,860,8,18,128,1
Rachaad White,RB,0,0,0,691,7,32,214,1
Jerry Jeudy,WR,0,0,0,9,0,64,832,3.70
Jakobi Meyers,WR,0,0,0,0,0,58,936,2.70
Dalton Schultz,TE,0,0,0,0,0,72,770,3.10
Dalton Kincaid,TE,0,0,0,0,0,60,870,3.30
Kyle Monangai,RB,0,0,0,738,8,20,176,1
Terry McLaurin,WR,0,0,0,0,0,55,886,3.40
Harold Fannin Jr.,TE,0,0,0,0,0,69,753,3.30
Tyrone Tracy Jr.,RB,0,0,0,566,6,34,292,1
Mark Andrews,TE,0,0,0,0,0,70,732,3.20
J.K. Dobbins,RB,0,0,0,899,7,14,93,1
Parker Washington,WR,0,0,0,69,0,52,842,3.10
Jalen Nailor,WR,0,0,0,37,0,56,879,2.10
AJ Barner,TE,0,0,0,0,0,68,733,3.20
Quentin Johnston,WR,0,0,0,17,0,54,842,3.10
Jordan Addison,WR,0,0,0,182,1.50,44,682,3
Josh Downs,WR,0,0,0,0,0,47,967,2.20
Dallas Goedert,TE,0,0,0,0,0,63,699,4
Romeo Doubs,WR,0,0,0,0,0,59,798,2.90
Greg Dulcich,TE,0,0,0,0,0,59,781,3.10
Zavion Thomas,WR,0,0,0,81,1,50,719,2.90
Kyle Pitts Sr.,TE,0,0,0,0,0,61,718,3.60
Rashid Shaheed,WR,0,0,0,107,0,56,702,2.60
Oronde Gadsden,TE,0,0,0,0,0,56,798,2.70
Jayden Higgins,WR,0,0,0,0,0,58,801,2
Christian Watson,WR,0,0,0,5,0,51,821,2.90
Jordyn Tyson,WR,0,0,0,0,0,51,697,4.80
Pat Freiermuth,TE,0,0,0,0,0,58,719,3.10
Tyler Allgeier,RB,0,0,0,600,7,21,166,1
Alec Pierce,WR,0,0,0,-3,0,62,697,2.30
Michael Wilson,WR,0,0,0,0,0,46,721,4.40
Malik Washington,WR,0,0,0,153,1.50,52,479,3.10
Woody Marks,RB,0,0,0,562,6,22,195,1
Khalil Shakir,WR,0,0,0,0,0,58,657,2.50
Brenton Strange,TE,0,0,0,0,0,53,687,3
Tank Bigsby,RB,0,0,0,685,6,15,128,1
Colby Parkinson,TE,0,0,0,0,0,56,613,3.50
Cade Otton,TE,0,0,0,0,0,59,633,2.50
Brenen Thompson,WR,0,0,0,44,0,51,652,2.60
Dylan Sampson,RB,0,0,0,376,6,30,254,1
Evan Engram,TE,0,0,0,0,0,58,616,2.50
Zach Charbonnet,RB,0,0,0,541,6,20,154,1
Makai Lemon,WR,0,0,0,0,0,49,643,2.80
Calvin Ridley,WR,0,0,0,0,0,48,661,2.40
Brian Robinson,RB,0,0,0,571,6,18,119,1
Isaiah Likely,TE,0,0,0,0,0,51,634,2
Jaylin Noel,WR,0,0,0,51,0,46,627,1.80
T.J. Hockenson,TE,0,0,0,0,0,54,563,2.50
Keon Coleman,WR,0,0,0,0,0,47,556,3
Xavier Worthy,WR,0,0,0,111,1.50,38,532,1.50
Theo Johnson,TE,0,0,0,0,0,48,601,2.10
Samaje Perine,RB,0,0,0,541,6,13,95,1
Tyjae Spears,RB,0,0,0,385,4,30,208,1
Chris Rodriguez Jr.,RB,0,0,0,532,6,12,106,1
Mike Evans,WR,0,0,0,0,0,40,580,3.30
Sean Tucker,RB,0,0,0,500,5,18,128,1
Gunnar Helm,TE,0,0,0,0,0,52,506,2.40
Jack Bech,WR,0,0,0,0,0,44,563,2.20
Chimere Dike,WR,0,0,0,100,0,44,470,2.30
Isiah Pacheco,RB,0,0,0,414,6,18,121,1
Justice Hill,RB,0,0,0,436,4,22,187,1
KC Concepcion,WR,0,0,0,0,0,44,560,2.30
Xavier Hutchinson,WR,0,0,0,30,1.90,38,488,1.90
Juwan Johnson,TE,0,0,0,0,0,44,577,1.90
Emari Demercado,RB,0,0,0,464,4,19,164,1
Isaiah Davis,RB,0,0,0,357,3,28,245,1
Kayshon Boutte,WR,0,0,0,39,0,40,569,2.10
DeMario Douglas,WR,0,0,0,14,0,37,582,2.80
Sam Roush,TE,0,0,0,0,0,43,526,2.60
Tank Dell,WR,0,0,0,0,0,43,501,3.10
Omar Cooper Jr.,WR,0,0,0,0,0,40,517,3
Mike Gesicki,TE,0,0,0,0,0,40,496,3.30
Michael Carter,RB,0,0,0,368,4,23,194,1
Cooper Kupp,WR,0,0,0,0,0,42,557,1.80
Xavier Legette,WR,0,0,0,0,0,44,527,2.10
Chris Godwin Jr.,WR,0,0,0,0,0,42,510,2.50
Matthew Golden,WR,0,0,0,59,0,39,493,1.90
Devin Singletary,RB,0,0,0,425,5,17,147,0
Andrei Iosivas,WR,0,0,0,25,0,34,501,2.80
Jalen Coker,WR,0,0,0,0,0,37,489,2.80
Troy Franklin,WR,0,0,0,0,0,37,506,2.20
Ray Davis,RB,0,0,0,383,4,17,146,1
Darnell Mooney,WR,0,0,0,0,0,35,499,2.50
Kenyon Sadiq,TE,0,0,0,0,0,40,450,2.60
Adonai Mitchell,WR,0,0,0,-17,0,36,524,1.90
Malik Davis,RB,0,0,0,427,4,13,111,1
Ricky Pearsall,WR,0,0,0,0,0,36,436,3
Pat Bryant,WR,0,0,0,117,1.80,30,335,1.80
Mason Taylor,TE,0,0,0,0,0,41,407,2.50
Jauan Jennings,WR,0,0,0,0,0,38,502,1.20
Dontayvion Wicks,WR,0,0,0,0,0,36,467,2.10
Chris Brooks,RB,0,0,0,253,3,29,218,0
Denzel Boston,WR,0,0,0,213,0,28,318,2
Rashod Bateman,WR,0,0,0,0,0,35,464,1.90
LeQuint Allen Jr.,RB,0,0,0,260,3,19,148,2
Keaton Mitchell,RB,0,0,0,411,2,17,138,1
Dawson Knox,TE,0,0,0,0,0,33,403,2.80
Trevor Etienne,RB,0,0,0,510,4,8,57,0
Caleb Douglas,WR,0,0,0,0,0,33,433,2.20
Ty Johnson,RB,0,0,0,236,3,20,207,1
Greg Dortch,WR,0,0,0,0,0,31,447,2
Kaelon Black,RB,0,0,0,399,3,12,106,1
Alvin Kamara,RB,0,0,0,271,2,24,175,1
Malachi Corley,WR,0,0,0,0,0,33,441,1.30
Elic Ayomanor,WR,0,0,0,0,0,26,412,2.80
Britain Covey,WR,0,0,0,25,0,29,371,2.60
De'Zhaun Stribling,WR,0,0,0,-7,0,27,463,1.70
Nikko Remigio,WR,0,0,0,0,0,29,397,2.60
Oscar Delp,TE,0,0,0,0,0,37,398,1.30
Trey Palmer,WR,0,0,0,0,0,29,385,2.20
Jaylen Wright,RB,0,0,0,296,4,10,87,1
Kyle Williams,WR,0,0,0,0,0,27,432,1.30
Brashard Smith,RB,0,0,0,153,2,24,193,1
Ja'Tavion Sanders,TE,0,0,0,0,0,36,321,1.50
Antonio Williams,WR,0,0,0,48,0.60,24,317,1.90
David Njoku,TE,0,0,0,0,0,31,331,2
Ameer Abdullah,RB,0,0,0,119,2,22,174,2
Darius Slayton,WR,0,0,0,0,0,26,407,1.30
Jake Tonges,TE,0,0,0,0,0,30,336,1.90
Cedric Tillman,WR,0,0,0,0,0,29,366,1.50
Michael Mayer,TE,0,0,0,0,0,31,330,1.70
Zachariah Branch,WR,0,0,0,15,0,29,302,2.10
Darnell Washington,TE,0,0,0,0,0,28,339,1.90
Jayden Reed,WR,0,0,0,15,0,27,323,1.80
KaVontae Turpin,WR,0,0,0,40,0,25,336,1.60
Tory Horton,WR,0,0,0,0,0,26,328,2.30
Kaleb Johnson,RB,0,0,0,223,4,10,82,1
Jordan Whittington,WR,0,0,0,14,0,27,332,1.40
Ryan Flournoy,WR,0,0,0,61,0,22,337,1.40
Tyquan Thornton,WR,0,0,0,0,0,20,409,1.40
Braelon Allen,RB,0,0,0,281,3,8,69,1
Devin Neal,RB,0,0,0,220,2,15,120,1
Emanuel Wilson,RB,0,0,0,253,2,12,92,1
Ollie Gordon II,RB,0,0,0,260,4,9,64,0
Max Klare,TE,0,0,0,0,0,25,269,2.20
Chris Brazzell,WR,0,0,0,-8,0,27,288,1.40
Ted Hurst,WR,0,0,0,1,0,23,325,1.40
Bam Knight,RB,0,0,0,166,2,16,128,1
Tommy Tremble,TE,0,0,0,0,0,27,282,1.40
Jaylin Lane,WR,0,0,0,12,0,22,320,1.20
Kendre Miller,RB,0,0,0,246,2,10,83,1
Kaden Wetjen,WR,0,0,0,0,0,21,271,1.90
Luther Burden III,WR,0,0,0,28,0,21,277,1.40
Jaren Kanak,TE,0,0,0,0,0,21,300,1.40
Jaydon Blue,RB,0,0,0,211,3,7,60,1
Devin Duvernay,WR,0,0,0,0,0,19,296,1.40
Marcus Mariota,QB,683,4,2,162,0,0,0,0
Zavier Scott,RB,0,0,0,157,2,15,119,0
Kimani Vidal,RB,0,0,0,256,2,9,82,0
Luke Musgrave,TE,0,0,0,0,0,22,240,1.50
Jackson Hawes,TE,0,0,0,0,0,21,251,1.30
Joe Flacco,QB,740,5,3,97,0,0,0,0
Jerome Ford,RB,0,0,0,102,1,23,136,0
Luke McCaffrey,WR,0,0,0,0,0,17,288,1.20
Noah Gray,TE,0,0,0,0,0,23,256,0.80
Nick Westbrook-Ikhine,WR,0,0,0,0,0,20,240,1.40
Mitchell Evans,TE,0,0,0,0,0,22,241,0.90
James Conner,RB,0,0,0,160,2,9,69,1
Christian Kirk,WR,0,0,0,0,0,18,260,1.10
Tyler Huntley,QB,694,4,3,114,0,0,0,0
Jalen Tolbert,WR,0,0,0,0,0,15,285,0.90
J.J. McCarthy,QB,665,4,2,90,0,0,0,0
Olamide Zaccheaus,WR,0,0,0,0,0,16,237,1.40
Riley Leonard,QB,730,4,2,58,0,0,0,0
Tyler Badie,RB,0,0,0,26,0,21,177,1
Germie Bernard,WR,0,0,0,0,0,16,221,1.60
Dyami Brown,WR,0,0,0,0,0,17,228,1.20
Luke Schoonmaker,TE,0,0,0,0,0,18,211,1
Elijah Higgins,TE,0,0,0,0,0,17,193,1.40
Justin Fields,QB,489,3,2,162,0,0,0,0
Quinn Ewers,QB,675,4,2,49,0,0,0,0
Isaac TeSlaa,WR,0,0,0,15,0,18,168,1.40
Jack Endries,TE,0,0,0,0,0,17,188,1.40
Josh Oliver,TE,0,0,0,0,0,16,193,1.40
Elijah Arroyo,TE,0,0,0,0,0,16,193,1.40
Marquez Valdes-Scantling,WR,0,0,0,0,0,16,191,1.10
John Metchie III,WR,0,0,0,0,0,16,202,1.10
Xavier Smith,WR,0,0,0,0,0,14,229,0.70
Isaiah Williams,WR,0,0,0,62,0,15,155,0.70
Jonathon Brooks,RB,0,0,0,176,2,6,42,0
Kenneth Gainwell,RB,0,0,0,157,2,7,51,0
Tyrod Taylor,QB,490,3,2,111,0,0,0,0
Spencer Rattler,QB,479,3,2,123,0,0,0,0
Chris Bell,WR,0,0,0,0,0,13,175,1.10
Ben Sinnott,TE,0,0,0,0,0,14,158,1.30
Mac Jones,QB,495,3,3,112,0,0,0,0
Jordan James,RB,0,0,0,143,2,6,46,0
Jalen McMillan,WR,0,0,0,0,0,14,183,0.80
Deshaun Watson,QB,662,4,5,33,0,0,0,0
AJ Dillon,RB,0,0,0,181,2,3,24,0
Jawhar Jordan,RB,0,0,0,156,2,5,37,0
Davis Allen,TE,0,0,0,0,0,13,150,1.30
Eli Stowers,TE,0,0,0,0,0,12,137,1.60
Mike Washington Jr.,RB,0,0,0,203,1,5,38,0
Rasheen Ali,RB,0,0,0,36,0,17,142,0
Dont'e Thornton Jr.,WR,0,0,0,0,0,12,168,1.10
Tua Tagovailoa,QB,481,3,2,65,0,0,0,0
Davis Mills,QB,478,3,2,71,0,0,0,0
Andrew Ogletree,TE,0,0,0,0,0,14,151,0.70
Skyy Moore,WR,0,0,0,31,0,12,135,0.70
Elijah Sarratt,WR,0,0,0,0,0,12,156,0.90
Anthony Gould,WR,0,0,0,40,0,10,150,0.70
Tutu Atwell,WR,0,0,0,0,0,12,154,0.90
Jameis Winston,QB,463,3,2,59,0,0,0,0
Carson Beck,QB,489,3,2,32,0,0,0,0
Jonah Coleman,RB,0,0,0,175,1,4,36,0
Malachi Fields,WR,0,0,0,0,0,12,163,0.40
Jahan Dotson,WR,0,0,0,0,0,12,160,0.60
Marlin Klein,TE,0,0,0,0,0,13,147,0.60
Chris Collier,RB,0,0,0,138,1,6,43,0
Fernando Mendoza,QB,454,3,2,30,0,0,0,0
Ahmani Marshall,RB,0,0,0,126,1,6,40,0
Savion Williams,WR,0,0,0,14,0,10,134,0.70
Austin Hooper,TE,0,0,0,0,0,11,138,0.70
Kalif Raymond,WR,0,0,0,0,0,10,128,0.80
Jeremy Ruckert,TE,0,0,0,0,0,12,117,0.70
MarShawn Lloyd,RB,0,0,0,124,1,5,35,0
Pierre Strong,RB,0,0,0,124,1,5,35,0
Eli Raridon,TE,0,0,0,0,0,11,117,0.70
Donovan Edwards,RB,0,0,0,101,1,6,42,0
Tim Patrick,WR,0,0,0,0,0,9,124,0.70
Kameron Johnson,WR,0,0,0,29,0,8,109,0.70
Will Shipley,RB,0,0,0,54,0,11,86,0
Cash Jones,RB,0,0,0,104,1,5,36,0
DJ Giddens,RB,0,0,0,96,2,2,17,0
Frank Gore Jr.,RB,0,0,0,87,1,6,44,0
Josh Whyle,TE,0,0,0,0,0,11,127,0
Tyler Conklin,TE,0,0,0,0,0,11,144,0
Cade Klubnik,QB,424,2,3,47,0,0,0,0
Jarquez Hunter,RB,0,0,0,109,1,4,30,0
Josh Williams,RB,0,0,0,88,2,2,14,0
Nate Boerkircher,TE,0,0,0,0,0,9,112,0.60
Seth McGowan,RB,0,0,0,71,2,2,17,0
Ulysses Bentley IV,RB,0,0,0,62,2,2,15,0
Colbie Young,WR,0,0,0,0,0,7,148,0
Nick Mullens,QB,242,2,1,54,0,0,0,0
Raheim Sanders,RB,0,0,0,95,1,3,23,0
Jaret Patterson,RB,0,0,0,90,1,3,24,0
Gunner Olszewski,WR,0,0,0,0,0,8,121,0
Cole Kmet,TE,0,0,0,0,0,8,83,0.70
Brock Wright,TE,0,0,0,0,0,8,78,0.70
Joe Milton III,QB,259,2,1,31,0,0,0,0
Trey Lance,QB,242,1,1,71,0,0,0,0
Kyle Allen,QB,246,2,1,30,0,0,0,0
C.J. Daniels,WR,0,0,0,0,0,7,91,0.60
Jacob Cowing,WR,0,0,0,0,0,6,82,0.70
Emmanuel Henderson,WR,0,0,0,0,0,7,87,0.50
Matthew Hibner,TE,0,0,0,0,0,6,77,0.70
Tyson Bagent,QB,240,2,1,23,0,0,0,0
Teddy Bridgewater,QB,260,2,1,19,0,0,0,0
Behren Morton,QB,259,2,1,19,0,0,0,0
Jalen Milroe,QB,248,2,1,23,0,0,0,0
Vinny Anthony,WR,0,0,0,0,0,6,75,0.70
Tre' Harris,WR,0,0,0,0,0,7,91,0.30
Bryce Lance,WR,0,0,0,0,0,6,78,0.70
Luke Farrell,TE,0,0,0,0,0,6,74,0.70
Charlie Kolar,TE,0,0,0,0,0,8,102,0
Mason Rudolph,QB,234,1,1,60,0,0,0,0
Ty Simpson,QB,259,2,1,8,0,0,0,0
Derius Davis,WR,0,0,0,17,0,6,88,0
Mitchell Trubisky,QB,222,1,1,51,0,0,0,0
Kendrick Law,WR,0,0,0,0,0,6,74,0.50
Ja'Kobi Lane,WR,0,0,0,0,0,6,78,0.30
Ashton Dulin,WR,0,0,0,0,0,6,78,0
Devaughn Vele,WR,0,0,0,0,0,6,81,0.40
Rivaldo Fairweather,TE,0,0,0,0,0,6,62,0.70
Noah Fant,TE,0,0,0,0,0,6,71,0.50
Jake Browning,QB,238,1,1,39,0,0,0,0
Tahj Brooks,RB,0,0,0,72,1,1,12,0
Adam Randall,RB,0,0,0,59,1,2,14,0
Terrell Jennings,RB,0,0,0,63,1,1,12,0
Josh Cameron,WR,0,0,0,0,0,5,75,0.40
Skyler Bell,WR,0,0,0,0,0,6,76,0.30
Jaheim Bell,TE,0,0,0,0,0,6,54,0.70
Grant Calcaterra,TE,0,0,0,0,0,5,57,0.70
Ian Thomas,TE,0,0,0,0,0,6,58,0.70
Cole Payton,QB,229,1,1,24,0,0,0,0
Kenny Pickett,QB,227,1,1,29,0,0,0,0
Brittain Brown,RB,0,0,0,60,1,1,10,0
Phil Mafah,RB,0,0,0,57,1,1,11,0
Roman Wilson,WR,0,0,0,0,0,5,66,0.30
Jarrett Stidham,QB,234,1,1,20,0,0,0,0
Jam Miller,RB,0,0,0,52,1,1,12,0
Charlie Jones,WR,0,0,0,0,0,5,64,0.30
Jahdae Walker,WR,0,0,0,0,0,4,51,0.70
Malik Benson,WR,0,0,0,0,0,5,58,0.40
Mecole Hardman,WR,0,0,0,0,0,4,52,0.70
Anthony Firkser,TE,0,0,0,0,0,4,46,0.70
Julian Hill,TE,0,0,0,0,0,5,54,0.40
Gary Brightwell,RB,0,0,0,66,0,3,20,0
Will Kacmarek,TE,0,0,0,0,0,4,51,0.40
Dylan Laube,RB,0,0,0,19,0,5,36,0
Demond Claiborne,RB,0,0,0,74,0,2,14,0
Kaytron Allen,RB,0,0,0,63,0,2,13,0
John Michael Gyllenborg,TE,0,0,0,0,0,5,49,0
Joe Royer,TE,0,0,0,0,0,5,55,0
D.J. Rogers,TE,0,0,0,0,0,4,40,0.40
Justin Joly,TE,0,0,0,0,0,5,57,0
Bauer Sharp,TE,0,0,0,0,0,5,53,0
Eli Heidenreich,RB,0,0,0,65,0,1,11,0
Eric Gray,RB,0,0,0,53,0,2,13,0
British Brooks,RB,0,0,0,88,0,0,0,0
Kendrick Bourne,WR,0,0,0,0,0,3,41,0.30
Carsen Ryan,TE,0,0,0,0,0,5,49,0
Tanner Koziol,TE,0,0,0,0,0,4,51,0
Mo Alie-Cox,TE,0,0,0,0,0,4,46,0
Emmett Johnson,RB,0,0,0,42,0,2,14,0
Nicholas Singleton,RB,0,0,0,60,0,1,11,0
Austin Trammell,WR,0,0,0,0,0,3,46,0
Foster Moreau,TE,0,0,0,0,0,4,40,0
Kene Nwangwu,RB,0,0,0,54,0,1,10,0
George Holani,RB,0,0,0,41,0,2,13,0
Tanner Hudson,TE,0,0,0,0,0,3,39,0
Charlie Woerner,TE,0,0,0,0,0,4,37,0
Josh Cuevas,TE,0,0,0,0,0,3,33,0
Daniel Bellinger,TE,0,0,0,0,0,4,40,0
Nate Adkins,TE,0,0,0,0,0,3,42,0
Seydou Traore,TE,0,0,0,0,0,3,42,0
Marquise Brown,WR,0,0,0,0,0,2,33,0
Myles Price,WR,0,0,0,0,0,3,35,0
Kenny Fletcher,TE,0,0,0,0,0,3,30,0
Dameon Pierce,RB,0,0,0,25,0,1,11,0
Ronnie Rivers,RB,0,0,0,39,0,0,0,0
Tyler Goodson,RB,0,0,0,22,0,1,10,0
Cyrus Allen,WR,0,0,0,13,0,1,16,0
Reggie Virgil,WR,0,0,0,0,0,1,20,0
Harrison Bryant,TE,0,0,0,0,0,2,24,0
Ben Yurosek,TE,0,0,0,0,0,1,14,0
Chris Manhertz,TE,0,0,0,0,0,1,14,0
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
