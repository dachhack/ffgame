// GENERATED — 2026 dynasty trade values, baked for dynasty-league draft rooms
// and waiver wires. Source: Stathead MCP `get_dynasty_values` (1QB market,
// value column; rookie-pick rows like "2027 Early 1st" are asset values, not
// players, and are deliberately not baked). The number is a market-relative
// asset price — twice the value is roughly twice the trade cost — so it sorts
// long-horizon worth the way ADP sorts draft-day cost.
//
// REFRESH alongside the ADP rebake: pull
//   get_dynasty_values { limit: 300, output_format: 'csv',
//                        fields: 'playerName,position,team,value' }
// via the Stathead MCP and replace DYN_CSV below (keep the as-of line
// current). Names join engine slugs through normName, the same convention
// adp2026 and the worker's player index use.
import { normName } from './players';

/** Stathead dynasty market as of 2026-08-23 (1QB values). */
export const DYN_AS_OF = '2026-08-23';

const DYN_CSV = `Bijan Robinson,RB,ATL,11252
Jahmyr Gibbs,RB,DET,10547
Ja'Marr Chase,WR,CIN,9727
Jaxon Smith-Njigba,WR,SEA,8613
Puka Nacua,WR,LAR,8555
Jeremiyah Love,RB,ARI,7666
Ashton Jeanty,RB,LVR,7622
Amon-Ra St. Brown,WR,DET,7333
Brock Bowers,TE,LVR,7162
Justin Jefferson,WR,MIN,6931
Malik Nabers,WR,NYG,6831
De'Von Achane,RB,MIA,6654
CeeDee Lamb,WR,DAL,6564
Trey McBride,TE,ARI,6432
Omarion Hampton,RB,LAC,6112
Drake London,WR,ATL,5635
Josh Allen,QB,BUF,5522
Jonathan Taylor,RB,IND,5477
James Cook,RB,BUF,5469
Tetairoa McMillan,WR,CAR,4856
Drake Maye,QB,NEP,4793
Colston Loveland,TE,CHI,4607
George Pickens,WR,DAL,4424
Kenneth Walker III,RB,KCC,4418
Christian McCaffrey,RB,SFO,4366
Carnell Tate,WR,TEN,4360
Saquon Barkley,RB,PHI,4357
Emeka Egbuka,WR,TBB,4325
Chase Brown,RB,CIN,4214
Caleb Williams,QB,CHI,4160
Chris Olave,WR,NOS,4127
Nico Collins,WR,HOU,4086
Quinshon Judkins,RB,CLE,4051
Breece Hall,RB,NYJ,4026
Tyler Warren,TE,IND,4010
Lamar Jackson,QB,BAL,3899
Jayden Daniels,QB,WAS,3827
Ladd McConkey,WR,LAC,3823
Garrett Wilson,WR,NYJ,3778
Jordyn Tyson,WR,NOS,3756
Rashee Rice,WR,KCC,3746
A.J. Brown,WR,NEP,3730
Jadarian Price,RB,SEA,3722
DeVonta Smith,WR,PHI,3711
TreVeyon Henderson,RB,NEP,3711
Makai Lemon,WR,PHI,3699
Joe Burrow,QB,CIN,3625
Kyren Williams,RB,LAR,3552
Zay Flowers,WR,BAL,3529
Luther Burden,WR,CHI,3467
Bucky Irving,RB,TBB,3449
Rome Odunze,WR,CHI,3384
Cam Skattebo,RB,NYG,3244
Tucker Kraft,TE,GBP,3202
Jaylen Waddle,WR,DEN,3192
Marvin Harrison Jr.,WR,ARI,3185
Brian Thomas Jr.,WR,JAC,3179
Tee Higgins,WR,CIN,3153
Justin Herbert,QB,LAC,3130
Javonte Williams,RB,DAL,3100
Josh Jacobs,RB,GBP,3085
Harold Fannin,TE,CLE,3081
KC Concepcion,WR,CLE,3047
Derrick Henry,RB,BAL,2951
Jaxson Dart,QB,NYG,2932
Jalen Hurts,QB,PHI,2906
Patrick Mahomes,QB,KCC,2874
Antonio Williams,WR,WAS,2859
Travis Etienne,RB,NOS,2844
Sam LaPorta,TE,DET,2828
Ted Hurst,WR,TBB,2813
Jameson Williams,WR,DET,2712
Trevor Lawrence,QB,JAC,2712
Kenyon Sadiq,TE,NYJ,2692
Bo Nix,QB,DEN,2669
Demond Claiborne,RB,MIN,2615
Kyle Pitts,TE,ATL,2562
Denzel Boston,WR,CLE,2557
D'Andre Swift,RB,CHI,2556
Jonah Coleman,RB,DEN,2546
Mike Washington Jr.,RB,LVR,2457
Omar Cooper Jr.,WR,NYJ,2385
Bhayshul Tuten,RB,JAC,2354
Chris Bell,WR,MIA,2352
Brock Purdy,QB,SFO,2340
D.J. Moore,WR,BUF,2302
David Montgomery,RB,HOU,2282
Germie Bernard,WR,PIT,2278
Ja'Kobi Lane,WR,BAL,2271
Parker Washington,WR,JAC,2246
Eli Stowers,TE,PHI,2237
Nicholas Singleton,RB,TEN,2230
Fernando Mendoza,QB,LVR,2213
Emmett Johnson,RB,KCC,2172
Tyler Shough,QB,NOS,2162
Alec Pierce,WR,IND,2107
Terry McLaurin,WR,WAS,2093
Wan'Dale Robinson,WR,TEN,2092
Jordan Love,QB,GBP,2090
Zachariah Branch,WR,ATL,2083
RJ Harvey,RB,DEN,2079
Jonathon Brooks,RB,CAR,2074
Christian Watson,WR,GBP,2053
Travis Hunter,WR,JAC,2043
Matthew Golden,WR,GBP,2042
Dak Prescott,QB,DAL,2033
Jordan Addison,WR,MIN,2019
Cam Ward,QB,TEN,2015
Mike Evans,WR,SFO,2003
Chuba Hubbard,RB,CAR,1974
Malachi Fields,WR,NYG,1962
Davante Adams,WR,LAR,1939
Michael Wilson,WR,ARI,1916
Kyle Monangai,RB,CHI,1909
Rico Dowdle,RB,PIT,1904
Blake Corum,RB,LAR,1901
Kaytron Allen,RB,WAS,1892
Rhamondre Stevenson,RB,NEP,1883
De'Zhaun Stribling,WR,SFO,1879
Zach Charbonnet,RB,SEA,1862
DK Metcalf,WR,PIT,1850
Michael Pittman,WR,PIT,1849
Max Klare,TE,LAR,1848
Josh Downs,WR,IND,1842
C.J. Stroud,QB,HOU,1832
Jaylen Warren,RB,PIT,1820
Jared Goff,QB,DET,1811
George Kittle,TE,SFO,1782
Jacory Croskey-Merritt,RB,WAS,1775
Baker Mayfield,QB,TBB,1771
Xavier Worthy,WR,KCC,1771
Isaiah Likely,TE,NYG,1768
Elijah Sarratt,WR,BAL,1768
Jayden Reed,WR,GBP,1760
Jordan Mason,RB,MIN,1753
J.K. Dobbins,RB,DEN,1735
Dalton Kincaid,TE,BUF,1722
Quentin Johnston,WR,LAC,1714
Jake Ferguson,TE,DAL,1713
Skyler Bell,WR,BUF,1685
Kenneth Gainwell,RB,TBB,1636
Courtland Sutton,WR,DEN,1611
Romeo Doubs,WR,NEP,1597
Oronde Gadsden,TE,LAC,1595
Tony Pollard,RB,TEN,1593
Chris Brazzell II,WR,CAR,1580
Brenton Strange,TE,JAC,1552
Deion Burks,WR,IND,1543
Jayden Higgins,WR,HOU,1533
Bryce Young,QB,CAR,1523
Rachaad White,RB,WAS,1520
Jalen McMillan,WR,TBB,1514
Chris Godwin,WR,TBB,1508
Kyler Murray,QB,MIN,1506
Jalen Coker,WR,CAR,1484
Sam Darnold,QB,SEA,1457
Chris Rodriguez,RB,JAC,1454
Jakobi Meyers,WR,JAC,1449
Tyler Allgeier,RB,ARI,1424
Kevin Coleman,WR,MIA,1423
Matthew Stafford,QB,LAR,1406
Keaton Mitchell,RB,LAC,1379
Cyrus Allen,WR,KCC,1365
Dylan Sampson,RB,CLE,1349`;

/** Engine slug → dynasty value (higher = worth more). Minted exactly the way
 *  ADP_2026 mints slugs, so both bakes join the same pool rows. */
export const DYN_2026: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const line of DYN_CSV.split('\n')) {
    const c = line.split(',');
    if (c.length < 4) continue;
    const slug = normName(c[0]).replace(/\s+/g, '-');
    const val = parseFloat(c[3]);
    if (!slug || !Number.isFinite(val)) continue;
    if (!m.has(slug)) m.set(slug, val);
  }
  return m;
})();

export const dynFor = (slug: string): number | null => DYN_2026.get(slug) ?? null;
