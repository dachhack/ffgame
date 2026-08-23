// GENERATED — 2026 dynasty trade values, baked for dynasty-league draft rooms
// and waiver wires. Source: Stathead MCP `get_dynasty_values` — BOTH market
// formats in one pull: `value` (1QB) and `superflexValue` (SF). Stathead's
// dynasty model offers exactly these two formats (no TE-premium market
// exists there — a TEP league reads the closest honest number, 1QB or SF by
// its lineup, rather than a fabricated boost). Rookie-pick rows ("2027 Early
// 1st") are asset values, not players, and are deliberately not baked.
//
// REFRESH alongside the ADP rebake: pull
//   get_dynasty_values { limit: 300, output_format: 'csv',
//                        fields: 'playerName,position,team,value,superflexValue' }
// via the Stathead MCP and replace DYN_CSV below (keep the as-of line
// current). Names join engine slugs through normName, the same convention
// adp2026 and the worker's player index use.
import { normName } from './players';

/** Stathead dynasty market as of 2026-08-23. */
export const DYN_AS_OF = '2026-08-23';

/** Which market this league reads: superflex lineups price QBs very
 *  differently (Josh Allen: 5522 in 1QB, 10373 in SF). Installed per league
 *  by the screens that know the lineup (the setLiveAdp pattern). */
export type DynFormat = '1qb' | 'sf';
let dynFormat: DynFormat = '1qb';
export const setDynFormat = (f: DynFormat) => { dynFormat = f; };

