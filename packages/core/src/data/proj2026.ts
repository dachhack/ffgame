// GENERATED — StatHead 2026 season projections (PPR projected points per game),
// baked for the native-league draft room's rankings + player cards, and the
// pod/showdown deal pool (server/src/pods.js dealPpg). Source: Stathead MCP
// `get_projections` (veterans: 60% 2025 actual + 40% 2yr avg + age curve;
// rookies: rookie career model with pick-based Y1 discount).
//
// REFRESH alongside adp2026.ts: pull
//   get_projections { limit: 1000, output_format: 'csv',
//                     fields: 'player_name,position,ppg,sleeper_id' }
// via the Stathead MCP and replace PROJ_CSV. Names join to engine slugs via
// normName (same convention as ADP and the live-scoring player index); the
// sleeper_id column is the EXACT join — display names drift between sources
// ("Omar Cooper Jr." vs "Omar Cooper"), Sleeper ids don't.
//
// ── WHY THE STORED NUMBER IS NOT StatHead's `ppg` (v0.307.0) ───────────────
// The CSV below keeps StatHead's columns verbatim — `ppg` and `games` — and
// PROJ_2026 stores `ppg * games / 17`. That is deliberate, and it is the whole
// reason this file could be refreshed at all.
//
// StatHead's `ppg` is projected points / projected GAMES: a rate conditional on
// playing. For a starter that is a weekly expectation. For a backup it is not —
// Nick Mullens comes back at 21.0 off a ONE-game denominator, above Lamar
// Jackson (16.6) and Mahomes (16.5), and the inversion happens within a team
// (Trey Lance 19.0 over Herbert 17.75 on the same LAC depth chart). StatHead
// confirmed the diagnosis and shipped `games`, `projPts` and a `min_games`
// filter in 1.0.66 so consumers can see and correct it.
//
// This file cannot simply switch to `projPts`. PROJ_2026 is read as a PER-WEEK
// number — `buildMatchupBoard` puts it in `proj` and sums it into a projected
// team total, and `slateAwareProj` ranks a roster with it — so a season total
// would render 346 projected points for one week.
//
// `ppg * games / 17` is the per-week form of the same figure: expected points
// in a randomly chosen week of the season, availability included. It is immune
// to the denominator (a 1-game backup lands near zero), it keeps the scale
// every consumer already expects, and it reproduces the shape the old April
// spine had — Joe Milton 1.1 here against 2.6 in the April bake, where the raw
// live `ppg` would have put him at 19.0.
//
// KNOWN COST, from StatHead directly: `games` is sometimes wrong. Justin Fields
// is projected 2 games on KC, which is a depth-chart error in their pool, not a
// presentation one — so he stores 2.6 where he may well start. Understating a
// player the model has mis-rostered is the failure we accept; the alternative
// was ranking him above Josh Allen.
//
// REFRESH: re-pull the CSV (`fields: 'player_name,position,ppg,games,sleeper_id'`,
// `sort_by: 'projPts'` so the real starter wins a contested slug) and replace
// PROJ_CSV. Do it on a schedule — the inputs that move the board (ADP, depth
// charts) move daily through cutdowns.
// ───────────────────────────────────────────────────────────────────────────
import { normName } from './players';

/** Live StatHead pool, pulled 2026-08-19T14:17:42Z (445 players + games + sleeper ids). */
export const PROJ_AS_OF = '2026-08-19';

