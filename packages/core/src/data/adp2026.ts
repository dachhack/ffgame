// GENERATED — 2026 consensus Average Draft Position, baked for the native-league
// draft pool. Source: Stathead MCP `get_adp` (season 2026, source 'consensus' —
// a freshness/confidence-weighted blend of FantasyPros expert-consensus rank +
// Sleeper draft ADP + FantasyFootballCalculator, PPR/1QB). Includes the 2026
// rookie class at market price (e.g. Jeremiyah Love RB, ADP 31.5).
//
// REFRESH (ADP moves all summer — rebake weekly through August): pull
//   get_adp { season: 2026, limit: 300, output_format: 'csv',
//             fields: 'player_name,position,team,adp,sleeper_id' }
// via the Stathead MCP and replace ADP_CSV below (keep the as-of line current).
//
// ── THE FIFTH COLUMN (v0.452.0) ───────────────────────────────────────────
// This was the last name-only bake in the data layer. PROJ_2026 has carried a
// sleeper id since v0.307.0 and DYN_2026 since v0.351.3; ADP joined engine
// slugs by NAME alone, which is the join that silently dropped Kenneth/Kenny
// Gainwell out of the dynasty board and spells one man "Chigoziem Okonkwo"
// where our index says "Chig".
//
// THE HONEST SIZE OF THE PROBLEM, measured before it was fixed (the source
// audit, docs/source-audit.md): of 221 rows, 221 mint a distinct slug, 0
// collide with each other, and 221 match a slug a live Sleeper-built pool
// mints. TODAY THE NAME JOIN COSTS NOTHING. The id is insurance, not repair:
// it costs one column and removes a whole bug class — a mid-season name
// correction at either end, a rookie who arrives spelled differently, a
// second player with the same name.
//
// THE IDS WERE ATTACHED WITHOUT TOUCHING A VALUE. Every row's sleeper id came
// from StatHead's public crosswalk by name + position, and every attach was
// verified against the Sleeper directory's own position and team; the only
// two that did not line up were team moves the August board predates (Kayshon
// Boutte NE→HOU, Jaydon Blue DAL→PHI), not wrong players.
//
// ── AND THEN THE VALUES (v0.453.0) ────────────────────────────────────────
// The first rebake since 26 August, and the first one the id column paid for:
// the before/after was diffed BY SLEEPER ID rather than by name, so a player
// who changed team (or spelling) between the two boards is one row that
// moved, not one row dropped and one added. 214 players in both, 20 new, 7
// gone; mean absolute move 13.8 picks, median 9.1.
//
// A MID-SEASON ADP IS A DIFFERENT ANIMAL from an August one. It prices what
// has already happened — Isiah Pacheco 164.8 → 249 and Josh Jacobs 35.9 →
// 115.7 are injuries, MarShawn Lloyd 183.2 → 136.7 is a job. That is the
// right board for a league drafting TODAY, which is what this file is for:
// it seeds a new pool's rank, and a pool is built the day its league is.
// Leagues that already drafted keep the rank stored in their own pool rows.
//
// Every row is validated on the way in (see the refresh note above): a
// sleeper id, a team, a number, and a Sleeper directory row that is active
// and plays that position. The 2026 board's tail — retired names and unsigned
// free agents with no id at all — is dropped rather than baked.
import { normName } from './players';
import { slugSleeperId } from './slugMeta';

/** Blend freshness: FantasyPros 2026-09-18 · Sleeper 2026-09-21 · FFC 2026-09-21. */
export const ADP_AS_OF = '2026-09-21';

