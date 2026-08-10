// GENERATED — 2026 consensus Average Draft Position, baked for the native-league
// draft pool. Source: Stathead MCP `get_adp` (season 2026, source 'consensus' —
// a freshness/confidence-weighted blend of FantasyPros expert-consensus rank +
// Sleeper draft ADP + FantasyFootballCalculator, PPR/1QB). Includes the 2026
// rookie class at market price (e.g. Jeremiyah Love RB, ADP 26.5).
//
// REFRESH (ADP moves all summer — rebake weekly through August): pull
//   get_adp { season: 2026, limit: 300, output_format: 'csv',
//             fields: 'player_name,position,team,adp' }
// via the Stathead MCP and replace ADP_CSV below (keep the as-of line current).
// Names are matched to engine slugs with normName, the same convention the
// worker's live-scoring player index uses, so ADP rows join the Sleeper
// directory (and baked 2025 PBP where it exists) automatically.
import { normName } from './players';

/** Blend freshness: FantasyPros 2026-07-03 · Sleeper 2026-07-07 · FFC 2026-07-07. */
export const ADP_AS_OF = '2026-07-07';

const ADP_CSV = `Bijan Robinson,RB,ATL,2
Ja'Marr Chase,WR,CIN,2.90
Jahmyr Gibbs,RB,DET,3
Puka Nacua,WR,LA,3.60
Jaxon Smith-Njigba,WR,SEA,5.10
Christian McCaffrey,RB,SF,6.70
Amon-Ra St. Brown,WR,DET,8
Jonathan Taylor,RB,IND,8.80
CeeDee Lamb,WR,DAL,9.90
Justin Jefferson,WR,MIN,10.30
Drake London,WR,ATL,12.70
Ashton Jeanty,RB,LVR,14.50
De'Von Achane,RB,MIA,14.50
James Cook III,RB,BUF,14.70
George Pickens,WR,DAL,19
Chase Brown,RB,CIN,19.50
A.J. Brown,WR,NE,19.80
Nico Collins,WR,HOU,19.90
Omarion Hampton,RB,LAC,21
Chris Olave,WR,NO,21.80
Trey McBride,TE,ARI,21.90
Saquon Barkley,RB,PHI,22.30
Kenneth Walker III,RB,KC,23.90
Jeremiyah Love,RB,ARI,26.50
Josh Allen,QB,BUF,27.10
Rashee Rice,WR,KC,27.40
Brock Bowers,TE,LVR,27.80
Derrick Henry,RB,BAL,28.70
Malik Nabers,WR,NYG,32.40
Tetairoa McMillan,WR,CAR,32.50
Garrett Wilson,WR,NYJ,32.80
Tee Higgins,WR,CIN,33.10
Josh Jacobs,RB,GB,34
DeVonta Smith,WR,PHI,35.60
Breece Hall,RB,NYJ,35.70
Zay Flowers,WR,BAL,37.40
Kyren Williams,RB,LA,38
Ladd McConkey,WR,LAC,39.50
Javonte Williams,RB,DAL,41.90
Lamar Jackson,QB,BAL,42.20
Jaylen Waddle,WR,DEN,42.60
Travis Etienne Jr.,RB,NO,42.70
Colston Loveland,TE,CHI,42.90
Luther Burden III,WR,CHI,44
Terry McLaurin,WR,WAS,44.40
Davante Adams,WR,LA,45.30
Bucky Irving,RB,TB,46.40
Emeka Egbuka,WR,TB,47.80
Joe Burrow,QB,CIN,48.70
Drake Maye,QB,NE,49.30
Cam Skattebo,RB,NYG,50.20
Jameson Williams,WR,DET,51.40
Mike Evans,WR,SF,54.30
Tyler Warren,TE,IND,55.80
TreVeyon Henderson,RB,NE,58.40
D'Andre Swift,RB,CHI,58.90
Quinshon Judkins,RB,CLE,59
DJ Moore,WR,BUF,59.80
Christian Watson,WR,GB,61.20
Rome Odunze,WR,CHI,62.50
Carnell Tate,WR,TEN,62.70
David Montgomery,RB,HOU,65.10
Bhayshul Tuten,RB,JAX,65.60
Jayden Daniels,QB,WAS,69.60
Harold Fannin Jr.,TE,CLE,69.90
Jaylen Warren,RB,PIT,70.50
DK Metcalf,WR,PIT,70.80
Jalen Hurts,QB,PHI,73.90
Tucker Kraft,TE,GB,74
Marvin Harrison Jr.,WR,ARI,74.30
Courtland Sutton,WR,DEN,74.40
Alec Pierce,WR,IND,76.30
Justin Herbert,QB,LAC,77.10
RJ Harvey,RB,DEN,79.20
Dak Prescott,QB,DAL,79.60
Rhamondre Stevenson,RB,NE,80.50
Jordyn Tyson,WR,NO,82.10
Kyle Pitts Sr.,TE,ATL,82.40
Michael Wilson,WR,ARI,83.10
Rico Dowdle,RB,PIT,83.50
Trevor Lawrence,QB,JAX,83.60
Tony Pollard,RB,TEN,84.10
Sam LaPorta,TE,DET,84.10
Chuba Hubbard,RB,CAR,85
Chris Godwin Jr.,WR,TB,85.70
Brian Thomas Jr.,WR,JAX,86.10
Caleb Williams,QB,CHI,88.90
Michael Pittman Jr.,WR,PIT,89.80
Parker Washington,WR,JAX,90.20
Jadarian Price,RB,SEA,92.30
Jakobi Meyers,WR,JAX,92.80
Jaxson Dart,QB,NYG,94.50
Patrick Mahomes II,QB,KC,94.60
Makai Lemon,WR,PHI,96.40
Wan'Dale Robinson,WR,TEN,96.60
Brock Purdy,QB,SF,97.10
Kyle Monangai,RB,CHI,98.40
Ricky Pearsall,WR,SF,102.50
J.K. Dobbins,RB,DEN,102.80
Travis Kelce,TE,KC,103.70
Jordan Addison,WR,MIN,105.30
Matthew Stafford,QB,LA,106.30
Kenny Gainwell,RB,TB,106.40
Aaron Jones Sr.,RB,MIN,107.20
Josh Downs,WR,IND,108.20
Dalton Kincaid,TE,BUF,108.20
Quentin Johnston,WR,LAC,108.60
George Kittle,TE,SF,109.90
Blake Corum,RB,LA,110.10
Jake Ferguson,TE,DAL,110.60
Bo Nix,QB,DEN,112.10
Jayden Reed,WR,GB,112.20
Jared Goff,QB,DET,113
Xavier Worthy,WR,KC,120.10
Dallas Goedert,TE,PHI,120.30
Romeo Doubs,WR,NE,121.30
Khalil Shakir,WR,BUF,121.50
Rachaad White,RB,WAS,122.80
Jordan Love,QB,GB,123.50
Jacory Croskey-Merritt,RB,WAS,125.20
Jayden Higgins,WR,HOU,125.80
Baker Mayfield,QB,TB,126.80
Mark Andrews,TE,BAL,127.30
Isaiah Likely,TE,NYG,127.80
KC Concepcion,WR,CLE,129.10
Oronde Gadsden II,TE,LAC,129.40
Tyler Allgeier,RB,ARI,131.90
Juwan Johnson,TE,NO,132.70
Malik Willis,QB,MIA,133.40
Jordan Mason,RB,MIN,134.40
Jalen Coker,WR,CAR,134.50
Kyler Murray,QB,MIN,135.40
Tyler Shough,QB,NO,137.20
Woody Marks,RB,HOU,138
Brenton Strange,TE,JAX,138.20
Matthew Golden,WR,GB,138.50
Hunter Henry,TE,NE,138.70
Tyrone Tracy Jr.,RB,NYG,140.10
Jauan Jennings,WR,MIN,140.10
Zach Charbonnet,RB,SEA,141.80
Jonathon Brooks,RB,CAR,147
Brian Robinson Jr.,RB,ATL,147
Dalton Schultz,TE,HOU,147
Stefon Diggs,WR,FA,148.80
C.J. Stroud,QB,HOU,149.90
Sam Darnold,QB,SEA,150.50
Tyjae Spears,RB,TEN,150.50
Alvin Kamara,RB,NO,151.40
Rashid Shaheed,WR,SEA,153.20
Dylan Sampson,RB,CLE,155.70
James Conner,RB,ARI,155.70
Denzel Boston,WR,CLE,157.90
Omar Cooper Jr.,WR,NYJ,158.30
Jerry Jeudy,WR,CLE,160.40
Chris Rodriguez Jr.,RB,JAX,161.20
Jonah Coleman,RB,DEN,161.70
Isiah Pacheco,RB,DET,162.70
Chig Okonkwo,TE,WAS,164.80
T.J. Hockenson,TE,MIN,165.40
Cam Ward,QB,TEN,167.10
Kenyon Sadiq,TE,NYJ,168.10
Emmett Johnson,RB,KC,169.20
Travis Hunter,WR,JAX,169.50
Deebo Samuel Sr.,WR,FA,171
Jalen McMillan,WR,TB,172.30
Braelon Allen,RB,NYJ,173.20
Daniel Jones,QB,IND,173.70
Bryce Young,QB,CAR,175.10
Keaton Mitchell,RB,LAC,175.20
Adonai Mitchell,WR,NYJ,175.40
AJ Barner,TE,SEA,177
Antonio Williams,WR,WAS,179.60
Kayshon Boutte,WR,NE,181.50
Tre' Harris,WR,LAC,182.70
Tank Bigsby,RB,PHI,182.80
Brandon Aiyuk,WR,SF,184.60
Troy Franklin,WR,DEN,185.20
Tre Tucker,WR,LVR,187
Kimani Vidal,RB,LAC,190.50
Tyreek Hill,WR,FA,192.10
Calvin Ridley,WR,TEN,192.70
Mike Washington Jr.,RB,LVR,193
Emanuel Wilson,RB,SEA,194.80
Pat Bryant,WR,DEN,196.80
David Njoku,TE,LAC,197.10
Gunnar Helm,TE,TEN,197.50
Sean Tucker,RB,TB,199.40
Jacoby Brissett,QB,ARI,201.10
Jalen Nailor,WR,LVR,201.80
Isaac TeSlaa,WR,DET,202.60
Chimere Dike,WR,TEN,203
Jaylin Noel,WR,HOU,203.90
Terrance Ferguson,TE,LA,204.60
Ray Davis,RB,BUF,205.20
Malik Washington,WR,MIA,205.20
Ryan Flournoy,WR,DAL,206.80
Kaytron Allen,RB,WAS,208.10
Trey Benson,RB,ARI,209.10
Cade Otton,TE,TB,209.30
Colby Parkinson,TE,LA,210.70`;

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