const PROJ_CSV = `Christian McCaffrey,RB,26.53,17,4034
Jahmyr Gibbs,RB,26,17,9221
Jonathan Taylor,RB,24.59,17,6813
Bijan Robinson,RB,21.59,17,9509
Josh Allen,QB,21.63,16,4984
De'Von Achane,RB,20.88,16,9226
Amon-Ra St. Brown,WR,19.29,17,7547
Ashton Jeanty,RB,19.06,17,12527
Jalen Hurts,QB,19.88,16,6904
Drake Maye,QB,19.75,16,11564
Puka Nacua,WR,19.50,16,9493
Trevor Lawrence,QB,19.38,16,7523
Chase Brown,RB,17.94,17,9224
Derrick Henry,RB,17.71,17,3198
Bo Nix,QB,18.38,16,11563
Caleb Williams,QB,18.31,16,11560
Jaxon Smith-Njigba,WR,17.06,17,9488
Ja'Marr Chase,WR,18.06,16,7564
Trey McBride,TE,16.88,17,8130
Justin Herbert,QB,17.75,16,6797
Matthew Stafford,QB,17.63,16,421
Dak Prescott,QB,17.63,16,3294
James Cook III,RB,16.59,17,8138
Jacoby Brissett,QB,18.67,15,3257
Josh Jacobs,RB,18.47,15,5850
Javonte Williams,RB,17.31,16,7588
Jaxson Dart,QB,18.33,15,12508
Jared Goff,QB,17.06,16,3163
Baker Mayfield,QB,16.88,16,4892
Saquon Barkley,RB,16.50,16,4866
Bryce Young,QB,16.38,16,9228
Aaron Rodgers,QB,16.31,16,96
Chris Olave,WR,16.31,16,8144
Justin Jefferson,WR,15.24,17,6794
CeeDee Lamb,WR,17.93,14,6786
C.J. Stroud,QB,16.67,15,9758
Kyren Williams,RB,14.71,17,8150
TreVeyon Henderson,RB,14.71,17,12529
Zay Flowers,WR,14.71,17,9997
Jordan Love,QB,16.60,15,6804
Cam Ward,QB,15.56,16,12522
Patrick Mahomes,QB,16.47,15,4046
Daniel Jones,QB,17.64,14,5870
Kenneth Walker,RB,14.53,17,8151
Brock Purdy,QB,16.27,15,8183
Breece Hall,RB,15.25,16,8155
Sam Darnold,QB,15.13,16,4943
D'Andre Swift,RB,15.13,16,6790
Omarion Hampton,RB,16.07,15,12507
Tyler Shough,QB,16,15,12545
Malik Willis,QB,17.14,14,8161
Chuba Hubbard,RB,15.93,15,7594
Jayden Daniels,QB,17,14,11566
Cam Skattebo,RB,17,14,12481
Joe Burrow,QB,16.79,14,6770
Geno Smith,QB,15.60,15,1373
Michael Penix Jr.,QB,15.60,15,11559
Drake London,WR,15.60,15,8112
Wan'Dale Robinson,WR,14.63,16,8126
A.J. Brown,WR,15.53,15,5859
Lamar Jackson,QB,16.57,14,4881
Emeka Egbuka,WR,13.35,17,12514
Rashee Rice,WR,16.14,14,10229
Tyler Warren,TE,13.29,17,12518
Travis Etienne Jr.,RB,13.18,17,7543
DeVonta Smith,WR,13.18,17,7525
Quinshon Judkins,RB,14.80,15,12512
Ladd McConkey,WR,13.88,16,11635
Jameson Williams,WR,12.94,17,8148
Kyler Murray,QB,15.64,14,5849
Travis Kelce,TE,12.76,17,1466
Zach Charbonnet,RB,13.38,16,9753
Davante Adams,WR,14.27,15,2133
Kirk Cousins,QB,14.20,15,1166
Bucky Irving,RB,14.20,15,11584
Marvin Harrison Jr.,WR,14.13,15,11628
Nico Collins,WR,14.13,15,7569
Kenneth Gainwell,RB,12.41,17,7567
Colston Loveland,TE,13.19,16,12517
Bhayshul Tuten,RB,13.87,15,12490
Brock Bowers,TE,13.87,15,11604
Tony Pollard,RB,12.18,17,5967
RJ Harvey,RB,12.18,17,12489
Courtland Sutton,WR,12.18,17,5045
George Pickens,WR,12.12,17,8137
Tetairoa McMillan,WR,12.12,17,12526
DK Metcalf,WR,13.60,15,5846
David Montgomery,RB,11.94,17,5892
Brian Thomas Jr.,WR,13.53,15,11631
Tee Higgins,WR,13.47,15,6801
Shedeur Sanders,QB,14.29,14,12524
Malik Nabers,WR,14.21,14,11632
Jaylen Warren,RB,12.38,16,8228
Rico Dowdle,RB,11.47,17,7021
Michael Pittman Jr.,WR,11.47,17,6819
Tucker Kraft,TE,13.93,14,9484
Jacory Croskey-Merritt,RB,11.41,17,12533
Jaylen Waddle,WR,12.06,16,7526
Garrett Wilson,WR,13.64,14,8146
Jake Ferguson,TE,11.12,17,8110
Hunter Henry,TE,11.06,17,3214
Tyler Allgeier,RB,10.88,17,8132
Sam LaPorta,TE,12.27,15,10859
Aaron Jones Sr.,RB,12.20,15,4199
Jordan Mason,RB,11.38,16,8408
George Kittle,TE,12,15,4217
Rome Odunze,WR,11.93,15,11620
Tre Tucker,WR,10.53,17,10213
Chig Okonkwo,TE,10.53,17,8210
DJ Moore,WR,10.41,17,4983
Rhamondre Stevenson,RB,11.73,15,7611
Marvin Mims Jr.,WR,11.60,15,9494
Jerry Jeudy,WR,10.18,17,6783
Rachaad White,RB,10.12,17,8136
Blake Corum,RB,10.06,17,11586
Jakobi Meyers,WR,10.63,16,5947
Harold Fannin Jr.,TE,10.56,16,12506
Kyle Monangai,RB,9.76,17,12534
Parker Washington,WR,10.31,16,9487
Dalton Schultz,TE,9.71,17,5001
Dalton Kincaid,TE,11,15,10236
Tyrone Tracy Jr.,RB,10.93,15,11655
Terry McLaurin,WR,10.93,15,5927
Mark Andrews,TE,9.65,17,5012
Bam Knight,RB,11.64,14,8122
Greg Dulcich,TE,10.87,15,8172
AJ Barner,TE,9.53,17,11603
Quentin Johnston,WR,11.50,14,9754
Jalen Nailor,WR,9.41,17,8180
Dallas Goedert,TE,10.60,15,5022
Jordan Addison,WR,10.53,15,9756
J.K. Dobbins,RB,10.47,15,6806
Josh Downs,WR,9.81,16,9500
Romeo Doubs,WR,9.81,16,8121
Zavion Thomas,WR,11.07,14,13411
Kyle Pitts Sr.,TE,9.12,17,7553
Rashid Shaheed,WR,9,17,8676
Jayden Higgins,WR,9,17,12484
Oronde Gadsden,TE,10.20,15,12493
Christian Watson,WR,10,15,8167
Pat Freiermuth,TE,10,15,7600
Makai Lemon,WR,10.43,14,13294
Michael Wilson,WR,8.53,17,10232
Malik Washington,WR,8.53,17,11610
Alec Pierce,WR,9.60,15,8142
Dylan Sampson,RB,9.53,15,12469
Carnell Tate,WR,10.14,14,13279
Brenton Strange,TE,9.33,15,9480
Tank Bigsby,RB,9.27,15,9225
Khalil Shakir,WR,8.63,16,8134
Colby Parkinson,TE,9.20,15,6865
Woody Marks,RB,8.50,16,12474
Brenen Thompson,WR,9.71,14,13380
Evan Engram,TE,8.50,16,4066
Cade Otton,TE,9,15,8111
Calvin Ridley,WR,12,11,4981
Brian Robinson,RB,7.65,17,8154
Tyjae Spears,RB,9.14,14,9508
Isaiah Likely,TE,8.53,15,8131
T.J. Hockenson,TE,8.40,15,5844
Isaiah Davis,RB,7.69,16,11571
Keon Coleman,WR,8.71,14,11637
Theo Johnson,TE,8.07,15,11597
Michael Carter,RB,8.57,14,7607
Mike Evans,WR,8.57,14,2216
Gunnar Helm,TE,7.50,16,12502
Xavier Worthy,WR,7.93,15,11624
Juwan Johnson,TE,7,17,7002
Chris Rodriguez Jr.,RB,8.43,14,10219
Jordyn Tyson,WR,8.43,14,13281
Samaje Perine,RB,7.80,15,4147
Chimere Dike,WR,6.82,17,12540
Sam Roush,TE,8.29,14,13322
Justice Hill,RB,9.50,12,5995
Jack Bech,WR,7.60,15,12483
Isiah Pacheco,RB,8.07,14,8205
Kayshon Boutte,WR,7.53,15,9504
DeMario Douglas,WR,7,16,9501
Jaylin Noel,WR,6.53,17,12536
Xavier Hutchinson,WR,6.94,16,10218
Mike Gesicki,TE,7.40,15,4993
Cooper Kupp,WR,6.88,16,4039
Xavier Legette,WR,7.27,15,11626
Dontayvion Wicks,WR,7.64,14,9486
Chris Godwin Jr.,WR,8.92,12,4037
Devin Singletary,RB,6.24,17,6130
Matthew Golden,WR,7.07,15,12501
Emari Demercado,RB,7.50,14,11199
Andrei Iosivas,WR,6.93,15,10226
Dawson Knox,TE,6.50,16,5906
Jalen Coker,WR,7.92,13,11646
Emanuel Wilson,RB,6,17,11435
Darnell Mooney,WR,6.80,15,7090
Troy Franklin,WR,5.94,17,11627
Kenyon Sadiq,TE,7.21,14,13330
Omar Cooper Jr.,WR,7.14,14,13276
KC Concepcion,WR,7.14,14,13298
Ty Johnson,RB,5.82,17,6039
Chris Brooks,RB,5.76,17,11370
Alvin Kamara,RB,7.54,13,4035
Ray Davis,RB,5.71,17,11575
Ricky Pearsall,WR,8.08,12,11638
Pat Bryant,WR,6.93,14,12492
Jauan Jennings,WR,6.40,15,7049
Sean Tucker,RB,5.53,17,9506
Rashod Bateman,WR,6.71,14,7571
LeQuint Allen Jr.,RB,5.75,16,12544
Oscar Delp,TE,6.50,14,13319
Keaton Mitchell,RB,6.43,14,9511
Trevor Etienne,RB,5.24,17,12531
Denzel Boston,WR,6.36,14,13346
Tank Dell,WR,6.36,14,9502
Greg Dortch,WR,6.29,14,5970
Mason Taylor,TE,6.29,14,12498
Adonai Mitchell,WR,5.44,16,11625
Elic Ayomanor,WR,5.38,16,12499
Britain Covey,WR,8.50,10,8414
De'Zhaun Stribling,WR,6.07,14,13417
Jackson Hawes,TE,6.07,14,12658
Zachariah Branch,WR,5.93,14,13320
Jaylen Wright,RB,6.83,12,11643
Trey Palmer,WR,5.79,14,9492
Chris Brazzell,WR,5.71,14,13353
Antonio Williams,WR,5.57,14,13301
Kyle Williams,WR,5.20,15,
Ja'Tavion Sanders,TE,5.20,15,11600
Will Kacmarek,TE,5.57,14,13434
Ameer Abdullah,RB,5.50,14,2359
Jake Tonges,TE,6.42,12,8698
David Njoku,TE,5.92,13,4033
Brashard Smith,RB,4.47,17,12455
Darius Slayton,WR,5.07,15,6149
Caleb Douglas,WR,5.43,14,13296
Devin Neal,RB,6.25,12,12476
Darnell Washington,TE,5.36,14,9479
Michael Mayer,TE,5.29,14,9482
Kaleb Johnson,RB,6.08,12,12504
Jaren Kanak,TE,5.21,14,13422
Jayden Reed,WR,8,9,10222
Nikko Remigio,WR,4.80,15,11320
Tory Horton,WR,6.55,11,12497
Jordan Whittington,WR,4.73,15,11623
KaVontae Turpin,WR,4.73,15,8917
Ryan Flournoy,WR,4.73,15,11783
Braelon Allen,RB,7.78,9,11576
Max Klare,TE,5,14,13278
Ollie Gordon II,RB,4,17,12495
Luther Burden III,WR,4.53,15,12519
Jaylin Lane,WR,4.47,15,12641
Devin Duvernay,WR,3.94,17,6847
Kendre Miller,RB,6,11,9757
Isaiah Williams,WR,4.33,15,11608
Tommy Tremble,TE,4.33,15,7694
James Conner,RB,8,8,4137
Ted Hurst,WR,4.57,14,13317
Malik Davis,RB,5.17,12,8800
Skyler Bell,WR,4.43,14,13402
Jaydon Blue,RB,6.67,9,12457
Tyquan Thornton,WR,4.29,14,8188
Malachi Corley,WR,4.29,14,11617
Jalen Tolbert,WR,4.07,14,8117
Marcus Mariota,QB,18.67,3,2307
Zavier Scott,RB,4.23,13,11299
Kimani Vidal,RB,3.93,14,11647
Luke Musgrave,TE,3.93,14,9481
Elijah Higgins,TE,3.24,17,10231
Luke McCaffrey,WR,4.50,12,11650
Joe Flacco,QB,17.67,3,19
Jerome Ford,RB,3.79,14,8143
Tyler Badie,RB,3.31,16,8208
Olamide Zaccheaus,WR,3.53,15,6271
Noah Gray,TE,3.53,15,7828
Nick Westbrook-Ikhine,WR,3.71,14,7496
Mitchell Evans,TE,3.47,15,12473
Kaden Wetjen,WR,3.57,14,13491
Jeremy Ruckert,TE,3.33,15,8145
Tyler Huntley,QB,16.33,3,7083
J.J. McCarthy,QB,16,3,11565
Riley Leonard,QB,15.67,3,12470
Germie Bernard,WR,3.36,14,13274
Isaac TeSlaa,WR,3.07,15,12535
Jack Endries,TE,3.29,14,13282
Luke Schoonmaker,TE,3.07,15,10871
Rivaldo Fairweather,TE,3.21,14,12851
Justin Fields,QB,22,2,7591
Quinn Ewers,QB,14.67,3,12500
Xavier Smith,WR,2.75,16,11168
Josh Oliver,TE,3.14,14,5973
Elijah Arroyo,TE,3.14,14,12521
Rasheen Ali,RB,2.87,15,11570
Marquez Valdes-Scantling,WR,3.50,12,5086
Kaelon Black,RB,2.93,14,13414
Jordan James,RB,2.93,14,12467
Jonathon Brooks,RB,2.86,14,11583
Tyrod Taylor,QB,19.50,2,827
Spencer Rattler,QB,19.50,2,11562
Tim Patrick,WR,2.79,14,4351
Jadarian Price,RB,2.71,14,13286
Ben Sinnott,TE,3.17,12,11596
Mac Jones,QB,18.50,2,7527
Demond Claiborne,RB,2.64,14,13347
Christian Kirk,WR,2.85,13,4950
Cedric Tillman,WR,2.64,14,10444
Dyami Brown,WR,2.85,13,7587
Deshaun Watson,QB,12,3,4017
AJ Dillon,RB,3.60,10,6828
Jawhar Jordan,RB,4,9,11588
Dont'e Thornton Jr.,WR,2.77,13,12541
George Holani,RB,2.92,12,12048
Tua Tagovailoa,QB,17,2,6768
Davis Mills,QB,17,2,7585
Seth McGowan,RB,2.43,14,13424
Skyy Moore,WR,1.94,17,8168
Anthony Gould,WR,2.54,13,11762
John Metchie III,WR,2.36,14,8147
Andrew Ogletree,TE,2.54,13,8489
Jameis Winston,QB,16,2,2306
Carson Beck,QB,15.50,2,13272
Mike Washington Jr.,RB,2.21,14,13305
Chris Collier,RB,2.21,14,11963
Eli Stowers,TE,2.21,14,13349
Eli Raridon,TE,2.21,14,13421
Chris Bell,WR,2.14,14,13311
Fernando Mendoza,QB,14.50,2,13269
Ahmani Marshall,RB,2.07,14,12797
Malachi Fields,WR,2.07,14,13285
Davis Allen,TE,1.93,15,10214
Austin Hooper,TE,2.07,14,3202
Jonah Coleman,RB,2,14,13345
Donovan Edwards,RB,2,14,12515
Savion Williams,WR,2,14,12482
Will Shipley,RB,1.80,15,11577
MarShawn Lloyd,RB,1.93,14,11581
Pierre Strong,RB,1.93,14,8116
Adam Randall,RB,1.93,14,13302
Nicholas Singleton,RB,1.93,14,13288
Jalen McMillan,WR,3,9,11618
Eli Heidenreich,RB,1.86,14,13423
Kaytron Allen,RB,1.86,14,13405
Jam Miller,RB,1.86,14,13403
Jeremiyah Love,RB,1.86,14,13287
Kameron Johnson,WR,1.53,17,11994
Tutu Atwell,WR,2.36,11,7562
Cash Jones,RB,1.79,14,13595
DJ Giddens,RB,2.78,9,12471
Jahan Dotson,WR,1.67,15,8119
Josh Whyle,TE,2.50,10,10212
Tyler Conklin,TE,2.50,10,5133
Cade Klubnik,QB,12,2,13303
Jarquez Hunter,RB,1.71,14,11569
Elijah Sarratt,WR,1.71,14,13268
Gunner Olszewski,WR,1.44,16,6699
Marlin Klein,TE,1.64,14,13307
Tahj Brooks,RB,1.57,14,12543
Emmett Johnson,RB,1.57,14,13337
Ulysses Bentley IV,RB,3.14,7,12826
Frank Gore Jr.,RB,1.57,14,232
Colbie Young,WR,1.57,14,13477
Bryce Lance,WR,1.57,14,13420
Nick Mullens,QB,21,1,4464
Raheim Sanders,RB,2.33,9,12472
Jaret Patterson,RB,2,10,7537
Kalif Raymond,WR,1.33,15,3634
Jacob Cowing,WR,1.43,14,11616
Grant Calcaterra,TE,1.67,12,8177
Luke Farrell,TE,1.43,14,7842
Brock Wright,TE,1.82,11,7891
Nate Boerkircher,TE,1.43,14,13299
Joe Milton III,QB,19,1,11557
Trey Lance,QB,19,1,7610
Kyle Allen,QB,19,1,5127
C.J. Daniels,WR,1.36,14,13270
Emmanuel Henderson,WR,1.36,14,13313
Cole Kmet,TE,1.19,16,6826
Matthew Hibner,TE,1.36,14,
Tyson Bagent,QB,18,1,11256
Teddy Bridgewater,QB,18,1,2152
Behren Morton,QB,18,1,13295
Jalen Milroe,QB,18,1,12510
Vinny Anthony,WR,1.29,14,13343
Charlie Kolar,TE,1.29,14,8127
Mason Rudolph,QB,17,1,4972
Ty Simpson,QB,17,1,13275
Tre' Harris,WR,1.06,16,12509
Mitchell Trubisky,QB,16,1,3976
Josh Williams,RB,2,8,12787
Kendrick Law,WR,1.14,14,13412
Ashton Dulin,WR,1.14,14,6427
Jake Browning,QB,15,1,6111
Phil Mafah,RB,2.14,7,12738
Terrell Jennings,RB,1.50,10,12412
Jahdae Walker,WR,1.50,10,13079
Josh Cameron,WR,1.07,14,13394
Jaheim Bell,TE,1.07,14,11605
Ian Thomas,TE,1.25,12,4995
Justin Joly,TE,1.07,14,13400
Cole Payton,QB,14,1,13335
Kenny Pickett,QB,14,1,8160
Jarrett Stidham,QB,14,1,6136
Brittain Brown,RB,1.75,8,8423
Derius Davis,WR,1.08,13,10234
Devaughn Vele,WR,1.17,12,11834
Joe Royer,TE,1,14,13435
Noah Fant,TE,1,14,5857
Dylan Laube,RB,0.76,17,11574
Malik Benson,WR,0.93,14,13329
Ja'Kobi Lane,WR,0.93,14,13293
Carsen Ryan,TE,0.93,14,13580
Anthony Firkser,TE,1.44,9,4435
Gary Brightwell,RB,1.50,8,7529
Roman Wilson,WR,0.92,12,11630
Mecole Hardman,WR,1.38,8,5917
Tanner Koziol,TE,0.79,14,13408
D.J. Rogers,TE,0.79,14,13355
Julian Hill,TE,0.85,13,11371
Daniel Bellinger,TE,0.79,14,8225
Austin Trammell,WR,1,10,7746
Tanner Hudson,TE,0.83,12,5409
Josh Cuevas,TE,0.71,14,13273
Seydou Traore,TE,0.71,14,13429
Eric Gray,RB,1.29,7,10223
British Brooks,RB,0.82,11,12171
Charlie Jones,WR,0.60,15,10228
John Michael Gyllenborg,TE,0.64,14,13342
Mo Alie-Cox,TE,0.69,13,4054
Nate Adkins,TE,0.90,10,11433
Bauer Sharp,TE,0.64,14,13308
Foster Moreau,TE,0.82,11,5985
Kene Nwangwu,RB,0.67,12,7720
Marquise Brown,WR,0.44,16,5848
Kendrick Bourne,WR,0.47,15,4454
Charlie Woerner,TE,0.64,11,7075
Myles Price,WR,0.38,16,13075
Kenny Fletcher,TE,0.43,14,13957
Dameon Pierce,RB,0.56,9,8129
Reggie Virgil,WR,0.36,14,13297
Harrison Bryant,TE,0.56,9,6850
Ronnie Rivers,RB,0.40,10,8195
Tyler Goodson,RB,0.33,12,8207
Cyrus Allen,WR,0.29,14,13413
Ben Yurosek,TE,0.30,10,13121
Chris Manhertz,TE,0.33,9,3048
Jacob Saylors,RB,0.15,13,11237
Roschon Johnson,RB,0.10,10,10235
Sione Vaki,RB,0.09,11,11729`;