const ADP_CSV = `Jahmyr Gibbs,RB,DET,1.10,9221
Bijan Robinson,RB,ATL,2.60,9509
Ja'Marr Chase,WR,CIN,3.30,7564
Puka Nacua,WR,LA,5.40,9493
Jonathan Taylor,RB,IND,5.70,6813
Jaxon Smith-Njigba,WR,SEA,6.30,9488
James Cook III,RB,BUF,7.20,8138
Amon-Ra St. Brown,WR,DET,7.60,7547
Christian McCaffrey,RB,SF,8.70,4034
CeeDee Lamb,WR,DAL,10.80,6786
Justin Jefferson,WR,MIN,11.30,6794
Chase Brown,RB,CIN,12.70,9224
Saquon Barkley,RB,PHI,14.40,4866
Kenneth Walker III,RB,KC,16.20,8151
De'Von Achane,RB,MIA,16.70,9226
Ashton Jeanty,RB,LVR,17.40,12527
Derrick Henry,RB,BAL,18.50,3198
Nico Collins,WR,HOU,18.70,7569
George Pickens,WR,DAL,19.40,8137
Omarion Hampton,RB,LAC,19.40,12507
Drake London,WR,ATL,20.10,8112
Chris Olave,WR,NO,23,8144
Josh Allen,QB,BUF,23.20,4984
Malik Nabers,WR,NYG,26.10,11632
Trey McBride,TE,ARI,26.30,8130
DeVonta Smith,WR,PHI,29.50,7525
A.J. Brown,WR,NE,29.90,5859
Lamar Jackson,QB,BAL,30.40,4881
Brock Bowers,TE,LVR,30.90,11604
Zay Flowers,WR,BAL,32,9997
Rashee Rice,WR,KC,32.70,10229
Jeremiyah Love,RB,ARI,33.90,13287
Javonte Williams,RB,DAL,34.50,7588
Kyren Williams,RB,LA,36.10,8150
Emeka Egbuka,WR,TB,37.10,12514
Tee Higgins,WR,CIN,37.20,6801
Breece Hall,RB,NYJ,37.40,8155
Ladd McConkey,WR,LAC,38.20,11635
Garrett Wilson,WR,NYJ,38.80,8146
Tetairoa McMillan,WR,CAR,38.80,12526
Jaylen Waddle,WR,DEN,39.10,7526
Colston Loveland,TE,CHI,41.50,12517
D'Andre Swift,RB,CHI,43.40,6790
Drake Maye,QB,NE,46.50,11564
Travis Etienne Jr.,RB,NO,47.30,7543
Bucky Irving,RB,TB,47.80,11584
Cam Skattebo,RB,NYG,49.10,12481
Jalen Hurts,QB,PHI,49.20,6904
DJ Moore,WR,BUF,50,4983
David Montgomery,RB,HOU,51.20,5892
Christian Watson,WR,GB,52.20,8167
Luther Burden III,WR,CHI,52.60,12519
Terry McLaurin,WR,WAS,55,5927
Davante Adams,WR,LA,55.10,2133
Jameson Williams,WR,DET,55.80,8148
Mike Evans,WR,SF,55.90,2216
Joe Burrow,QB,CIN,56,6770
Parker Washington,WR,JAX,57,9487
Caleb Williams,QB,CHI,58.70,11560
Bhayshul Tuten,RB,JAX,60.40,12490
Tyler Warren,TE,IND,62.20,12518
Quinshon Judkins,RB,CLE,62.30,12512
Rome Odunze,WR,CHI,64.30,11620
Carnell Tate,WR,TEN,64.80,13279
Jayden Daniels,QB,WAS,68,11566
Jadarian Price,RB,SEA,68.40,13286
DK Metcalf,WR,PIT,70.80,5846
Sam LaPorta,TE,DET,74.70,10859
Marvin Harrison Jr.,WR,ARI,74.90,11628
Justin Herbert,QB,LAC,75.60,6797
Chris Godwin Jr.,WR,TB,76,4037
Rhamondre Stevenson,RB,NE,76.10,7611
TreVeyon Henderson,RB,NE,77.10,12529
Brian Thomas Jr.,WR,JAX,77.80,11631
Courtland Sutton,WR,DEN,78.70,5045
Trevor Lawrence,QB,JAX,79,7523
Jaylen Warren,RB,PIT,79.20,8228
Tucker Kraft,TE,GB,80.10,9484
Dak Prescott,QB,DAL,84.50,3294
Stefon Diggs,WR,WAS,85.40,2449
Makai Lemon,WR,PHI,85.50,13294
Alec Pierce,WR,IND,86.80,8142
Harold Fannin Jr.,TE,CLE,88,12506
Michael Wilson,WR,ARI,89.30,10232
Kyle Pitts Sr.,TE,ATL,90.70,7553
Michael Pittman Jr.,WR,PIT,91,6819
Quentin Johnston,WR,LAC,91.30,9754
George Kittle,TE,SF,92.80,4217
Rico Dowdle,RB,PIT,94.30,7021
Josh Downs,WR,IND,94.90,9500
Jaxson Dart,QB,NYG,95.90,12508
Jonathon Brooks,RB,CAR,96.30,11583
Jordan Addison,WR,MIN,97.10,9756
Wan'Dale Robinson,WR,TEN,98.20,8126
Jayden Reed,WR,GB,98.70,10222
Dalton Kincaid,TE,BUF,99.20,10236
KC Concepcion Jr.,WR,CLE,99.60,13298
Brock Purdy,QB,SF,99.80,8183
Matthew Golden,WR,GB,102.90,12501
Matthew Stafford,QB,LA,103.70,421
Blake Corum,RB,LA,104.40,11586
Patrick Mahomes II,QB,KC,106,4046
Travis Kelce,TE,KC,106.20,1466
Deebo Samuel Sr.,WR,SF,107.30,5872
Jakobi Meyers,WR,JAX,107.90,5947
Bo Nix,QB,DEN,110,11563
Jalen Coker,WR,CAR,110.10,11646
Tony Pollard,RB,TEN,110.60,5967
Isaiah Likely,TE,NYG,110.80,8131
Chuba Hubbard,RB,CAR,110.80,7594
RJ Harvey,RB,DEN,111.80,12489
J.K. Dobbins,RB,DEN,112.90,6806
Romeo Doubs,WR,NE,114.30,8121
Dallas Goedert,TE,PHI,115,5022
Josh Jacobs,RB,GB,115.70,5850
Jared Goff,QB,DET,117,3163
Jordyn Tyson,WR,NO,117.80,13281
Jake Ferguson,TE,DAL,118.90,8110
Xavier Worthy,WR,KC,121.30,11624
Khalil Shakir,WR,BUF,122.60,8134
Jordan Mason,RB,MIN,122.90,8408
Kenny Gainwell,RB,TB,126.60,7567
De'Zhaun Stribling,WR,SF,126.80,13417
Mark Andrews,TE,BAL,128.60,5012
Jordan Love,QB,GB,130.90,6804
Baker Mayfield,QB,TB,131.50,4892
Kyle Monangai,RB,CHI,131.60,12534
Jacory Croskey-Merritt,RB,WAS,132.90,12533
Denzel Boston,WR,CLE,136.40,13346
MarShawn Lloyd,RB,GB,136.70,11581
Rashid Shaheed,WR,SEA,137.70,8676
Kyler Murray,QB,MIN,138,5849
Hunter Henry,TE,NE,140.70,3214
Rachaad White,RB,WAS,140.90,8136
Aaron Jones Sr.,RB,MIN,143.30,4199
Juwan Johnson,TE,NO,145,7002
Brenton Strange,TE,JAX,146.30,9480
Tyler Shough,QB,NO,147.50,12545
Malik Willis,QB,MIA,153.20,8161
T.J. Hockenson,TE,MIN,155.30,5844
Dalton Schultz,TE,HOU,155.80,5001
Kenyon Sadiq,TE,NYJ,160.70,13330
Mike Washington Jr.,RB,LVR,161.70,13305
Kayshon Boutte,WR,HOU,162.10,9504
Keenan Allen,WR,IND,162.30,1479
Tyler Allgeier,RB,ARI,163.40,8132
Dontayvion Wicks,WR,PHI,164.80,9486
Tre Tucker,WR,LVR,165,10213
Oronde Gadsden II,TE,LAC,165.60,12493
C.J. Stroud,QB,HOU,166,9758
Chig Okonkwo,TE,WAS,167.70,8210
Sam Darnold,QB,SEA,168.70,4943
Daniel Jones,QB,IND,168.90,5870
Woody Marks,RB,HOU,169.10,12474
AJ Barner,TE,SEA,171.20,11603
Tyjae Spears,RB,TEN,171.80,9508
Adonai Mitchell,WR,NYJ,173.80,11625
Terrance Ferguson,TE,LA,174,12487
Bryce Young,QB,CAR,174.80,9228
Chris Rodriguez Jr.,RB,JAX,175.50,10219
Jonah Coleman,RB,DEN,177.80,13345
Tre' Harris,WR,LAC,179.40,12509
Caleb Douglas,WR,MIA,180,13296
Pat Bryant,WR,DEN,180.40,12492
Jerry Jeudy,WR,CLE,180.50,6783
Keaton Mitchell,RB,LAC,183.80,9511
Greg Dulcich,TE,MIA,184.30,8172
Ja'Kobi Lane,WR,BAL,184.40,13293
Jalen Nailor,WR,LVR,187.50,8180
Zach Charbonnet,RB,SEA,190.50,9753
Omar Cooper Jr.,WR,NYJ,190.60,13276
Kaelon Black,RB,SF,191.20,13414
Jalen McMillan,WR,TB,192.30,11618
Pat Freiermuth,TE,PIT,194.30,7600
Malachi Fields,WR,NYG,194.50,13285
Gunnar Helm,TE,TEN,195.10,12502
Alvin Kamara,RB,NO,195.10,4035
Tank Bigsby,RB,PHI,195.40,9225
Cade Otton,TE,TB,195.70,8111
Malik Washington,WR,MIA,197.10,11610
Jaylin Noel,WR,HOU,198.40,12536
David Njoku,TE,LAC,199.10,4033
Cam Ward,QB,TEN,201.90,12522
Jauan Jennings,WR,MIN,203.90,7049
Brian Robinson Jr.,RB,ATL,204.90,8154
Cyrus Allen,WR,KC,207,13413
Cooper Kupp,WR,SEA,207.80,4039
Ryan Flournoy,WR,DAL,208,11783
Emmett Johnson,RB,KC,211.30,13337
Fernando Mendoza,QB,LVR,211.70,13269
Rashod Bateman,WR,BAL,212,7571
Geno Smith,QB,NYJ,214,1373
Chris Bell,WR,MIA,215.30,13311
Devaughn Vele,WR,NO,215.70,11834
Dylan Sampson,RB,CLE,218.20,12469
Braelon Allen,RB,NYJ,219.70,11576
Aaron Rodgers,QB,PIT,220.30,96
Antonio Williams,WR,WAS,221.70,13301
Tyrone Tracy Jr.,RB,NYG,222.40,11655
Travis Hunter,WR,JAX,223.30,12530
Jayden Higgins,WR,HOU,223.90,12484
Calvin Ridley,WR,TEN,227.10,4981
Zachariah Branch,WR,ATL,228.70,13320
Isaac TeSlaa,WR,DET,228.90,12535
Ted Hurst III,WR,TB,229.70,13317
Ray Davis,RB,BUF,230.40,11575
Germie Bernard,WR,PIT,232.30,13274
Mason Taylor,TE,NYJ,234.80,12498
Lucas Krull,TE,DEN,236,8249
Najee Harris,RB,NYG,236.30,7528
Jacoby Brissett,QB,ARI,236.60,3257
Colby Parkinson,TE,LA,237.10,6865
Thomas Ives,WR,CHI,239,6465
Kimani Vidal,RB,LAC,241.20,11647
Tory Horton,WR,SEA,241.40,12497
Malachi Corley,WR,CLE,242,11617
Tank Dell,WR,HOU,242.10,9502
Darnell Mooney,WR,NYG,242.30,7090
Jelani Woods,TE,NYJ,243,8219
Michael Penix Jr.,QB,ATL,244,11559
Kaleb Johnson,RB,GB,244.40,12504
Ricky Pearsall,WR,SF,244.40,11638
Elijah Sarratt,WR,BAL,245,13268
Marvin Mims Jr.,WR,DEN,245.80,9494
Chimere Dike,WR,TEN,246.80,12540
Troy Franklin,WR,DEN,248.60,11627
Isiah Pacheco,RB,DET,249,8205
Justice Hill,RB,BAL,249.60,5995
Michael Trigg,TE,DAL,249.70,13401
Dylan Drummond,WR,ATL,251,11474
Nicholas Singleton,RB,TEN,251.40,13288
Theo Johnson,TE,NYG,252.10,11597
Jack Bech,WR,LVR,252.20,12483
Kendre Miller,RB,NO,252.80,9757`;

