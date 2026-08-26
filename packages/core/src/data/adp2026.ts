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

/** Blend freshness: FantasyPros 2026-08-21 · Sleeper 2026-08-26 · FFC 2026-08-25. */
export const ADP_AS_OF = '2026-08-26';

const ADP_CSV = `Jahmyr Gibbs,RB,DET,2
Bijan Robinson,RB,ATL,2.80
Ja'Marr Chase,WR,CIN,2.90
Puka Nacua,WR,LA,3.50
Jaxon Smith-Njigba,WR,SEA,5.40
Amon-Ra St. Brown,WR,DET,6.70
Christian McCaffrey,RB,SF,7.60
Jonathan Taylor,RB,IND,9.20
CeeDee Lamb,WR,DAL,9.60
Justin Jefferson,WR,MIN,10.80
Drake London,WR,ATL,12.80
James Cook III,RB,BUF,13.80
De'Von Achane,RB,MIA,15.10
Ashton Jeanty,RB,LVR,15.30
Chase Brown,RB,CIN,15.70
A.J. Brown,WR,NE,16.90
Saquon Barkley,RB,PHI,19.90
Nico Collins,WR,HOU,20.70
Rashee Rice,WR,KC,20.90
George Pickens,WR,DAL,21.60
Omarion Hampton,RB,LAC,22
Chris Olave,WR,NO,22.40
Kenneth Walker III,RB,KC,23.50
Trey McBride,TE,ARI,23.80
Derrick Henry,RB,BAL,25.60
Brock Bowers,TE,LVR,25.90
Malik Nabers,WR,NYG,26.40
Josh Allen,QB,BUF,28.10
DeVonta Smith,WR,PHI,29.60
Zay Flowers,WR,BAL,31.70
Jeremiyah Love,RB,ARI,31.80
Garrett Wilson,WR,NYJ,32.60
Tetairoa McMillan,WR,CAR,34.40
Kyren Williams,RB,LA,34.70
Josh Jacobs,RB,GB,35.90
Tee Higgins,WR,CIN,36
Breece Hall,RB,NYJ,36.50
Ladd McConkey,WR,LAC,37.30
Emeka Egbuka,WR,TB,37.90
Javonte Williams,RB,DAL,39
Lamar Jackson,QB,BAL,42.10
Jaylen Waddle,WR,DEN,42.70
Travis Etienne Jr.,RB,NO,44.30
Cam Skattebo,RB,NYG,45.60
Colston Loveland,TE,CHI,45.90
Drake Maye,QB,NE,46.10
Davante Adams,WR,LA,47.20
Terry McLaurin,WR,WAS,48.80
Bucky Irving,RB,TB,48.80
Jameson Williams,WR,DET,52
Joe Burrow,QB,CIN,52.30
DJ Moore,WR,BUF,52.40
D'Andre Swift,RB,CHI,52.40
Luther Burden III,WR,CHI,52.90
Quinshon Judkins,RB,CLE,55.50
Mike Evans,WR,SF,56.10
David Montgomery,RB,HOU,56.50
Tyler Warren,TE,IND,56.80
Rome Odunze,WR,CHI,57.90
Bhayshul Tuten,RB,JAX,60.70
Christian Watson,WR,GB,61.30
TreVeyon Henderson,RB,NE,61.30
Jayden Daniels,QB,WAS,63.80
Jalen Hurts,QB,PHI,66.70
Parker Washington,WR,JAX,68.50
Jaylen Warren,RB,PIT,68.60
Marvin Harrison Jr.,WR,ARI,69.50
Carnell Tate,WR,TEN,70.60
DK Metcalf,WR,PIT,72.60
Jadarian Price,RB,SEA,73.30
Brian Thomas Jr.,WR,JAX,73.50
Courtland Sutton,WR,DEN,73.60
Dak Prescott,QB,DAL,73.80
Harold Fannin Jr.,TE,CLE,74.70
Kyle Pitts Sr.,TE,ATL,75.10
Rhamondre Stevenson,RB,NE,75.40
Caleb Williams,QB,CHI,76.90
Tony Pollard,RB,TEN,78.20
Tucker Kraft,TE,GB,81.90
Rico Dowdle,RB,PIT,81.90
Michael Wilson,WR,ARI,82.10
Chris Godwin Jr.,WR,TB,83.50
Michael Pittman Jr.,WR,PIT,84.80
Chuba Hubbard,RB,CAR,84.80
Sam LaPorta,TE,DET,85.60
Justin Herbert,QB,LAC,87.30
Alec Pierce,WR,IND,87.50
RJ Harvey,RB,DEN,87.70
Trevor Lawrence,QB,JAX,89
Matthew Stafford,QB,LA,91.60
Josh Downs,WR,IND,91.70
Wan'Dale Robinson,WR,TEN,94.40
J.K. Dobbins,RB,DEN,95.10
Jakobi Meyers,WR,JAX,99
Brock Purdy,QB,SF,100.10
Travis Kelce,TE,KC,100.10
Kenny Gainwell,RB,TB,100.20
Jonathon Brooks,RB,CAR,100.40
Stefon Diggs,WR,WAS,100.40
Quentin Johnston,WR,LAC,101.50
Jordan Addison,WR,MIN,102.50
Jaxson Dart,QB,NYG,103
Patrick Mahomes II,QB,KC,103
George Kittle,TE,SF,104.10
Jayden Reed,WR,GB,104.50
Makai Lemon,WR,PHI,104.80
Kyle Monangai,RB,CHI,107.20
Bo Nix,QB,DEN,110.50
Jared Goff,QB,DET,111.40
Aaron Jones Sr.,RB,MIN,112.20
Blake Corum,RB,LA,112.60
Dallas Goedert,TE,PHI,113.90
Rachaad White,RB,WAS,115.60
Jacory Croskey-Merritt,RB,WAS,115.90
Jake Ferguson,TE,DAL,116.60
Jordan Mason,RB,MIN,117.90
Khalil Shakir,WR,BUF,118.60
Jordyn Tyson,WR,NO,119.90
Dalton Kincaid,TE,BUF,120.40
Matthew Golden,WR,GB,120.40
KC Concepcion,WR,CLE,121.70
Xavier Worthy,WR,KC,122.60
Isaiah Likely,TE,NYG,123
Romeo Doubs,WR,NE,125.20
Deebo Samuel Sr.,WR,SF,127.90
Jalen Coker,WR,CAR,128.60
Baker Mayfield,QB,TB,128.80
Mark Andrews,TE,BAL,129.30
Kyler Murray,QB,MIN,133.30
Jordan Love,QB,GB,137.70
Rashid Shaheed,WR,SEA,141.10
Zach Charbonnet,RB,SEA,142
Tyler Shough,QB,NO,143.50
Tyjae Spears,RB,TEN,144.40
De'Zhaun Stribling,WR,SF,146
Woody Marks,RB,HOU,146.50
Tyler Allgeier,RB,ARI,146.70
Chris Rodriguez Jr.,RB,JAX,147.10
Denzel Boston,WR,CLE,150.80
Sam Darnold,QB,SEA,151.60
Hunter Henry,TE,NE,152.30
Tyrone Tracy Jr.,RB,NYG,152.50
Juwan Johnson,TE,NO,152.90
Alvin Kamara,RB,NO,152.90
Jayden Higgins,WR,HOU,156.20
Jerry Jeudy,WR,CLE,157.70
Brenton Strange,TE,JAX,158.50
Jonah Coleman,RB,DEN,159.20
Oronde Gadsden II,TE,LAC,160.50
Malik Willis,QB,MIA,161.10
Keaton Mitchell,RB,LAC,161.80
Dylan Sampson,RB,CLE,162.70
Isiah Pacheco,RB,DET,164.80
Brian Robinson Jr.,RB,ATL,165.20
Tre Tucker,WR,LVR,165.70
C.J. Stroud,QB,HOU,165.80
Jauan Jennings,WR,MIN,165.90
Chig Okonkwo,TE,WAS,167.20
Tank Bigsby,RB,PHI,168
Jalen McMillan,WR,TB,168.20
Daniel Jones,QB,IND,170.40
Travis Hunter,WR,JAX,171.70
Mike Washington Jr.,RB,LVR,173.50
Jalen Nailor,WR,LVR,174.50
Dalton Schultz,TE,HOU,174.90
T.J. Hockenson,TE,MIN,175.10
Cam Ward,QB,TEN,177.40
Malik Washington,WR,MIA,177.40
Braelon Allen,RB,NYJ,178.10
Tank Dell,WR,HOU,178.10
Keenan Allen,WR,IND,178.40
Kenyon Sadiq,TE,NYJ,182.20
Omar Cooper Jr.,WR,NYJ,182.50
MarShawn Lloyd,RB,GB,183.20
Cyrus Allen,WR,KC,183.40
Adonai Mitchell,WR,NYJ,185.30
Bryce Young,QB,CAR,187
Dontayvion Wicks,WR,PHI,187.20
Ja'Kobi Lane,WR,BAL,188.30
AJ Barner,TE,SEA,192.20
Ryan Flournoy,WR,DAL,193.10
Emmett Johnson,RB,KC,193.40
Jaylin Noel,WR,HOU,193.70
Calvin Ridley,WR,TEN,195.60
Tre' Harris,WR,LAC,196.10
Kayshon Boutte,WR,NE,196.60
Cooper Kupp,WR,SEA,197.10
James Conner,RB,ARI,200
Rashod Bateman,WR,BAL,200.70
Pat Bryant,WR,DEN,202.60
Terrance Ferguson,TE,LA,203.40
Caleb Douglas,WR,MIA,203.60
Ray Davis,RB,BUF,203.70
Jacoby Brissett,QB,ARI,204.80
Kaelon Black,RB,SF,205.70
Isaac TeSlaa,WR,DET,207.70
Greg Dulcich,TE,MIA,207.80
Nicholas Singleton,RB,TEN,209.30
Zachariah Branch,WR,ATL,210.60
Fernando Mendoza,QB,LVR,211.40
Aaron Rodgers,QB,PIT,212.50
Kimani Vidal,RB,LAC,213.20
Germie Bernard,WR,PIT,214
Jaydon Blue,RB,DAL,215.70
Troy Franklin,WR,DEN,216.20
Sean Tucker,RB,TB,217.70
Justice Hill,RB,BAL,218.60
Gunnar Helm,TE,TEN,224.30
Malachi Fields,WR,NYG,224.70
David Njoku,TE,LAC,226.60
Keon Coleman,WR,BUF,227.30
Antonio Williams,WR,WAS,227.50
Darnell Mooney,WR,NYG,231.10
Emanuel Wilson,RB,SEA,233.50
Kaytron Allen,RB,WAS,233.60
Chimere Dike,WR,TEN,233.90
Pat Freiermuth,TE,PIT,235.20
Geno Smith,QB,NYJ,236.70
Devaughn Vele,WR,NO,237.20
Jack Bech,WR,LVR,238.10
Jaylen Wright,RB,MIA,238.70`;

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