const DYN_CSV = `RB,ATL,Bijan Robinson,11252,10241
RB,DET,Jahmyr Gibbs,10547,9923
WR,CIN,Ja'Marr Chase,9727,9674
WR,SEA,Jaxon Smith-Njigba,8613,8816
WR,LAR,Puka Nacua,8555,8687
RB,ARI,Jeremiyah Love,7666,7071
RB,LVR,Ashton Jeanty,7622,7125
WR,DET,Amon-Ra St. Brown,7333,7500
TE,LVR,Brock Bowers,7162,7986
WR,MIN,Justin Jefferson,6931,6934
WR,NYG,Malik Nabers,6831,6772
RB,MIA,De'Von Achane,6654,6244
WR,DAL,CeeDee Lamb,6564,6656
TE,ARI,Trey McBride,6432,7158
RB,LAC,Omarion Hampton,6112,5747
WR,ATL,Drake London,5635,5629
QB,BUF,Josh Allen,5522,10373
RB,IND,Jonathan Taylor,5477,5159
RB,BUF,James Cook,5469,5148
WR,CAR,Tetairoa McMillan,4856,4933
QB,NEP,Drake Maye,4793,8525
TE,CHI,Colston Loveland,4607,5200
WR,DAL,George Pickens,4424,4647
RB,KCC,Kenneth Walker III,4418,4179
RB,SFO,Christian McCaffrey,4366,4044
WR,TEN,Carnell Tate,4360,4503
RB,PHI,Saquon Barkley,4357,3997
WR,TBB,Emeka Egbuka,4325,4501
RB,CIN,Chase Brown,4214,4041
QB,CHI,Caleb Williams,4160,7300
WR,NOS,Chris Olave,4127,4190
WR,HOU,Nico Collins,4086,4244
RB,CLE,Quinshon Judkins,4051,3718
RB,NYJ,Breece Hall,4026,3756
TE,IND,Tyler Warren,4010,4551
QB,BAL,Lamar Jackson,3899,7130
QB,WAS,Jayden Daniels,3827,7018
WR,LAC,Ladd McConkey,3823,3979
WR,NYJ,Garrett Wilson,3778,3750
WR,NOS,Jordyn Tyson,3756,3738
WR,KCC,Rashee Rice,3746,3745
WR,NEP,A.J. Brown,3730,3825
RB,SEA,Jadarian Price,3722,3674
WR,PHI,DeVonta Smith,3711,3749
RB,NEP,TreVeyon Henderson,3711,3413
WR,PHI,Makai Lemon,3699,3787
QB,CIN,Joe Burrow,3625,6499
RB,LAR,Kyren Williams,3552,3301
WR,BAL,Zay Flowers,3529,3638
WR,CHI,Luther Burden,3467,3556
RB,TBB,Bucky Irving,3449,3154
WR,CHI,Rome Odunze,3384,3410
RB,NYG,Cam Skattebo,3244,3077
TE,GBP,Tucker Kraft,3202,3545
WR,DEN,Jaylen Waddle,3192,3174
WR,ARI,Marvin Harrison Jr.,3185,3213
WR,JAC,Brian Thomas Jr.,3179,3124
WR,CIN,Tee Higgins,3153,3143
QB,LAC,Justin Herbert,3130,5821
RB,DAL,Javonte Williams,3100,2913
RB,GBP,Josh Jacobs,3085,2749
TE,CLE,Harold Fannin,3081,3312
WR,CLE,KC Concepcion,3047,3054
RB,BAL,Derrick Henry,2951,2780
QB,NYG,Jaxson Dart,2932,5091
QB,PHI,Jalen Hurts,2906,5353
QB,KCC,Patrick Mahomes,2874,5192
WR,WAS,Antonio Williams,2859,3105
RB,NOS,Travis Etienne,2844,2666
TE,DET,Sam LaPorta,2828,3213
WR,TBB,Ted Hurst,2813,2930
WR,DET,Jameson Williams,2712,2694
QB,JAC,Trevor Lawrence,2712,4814
TE,NYJ,Kenyon Sadiq,2692,2852
QB,DEN,Bo Nix,2669,5007
RB,MIN,Demond Claiborne,2615,2625
TE,ATL,Kyle Pitts,2562,2857
WR,CLE,Denzel Boston,2557,2623
RB,CHI,D'Andre Swift,2556,2380
RB,DEN,Jonah Coleman,2546,2359
RB,LVR,Mike Washington Jr.,2457,2325
WR,NYJ,Omar Cooper Jr.,2385,2291
RB,JAC,Bhayshul Tuten,2354,2298
WR,MIA,Chris Bell,2352,2329
QB,SFO,Brock Purdy,2340,4188
WR,BUF,D.J. Moore,2302,2289
RB,HOU,David Montgomery,2282,2040
WR,PIT,Germie Bernard,2278,2382
WR,BAL,Ja'Kobi Lane,2271,2530
WR,JAC,Parker Washington,2246,2410
TE,PHI,Eli Stowers,2237,2405
RB,TEN,Nicholas Singleton,2230,2104
QB,LVR,Fernando Mendoza,2213,4149
RB,KCC,Emmett Johnson,2172,2094
QB,NOS,Tyler Shough,2162,3381
WR,IND,Alec Pierce,2107,2038
WR,WAS,Terry McLaurin,2093,2056
WR,TEN,Wan'Dale Robinson,2092,2020
QB,GBP,Jordan Love,2090,3784
WR,ATL,Zachariah Branch,2083,2109
RB,DEN,RJ Harvey,2079,1904
RB,CAR,Jonathon Brooks,2074,1907
WR,GBP,Christian Watson,2053,2068
WR,JAC,Travis Hunter,2043,2024
WR,GBP,Matthew Golden,2042,1948
QB,DAL,Dak Prescott,2033,3779
WR,MIN,Jordan Addison,2019,2014
QB,TEN,Cam Ward,2015,3452
WR,SFO,Mike Evans,2003,2002
RB,CAR,Chuba Hubbard,1974,1779
WR,NYG,Malachi Fields,1962,2034
WR,LAR,Davante Adams,1939,1890
WR,ARI,Michael Wilson,1916,1915
RB,CHI,Kyle Monangai,1909,1737
RB,PIT,Rico Dowdle,1904,1730
RB,LAR,Blake Corum,1901,1769
RB,WAS,Kaytron Allen,1892,1843
RB,NEP,Rhamondre Stevenson,1883,1751
WR,SFO,De'Zhaun Stribling,1879,1877
RB,SEA,Zach Charbonnet,1862,1670
WR,PIT,DK Metcalf,1850,1845
WR,PIT,Michael Pittman,1849,1818
TE,LAR,Max Klare,1848,2232
WR,IND,Josh Downs,1842,1784
QB,HOU,C.J. Stroud,1832,3191
RB,PIT,Jaylen Warren,1820,1669
QB,DET,Jared Goff,1811,3244
TE,SFO,George Kittle,1782,1912
RB,WAS,Jacory Croskey-Merritt,1775,1637
QB,TBB,Baker Mayfield,1771,3274
WR,KCC,Xavier Worthy,1771,1721
TE,NYG,Isaiah Likely,1768,1896
WR,BAL,Elijah Sarratt,1768,1751
WR,GBP,Jayden Reed,1760,1731
RB,MIN,Jordan Mason,1753,1595
RB,DEN,J.K. Dobbins,1735,1535
TE,BUF,Dalton Kincaid,1722,1887
WR,LAC,Quentin Johnston,1714,1666
TE,DAL,Jake Ferguson,1713,1863
WR,BUF,Skyler Bell,1685,1744
RB,TBB,Kenneth Gainwell,1636,1499
WR,DEN,Courtland Sutton,1611,1579
WR,NEP,Romeo Doubs,1597,1631
TE,LAC,Oronde Gadsden,1595,1702
RB,TEN,Tony Pollard,1593,1448
WR,CAR,Chris Brazzell II,1580,1598
TE,JAC,Brenton Strange,1552,1681
WR,IND,Deion Burks,1543,1567
WR,HOU,Jayden Higgins,1533,1551
QB,CAR,Bryce Young,1523,2429
RB,WAS,Rachaad White,1520,1386
WR,TBB,Jalen McMillan,1514,1507
WR,TBB,Chris Godwin,1508,1449
QB,MIN,Kyler Murray,1506,2663
WR,CAR,Jalen Coker,1484,1479
QB,SEA,Sam Darnold,1457,2477
RB,JAC,Chris Rodriguez,1454,1340
WR,JAC,Jakobi Meyers,1449,1418
RB,ARI,Tyler Allgeier,1424,1350
WR,MIA,Kevin Coleman,1423,1587
QB,LAR,Matthew Stafford,1406,2437
RB,LAC,Keaton Mitchell,1379,1230
WR,KCC,Cyrus Allen,1365,1392
RB,CLE,Dylan Sampson,1349,1260`;

/** Engine slug → [1QB value, SF value]. Minted exactly the way ADP_2026
 *  mints slugs, so both bakes join the same pool rows. */
export const DYN_2026: Map<string, [number, number]> = (() => {
  const m = new Map<string, [number, number]>();
  for (const line of DYN_CSV.split('\n')) {
    const c = line.split(',');
    if (c.length < 5) continue;
    const slug = normName(c[2]).replace(/\s+/g, '-');
    const v1 = parseFloat(c[3]); const vs = parseFloat(c[4]);
    if (!slug || !Number.isFinite(v1) || !Number.isFinite(vs)) continue;
    if (!m.has(slug)) m.set(slug, [v1, vs]);
  }
  return m;
})();

export const dynFor = (slug: string): number | null => {
  const v = DYN_2026.get(slug);
  return v ? (dynFormat === 'sf' ? v[1] : v[0]) : null;
};
