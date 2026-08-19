// GENERATED — 2026 consensus Average Draft Position, baked for the native-league
// draft pool. Source: Stathead MCP `get_adp` (season 2026, source 'consensus' —
// a freshness/confidence-weighted blend of FantasyPros expert-consensus rank +
// Sleeper draft ADP + FantasyFootballCalculator, PPR/1QB). Includes the 2026
// rookie class at market price (e.g. Jeremiyah Love RB, ADP 31.5).
//
// REFRESH (ADP moves all summer — rebake weekly through August): pull
//   get_adp { season: 2026, limit: 300, output_format: 'csv',
//             fields: 'player_name,position,team,adp' }
// via the Stathead MCP and replace ADP_CSV below (keep the as-of line current).
// Names are matched to engine slugs with normName, the same convention the
// worker's live-scoring player index uses, so ADP rows join the Sleeper
// directory (and baked 2025 PBP where it exists) automatically.
import { normName } from './players';

/** Blend freshness: FantasyPros 2026-08-14 · Sleeper 2026-08-19 · FFC 2026-08-18. */
export const ADP_AS_OF = '2026-08-19';

const ADP_CSV = `Jahmyr Gibbs,RB,DET,2.20
Bijan Robinson,RB,ATL,2.50
Ja'Marr Chase,WR,CIN,2.90
Puka Nacua,WR,LA,3.40
Jaxon Smith-Njigba,WR,SEA,5.40
Amon-Ra St. Brown,WR,DET,6.60
Christian McCaffrey,RB,SF,7.20
Jonathan Taylor,RB,IND,8.90
CeeDee Lamb,WR,DAL,9.70
Justin Jefferson,WR,MIN,11.30
Drake London,WR,ATL,12.50
James Cook III,RB,BUF,13.90
De'Von Achane,RB,MIA,14.40
Ashton Jeanty,RB,LVR,15.70
Chase Brown,RB,CIN,16.10
A.J. Brown,WR,NE,16.70
Saquon Barkley,RB,PHI,20.20
George Pickens,WR,DAL,20.70
Rashee Rice,WR,KC,20.80
Nico Collins,WR,HOU,20.90
Omarion Hampton,RB,LAC,21.10
Trey McBride,TE,ARI,23.80
Chris Olave,WR,NO,23.90
Kenneth Walker III,RB,KC,24.40
Derrick Henry,RB,BAL,25.60
Josh Allen,QB,BUF,27.20
Brock Bowers,TE,LVR,27.30
Malik Nabers,WR,NYG,28.10
DeVonta Smith,WR,PHI,29.20
Zay Flowers,WR,BAL,31
Jeremiyah Love,RB,ARI,31.50
Garrett Wilson,WR,NYJ,33.40
Breece Hall,RB,NYJ,33.90
Tetairoa McMillan,WR,CAR,34.10
Kyren Williams,RB,LA,34.80
Tee Higgins,WR,CIN,35.20
Josh Jacobs,RB,GB,35.60
Ladd McConkey,WR,LAC,37.60
Emeka Egbuka,WR,TB,37.90
Javonte Williams,RB,DAL,40.10
Lamar Jackson,QB,BAL,41.60
Jaylen Waddle,WR,DEN,43.50
Cam Skattebo,RB,NYG,44.20
Drake Maye,QB,NE,45.80
Travis Etienne Jr.,RB,NO,45.80
Colston Loveland,TE,CHI,46.30
Davante Adams,WR,LA,47
Terry McLaurin,WR,WAS,48.20
Bucky Irving,RB,TB,48.20
Joe Burrow,QB,CIN,51.90
Luther Burden III,WR,CHI,51.90
Jameson Williams,WR,DET,51.90
DJ Moore,WR,BUF,53.20
D'Andre Swift,RB,CHI,53.40
Mike Evans,WR,SF,55.30
Tyler Warren,TE,IND,55.60
Quinshon Judkins,RB,CLE,55.60
Rome Odunze,WR,CHI,57.20
David Montgomery,RB,HOU,58
TreVeyon Henderson,RB,NE,59.50
Bhayshul Tuten,RB,JAX,61.60
Jayden Daniels,QB,WAS,61.80
Christian Watson,WR,GB,62.10
Jalen Hurts,QB,PHI,67.40
Carnell Tate,WR,TEN,68.10
Marvin Harrison Jr.,WR,ARI,69.80
Jaylen Warren,RB,PIT,70.50
Parker Washington,WR,JAX,70.60
DK Metcalf,WR,PIT,72
Brian Thomas Jr.,WR,JAX,74.10
Courtland Sutton,WR,DEN,74.60
Dak Prescott,QB,DAL,74.90
Harold Fannin Jr.,TE,CLE,75
Jadarian Price,RB,SEA,76.50
Kyle Pitts Sr.,TE,ATL,76.70
Tony Pollard,RB,TEN,77.70
Caleb Williams,QB,CHI,78
Sam LaPorta,TE,DET,78
Rhamondre Stevenson,RB,NE,78.80
Chuba Hubbard,RB,CAR,79.70
Alec Pierce,WR,IND,80.60
Tucker Kraft,TE,GB,82.10
Rico Dowdle,RB,PIT,83.20
Michael Wilson,WR,ARI,84.20
Michael Pittman Jr.,WR,PIT,85.40
RJ Harvey,RB,DEN,85.80
Chris Godwin Jr.,WR,TB,85.90
Jordyn Tyson,WR,NO,86.90
Justin Herbert,QB,LAC,87.40
Trevor Lawrence,QB,JAX,89.90
Josh Downs,WR,IND,91.40
Wan'Dale Robinson,WR,TEN,92.10
Matthew Stafford,QB,LA,93.80
Jakobi Meyers,WR,JAX,96.10
J.K. Dobbins,RB,DEN,98.10
Jaxson Dart,QB,NYG,98.80
Brock Purdy,QB,SF,99.40
Kenny Gainwell,RB,TB,99.80
Quentin Johnston,WR,LAC,100.20
Travis Kelce,TE,KC,100.60
Makai Lemon,WR,PHI,101.60
Patrick Mahomes II,QB,KC,101.90
Jordan Addison,WR,MIN,104.30
Jayden Reed,WR,GB,104.60
George Kittle,TE,SF,105.30
Kyle Monangai,RB,CHI,106
Stefon Diggs,WR,WAS,106
Aaron Jones Sr.,RB,MIN,110.60
Jonathon Brooks,RB,CAR,111.80
Bo Nix,QB,DEN,112.10
Jared Goff,QB,DET,113
Rachaad White,RB,WAS,113.10
Blake Corum,RB,LA,114.10
Jacory Croskey-Merritt,RB,WAS,116.30
Jake Ferguson,TE,DAL,117.30
Khalil Shakir,WR,BUF,117.80
Dallas Goedert,TE,PHI,120.70
Dalton Kincaid,TE,BUF,122
Jordan Mason,RB,MIN,122
Romeo Doubs,WR,NE,122
Xavier Worthy,WR,KC,122.70
Isaiah Likely,TE,NYG,123.30
Matthew Golden,WR,GB,125
KC Concepcion,WR,CLE,128.50
Deebo Samuel Sr.,WR,SF,128.80
Baker Mayfield,QB,TB,129
Jayden Higgins,WR,HOU,129.50
Jalen Coker,WR,CAR,129.60
Mark Andrews,TE,BAL,129.90
Kyler Murray,QB,MIN,134.50
Jordan Love,QB,GB,135.70
Tyler Shough,QB,NO,140.20
Zach Charbonnet,RB,SEA,141.10
Rashid Shaheed,WR,SEA,142.70
Tyrone Tracy Jr.,RB,NYG,146.80
Tyjae Spears,RB,TEN,147.80
Oronde Gadsden II,TE,LAC,150
Alvin Kamara,RB,NO,150.20
Tyler Allgeier,RB,ARI,150.80
Woody Marks,RB,HOU,151.20
Sam Darnold,QB,SEA,151.70
Chris Rodriguez Jr.,RB,JAX,152.80
Hunter Henry,TE,NE,153.50
Denzel Boston,WR,CLE,153.90
Brenton Strange,TE,JAX,157.70
Juwan Johnson,TE,NO,158.10
Jerry Jeudy,WR,CLE,158.40
Malik Willis,QB,MIA,158.70
C.J. Stroud,QB,HOU,160.60
Brian Robinson Jr.,RB,ATL,160.60
Chig Okonkwo,TE,WAS,161
Jauan Jennings,WR,MIN,161.60
Isiah Pacheco,RB,DET,162
De'Zhaun Stribling,WR,SF,165
Dylan Sampson,RB,CLE,165.20
Jalen McMillan,WR,TB,165.40
Jonah Coleman,RB,DEN,165.50
Keaton Mitchell,RB,LAC,166
Travis Hunter,WR,JAX,166.50
Tre Tucker,WR,LVR,166.60
Omar Cooper Jr.,WR,NYJ,166.90
Daniel Jones,QB,IND,170.60
Tank Bigsby,RB,PHI,171
T.J. Hockenson,TE,MIN,174.40
Cam Ward,QB,TEN,174.60
Jalen Nailor,WR,LVR,174.70
Dalton Schultz,TE,HOU,179.30
Adonai Mitchell,WR,NYJ,180.90
Malik Washington,WR,MIA,181.20
Kenyon Sadiq,TE,NYJ,181.70
Tank Dell,WR,HOU,182.50
Braelon Allen,RB,NYJ,183.70
Bryce Young,QB,CAR,187.60
Tre' Harris,WR,LAC,188.90
Dontayvion Wicks,WR,PHI,192.60
Kayshon Boutte,WR,NE,192.60
Calvin Ridley,WR,TEN,193.30
AJ Barner,TE,SEA,193.90
Mike Washington Jr.,RB,LVR,193.90
James Conner,RB,ARI,195.20
Cooper Kupp,WR,SEA,197.40
Emmett Johnson,RB,KC,198
Rashod Bateman,WR,BAL,198.50
Ja'Kobi Lane,WR,BAL,199.20
Ryan Flournoy,WR,DAL,200
Ricky Pearsall,WR,SF,200.40
Greg Dulcich,TE,MIA,203.10
Ray Davis,RB,BUF,204.60
Jacoby Brissett,QB,ARI,204.60
Isaac TeSlaa,WR,DET,204.70
Nicholas Singleton,RB,TEN,207.30
Jaylin Noel,WR,HOU,207.80
MarShawn Lloyd,RB,GB,208.20
Pat Bryant,WR,DEN,208.30
Zachariah Branch,WR,ATL,208.30
Kimani Vidal,RB,LAC,208.40
Fernando Mendoza,QB,LVR,209.30
Aaron Rodgers,QB,PIT,214.10
Antonio Williams,WR,WAS,214.40
Cyrus Allen,WR,KC,216.30`;

/** Engine slug → consensus ADP (lower = earlier pick). */
export const ADP_2026: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const line of ADP_CSV.split('\n')) {
    const c = line.split(',');
    if (c.length < 4) continue;
    const slug = normName(c[0]).replace(/\s+/g, '-');
    const adp = parseFloat(c[3]);
    if (!slug || !Number.isFinite(adp)) continue;
    if (!m.has(slug)) m.set(slug, adp);
  }
  return m;
})();