/** A full NFL season, for turning a per-GAME rate into a per-WEEK expectation.
 *  17 rather than 18: the bye is a week the player was never going to play, and
 *  `slateAwareProj` already zeroes a bye where it knows about one. */
const SEASON_WEEKS = 17;

/** Engine slug → 2026 projected PPR points in a given WEEK — `ppg * games / 17`,
 *  not StatHead's raw `ppg`. See the docblock above for why. */
export const PROJ_2026: Map<string, number> = new Map();
/** Sleeper player_id → the same projection (exact join; names drift, ids don't). */
export const PROJ_2026_SID: Map<string, number> = new Map();
for (const line of PROJ_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 4) continue;
  const slug = normName(c[0]).replace(/\s+/g, '-');
  const ppg = parseFloat(c[2]);
  const games = parseFloat(c[3]);
  if (!slug || !Number.isFinite(ppg) || !Number.isFinite(games)) continue;
  // Clamped at the season length so a stray games value can never inflate a
  // player above his own rate.
  const perWeek = Math.round((ppg * Math.min(games, SEASON_WEEKS) / SEASON_WEEKS) * 10) / 10;
  if (!PROJ_2026.has(slug)) PROJ_2026.set(slug, perWeek);
  const sid = (c[4] ?? '').trim();
  if (sid && !PROJ_2026_SID.has(sid)) PROJ_2026_SID.set(sid, perWeek);
}