// BOTH JOINS MINTED IN ONE PARSE (v0.452.0) — the same shape dyn2026 has used
// since v0.351.3. `ADP_2026` keys the engine slug exactly as before, so every
// existing caller and every existing value is untouched; `ADP_BY_SID` keys
// StatHead's own sleeper_id and is immune to name drift.
const byName = new Map<string, number>();
const bySid = new Map<string, number>();
for (const line of ADP_CSV.split('\n')) {
  const c = line.split(',');
  if (c.length < 4) continue;
  const slug = normName(c[0]).replace(/\s+/g, '-');
  const adp = parseFloat(c[3]);
  if (!Number.isFinite(adp)) continue;
  if (slug && !byName.has(slug)) byName.set(slug, adp);
  const sid = (c[4] ?? '').trim();
  if (sid && !bySid.has(sid)) bySid.set(sid, adp);
}

/** Engine slug → consensus ADP (lower = earlier pick). */
export const ADP_2026: Map<string, number> = byName;
/** Sleeper id → the same number, for the join that cannot be misspelled. */
export const ADP_BY_SID: Map<string, number> = bySid;

/** THIS PLAYER'S ADP, ID FIRST (v0.452.0).
 *
 *  The pool's slug→sleeper-id map is authoritative where a screen has
 *  installed one (setSlugSleeperIds, the same overlay dyn2026 reads); the
 *  name join answers everywhere else and for the handful of rows StatHead
 *  cannot id. Away from a pool no ids are installed and this is exactly the
 *  name lookup it has always been — which is why nothing about the draft
 *  room changes on the day this ships. */
export const adpValue = (slug: string): number | null => {
  const sid = slugSleeperId(slug);
  return (sid ? bySid.get(sid) : undefined) ?? byName.get(slug) ?? null;
};
