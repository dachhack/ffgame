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

/** Live StatHead pool, pulled 2026-08-26T12:16:06Z (445 skill players + games + sleeper ids; K/DST rows from the pull are dropped — kicker/DST projections ride the v0.311.0 team-id mechanism, not player slugs). */
export const PROJ_AS_OF = '2026-08-26';

const PROJ_CSV = `Jahmyr Gibbs,RB,25.94,17,9221
Jonathan Taylor,RB,24.94,17,6813
Christian McCaffrey,RB,23.53,17,4034
Bijan Robinson,RB,21.47,17,9509
Josh Allen,QB,21.63,16,4984
Amon-Ra St. Brown,WR,19.29,17,7547
Ashton Jeanty,RB,18.88,17,12527
Jalen Hurts,QB,19.88,16,6904
Drake Maye,QB,19.75,16,11564
Puka Nacua,WR,19.50,16,9493
De'Von Achane,RB,19.44,16,9226
Derrick Henry,RB,18.06,17,3198
Trevor Lawrence,QB,19.13,16,7523
Chase Brown,RB,17.65,17,9224
Bo Nix,QB,18.44,16,11563
Caleb Williams,QB,18.31,16,11560
James Cook III,RB,17,17,8138
Ja'Marr Chase,WR,18.06,16,7564
Jaxon Smith-Njigba,WR,16.94,17,9488
Trey McBride,TE,16.88,17,8130
Justin Herbert,QB,17.75,16,6797
Matthew Stafford,QB,17.63,16,421
Dak Prescott,QB,17.63,16,3294
Jacoby Brissett,QB,18.67,15,3257
Justin Jefferson,WR,16.47,17,6794
Josh Jacobs,RB,18.47,15,5850
Jaxson Dart,QB,18.33,15,12508
Jared Goff,QB,17.06,16,3163
Baker Mayfield,QB,16.88,16,4892
Bryce Young,QB,16.38,16,9228
Aaron Rodgers,QB,16.31,16,96
Bucky Irving,RB,17.40,15,11584
Javonte Williams,RB,16.25,16,7588
TreVeyon Henderson,RB,15.18,17,12529
Saquon Barkley,RB,16.06,16,4866
Kenneth Walker,RB,15.12,17,8151
Chris Olave,WR,15.81,16,8144
C.J. Stroud,QB,16.67,15,9758
Kyren Williams,RB,14.71,17,8150
CeeDee Lamb,WR,17.86,14,6786
Jordan Love,QB,16.60,15,6804
Cam Ward,QB,15.56,16,12522
Zay Flowers,WR,14.59,17,9997
Patrick Mahomes,QB,16.47,15,4046
Daniel Jones,QB,17.64,14,5870
Brock Purdy,QB,16.27,15,8183
Sam Darnold,QB,15.13,16,4943
D'Andre Swift,RB,15.06,16,6790
Tyler Shough,QB,16,15,12545
Malik Willis,QB,17.14,14,8161
Jayden Daniels,QB,17,14,11566
Omarion Hampton,RB,15.87,15,12507
Joe Burrow,QB,16.79,14,6770
Michael Penix Jr.,QB,15.60,15,11559
Breece Hall,RB,14.63,16,8155
Cam Skattebo,RB,16.71,14,12481
Drake London,WR,15.53,15,8112
A.J. Brown,WR,15.53,15,5859
Lamar Jackson,QB,16.57,14,4881
Geno Smith,QB,15.33,15,1373
Chuba Hubbard,RB,15.33,15,7594
Emeka Egbuka,WR,13.53,17,12514
Wan'Dale Robinson,WR,14.31,16,8126
Rashee Rice,WR,16.21,14,10229
Tyler Warren,TE,13.29,17,12518
Jadarian Price,RB,15.93,14,13286
Ladd McConkey,WR,13.88,16,11635
DeVonta Smith,WR,13,17,7525
Jameson Williams,WR,12.94,17,8148
Kyler Murray,QB,15.64,14,5849
Travis Kelce,TE,12.76,17,1466
Quinshon Judkins,RB,14.33,15,12512
Nico Collins,WR,14.33,15,7569
Davante Adams,WR,14.27,15,2133
Kirk Cousins,QB,14.20,15,1166
David Montgomery,RB,12.53,17,5892
Marvin Harrison Jr.,WR,14.13,15,11628
Colston Loveland,TE,13.13,16,12517
Travis Etienne Jr.,RB,12.29,17,7543
Brock Bowers,TE,13.93,15,11604
Bhayshul Tuten,RB,13.87,15,12490
Tony Pollard,RB,12.24,17,5967
Courtland Sutton,WR,12.24,17,5045
George Pickens,WR,12.06,17,8137
Tetairoa McMillan,WR,12.06,17,12526
Brian Thomas Jr.,WR,13.53,15,11631
Tee Higgins,WR,13.47,15,6801
RJ Harvey,RB,11.82,17,12489
DK Metcalf,WR,13.40,15,5846
Shedeur Sanders,QB,14.29,14,12524
Jacory Croskey-Merritt,RB,11.65,17,12533
Malik Nabers,WR,14.14,14,11632
Rico Dowdle,RB,11.53,17,7021
Tucker Kraft,TE,14,14,9484
Jordan Mason,RB,12.13,16,8408
Jaylen Waddle,WR,12.13,16,7526
Jaylen Warren,RB,12.06,16,8228
Michael Pittman Jr.,WR,11.35,17,6819
Jake Ferguson,TE,11.06,17,8110
Rhamondre Stevenson,RB,12.47,15,7611
Garrett Wilson,WR,13.36,14,8146
Hunter Henry,TE,11,17,3214
Aaron Jones Sr.,RB,12.33,15,4199
Sam LaPorta,TE,12.27,15,10859
Jeremiyah Love,RB,12.93,14,13287
Tre Tucker,WR,10.53,17,10213
DJ Moore,WR,10.53,17,4983
Chig Okonkwo,TE,10.53,17,8210
Rome Odunze,WR,11.87,15,11620
George Kittle,TE,11.80,15,4217
Marvin Mims Jr.,WR,11.67,15,9494
Carnell Tate,WR,12.29,14,13279
Blake Corum,RB,10.06,17,11586
Rachaad White,RB,10.06,17,8136
Jerry Jeudy,WR,10.06,17,6783
Jakobi Meyers,WR,10.50,16,5947
Dalton Schultz,TE,9.88,17,5001
Dalton Kincaid,TE,11.13,15,10236
Kyle Monangai,RB,9.71,17,12534
Terry McLaurin,WR,10.93,15,5927
Harold Fannin Jr.,TE,10.25,16,12506
Tyrone Tracy Jr.,RB,10.80,15,11655
Mark Andrews,TE,9.53,17,5012
J.K. Dobbins,RB,10.73,15,6806
Parker Washington,WR,10.06,16,9487
Jalen Nailor,WR,9.41,17,8180
AJ Barner,TE,9.41,17,11603
Quentin Johnston,WR,11.36,14,9754
Jordan Addison,WR,10.53,15,9756
Josh Downs,WR,9.81,16,9500
Dallas Goedert,TE,10.47,15,5022
Romeo Doubs,WR,9.75,16,8121
Greg Dulcich,TE,10.33,15,8172
Zavion Thomas,WR,11,14,13411
Kyle Pitts Sr.,TE,9.06,17,7553
Rashid Shaheed,WR,9,17,8676
Oronde Gadsden,TE,10.13,15,12493
Jayden Higgins,WR,8.88,17,12484
Christian Watson,WR,10,15,8167
Jordyn Tyson,WR,10.71,14,13281
Pat Freiermuth,TE,9.93,15,7600
Tyler Allgeier,RB,8.59,17,8132
Alec Pierce,WR,9.67,15,8142
Michael Wilson,WR,8.53,17,10232
Malik Washington,WR,8.35,17,11610
Woody Marks,RB,8.75,16,12474
Khalil Shakir,WR,8.69,16,8134
Brenton Strange,TE,9.27,15,9480
Tank Bigsby,RB,9.20,15,9225
Colby Parkinson,TE,9.20,15,6865
Cade Otton,TE,9.20,15,8111
Brenen Thompson,WR,9.71,14,13380
Dylan Sampson,RB,9,15,12469
Evan Engram,TE,8.44,16,4066
Zach Charbonnet,RB,8.25,16,9753
Makai Lemon,WR,9.29,14,13294
Calvin Ridley,WR,11.82,11,4981
Brian Robinson,RB,7.59,17,8154
Isaiah Likely,TE,8.47,15,8131
Jaylin Noel,WR,7.35,17,12536
T.J. Hockenson,TE,8.33,15,5844
Keon Coleman,WR,8.64,14,11637
Xavier Worthy,WR,8,15,11624
Theo Johnson,TE,8,15,11597
Samaje Perine,RB,7.93,15,4147
Tyjae Spears,RB,8.50,14,9508
Chris Rodriguez Jr.,RB,8.43,14,10219
Mike Evans,WR,8.43,14,2216
Sean Tucker,RB,6.88,17,9506
Gunnar Helm,TE,7.31,16,12502
Jack Bech,WR,7.67,15,12483
Chimere Dike,WR,6.76,17,12540
Isiah Pacheco,RB,8.14,14,8205
Justice Hill,RB,9.50,12,5995
KC Concepcion,WR,8.14,14,13298
Xavier Hutchinson,WR,7.06,16,10218
Juwan Johnson,TE,6.65,17,7002
Emari Demercado,RB,8,14,11199
Isaiah Davis,RB,7,16,11571
Kayshon Boutte,WR,7.47,15,9504
DeMario Douglas,WR,7,16,9501
Sam Roush,TE,8,14,13322
Tank Dell,WR,7.93,14,9502
Omar Cooper Jr.,WR,7.86,14,13276
Mike Gesicki,TE,7.33,15,4993
Michael Carter,RB,7.79,14,7607
Cooper Kupp,WR,6.81,16,4039
Xavier Legette,WR,7.27,15,11626
Chris Godwin Jr.,WR,9,12,4037
Matthew Golden,WR,7,15,12501
Devin Singletary,RB,6.12,17,6130
Andrei Iosivas,WR,6.87,15,10226
Jalen Coker,WR,7.85,13,11646
Troy Franklin,WR,5.94,17,11627
Ray Davis,RB,5.88,17,11575
Darnell Mooney,WR,6.67,15,7090
Kenyon Sadiq,TE,7.14,14,13330
Adonai Mitchell,WR,6.19,16,11625
Malik Davis,RB,8.08,12,8800
Ricky Pearsall,WR,8.08,12,11638
Pat Bryant,WR,6.93,14,12492
Mason Taylor,TE,6.93,14,12498
Jauan Jennings,WR,6.40,15,7049
Dontayvion Wicks,WR,6.79,14,9486
Chris Brooks,RB,5.53,17,11370
Denzel Boston,WR,6.64,14,13346
Rashod Bateman,WR,6.64,14,7571
LeQuint Allen Jr.,RB,5.63,16,12544
Keaton Mitchell,RB,6.43,14,9511
Dawson Knox,TE,5.63,16,5906
Trevor Etienne,RB,5.24,17,12531
Caleb Douglas,WR,6.36,14,13296
Ty Johnson,RB,5.18,17,6039
Greg Dortch,WR,6.29,14,5970
Kaelon Black,RB,6.21,14,13414
Alvin Kamara,RB,6.69,13,4035
Malachi Corley,WR,6.07,14,11617
Elic Ayomanor,WR,5.31,16,12499
Britain Covey,WR,8.40,10,8414
De'Zhaun Stribling,WR,6,14,13417
Nikko Remigio,WR,5.60,15,11320
Oscar Delp,TE,6,14,13319
Trey Palmer,WR,5.79,14,9492
Jaylen Wright,RB,6.50,12,11643
Kyle Williams,WR,5.20,15,
Brashard Smith,RB,4.53,17,12455
Ja'Tavion Sanders,TE,5.13,15,11600
Antonio Williams,WR,5.43,14,13301
David Njoku,TE,5.85,13,4033
Ameer Abdullah,RB,5.36,14,2359
Darius Slayton,WR,5,15,6149
Jake Tonges,TE,6.25,12,8698
Cedric Tillman,WR,5.29,14,10444
Michael Mayer,TE,5.29,14,9482
Zachariah Branch,WR,5.21,14,13320
Darnell Washington,TE,5.21,14,9479
Jayden Reed,WR,8,9,10222
KaVontae Turpin,WR,4.80,15,8917
Tory Horton,WR,6.55,11,12497
Kaleb Johnson,RB,5.92,12,12504
Jordan Whittington,WR,4.67,15,11623
Ryan Flournoy,WR,4.67,15,11783
Tyquan Thornton,WR,4.93,14,8188
Braelon Allen,RB,7.44,9,11576
Devin Neal,RB,5.58,12,12476
Emanuel Wilson,RB,3.82,17,11435
Ollie Gordon II,RB,3.82,17,12495
Max Klare,TE,4.64,14,13278
Chris Brazzell,WR,4.57,14,13353
Ted Hurst,WR,4.57,14,13317
Bam Knight,RB,4.50,14,8122
Tommy Tremble,TE,4.20,15,7694
Jaylin Lane,WR,4.13,15,12641
Kendre Miller,RB,5.55,11,9757
Kaden Wetjen,WR,4.29,14,13491
Luther Burden III,WR,4,15,12519
Jaren Kanak,TE,4.21,14,13422
Jaydon Blue,RB,6.44,9,12457
Devin Duvernay,WR,3.35,17,6847
Marcus Mariota,QB,18.67,3,2307
Zavier Scott,RB,4.23,13,11299
Kimani Vidal,RB,3.93,14,11647
Luke Musgrave,TE,3.93,14,9481
Jackson Hawes,TE,3.86,14,12658
Joe Flacco,QB,17.67,3,19
Jerome Ford,RB,3.79,14,8143
Luke McCaffrey,WR,4.42,12,11650
Noah Gray,TE,3.53,15,7828
Nick Westbrook-Ikhine,WR,3.71,14,7496
Mitchell Evans,TE,3.47,15,12473
James Conner,RB,6.25,8,4137
Christian Kirk,WR,3.85,13,4950
Tyler Huntley,QB,16.33,3,7083
Jalen Tolbert,WR,3.50,14,8117
J.J. McCarthy,QB,16,3,11565
Olamide Zaccheaus,WR,3.20,15,6271
Riley Leonard,QB,15.67,3,12470
Tyler Badie,RB,2.94,16,8208
Germie Bernard,WR,3.36,14,13274
Dyami Brown,WR,3.62,13,7587
Luke Schoonmaker,TE,3,15,10871
Elijah Higgins,TE,2.65,17,10231
Justin Fields,QB,22,2,7591
Quinn Ewers,QB,14.67,3,12500
Isaac TeSlaa,WR,2.93,15,12535
Jack Endries,TE,3.14,14,13282
Josh Oliver,TE,3.14,14,5973
Elijah Arroyo,TE,3.14,14,12521
Marquez Valdes-Scantling,WR,3.50,12,5086
John Metchie III,WR,3,14,8147
Xavier Smith,WR,2.56,16,11168
Isaiah Williams,WR,2.73,15,11608
Jonathon Brooks,RB,2.86,14,11583
Kenneth Gainwell,RB,2.86,14,7567
Tyrod Taylor,QB,19.50,2,827
Spencer Rattler,QB,19.50,2,11562
Chris Bell,WR,2.71,14,13311
Ben Sinnott,TE,3.17,12,11596
Mac Jones,QB,18.50,2,7527
Jordan James,RB,2.64,14,12467
Jalen McMillan,WR,4.11,9,11618
Deshaun Watson,QB,12,3,4017
AJ Dillon,RB,3.60,10,6828
Jawhar Jordan,RB,4,9,11588
Davis Allen,TE,2.40,15,10214
Eli Stowers,TE,2.57,14,13349
Mike Washington Jr.,RB,2.50,14,13305
Rasheen Ali,RB,2.33,15,11570
Dont'e Thornton Jr.,WR,2.69,13,12541
Tua Tagovailoa,QB,17,2,6768
Davis Mills,QB,17,2,7585
Andrew Ogletree,TE,2.62,13,8489
Skyy Moore,WR,1.94,17,8168
Elijah Sarratt,WR,2.36,14,13268
Anthony Gould,WR,2.54,13,11762
Tutu Atwell,WR,3,11,7562
Jameis Winston,QB,16,2,2306
Carson Beck,QB,15.50,2,13272
Jonah Coleman,RB,2.21,14,13345
Malachi Fields,WR,2.21,14,13285
Jahan Dotson,WR,2.07,15,8119
Marlin Klein,TE,2.21,14,13307
Chris Collier,RB,2.14,14,11963
Fernando Mendoza,QB,14.50,2,13269
Ahmani Marshall,RB,2.07,14,12797
Savion Williams,WR,2.07,14,12482
Austin Hooper,TE,2.07,14,3202
Kalif Raymond,WR,1.87,15,3634
Jeremy Ruckert,TE,1.87,15,8145
MarShawn Lloyd,RB,1.93,14,11581
Pierre Strong,RB,1.93,14,8116
Eli Raridon,TE,1.93,14,13421
Donovan Edwards,RB,1.86,14,12515
Tim Patrick,WR,1.86,14,4351
Kameron Johnson,WR,1.53,17,11994
Will Shipley,RB,1.67,15,11577
Cash Jones,RB,1.79,14,13595
DJ Giddens,RB,2.78,9,12471
Frank Gore Jr.,RB,1.79,14,232
Josh Whyle,TE,2.50,10,10212
Tyler Conklin,TE,2.50,10,5133
Cade Klubnik,QB,12,2,13303
Jarquez Hunter,RB,1.71,14,11569
Josh Williams,RB,3,8,12787
Nate Boerkircher,TE,1.71,14,13299
Seth McGowan,RB,1.64,14,13424
Ulysses Bentley IV,RB,3.14,7,12826
Colbie Young,WR,1.57,14,13477
Nick Mullens,QB,21,1,4464
Raheim Sanders,RB,2.33,9,12472
Jaret Patterson,RB,2,10,7537
Gunner Olszewski,WR,1.25,16,6699
Cole Kmet,TE,1.25,16,6826
Brock Wright,TE,1.82,11,7891
Joe Milton III,QB,19,1,11557
Trey Lance,QB,19,1,7610
Kyle Allen,QB,19,1,5127
C.J. Daniels,WR,1.36,14,13270
Jacob Cowing,WR,1.36,14,11616
Emmanuel Henderson,WR,1.36,14,13313
Matthew Hibner,TE,1.36,14,
Tyson Bagent,QB,18,1,11256
Teddy Bridgewater,QB,18,1,2152
Behren Morton,QB,18,1,13295
Jalen Milroe,QB,18,1,12510
Vinny Anthony,WR,1.29,14,13343
Tre' Harris,WR,1.13,16,12509
Bryce Lance,WR,1.29,14,13420
Luke Farrell,TE,1.29,14,7842
Charlie Kolar,TE,1.29,14,8127
Mason Rudolph,QB,17,1,4972
Ty Simpson,QB,17,1,13275
Derius Davis,WR,1.31,13,10234
Mitchell Trubisky,QB,16,1,3976
Kendrick Law,WR,1.14,14,13412
Ja'Kobi Lane,WR,1.14,14,13293
Ashton Dulin,WR,1.14,14,6427
Devaughn Vele,WR,1.33,12,11834
Rivaldo Fairweather,TE,1.14,14,12851
Noah Fant,TE,1.14,14,5857
Jake Browning,QB,15,1,6111
Tahj Brooks,RB,1.07,14,12543
Adam Randall,RB,1.07,14,13302
Terrell Jennings,RB,1.50,10,12412
Josh Cameron,WR,1.07,14,13394
Skyler Bell,WR,1.07,14,13402
Jaheim Bell,TE,1.07,14,11605
Grant Calcaterra,TE,1.25,12,8177
Ian Thomas,TE,1.25,12,4995
Cole Payton,QB,14,1,13335
Kenny Pickett,QB,14,1,8160
Brittain Brown,RB,1.75,8,8423
Phil Mafah,RB,2,7,12738
Roman Wilson,WR,1.17,12,11630
Jarrett Stidham,QB,13,1,6136
Jam Miller,RB,0.93,14,13403
Charlie Jones,WR,0.87,15,10228
Jahdae Walker,WR,1.30,10,13079
Malik Benson,WR,0.93,14,13329
Mecole Hardman,WR,1.63,8,5917
Anthony Firkser,TE,1.44,9,4435
Julian Hill,TE,1,13,11371
Gary Brightwell,RB,1.50,8,7529
Will Kacmarek,TE,0.86,14,13434
Dylan Laube,RB,0.65,17,11574
Demond Claiborne,RB,0.79,14,13347
Kaytron Allen,RB,0.71,14,13405
John Michael Gyllenborg,TE,0.71,14,13342
Joe Royer,TE,0.71,14,13435
D.J. Rogers,TE,0.71,14,13355
Justin Joly,TE,0.71,14,13400
Bauer Sharp,TE,0.71,14,13308
Eli Heidenreich,RB,0.64,14,13423
Eric Gray,RB,1.29,7,10223
British Brooks,RB,0.82,11,12171
Kendrick Bourne,WR,0.60,15,4454
Carsen Ryan,TE,0.64,14,13580
Tanner Koziol,TE,0.64,14,13408
Mo Alie-Cox,TE,0.69,13,4054
Emmett Johnson,RB,0.57,14,13337
Nicholas Singleton,RB,0.57,14,13288
Austin Trammell,WR,0.80,10,7746
Foster Moreau,TE,0.73,11,5985
Kene Nwangwu,RB,0.58,12,7720
George Holani,RB,0.58,12,12048
Tanner Hudson,TE,0.58,12,5409
Charlie Woerner,TE,0.64,11,7075
Josh Cuevas,TE,0.50,14,13273
Daniel Bellinger,TE,0.50,14,8225
Nate Adkins,TE,0.70,10,11433
Seydou Traore,TE,0.50,14,13429
Marquise Brown,WR,0.38,16,5848
Myles Price,WR,0.38,16,13075
Kenny Fletcher,TE,0.43,14,13957
Dameon Pierce,RB,0.56,9,8129
Ronnie Rivers,RB,0.40,10,8195
Tyler Goodson,RB,0.33,12,8207
Cyrus Allen,WR,0.29,14,13413
Reggie Virgil,WR,0.29,14,13297
Harrison Bryant,TE,0.44,9,6850
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
