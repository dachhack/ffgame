// GENERATED — 2026 dynasty trade values, baked for dynasty-league draft rooms
// and waiver wires. Source: Stathead MCP `get_dynasty_values` — BOTH market
// formats in one pull: `value` (1QB) and `superflexValue` (SF). Stathead's
// dynasty model offers exactly these two formats (no TE-premium market
// exists there — a TEP league reads the closest honest number, 1QB or SF by
// its lineup, rather than a fabricated boost). Rookie-pick rows ("2027 Early
// 1st") are asset values, not players, and are deliberately not baked.
//
// v0.351.3: the board is 500 rows deep (was 200) and every player row now
// carries his `sleeper_id`, so the join is ID-FIRST: a slug resolves through
// the league pool's slug→sleeper-id map (slugMeta) into DYN_BY_SID, and only
// a row Stathead couldn't id (a handful of deep rookies) or a screen with no
// pool ids installed falls back to the name join. The name join is what
// silently dropped Kenneth/Kenny Gainwell — ids end that bug class.
//
// REFRESH alongside the ADP rebake: pull
//   get_dynasty_values { limit: 500, output_format: 'csv',
//     fields: 'player_name,position,team,value,superflexValue,sleeper_id' }
// via the Stathead MCP, drop the rookie-pick rows, and replace DYN_CSV below
// (keep the as-of line current). One hand-edit survives refreshes: the board
// spells "Chigoziem Okonkwo" with NO sleeper_id, so neither join can reach
// him — the baked row says "Chig Okonkwo", the name our player index uses.
import { normName } from './players';
import { slugSleeperId } from './slugMeta';

/** Stathead dynasty market as of 2026-08-23. */
export const DYN_AS_OF = '2026-08-23';

/** Which market this league reads: superflex lineups price QBs very
 *  differently (Josh Allen: 5522 in 1QB, 10373 in SF). Installed per league
 *  by the screens that know the lineup (the setLiveAdp pattern). */
export type DynFormat = '1qb' | 'sf';
let dynFormat: DynFormat = '1qb';
export const setDynFormat = (f: DynFormat) => { dynFormat = f; };

