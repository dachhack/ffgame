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
// Boutte NE→HOU, Jaydon Blue DAL→PHI), not wrong players. A future refresh
// takes the ids straight from `get_adp`, which serves them.
import { normName } from './players';
import { slugSleeperId } from './slugMeta';

/** Blend freshness: FantasyPros 2026-08-21 · Sleeper 2026-08-26 · FFC 2026-08-25. */
export const ADP_AS_OF = '2026-08-26';

const ADP_CSV = `Jahmyr Gibbs,RB,DET,2,9221
Bijan Robinson,RB,ATL,2.80,9509
Ja'Marr Chase,WR,CIN,2.90,7564
Puka Nacua,WR,LA,3.50,9493
Jaxon Smith-Njigba,WR,SEA,5.40,9488
Amon-Ra St. Brown,WR,DET,6.70,7547
Christian McCaffrey,RB,SF,7.60,4034
Jonathan Taylor,RB,IND,9.20,6813
CeeDee Lamb,WR,DAL,9.60,6786
Justin Jefferson,WR,MIN,10.80,6794
Drake London,WR,ATL,12.80,8112
James Cook III,RB,BUF,13.80,8138
De'Von Achane,RB,MIA,15.10,9226
Ashton Jeanty,RB,LVR,15.30,12527
Chase Brown,RB,CIN,15.70,9224
A.J. Brown,WR,NE,16.90,5859
Saquon Barkley,RB,PHI,19.90,4866
Nico Collins,WR,HOU,20.70,7569
Rashee Rice,WR,KC,20.90,10229
George Pickens,WR,DAL,21.60,8137
Omarion Hampton,RB,LAC,22,12507
Chris Olave,WR,NO,22.40,8144
Kenneth Walker III,RB,KC,23.50,8151
Trey McBride,TE,ARI,23.80,8130
Derrick Henry,RB,BAL,25.60,3198
Brock Bowers,TE,LVR,25.90,11604
Malik Nabers,WR,NYG,26.40,11632
Josh Allen,QB,BUF,28.10,4984
DeVonta Smith,WR,PHI,29.60,7525
Zay Flowers,WR,BAL,31.70,9997
Jeremiyah Love,RB,ARI,31.80,13287
Garrett Wilson,WR,NYJ,32.60,8146
Tetairoa McMillan,WR,CAR,34.40,12526
Kyren Williams,RB,LA,34.70,8150
Josh Jacobs,RB,GB,35.90,5850
Tee Higgins,WR,CIN,36,6801
Breece Hall,RB,NYJ,36.50,8155
Ladd McConkey,WR,LAC,37.30,11635
Emeka Egbuka,WR,TB,37.90,12514
Javonte Williams,RB,DAL,39,7588
Lamar Jackson,QB,BAL,42.10,4881
Jaylen Waddle,WR,DEN,42.70,7526
Travis Etienne Jr.,RB,NO,44.30,7543
Cam Skattebo,RB,NYG,45.60,12481
Colston Loveland,TE,CHI,45.90,12517
Drake Maye,QB,NE,46.10,11564
Davante Adams,WR,LA,47.20,2133
Terry McLaurin,WR,WAS,48.80,5927
Bucky Irving,RB,TB,48.80,11584
Jameson Williams,WR,DET,52,8148
Joe Burrow,QB,CIN,52.30,6770
DJ Moore,WR,BUF,52.40,4983
D'Andre Swift,RB,CHI,52.40,6790
Luther Burden III,WR,CHI,52.90,12519
Quinshon Judkins,RB,CLE,55.50,12512
Mike Evans,WR,SF,56.10,2216
David Montgomery,RB,HOU,56.50,5892
Tyler Warren,TE,IND,56.80,12518
Rome Odunze,WR,CHI,57.90,11620
Bhayshul Tuten,RB,JAX,60.70,12490
Christian Watson,WR,GB,61.30,8167
TreVeyon Henderson,RB,NE,61.30,12529
Jayden Daniels,QB,WAS,63.80,11566
Jalen Hurts,QB,PHI,66.70,6904
Parker Washington,WR,JAX,68.50,9487
Jaylen Warren,RB,PIT,68.60,8228
Marvin Harrison Jr.,WR,ARI,69.50,11628
Carnell Tate,WR,TEN,70.60,13279
DK Metcalf,WR,PIT,72.60,5846
Jadarian Price,RB,SEA,73.30,13286
Brian Thomas Jr.,WR,JAX,73.50,11631
Courtland Sutton,WR,DEN,73.60,5045
Dak Prescott,QB,DAL,73.80,3294
Harold Fannin Jr.,TE,CLE,74.70,12506
Kyle Pitts Sr.,TE,ATL,75.10,7553
Rhamondre Stevenson,RB,NE,75.40,7611
Caleb Williams,QB,CHI,76.90,11560
Tony Pollard,RB,TEN,78.20,5967
Tucker Kraft,TE,GB,81.90,9484
Rico Dowdle,RB,PIT,81.90,7021
Michael Wilson,WR,ARI,82.10,10232
Chris Godwin Jr.,WR,TB,83.50,4037
Michael Pittman Jr.,WR,PIT,84.80,6819
Chuba Hubbard,RB,CAR,84.80,7594
Sam LaPorta,TE,DET,85.60,10859
Justin Herbert,QB,LAC,87.30,6797
Alec Pierce,WR,IND,87.50,8142
RJ Harvey,RB,DEN,87.70,12489
Trevor Lawrence,QB,JAX,89,7523
Matthew Stafford,QB,LA,91.60,421
Josh Downs,WR,IND,91.70,9500
Wan'Dale Robinson,WR,TEN,94.40,8126
J.K. Dobbins,RB,DEN,95.10,6806
Jakobi Meyers,WR,JAX,99,5947
Brock Purdy,QB,SF,100.10,8183
Travis Kelce,TE,KC,100.10,1466
Kenny Gainwell,RB,TB,100.20,7567
Jonathon Brooks,RB,CAR,100.40,11583
Stefon Diggs,WR,WAS,100.40,2449
Quentin Johnston,WR,LAC,101.50,9754
Jordan Addison,WR,MIN,102.50,9756
Jaxson Dart,QB,NYG,103,12508
Patrick Mahomes II,QB,KC,103,4046
George Kittle,TE,SF,104.10,4217
Jayden Reed,WR,GB,104.50,10222
Makai Lemon,WR,PHI,104.80,13294
Kyle Monangai,RB,CHI,107.20,12534
Bo Nix,QB,DEN,110.50,11563
Jared Goff,QB,DET,111.40,3163
Aaron Jones Sr.,RB,MIN,112.20,4199
Blake Corum,RB,LA,112.60,11586
Dallas Goedert,TE,PHI,113.90,5022
Rachaad White,RB,WAS,115.60,8136
Jacory Croskey-Merritt,RB,WAS,115.90,12533
Jake Ferguson,TE,DAL,116.60,8110
Jordan Mason,RB,MIN,117.90,8408
Khalil Shakir,WR,BUF,118.60,8134
Jordyn Tyson,WR,NO,119.90,13281
Dalton Kincaid,TE,BUF,120.40,10236
Matthew Golden,WR,GB,120.40,12501
KC Concepcion,WR,CLE,121.70,13298
Xavier Worthy,WR,KC,122.60,11624
Isaiah Likely,TE,NYG,123,8131
Romeo Doubs,WR,NE,125.20,8121
Deebo Samuel Sr.,WR,SF,127.90,5872
Jalen Coker,WR,CAR,128.60,11646
Baker Mayfield,QB,TB,128.80,4892
Mark Andrews,TE,BAL,129.30,5012
Kyler Murray,QB,MIN,133.30,5849
Jordan Love,QB,GB,137.70,6804
Rashid Shaheed,WR,SEA,141.10,8676
Zach Charbonnet,RB,SEA,142,9753
Tyler Shough,QB,NO,143.50,12545
Tyjae Spears,RB,TEN,144.40,9508
De'Zhaun Stribling,WR,SF,146,13417
Woody Marks,RB,HOU,146.50,12474
Tyler Allgeier,RB,ARI,146.70,8132
Chris Rodriguez Jr.,RB,JAX,147.10,10219
Denzel Boston,WR,CLE,150.80,13346
Sam Darnold,QB,SEA,151.60,4943
Hunter Henry,TE,NE,152.30,3214
Tyrone Tracy Jr.,RB,NYG,152.50,11655
Juwan Johnson,TE,NO,152.90,7002
Alvin Kamara,RB,NO,152.90,4035
Jayden Higgins,WR,HOU,156.20,12484
Jerry Jeudy,WR,CLE,157.70,6783
Brenton Strange,TE,JAX,158.50,9480
Jonah Coleman,RB,DEN,159.20,13345
Oronde Gadsden II,TE,LAC,160.50,12493
Malik Willis,QB,MIA,161.10,8161
Keaton Mitchell,RB,LAC,161.80,9511
Dylan Sampson,RB,CLE,162.70,12469
Isiah Pacheco,RB,DET,164.80,8205
Brian Robinson Jr.,RB,ATL,165.20,8154
Tre Tucker,WR,LVR,165.70,10213
C.J. Stroud,QB,HOU,165.80,9758
Jauan Jennings,WR,MIN,165.90,7049
Chig Okonkwo,TE,WAS,167.20,8210
Tank Bigsby,RB,PHI,168,9225
Jalen McMillan,WR,TB,168.20,11618
Daniel Jones,QB,IND,170.40,5870
Travis Hunter,WR,JAX,171.70,12530
Mike Washington Jr.,RB,LVR,173.50,13305
Jalen Nailor,WR,LVR,174.50,8180
Dalton Schultz,TE,HOU,174.90,5001
T.J. Hockenson,TE,MIN,175.10,5844
Cam Ward,QB,TEN,177.40,12522
Malik Washington,WR,MIA,177.40,11610
Braelon Allen,RB,NYJ,178.10,11576
Tank Dell,WR,HOU,178.10,9502
Keenan Allen,WR,IND,178.40,1479
Kenyon Sadiq,TE,NYJ,182.20,13330
Omar Cooper Jr.,WR,NYJ,182.50,13276
MarShawn Lloyd,RB,GB,183.20,11581
Cyrus Allen,WR,KC,183.40,13413
Adonai Mitchell,WR,NYJ,185.30,11625
Bryce Young,QB,CAR,187,9228
Dontayvion Wicks,WR,PHI,187.20,9486
Ja'Kobi Lane,WR,BAL,188.30,13293
AJ Barner,TE,SEA,192.20,11603
Ryan Flournoy,WR,DAL,193.10,11783
Emmett Johnson,RB,KC,193.40,13337
Jaylin Noel,WR,HOU,193.70,12536
Calvin Ridley,WR,TEN,195.60,4981
Tre' Harris,WR,LAC,196.10,12509
Kayshon Boutte,WR,NE,196.60,9504
Cooper Kupp,WR,SEA,197.10,4039
James Conner,RB,ARI,200,4137
Rashod Bateman,WR,BAL,200.70,7571
Pat Bryant,WR,DEN,202.60,12492
Terrance Ferguson,TE,LA,203.40,12487
Caleb Douglas,WR,MIA,203.60,13296
Ray Davis,RB,BUF,203.70,11575
Jacoby Brissett,QB,ARI,204.80,3257
Kaelon Black,RB,SF,205.70,13414
Isaac TeSlaa,WR,DET,207.70,12535
Greg Dulcich,TE,MIA,207.80,8172
Nicholas Singleton,RB,TEN,209.30,13288
Zachariah Branch,WR,ATL,210.60,13320
Fernando Mendoza,QB,LVR,211.40,13269
Aaron Rodgers,QB,PIT,212.50,96
Kimani Vidal,RB,LAC,213.20,11647
Germie Bernard,WR,PIT,214,13274
Jaydon Blue,RB,DAL,215.70,12457
Troy Franklin,WR,DEN,216.20,11627
Sean Tucker,RB,TB,217.70,9506
Justice Hill,RB,BAL,218.60,5995
Gunnar Helm,TE,TEN,224.30,12502
Malachi Fields,WR,NYG,224.70,13285
David Njoku,TE,LAC,226.60,4033
Keon Coleman,WR,BUF,227.30,11637
Antonio Williams,WR,WAS,227.50,13301
Darnell Mooney,WR,NYG,231.10,7090
Emanuel Wilson,RB,SEA,233.50,11435
Kaytron Allen,RB,WAS,233.60,13405
Chimere Dike,WR,TEN,233.90,12540
Pat Freiermuth,TE,PIT,235.20,7600
Geno Smith,QB,NYJ,236.70,1373
Devaughn Vele,WR,NO,237.20,11834
Jack Bech,WR,LVR,238.10,12483
Jaylen Wright,RB,MIA,238.70,11643`;

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
