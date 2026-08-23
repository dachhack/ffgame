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
// via the Stathead MCP and run the scratch generator (gen-dyn.py) over it —
// it drops the rookie-pick rows, keeps the one surviving hand-edit (the
// board spells "Chigoziem Okonkwo" with NO sleeper_id, so neither join can
// reach him; the baked row says "Chig Okonkwo", the name our player index
// uses), and rewrites this file. Keep the as-of line current.
import { normName } from './players';
import { slugSleeperId } from './slugMeta';

/** Stathead dynasty market as of 2026-08-23. */
export const DYN_AS_OF = '2026-08-23';

/** Which market this league reads: superflex lineups price QBs very
 *  differently (Josh Allen: 5735 in 1QB, 10729 in SF). Installed per league
 *  by the screens that know the lineup (the setLiveAdp pattern). */
export type DynFormat = '1qb' | 'sf';
let dynFormat: DynFormat = '1qb';
export const setDynFormat = (f: DynFormat) => { dynFormat = f; };

const DYN_CSV = `RB,DET,Jahmyr Gibbs,11106,10187,9221
RB,ATL,Bijan Robinson,11033,10120,9509
WR,CIN,Ja'Marr Chase,9792,9796,7564
WR,SEA,Jaxon Smith-Njigba,8749,8752,9488
WR,LAR,Puka Nacua,8241,8244,9493
WR,DET,Amon-Ra St. Brown,7425,7428,7547
RB,LVR,Ashton Jeanty,7329,6722,12527
RB,ARI,Jeremiyah Love,7268,6666,13287
TE,LVR,Brock Bowers,6902,7549,11604
WR,MIN,Justin Jefferson,6884,6887,6794
RB,MIA,De'Von Achane,6650,6100,9226
WR,NYG,Malik Nabers,6609,6612,11632
RB,LAC,Omarion Hampton,6369,5842,12507
WR,DAL,CeeDee Lamb,6216,6219,6786
RB,IND,Jonathan Taylor,6139,5631,6813
RB,BUF,James Cook,5859,5374,8138
TE,ARI,Trey McBride,5823,6368,8130
QB,BUF,Josh Allen,5735,10729,4984
WR,ATL,Drake London,5656,5658,8112
WR,DAL,George Pickens,5183,5185,8137
RB,CIN,Chase Brown,4883,4479,9224
RB,SFO,Christian McCaffrey,4849,4448,4034
TE,CHI,Colston Loveland,4749,5194,12517
WR,CAR,Tetairoa McMillan,4713,4715,12526
RB,KCC,Kenneth Walker III,4711,4321,8151
WR,HOU,Nico Collins,4557,4559,7569
QB,NEP,Drake Maye,4538,8488,11564
RB,PHI,Saquon Barkley,4486,4114,4866
WR,TBB,Emeka Egbuka,4483,4485,12514
WR,TEN,Carnell Tate,4321,4322,13279
WR,NOS,Chris Olave,4312,4314,8144
WR,NEP,A.J. Brown,4242,4244,5859
TE,IND,Tyler Warren,4208,4602,12518
WR,LAC,Ladd McConkey,4002,4004,11635
WR,NYJ,Garrett Wilson,3991,3993,8146
QB,BAL,Lamar Jackson,3960,7407,4881
RB,CLE,Quinshon Judkins,3956,3628,12512
RB,NYJ,Breece Hall,3878,3557,8155
WR,BAL,Zay Flowers,3847,3848,9997
RB,LAR,Kyren Williams,3788,3474,8150
WR,PHI,DeVonta Smith,3771,3772,7525
QB,CHI,Caleb Williams,3742,7001,11560
QB,WAS,Jayden Daniels,3687,6897,11566
WR,CHI,Luther Burden,3660,3662,12519
RB,NEP,TreVeyon Henderson,3657,3354,12529
RB,SEA,Jadarian Price,3653,3351,13286
QB,CIN,Joe Burrow,3642,6813,6770
WR,KCC,Rashee Rice,3541,3542,10229
WR,NOS,Jordyn Tyson,3480,3481,13281
WR,CIN,Tee Higgins,3449,3450,6801
RB,NYG,Cam Skattebo,3384,3104,12481
RB,DAL,Javonte Williams,3381,3102,7588
RB,TBB,Bucky Irving,3360,3082,11584
WR,DEN,Jaylen Waddle,3329,3330,7526
RB,BAL,Derrick Henry,3273,3002,3198
WR,CHI,Rome Odunze,3270,3272,11620
WR,PHI,Makai Lemon,3135,3136,13294
QB,LAC,Justin Herbert,3133,5861,6797
TE,GBP,Tucker Kraft,3066,3354,9484
WR,ARI,Marvin Harrison Jr.,3059,3060,11628
RB,GBP,Josh Jacobs,3021,2771,5850
RB,NOS,Travis Etienne,3019,2769,7543
QB,PHI,Jalen Hurts,2984,5582,6904
WR,JAC,Brian Thomas Jr.,2984,2985,11631
WR,DET,Jameson Williams,2929,2930,8148
QB,KCC,Patrick Mahomes,2918,5460,4046
TE,CLE,Harold Fannin,2906,3179,12506
RB,JAC,Bhayshul Tuten,2885,2646,12490
TE,DET,Sam LaPorta,2826,3091,10859
QB,NYG,Jaxson Dart,2806,5250,12508
WR,CLE,KC Concepcion,2780,2782,13298
TE,ATL,Kyle Pitts,2690,2942,7553
QB,JAC,Trevor Lawrence,2644,4946,7523
QB,DEN,Bo Nix,2633,4926,11563
RB,CHI,D'Andre Swift,2602,2387,6790
WR,JAC,Parker Washington,2569,2570,9487
RB,HOU,David Montgomery,2468,2264,5892
WR,BUF,D.J. Moore,2455,2456,4983
TE,NYJ,Kenyon Sadiq,2336,2554,13330
WR,SFO,De'Zhaun Stribling,2312,2313,13417
QB,SFO,Brock Purdy,2225,4162,8183
QB,LVR,Fernando Mendoza,2205,4125,13269
RB,CAR,Jonathon Brooks,2203,2021,11583
QB,GBP,Jordan Love,2202,4120,6804
QB,DAL,Dak Prescott,2195,4107,3294
WR,LAR,Davante Adams,2184,2185,2133
WR,CLE,Denzel Boston,2178,2179,13346
RB,PIT,Jaylen Warren,2153,1975,8228
WR,GBP,Christian Watson,2148,2149,8167
RB,DEN,RJ Harvey,2123,1947,12489
WR,WAS,Terry McLaurin,2095,2096,5927
WR,ARI,Michael Wilson,2088,2088,10232
WR,MIN,Jordan Addison,2081,2082,9756
RB,LAR,Blake Corum,2038,1869,11586
TE,SFO,George Kittle,2031,2221,4217
WR,GBP,Matthew Golden,2029,2030,12501
RB,DEN,Jonah Coleman,2008,1842,13345
WR,PIT,DK Metcalf,1957,1958,5846
QB,DET,Jared Goff,1932,3614,3163
WR,IND,Josh Downs,1925,1926,9500
WR,IND,Alec Pierce,1905,1905,8142
TE,NYG,Isaiah Likely,1896,2074,8131
RB,WAS,Jacory Croskey-Merritt,1892,1736,12533
QB,TEN,Cam Ward,1889,3534,12522
RB,CAR,Chuba Hubbard,1882,1726,7594
WR,LAC,Quentin Johnston,1867,1868,9754
WR,SFO,Mike Evans,1849,1850,2216
WR,TEN,Wan'Dale Robinson,1823,1824,8126
QB,NOS,Tyler Shough,1820,3404,12545
RB,CHI,Kyle Monangai,1818,1667,12534
WR,BAL,Ja'Kobi Lane,1816,1817,13293
TE,BUF,Dalton Kincaid,1815,1985,10236
WR,PIT,Michael Pittman,1813,1814,6819
RB,PIT,Rico Dowdle,1799,1650,7021
RB,SEA,Zach Charbonnet,1798,1649,9753
TE,PHI,Eli Stowers,1784,1951,13349
WR,NYJ,Omar Cooper Jr.,1783,1784,13276
QB,TBB,Baker Mayfield,1770,3311,4892
RB,NEP,Rhamondre Stevenson,1770,1624,7611
RB,MIN,Jordan Mason,1766,1620,8408
WR,GBP,Jayden Reed,1735,1735,10222
QB,HOU,C.J. Stroud,1705,3189,9758
WR,JAC,Travis Hunter,1699,1700,12530
WR,HOU,Jayden Higgins,1680,1681,12484
RB,TEN,Nicholas Singleton,1676,1537,13288
WR,KCC,Xavier Worthy,1675,1676,11624
RB,TEN,Tony Pollard,1675,1536,5967
RB,LVR,Mike Washington Jr.,1639,1503,13305
RB,ARI,Tyler Allgeier,1627,1493,8132
WR,TBB,Chris Godwin,1617,1617,4037
RB,DEN,J.K. Dobbins,1613,1480,6806
RB,TBB,Kenneth Gainwell,1602,1481,7567
TE,DAL,Jake Ferguson,1595,1745,8110
RB,HOU,Woody Marks,1595,1463,12474
WR,NEP,Romeo Doubs,1586,1587,8121
QB,MIN,Kyler Murray,1583,2961,5849
RB,WAS,Rachaad White,1567,1437,8136
WR,CAR,Jalen Coker,1557,1557,11646
QB,LAR,Matthew Stafford,1541,2883,421
WR,KCC,Cyrus Allen,1540,1541,13413
WR,DEN,Courtland Sutton,1521,1522,5045
QB,SEA,Sam Darnold,1520,2843,4943
TE,KCC,Travis Kelce,1494,1634,1466
WR,DEN,Pat Bryant,1487,1488,12492
WR,HOU,Tank Dell,1484,1484,9502
RB,SFO,Kaelon Black,1483,1361,13414
WR,NYG,Malachi Fields,1478,1479,13285
TE,LAC,Oronde Gadsden,1477,1615,12493
WR,WAS,Stefon Diggs,1453,1453,2449
TE,LAR,Terrance Ferguson,1449,1584,12487
RB,PHI,Tank Bigsby,1444,1325,9225
WR,SFO,Ricky Pearsall,1429,1430,11638
TE,BAL,Mark Andrews,1419,1552,5012
QB,CAR,Bryce Young,1417,2651,9228
RB,CLE,Dylan Sampson,1411,1294,12469
RB,JAC,Chris Rodriguez,1404,1287,10219
WR,WAS,Antonio Williams,1403,1403,13301
WR,BUF,Khalil Shakir,1403,1404,8134
RB,LAC,Keaton Mitchell,1391,1276,9511
QB,MIA,Malik Willis,1372,2567,8161
WR,MIA,Chris Bell,1369,1369,13311
WR,LAC,Tre Harris,1368,1368,12509
WR,TBB,Jalen McMillan,1366,1366,11618
TE,JAC,Brenton Strange,1364,1492,9480
RB,NYJ,Braelon Allen,1362,1249,11576
RB,GBP,MarShawn Lloyd,1346,1234,11581
WR,JAC,Jakobi Meyers,1344,1344,5947
QB,IND,Daniel Jones,1336,2499,5870
WR,SEA,Rashid Shaheed,1326,1326,8676
TE,MIN,T.J. Hockenson,1321,1445,5844
TE,SEA,AJ Barner,1320,1444,11603
RB,TEN,Tyjae Spears,1315,1207,9508
WR,LVR,Jalen Nailor,1300,1301,8180
TE,PHI,Dallas Goedert,1298,1419,5022
WR,SFO,Deebo Samuel,1298,1298,5872
TE,TEN,Gunnar Helm,1295,1416,12502
TE,NOS,Juwan Johnson,1290,1411,7002
WR,MIA,Caleb Douglas,1288,1289,13296
QB,LAR,Ty Simpson,1283,2401,13275
WR,ATL,Zachariah Branch,1261,1261,13320
RB,ATL,Brian Robinson,1260,1156,8154
RB,NYG,Tyrone Tracy,1257,1153,11655
RB,NOS,Alvin Kamara,1251,1147,4035
RB,DET,Isiah Pacheco,1250,1147,8205
WR,LVR,Tre Tucker,1245,1245,10213
WR,PIT,Germie Bernard,1233,1234,13274
WR,MIA,Malik Washington,1207,1208,11610
RB,MIN,Aaron Jones,1206,1106,4199
WR,NYJ,Adonai Mitchell,1189,1190,11625
WR,PHI,Dontayvion Wicks,1188,1188,9486
WR,HOU,Jaylin Noel,1177,1177,12536
TE,HOU,Dalton Schultz,1177,1288,5001
TE,NEP,Hunter Henry,1170,1280,3214
WR,TBB,Ted Hurst,1149,1149,13317
RB,KCC,Emmett Johnson,1143,1048,13337
WR,DET,Isaac TeSlaa,1137,1138,12535
RB,NYG,Najee Harris,1111,1019,7528
RB,MIN,Demond Claiborne,1098,1007,13347
WR,NEP,Kayshon Boutte,1086,1087,9504
WR,CLE,Jerry Jeudy,1079,1080,6783
WR,IND,Keenan Allen,1052,1053,1479
TE,WAS,Chig Okonkwo,1038,1139,
WR,SEA,Tory Horton,1010,1010,12497
RB,WAS,Kaytron Allen,1003,920,13405
RB,DAL,Jaydon Blue,983,902,12457
WR,MIN,Jauan Jennings,965,966,7049
WR,BUF,Keon Coleman,957,957,11637
RB,PIT,Kaleb Johnson,950,872,12504
WR,BAL,Elijah Sarratt,934,934,13268
WR,DEN,Troy Franklin,925,926,11627
TE,NEP,Eli Raridon,914,1000,13421
QB,CLE,Shedeur Sanders,848,1587,12524
WR,LVR,Jack Bech,847,847,12483
RB,LAC,Kimani Vidal,844,774,11647
TE,MIA,Greg Dulcich,844,923,8172
TE,TBB,Cade Otton,837,915,8111
QB,ATL,Tua Tagovailoa,834,1561,6768
QB,ARI,Carson Beck,822,1539,13272
QB,MIN,J.J. McCarthy,815,1524,11565
QB,ATL,Michael Penix Jr.,787,1472,11559
QB,ARI,Jacoby Brissett,787,1473,3257
TE,LAC,David Njoku,782,855,4033
RB,BAL,Adam Randall,774,710,13302
WR,FA,Tyreek Hill,773,773,3321
RB,MIA,Ollie Gordon,762,699,12495
WR,CLE,Cedric Tillman,760,763,10444
QB,NYJ,Geno Smith,750,1403,1373
RB,GBP,Damien Martinez,738,665,12462
WR,TEN,Elic Ayomanor,734,735,12499
WR,BUF,Joshua Palmer,727,746,
TE,PIT,Pat Freiermuth,705,771,7600
QB,PIT,Aaron Rodgers,704,1317,96
WR,BUF,Skyler Bell,699,699,13402
QB,CLE,Deshaun Watson,694,1298,4017
WR,DAL,Ryan Flournoy,691,691,11783
WR,SFO,Brandon Aiyuk,689,689,6803
RB,DEN,Jaleel McLaughlin,686,643,11439
TE,LVR,Michael Mayer,658,720,9482
RB,ARI,Trey Benson,646,592,11589
RB,WAS,Jerome Ford,641,599,8143
WR,BAL,Devontez Walker,640,643,11629
TE,NYJ,Mason Taylor,636,696,12498
RB,BUF,Ray Davis,635,582,11575
WR,MIN,Tai Felton,634,640,12496
RB,BAL,Rasheen Ali,634,607,11570
RB,SFO,Jordan James,627,576,12467
QB,LVR,Kirk Cousins,627,1172,1166
WR,NYG,Jalin Hyatt,626,641,9497
WR,TEN,Chimere Dike,611,612,12540
RB,CLE,Raheim Sanders,610,585,12472
TE,SEA,Elijah Arroyo,607,664,12521
RB,MIA,Jaylen Wright,605,555,11643
WR,MIA,Tahj Washington,597,625,11821
TE,LAR,Max Klare,583,638,13278
WR,PHI,Elijah Moore,579,595,7596
WR,BAL,Rashod Bateman,578,578,7571
WR,NOS,Trey Palmer,575,586,9492
WR,NEP,Kyle Williams,572,572,
WR,DET,Greg Dortch,571,600,5970
RB,MIA,Donovan Edwards,571,572,12515
WR,TEN,Calvin Ridley,568,568,4981
TE,NYG,Theo Johnson,564,617,11597
RB,TEN,Kalel Mullings,564,551,12516
WR,SEA,Cooper Kupp,563,563,4039
WR,NOS,Bryce Lance,560,560,13420
WR,ARI,Kendrick Bourne,559,578,4454
WR,CLE,Malachi Corley,558,583,11617
RB,ARI,Bam Knight,555,519,8122
WR,SFO,Jacob Cowing,553,561,11616
RB,TBB,Sean Tucker,550,504,9506
WR,LVR,Malik Benson,550,550,13329
WR,TBB,Kameron Johnson,550,600,11994
TE,SFO,Jake Tonges,536,586,8698
QB,IND,Anthony Richardson,525,983,9229
WR,CAR,Chris Brazzell II,519,519,13353
RB,IND,DJ Giddens,516,473,12471
TE,DEN,Justin Joly,515,563,13400
RB,ATL,Tyler Goodson,514,501,8207
WR,CAR,Xavier Legette,509,510,11626
WR,TEN,Xavier Restrepo,508,535,12520
RB,ARI,James Conner,505,463,4137
WR,BUF,Gabriel Davis,500,538,
RB,DAL,Israel Abanikanda,496,491,9227
RB,PHI,Dameon Pierce,495,472,8129
RB,DEN,Tyler Badie,492,471,8208
WR,NOS,Barion Brown,485,485,
TE,HOU,Cade Stover,482,545,11599
RB,MIA,Le'Veon Moss,482,451,13300
TE,NOS,Oscar Delp,480,525,13319
TE,CAR,Darren Waller,480,525,2505
WR,CLE,Isaiah Bond,474,474,12503
WR,CLE,David Bell,472,494,8118
RB,BUF,Frank Gore Jr.,469,461,232
WR,SFO,Javon Baker,468,476,11645
TE,CAR,Tommy Tremble,462,508,7694
RB,TEN,Michael Carter,462,438,7607
QB,SFO,Mac Jones,461,863,7527
RB,CIN,Kendall Milton,457,451,11649
RB,NYJ,Isaiah Davis,453,415,11571
WR,DAL,Jonathan Mingo,453,471,10225
RB,DET,Sione Vaki,450,439,11729
TE,LAR,Tyler Higbee,447,523,3271
WR,SEA,Jake Bobo,446,446,10867
WR,LAR,Tyler Scott,441,452,9490
WR,NYG,Darnell Mooney,439,439,7090
RB,IND,Seth McGowan,439,403,13424
WR,NYG,Isaiah Hodgins,439,475,6920
TE,DEN,Evan Engram,433,474,4066
WR,NEP,Mack Hollins,433,479,4177
WR,NYG,Xavier Gipson,418,443,11306
WR,NOS,Devaughn Vele,415,415,11834
TE,LAR,Colby Parkinson,414,453,6865
TE,ARI,Elijah Higgins,414,472,10231
TE,CAR,Mitchell Evans,410,474,12473
WR,CHI,Zavion Thomas,408,408,13411
WR,BUF,Tyrell Shavers,408,389,11377
WR,NYJ,Arian Smith,407,427,12539
RB,SEA,Emanuel Wilson,404,370,11435
WR,NOS,Bub Means,402,392,11748
TE,DAL,Luke Schoonmaker,401,453,10871
WR,NOS,Mason Tipton,389,411,11895
WR,GBP,Bo Melton,386,402,
WR,ARI,Reggie Virgil,383,395,13297
TE,BAL,Matthew Hibner,380,477,
TE,LAR,Davis Allen,376,392,10214
WR,PHI,Johnny Wilson,370,372,11636
RB,CAR,AJ Dillon,365,338,6828
QB,NYJ,Cade Klubnik,364,682,13303
TE,HOU,Brevin Jordan,363,396,7568
RB,JAC,LeQuint Allen,362,332,12544
RB,NEP,Hassan Haskins,355,341,8123
WR,TBB,Tez Johnson,347,347,12485
RB,HOU,Jawhar Jordan,346,307,11588
WR,DEN,Marvin Mims,343,343,9494
WR,MIA,Kevin Coleman,338,338,13338
WR,SFO,Demarcus Robinson,338,363,3286
WR,LAC,Brenen Thompson,337,337,13380
RB,SFO,Sincere McCormick,337,312,8220
TE,KCC,Jared Wiley,332,360,11595
WR,DEN,Lil'Jordan Humphrey,330,341,5938
RB,ATL,Nathan Carter,330,254,
RB,NOS,Devin Neal,328,301,12476
WR,KCC,Tyquan Thornton,313,313,8188
WR,LAC,Derius Davis,312,296,10234
RB,SEA,George Holani,310,284,12048
RB,MIA,Alexander Mattison,306,269,5987
RB,PIT,Eli Heidenreich,304,278,13423
RB,DET,Trayveon Williams,292,287,6144
TE,CHI,Cole Kmet,291,319,6826
RB,NOS,Ty Chandler,286,270,8230
RB,SFO,Zamir White,286,264,8139
WR,BUF,Mecole Hardman,284,277,5917
QB,KCC,Justin Fields,280,524,7591
RB,LVR,Dylan Laube,278,246,11574
WR,CIN,Colbie Young,277,277,13477
TE,DET,Brock Wright,275,327,7891
RB,MIN,Zavier Scott,273,259,11299
RB,WAS,Jeremy McNichols,266,239,4219
WR,BAL,LaJohntay Wester,263,248,12699
WR,ATL,Malik Heath,262,257,11210
WR,NEP,Demario Douglas,259,260,9501
WR,KCC,Jalen Royals,256,256,12505
TE,HOU,Marlin Klein,256,280,13307
WR,CLE,Jamari Thrash,256,260,11633
QB,SEA,Jalen Milroe,255,478,12510
RB,BAL,Justice Hill,254,233,5995
WR,HOU,Xavier Hutchinson,251,251,10218
QB,DAL,Sam Howell,245,602,8162
TE,PIT,Darnell Washington,242,265,9479
WR,DAL,Tyler Johnson,242,248,6960
QB,BAL,Tyler Huntley,241,680,7083
WR,CLE,Tylan Wallace,236,227,7595
WR,LAR,CJ Daniels,235,235,13270
QB,NOS,Zach Wilson,234,339,7538
WR,SFO,Christian Kirk,232,232,4950
WR,ATL,Jahan Dotson,232,232,8119
TE,CAR,Ja'Tavion Sanders,226,247,11600
RB,CAR,Trevor Etienne,224,206,12531
WR,WAS,Van Jefferson,224,223,6853
WR,LVR,Dont'e Thornton,220,220,12541
WR,FA,Brenden Rice,216,225,11621
TE,JAC,Tanner Koziol,215,235,13408
TE,CIN,Erick All,211,231,11592
WR,PHI,Marquise Brown,209,209,5848
RB,CIN,Tahj Brooks,204,187,12543
QB,PHI,Tanner McKee,195,81,9230
WR,WAS,Luke McCaffrey,183,183,11650
QB,PIT,Will Howard,182,341,12511
TE,JAC,Hunter Long,173,194,7535
RB,KCC,Brashard Smith,170,156,12455
RB,GBP,Chris Brooks,169,155,11370
WR,IND,Deion Burks,169,169,13333
QB,CIN,Joe Flacco,169,317,19
QB,SEA,Drew Lock,169,533,5854
TE,GBP,Luke Musgrave,168,183,9481
WR,CIN,Andrei Iosivas,167,167,10226
RB,NEP,Jam Miller,164,151,13403
WR,WAS,Treylon Burks,163,163,8135
QB,ARI,Gardner Minshew,162,153,6011
RB,CIN,Samaje Perine,159,145,4147
RB,JAC,J'Mari Taylor,156,144,13348
TE,WAS,Ben Sinnott,155,169,11596
WR,GBP,Savion Williams,154,154,12482
RB,LAR,Jarquez Hunter,148,136,11569
QB,KCC,Garrett Nussmeier,144,269,13404
WR,NYG,Calvin Austin III,137,137,8125
WR,PIT,Roman Wilson,133,134,11630
QB,NYG,Jameis Winston,133,248,2306
QB,WAS,Marcus Mariota,133,248,2307
TE,DAL,Michael Trigg,131,143,13401
TE,CHI,Sam Roush,131,144,13322
RB,DAL,Malik Davis,130,119,8800
WR,CAR,John Metchie,127,127,8147
TE,KCC,Noah Gray,127,139,7828
WR,NYG,Darius Slayton,125,125,6149
RB,BUF,Ty Johnson,123,113,6039
QB,IND,Riley Leonard,123,230,12470
TE,CIN,Jack Endries,121,132,13282
WR,MIA,Jalen Tolbert,120,120,8117
QB,HOU,Davis Mills,118,159,7585
QB,CHI,Tyson Bagent,116,125,11256
TE,CIN,Mike Gesicki,114,125,4993
QB,DAL,Joe Milton,114,213,11557
QB,GBP,Kyle McCord,114,345,12494
TE,BUF,Dawson Knox,113,124,5906
WR,WAS,Jaylin Lane,112,112,12641
RB,KCC,Emari Demercado,111,102,11199
RB,NOS,Kendre Miller,102,94,9757
QB,LAR,Stetson Bennett,102,343,10857
QB,PIT,Drew Allar,101,1651,13289
RB,NYG,Devin Singletary,100,92,6130
WR,MIA,Tutu Atwell,87,87,7562
WR,DAL,KaVontae Turpin,79,79,8917
QB,CLE,Taylen Green,74,275,13306
QB,PHI,Cole Payton,74,526,13335
TE,LAC,Charlie Kolar,72,78,8127
RB,PHI,Will Shipley,69,63,11577
QB,MIA,Quinn Ewers,69,129,12500
QB,NOS,Spencer Rattler,68,127,11562
RB,CHI,Roschon Johnson,67,61,10235
RB,SFO,Isaac Guerendo,65,59,11651
WR,LAR,Jordan Whittington,58,58,11623
QB,CLE,Dillon Gabriel,53,100,12486
WR,CAR,Jimmy Horn,51,51,12523
WR,SFO,Jordan Watkins,49,49,12634
QB,LAC,Trey Lance,48,89,7610
RB,FA,Kareem Hunt,47,234,4098
WR,LAC,KeAndre Lambert-Smith,44,44,12670
WR,LAR,Konata Mumpfield,44,44,12718
WR,IND,Nick Westbrook-Ikhine,44,44,7496
RB,FA,Khalil Herbert,43,39,7608
WR,WAS,Dyami Brown,37,37,7587
RB,NOS,Audric Estime,36,33,
WR,ATL,Olamide Zaccheaus,33,33,6271
RB,DAL,Phil Mafah,31,28,12738
QB,TEN,Will Levis,29,53,9999
TE,TEN,Daniel Bellinger,27,30,8225
TE,NOS,Noah Fant,24,27,5857
WR,CHI,Jahdae Walker,19,19,13079
WR,NEP,Efton Chism,18,18,12542
WR,GBP,Skyy Moore,18,18,8168
TE,FA,Jonnu Smith,14,203,4144
QB,CAR,Kenny Pickett,9,18,8160
WR,LVR,Noah Brown,9,226,4234`;

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