const DYN_CSV = `RB,ATL,Bijan Robinson,11252,10241,9509
RB,DET,Jahmyr Gibbs,10547,9923,9221
WR,CIN,Ja'Marr Chase,9727,9674,7564
WR,SEA,Jaxon Smith-Njigba,8613,8816,9488
WR,LAR,Puka Nacua,8555,8687,9493
RB,ARI,Jeremiyah Love,7666,7071,13287
RB,LVR,Ashton Jeanty,7622,7125,12527
WR,DET,Amon-Ra St. Brown,7333,7500,7547
TE,LVR,Brock Bowers,7162,7986,11604
WR,MIN,Justin Jefferson,6931,6934,6794
WR,NYG,Malik Nabers,6831,6772,11632
RB,MIA,De'Von Achane,6654,6244,9226
WR,DAL,CeeDee Lamb,6564,6656,6786
TE,ARI,Trey McBride,6432,7158,8130
RB,LAC,Omarion Hampton,6112,5747,12507
WR,ATL,Drake London,5635,5629,8112
QB,BUF,Josh Allen,5522,10373,4984
RB,IND,Jonathan Taylor,5477,5159,6813
RB,BUF,James Cook,5469,5148,8138
WR,CAR,Tetairoa McMillan,4856,4933,12526
QB,NEP,Drake Maye,4793,8525,11564
TE,CHI,Colston Loveland,4607,5200,12517
WR,DAL,George Pickens,4424,4647,8137
RB,KCC,Kenneth Walker III,4418,4179,8151
RB,SFO,Christian McCaffrey,4366,4044,4034
WR,TEN,Carnell Tate,4360,4503,13279
RB,PHI,Saquon Barkley,4357,3997,4866
WR,TBB,Emeka Egbuka,4325,4501,12514
RB,CIN,Chase Brown,4214,4041,9224
QB,CHI,Caleb Williams,4160,7300,11560
WR,NOS,Chris Olave,4127,4190,8144
WR,HOU,Nico Collins,4086,4244,7569
RB,CLE,Quinshon Judkins,4051,3718,12512
RB,NYJ,Breece Hall,4026,3756,8155
TE,IND,Tyler Warren,4010,4551,12518
QB,BAL,Lamar Jackson,3899,7130,4881
QB,WAS,Jayden Daniels,3827,7018,11566
WR,LAC,Ladd McConkey,3823,3979,11635
WR,NYJ,Garrett Wilson,3778,3750,8146
WR,NOS,Jordyn Tyson,3756,3738,13281
WR,KCC,Rashee Rice,3746,3745,10229
WR,NEP,A.J. Brown,3730,3825,5859
RB,SEA,Jadarian Price,3722,3674,13286
WR,PHI,DeVonta Smith,3711,3749,7525
RB,NEP,TreVeyon Henderson,3711,3413,12529
WR,PHI,Makai Lemon,3699,3787,13294
QB,CIN,Joe Burrow,3625,6499,6770
RB,LAR,Kyren Williams,3552,3301,8150
WR,BAL,Zay Flowers,3529,3638,9997
WR,CHI,Luther Burden,3467,3556,12519
RB,TBB,Bucky Irving,3449,3154,11584
WR,CHI,Rome Odunze,3384,3410,11620
RB,NYG,Cam Skattebo,3244,3077,12481
TE,GBP,Tucker Kraft,3202,3545,9484
WR,DEN,Jaylen Waddle,3192,3174,7526
WR,ARI,Marvin Harrison Jr.,3185,3213,11628
WR,JAC,Brian Thomas Jr.,3179,3124,11631
WR,CIN,Tee Higgins,3153,3143,6801
QB,LAC,Justin Herbert,3130,5821,6797
RB,DAL,Javonte Williams,3100,2913,7588
RB,GBP,Josh Jacobs,3085,2749,5850
TE,CLE,Harold Fannin,3081,3312,12506
WR,CLE,KC Concepcion,3047,3054,13298
RB,BAL,Derrick Henry,2951,2780,3198
QB,NYG,Jaxson Dart,2932,5091,12508
QB,PHI,Jalen Hurts,2906,5353,6904
QB,KCC,Patrick Mahomes,2874,5192,4046
WR,WAS,Antonio Williams,2859,3105,13301
RB,NOS,Travis Etienne,2844,2666,7543
TE,DET,Sam LaPorta,2828,3213,10859
WR,TBB,Ted Hurst,2813,2930,13317
WR,DET,Jameson Williams,2712,2694,8148
QB,JAC,Trevor Lawrence,2712,4814,7523
TE,NYJ,Kenyon Sadiq,2692,2852,13330
QB,DEN,Bo Nix,2669,5007,11563
RB,MIN,Demond Claiborne,2615,2625,13347
TE,ATL,Kyle Pitts,2562,2857,7553
WR,CLE,Denzel Boston,2557,2623,13346
RB,CHI,D'Andre Swift,2556,2380,6790
RB,DEN,Jonah Coleman,2546,2359,13345
RB,LVR,Mike Washington Jr.,2457,2325,13305
WR,NYJ,Omar Cooper Jr.,2385,2291,13276
RB,JAC,Bhayshul Tuten,2354,2298,12490
WR,MIA,Chris Bell,2352,2329,13311
QB,SFO,Brock Purdy,2340,4188,8183
WR,BUF,D.J. Moore,2302,2289,4983
RB,HOU,David Montgomery,2282,2040,5892
WR,PIT,Germie Bernard,2278,2382,13274
WR,BAL,Ja'Kobi Lane,2271,2530,13293
WR,JAC,Parker Washington,2246,2410,9487
TE,PHI,Eli Stowers,2237,2405,13349
RB,TEN,Nicholas Singleton,2230,2104,13288
QB,LVR,Fernando Mendoza,2213,4149,13269
RB,KCC,Emmett Johnson,2172,2094,13337
QB,NOS,Tyler Shough,2162,3381,12545
WR,IND,Alec Pierce,2107,2038,8142
WR,WAS,Terry McLaurin,2093,2056,5927
WR,TEN,Wan'Dale Robinson,2092,2020,8126
QB,GBP,Jordan Love,2090,3784,6804
WR,ATL,Zachariah Branch,2083,2109,13320
RB,DEN,RJ Harvey,2079,1904,12489
RB,CAR,Jonathon Brooks,2074,1907,11583
WR,GBP,Christian Watson,2053,2068,8167
WR,JAC,Travis Hunter,2043,2024,12530
WR,GBP,Matthew Golden,2042,1948,12501
QB,DAL,Dak Prescott,2033,3779,3294
WR,MIN,Jordan Addison,2019,2014,9756
QB,TEN,Cam Ward,2015,3452,12522
WR,SFO,Mike Evans,2003,2002,2216
RB,CAR,Chuba Hubbard,1974,1779,7594
WR,NYG,Malachi Fields,1962,2034,13285
WR,LAR,Davante Adams,1939,1890,2133
WR,ARI,Michael Wilson,1916,1915,10232
RB,CHI,Kyle Monangai,1909,1737,12534
RB,PIT,Rico Dowdle,1904,1730,7021
RB,LAR,Blake Corum,1901,1769,11586
RB,WAS,Kaytron Allen,1892,1843,13405
RB,NEP,Rhamondre Stevenson,1883,1751,7611
WR,SFO,De'Zhaun Stribling,1879,1877,13417
RB,SEA,Zach Charbonnet,1862,1670,9753
WR,PIT,DK Metcalf,1850,1845,5846
WR,PIT,Michael Pittman,1849,1818,6819
TE,LAR,Max Klare,1848,2232,13278
WR,IND,Josh Downs,1842,1784,9500
QB,HOU,C.J. Stroud,1832,3191,9758
RB,PIT,Jaylen Warren,1820,1669,8228
QB,DET,Jared Goff,1811,3244,3163
TE,SFO,George Kittle,1782,1912,4217
RB,WAS,Jacory Croskey-Merritt,1775,1637,12533
QB,TBB,Baker Mayfield,1771,3274,4892
WR,KCC,Xavier Worthy,1771,1721,11624
TE,NYG,Isaiah Likely,1768,1896,8131
WR,BAL,Elijah Sarratt,1768,1751,13268
WR,GBP,Jayden Reed,1760,1731,10222
RB,MIN,Jordan Mason,1753,1595,8408
RB,DEN,J.K. Dobbins,1735,1535,6806
TE,BUF,Dalton Kincaid,1722,1887,10236
WR,LAC,Quentin Johnston,1714,1666,9754
TE,DAL,Jake Ferguson,1713,1863,8110
WR,BUF,Skyler Bell,1685,1744,13402
RB,TBB,Kenneth Gainwell,1636,1499,7567
WR,DEN,Courtland Sutton,1611,1579,5045
WR,NEP,Romeo Doubs,1597,1631,8121
TE,LAC,Oronde Gadsden,1595,1702,12493
RB,TEN,Tony Pollard,1593,1448,5967
WR,CAR,Chris Brazzell II,1580,1598,13353
TE,JAC,Brenton Strange,1552,1681,9480
WR,IND,Deion Burks,1543,1567,13333
WR,HOU,Jayden Higgins,1533,1551,12484
QB,CAR,Bryce Young,1523,2429,9228
RB,WAS,Rachaad White,1520,1386,8136
WR,TBB,Jalen McMillan,1514,1507,11618
WR,TBB,Chris Godwin,1508,1449,4037
QB,MIN,Kyler Murray,1506,2663,5849
WR,CAR,Jalen Coker,1484,1479,11646
QB,SEA,Sam Darnold,1457,2477,4943
RB,JAC,Chris Rodriguez,1454,1340,10219
WR,JAC,Jakobi Meyers,1449,1418,5947
RB,ARI,Tyler Allgeier,1424,1350,8132
WR,MIA,Kevin Coleman,1423,1587,13338
QB,LAR,Matthew Stafford,1406,2437,421
RB,LAC,Keaton Mitchell,1379,1230,9511
WR,KCC,Cyrus Allen,1365,1392,13413
RB,CLE,Dylan Sampson,1349,1260,12469
RB,HOU,Woody Marks,1348,1269,12474
RB,NYJ,Braelon Allen,1348,1260,11576
WR,BUF,Khalil Shakir,1345,1309,8134
QB,IND,Daniel Jones,1336,2257,5870
WR,LAC,Tre Harris,1335,1317,12509
TE,PHI,Dallas Goedert,1331,1426,5022
RB,MIN,Aaron Jones,1327,1149,4199
TE,KCC,Travis Kelce,1321,1418,1466
RB,DET,Isiah Pacheco,1319,1155,8205
TE,MIN,T.J. Hockenson,1297,1421,5844
WR,MIA,Caleb Douglas,1283,1351,13296
TE,BAL,Mark Andrews,1282,1409,5012
TE,LAR,Terrance Ferguson,1277,1389,12487
RB,JAC,J'Mari Taylor,1273,1212,13348
TE,SEA,AJ Barner,1272,1388,11603
QB,LAR,Ty Simpson,1269,2557,13275
RB,SFO,Kaelon Black,1264,1197,13414
WR,SFO,Ricky Pearsall,1255,1275,11638
TE,WAS,Chig Okonkwo,1225,1357,
RB,ATL,Brian Robinson,1219,1100,8154
QB,MIA,Malik Willis,1204,2125,8161
TE,TEN,Gunnar Helm,1204,1302,12502
RB,NOS,Alvin Kamara,1204,1085,4035
WR,SEA,Rashid Shaheed,1195,1158,8676
RB,TEN,Tyjae Spears,1140,1052,9508
WR,PHI,Dontayvion Wicks,1140,1146,9486
RB,SFO,Jordan James,1137,947,12467
WR,DET,Isaac TeSlaa,1135,1151,12535
RB,PHI,Tank Bigsby,1125,970,9225
WR,NYJ,Adonai Mitchell,1120,1099,11625
RB,NYG,Tyrone Tracy,1119,1010,11655
WR,MIA,Malik Washington,1116,1108,11610
WR,CLE,Jerry Jeudy,1105,1097,6783
RB,NEP,Jam Miller,1092,1082,13403
TE,NOS,Juwan Johnson,1090,1228,7002
RB,PIT,Kaleb Johnson,1089,994,12504
TE,NYJ,Mason Taylor,1075,1166,12498
WR,BUF,Keon Coleman,1072,1047,11637
WR,HOU,Tank Dell,1069,1087,9502
RB,BAL,Adam Randall,1019,992,13302
TE,NEP,Eli Raridon,1005,1191,13421
WR,NEP,Kayshon Boutte,995,1022,9504
WR,SEA,Tory Horton,989,1004,12497
TE,DAL,Michael Trigg,989,1223,13401
RB,MIA,Le'Veon Moss,988,956,13300
RB,ARI,Trey Benson,980,907,11589
TE,CIN,Jack Endries,978,1375,13282
WR,DEN,Pat Bryant,967,965,12492
QB,ARI,Jacoby Brissett,955,1396,3257
WR,TEN,Elic Ayomanor,950,940,12499
WR,NOS,Bryce Lance,943,948,13420
WR,LVR,Jalen Nailor,930,905,8180
TE,NOS,Oscar Delp,920,1049,13319
QB,ATL,Tua Tagovailoa,908,1435,6768
WR,WAS,Stefon Diggs,903,912,2449
WR,DEN,Troy Franklin,900,949,11627
WR,CHI,Zavion Thomas,895,958,13411
RB,SEA,Emanuel Wilson,895,784,11435
QB,CLE,Shedeur Sanders,877,1378,12524
RB,IND,Seth McGowan,872,848,13424
RB,PIT,Eli Heidenreich,871,862,13423
WR,TEN,Chimere Dike,870,877,12540
QB,CLE,Deshaun Watson,866,1101,4017
WR,LAC,Brenen Thompson,864,924,13380
QB,ATL,Michael Penix Jr.,863,1551,11559
QB,NYJ,Geno Smith,842,1278,1373
RB,ARI,James Conner,841,755,4137
WR,HOU,Jaylin Noel,829,828,12536
WR,NOS,Barion Brown,827,836,
TE,DEN,Justin Joly,821,986,13400
RB,MIA,Ollie Gordon,808,740,12495
QB,LVR,Kirk Cousins,802,1204,1166
WR,LVR,Jack Bech,795,807,12483
WR,NEP,Kyle Williams,777,783,
TE,LAC,David Njoku,770,861,4033
WR,LVR,Malik Benson,766,806,13329
RB,CHI,Roschon Johnson,758,711,10235
TE,NEP,Hunter Henry,737,808,3214
WR,LAR,Jordan Whittington,730,721,11623
WR,SFO,Deebo Samuel,715,724,5872
RB,DAL,Jaydon Blue,715,658,12457
RB,LAC,Kimani Vidal,715,647,11647
TE,TBB,Cade Otton,707,785,8111
WR,LVR,Tre Tucker,705,707,10213
TE,HOU,Dalton Schultz,693,759,5001
WR,BAL,Devontez Walker,677,663,11629
WR,FA,Tyreek Hill,677,620,3321
TE,SFO,Jake Tonges,671,734,8698
WR,NYG,Jalin Hyatt,662,661,9497
WR,MIN,Jauan Jennings,659,671,7049
RB,BAL,Rasheen Ali,644,608,11570
WR,TEN,Calvin Ridley,637,590,4981
WR,MIA,Tahj Washington,632,644,11821
WR,SFO,Brandon Aiyuk,632,605,6803
RB,IND,DJ Giddens,631,542,12471
TE,PIT,Pat Freiermuth,626,672,7600
QB,MIN,J.J. McCarthy,620,1282,11565
TE,SEA,Elijah Arroyo,616,683,12521
WR,SFO,Jordan Watkins,616,624,12634
WR,PHI,Elijah Moore,612,613,7596
WR,NOS,Trey Palmer,608,604,9492
WR,DET,Greg Dortch,605,618,5970
RB,MIA,Jaylen Wright,596,531,11643
QB,KCC,Justin Fields,587,1037,7591
WR,SFO,Jacob Cowing,585,578,11616
WR,TBB,Kameron Johnson,582,618,11994
QB,NYJ,Cade Klubnik,582,1818,13303
RB,MIA,Donovan Edwards,580,572,12515
WR,CHI,Jahdae Walker,575,616,13079
RB,TEN,Kalel Mullings,573,551,12516
RB,GBP,MarShawn Lloyd,572,481,11581
TE,NYG,Theo Johnson,569,607,11597
TE,HOU,Cade Stover,569,650,11599
RB,TBB,Sean Tucker,568,517,9506
WR,LAR,CJ Daniels,568,600,13270
RB,ARI,Bam Knight,564,519,8122
TE,LVR,Michael Mayer,563,593,9482
WR,NEP,Efton Chism,563,557,12542
QB,KCC,Garrett Nussmeier,556,900,13404
WR,NYG,Darnell Mooney,549,541,7090
TE,CAR,Tommy Tremble,545,606,7694
TE,HOU,Marlin Klein,537,655,13307
WR,TEN,Xavier Restrepo,537,551,12520
TE,DEN,Evan Engram,534,569,4066
QB,SFO,Mac Jones,532,965,7527
WR,BUF,Gabriel Davis,530,554,
RB,ATL,Tyler Goodson,523,501,8207
RB,NOS,Devin Neal,516,470,12476
TE,LAC,Charlie Kolar,515,602,8127
WR,LVR,Dont'e Thornton,513,492,12541
WR,CLE,Isaiah Bond,512,534,12503
WR,IND,Nick Westbrook-Ikhine,510,500,7496
WR,CIN,Colbie Young,510,566,13477
RB,DAL,Israel Abanikanda,504,491,9227
RB,PHI,Dameon Pierce,503,472,8129
QB,PIT,Will Howard,502,782,12511
WR,CLE,David Bell,500,508,8118
RB,DEN,Tyler Badie,500,471,8208
WR,SFO,Javon Baker,495,490,11645
RB,JAC,LeQuint Allen,490,448,12544
TE,ARI,Elijah Higgins,489,562,10231
QB,IND,Anthony Richardson,487,800,9229
TE,CAR,Mitchell Evans,484,564,12473
RB,FA,Khalil Herbert,484,477,7608
QB,PIT,Aaron Rodgers,482,817,96
WR,DAL,Jonathan Mingo,479,485,10225
WR,TBB,Tez Johnson,478,503,12485
RB,BUF,Ray Davis,478,428,11575
WR,SFO,Christian Kirk,476,461,4950
RB,BUF,Frank Gore Jr.,476,462,232
TE,MIA,Greg Dulcich,474,496,8172
TE,DAL,Luke Schoonmaker,473,539,10871
WR,SEA,Jake Bobo,472,459,10867
WR,LAR,Tyler Scott,467,465,9490
WR,NYG,Isaiah Hodgins,464,489,6920
RB,CIN,Kendall Milton,464,451,11649
RB,DET,Sione Vaki,457,439,11729
WR,CAR,Xavier Legette,455,448,11626
TE,BAL,Matthew Hibner,449,569,
QB,ARI,Carson Beck,449,1763,13272
TE,LAR,Davis Allen,443,467,10214
WR,NYG,Xavier Gipson,443,456,11306
RB,KCC,Brashard Smith,440,410,12455
WR,BUF,Tyrell Shavers,432,401,11377
WR,NYJ,Arian Smith,430,440,12539
TE,HOU,Brevin Jordan,428,472,7568
WR,NOS,Bub Means,426,403,11748
TE,LAR,Colby Parkinson,416,449,6865
WR,GBP,Skyy Moore,415,447,8168
WR,NOS,Mason Tipton,412,423,11895
TE,CHI,Sam Roush,411,516,13322
WR,GBP,Bo Melton,409,414,
RB,CAR,Trevor Etienne,408,365,12531
WR,DEN,Marvin Mims,406,413,9494
WR,ARI,Reggie Virgil,406,407,13297
TE,JAC,Tanner Koziol,402,546,13408
WR,SEA,Cooper Kupp,396,378,4039
TE,KCC,Jared Wiley,392,429,11595
WR,PHI,Johnny Wilson,392,383,11636
WR,MIA,Jalen Tolbert,380,357,8117
RB,CAR,AJ Dillon,371,338,6828
RB,NEP,Hassan Haskins,360,341,8123
WR,SFO,Demarcus Robinson,357,374,3286
WR,PHI,Marquise Brown,351,342,5848
RB,HOU,Jawhar Jordan,351,307,11588
WR,DEN,Lil'Jordan Humphrey,349,352,5938
RB,SFO,Sincere McCormick,342,312,8220
WR,BAL,Rashod Bateman,335,318,7571
RB,ATL,Nathan Carter,335,254,
TE,CAR,Ja'Tavion Sanders,333,371,11600
WR,LAC,Derius Davis,330,305,10234
QB,SEA,Jalen Milroe,326,563,12510
TE,DET,Brock Wright,324,389,7891
TE,WAS,Ben Sinnott,311,330,11596
WR,ATL,Jahan Dotson,310,303,8119
RB,MIA,Alexander Mattison,310,269,5987
RB,NYJ,Isaiah Davis,308,292,11571
WR,BUF,Mecole Hardman,300,285,5917
RB,DET,Trayveon Williams,297,287,6144
RB,NOS,Ty Chandler,291,270,8230
RB,SFO,Zamir White,291,264,8139
WR,KCC,Jalen Royals,285,272,12505
RB,LVR,Dylan Laube,283,246,11574
TE,CIN,Mike Gesicki,281,312,4993
WR,BAL,LaJohntay Wester,279,255,12699
WR,ATL,Malik Heath,277,265,11210
RB,MIN,Zavier Scott,277,259,11299
RB,CIN,Tahj Brooks,276,245,12543
TE,CHI,Cole Kmet,274,305,6826
WR,CLE,Jamari Thrash,271,268,11633
RB,WAS,Jeremy McNichols,271,239,4219
RB,NYG,Najee Harris,270,242,7528
WR,DAL,Tyler Johnson,256,255,6960
WR,CLE,Tylan Wallace,250,234,7595
QB,DAL,Sam Howell,238,545,8162
WR,WAS,Van Jefferson,237,229,6853
RB,NOS,Kendre Miller,229,228,9757
QB,NOS,Zach Wilson,228,307,7538
WR,LVR,Noah Brown,228,233,4234
WR,FA,Brenden Rice,228,232,11621
WR,DAL,Ryan Flournoy,227,228,11783
QB,IND,Riley Leonard,223,331,12470
WR,NOS,Devaughn Vele,214,215,11834
TE,JAC,Hunter Long,204,231,7535
RB,KCC,Emari Demercado,202,189,11199
RB,BAL,Justice Hill,197,174,5995
WR,WAS,Jaylin Lane,195,194,12641
TE,PIT,Darnell Washington,193,209,9479
WR,WAS,Luke McCaffrey,193,179,11650
WR,IND,Keenan Allen,191,187,1479
QB,PHI,Tanner McKee,190,108,9230
RB,SFO,Isaac Guerendo,188,164,11651
WR,CLE,Cedric Tillman,186,189,10444
WR,GBP,Savion Williams,178,176,12482
WR,PIT,Roman Wilson,174,179,11630
QB,MIA,Quinn Ewers,172,290,12500
WR,CAR,John Metchie,168,167,8147
QB,SEA,Drew Lock,165,483,5854
WR,NYG,Calvin Austin III,163,159,8125
QB,ARI,Gardner Minshew,158,146,6011
WR,NEP,Demario Douglas,157,153,9501
RB,LAR,Jarquez Hunter,147,125,11569
TE,CAR,Darren Waller,146,185,2505
QB,WAS,Marcus Mariota,143,230,2307
TE,GBP,Luke Musgrave,135,143,9481
TE,BUF,Dawson Knox,135,149,5906
RB,TEN,Michael Carter,135,124,7607
QB,DAL,Joe Milton,129,201,11557
QB,CIN,Joe Flacco,126,231,19
WR,CIN,Andrei Iosivas,124,120,10226
QB,TEN,Will Levis,116,142,9999
QB,HOU,Davis Mills,115,154,7585
QB,NOS,Spencer Rattler,114,188,11562
QB,CHI,Tyson Bagent,113,123,11256
QB,GBP,Kyle McCord,111,312,12494
QB,NYG,Jameis Winston,106,161,2306
WR,KCC,Tyquan Thornton,101,102,8188
RB,NOS,Audric Estime,100,88,
QB,LAR,Stetson Bennett,100,311,10857
TE,KCC,Noah Gray,99,108,7828
QB,PIT,Drew Allar,98,1529,13289
WR,NEP,Mack Hollins,90,94,4177
WR,LAC,KeAndre Lambert-Smith,89,86,12670
TE,LAR,Tyler Higbee,89,97,3271
TE,NOS,Noah Fant,88,95,5857
WR,NYG,Darius Slayton,87,87,6149
RB,SEA,George Holani,83,76,12048
WR,BUF,Joshua Palmer,82,76,
WR,WAS,Treylon Burks,80,77,8135
RB,WAS,Jerome Ford,79,70,8143
WR,DAL,KaVontae Turpin,75,72,8917
RB,DAL,Malik Davis,72,63,8800
QB,CLE,Taylen Green,72,845,13306
QB,PHI,Cole Payton,72,477,13335
QB,CLE,Dillon Gabriel,65,104,12486
RB,BUF,Ty Johnson,62,56,6039
WR,HOU,Xavier Hutchinson,61,59,10218
TE,CIN,Erick All,61,65,11592
RB,PHI,Will Shipley,61,52,11577
RB,NYG,Devin Singletary,61,55,6130
WR,CAR,Jimmy Horn,59,56,12523
TE,FA,Jonnu Smith,54,242,4144
QB,CAR,Kenny Pickett,53,95,8160
RB,DAL,Phil Mafah,47,42,12738
RB,CIN,Samaje Perine,44,39,4147
WR,ATL,Olamide Zaccheaus,37,38,6271
WR,WAS,Dyami Brown,36,36,7587
QB,LAC,Trey Lance,35,70,7610
QB,BAL,Tyler Huntley,34,52,7083
RB,GBP,Chris Brooks,33,30,11370
RB,DEN,Jaleel McLaughlin,33,31,11439
RB,GBP,Damien Martinez,32,27,12462
RB,CLE,Raheim Sanders,29,27,12472
WR,LAR,Konata Mumpfield,26,25,12718
RB,FA,Kareem Hunt,26,234,4098
TE,TEN,Daniel Bellinger,25,28,8225
WR,ARI,Kendrick Bourne,24,24,4454
WR,MIN,Tai Felton,19,18,12496
WR,CLE,Malachi Corley,17,17,11617
WR,MIA,Tutu Atwell,15,14,7562`;

/** Both joins minted in one parse. DYN_2026 keys engine slugs exactly the way
 *  ADP_2026 mints them (normName), so both bakes join the same pool rows;
 *  DYN_BY_SID keys Stathead's own sleeper_id and is immune to name drift. */
const byName = new Map<string, [number, number]>();
const bySid = new Map<string, [number, number]>();
for (const line of DYN_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 5) continue;
  const v1 = parseFloat(c[3]); const vs = parseFloat(c[4]);
  if (!Number.isFinite(v1) || !Number.isFinite(vs)) continue;
  const v: [number, number] = [v1, vs];
  const slug = normName(c[2]).replace(/\s+/g, '-');
  if (slug && !byName.has(slug)) byName.set(slug, v);
  const sid = (c[5] ?? '').trim();
  if (sid && !bySid.has(sid)) bySid.set(sid, v);
}
export const DYN_2026: Map<string, [number, number]> = byName;
export const DYN_BY_SID: Map<string, [number, number]> = bySid;

export const dynFor = (slug: string): number | null => {
  // ID first: the pool's slug→sleeper-id map is authoritative where a screen
  // has installed it; the name join both backfills the id-less rows and keeps
  // every screen working when no pool ids are loaded.
  const sid = slugSleeperId(slug);
  const v = (sid ? bySid.get(sid) : undefined) ?? byName.get(slug);
  return v ? (dynFormat === 'sf' ? v[1] : v[0]) : null;
};
