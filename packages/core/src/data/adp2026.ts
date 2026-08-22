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

/** Blend freshness: FantasyPros 2026-08-21 · Sleeper 2026-08-22 · FFC 2026-08-21. */
export const ADP_AS_OF = '2026-08-22';

const ADP_CSV = `Jahmyr Gibbs,RB,DET,2
Bijan Robinson,RB,ATL,2.70
Ja'Marr Chase,WR,CIN,3
Puka Nacua,WR,LA,3.60
Jaxon Smith-Njigba,WR,SEA,5.40
Amon-Ra St. Brown,WR,DET,6.60
Christian McCaffrey,RB,SF,7.60
Jonathan Taylor,RB,IND,9
CeeDee Lamb,WR,DAL,9.60
Justin Jefferson,WR,MIN,10.60
Drake London,WR,ATL,12.40
James Cook III,RB,BUF,13.90
De'Von Achane,RB,MIA,15.10
Ashton Jeanty,RB,LVR,15.30
Chase Brown,RB,CIN,16.10
A.J. Brown,WR,NE,16.60
Saquon Barkley,RB,PHI,20.30
George Pickens,WR,DAL,20.70
Nico Collins,WR,HOU,20.90
Rashee Rice,WR,KC,20.90
Omarion Hampton,RB,LAC,21.90
Chris Olave,WR,NO,22.60
Trey McBride,TE,ARI,23.60
Kenneth Walker III,RB,KC,23.80
Brock Bowers,TE,LVR,25.60
Derrick Henry,RB,BAL,25.90
Malik Nabers,WR,NYG,26.60
Josh Allen,QB,BUF,28.30
DeVonta Smith,WR,PHI,29.50
Zay Flowers,WR,BAL,31
Jeremiyah Love,RB,ARI,32.40
Garrett Wilson,WR,NYJ,32.80
Tetairoa McMillan,WR,CAR,34
Kyren Williams,RB,LA,34.90
Tee Higgins,WR,CIN,35.70
Breece Hall,RB,NYJ,36
Josh Jacobs,RB,GB,36.40
Ladd McConkey,WR,LAC,37.30
Emeka Egbuka,WR,TB,38.90
Javonte Williams,RB,DAL,39.60
Lamar Jackson,QB,BAL,42.10
Jaylen Waddle,WR,DEN,42.90
Travis Etienne Jr.,RB,NO,45.10
Cam Skattebo,RB,NYG,45.20
Colston Loveland,TE,CHI,45.80
Drake Maye,QB,NE,45.80
Davante Adams,WR,LA,46.70
Terry McLaurin,WR,WAS,48.80
Bucky Irving,RB,TB,48.90
Jameson Williams,WR,DET,51.60
Joe Burrow,QB,CIN,52.50
D'Andre Swift,RB,CHI,52.60
Luther Burden III,WR,CHI,52.90
DJ Moore,WR,BUF,53.10
Mike Evans,WR,SF,55.20
Quinshon Judkins,RB,CLE,55.70
Tyler Warren,TE,IND,56
Rome Odunze,WR,CHI,56.90
David Montgomery,RB,HOU,57.50
TreVeyon Henderson,RB,NE,60.80
Christian Watson,WR,GB,61
Bhayshul Tuten,RB,JAX,61
Jayden Daniels,QB,WAS,63.40
Jalen Hurts,QB,PHI,67.70
Parker Washington,WR,JAX,68.70
Carnell Tate,WR,TEN,68.90
Marvin Harrison Jr.,WR,ARI,69.60
Jaylen Warren,RB,PIT,69.60
DK Metcalf,WR,PIT,72.90
Brian Thomas Jr.,WR,JAX,73.50
Harold Fannin Jr.,TE,CLE,74.30
Courtland Sutton,WR,DEN,74.30
Dak Prescott,QB,DAL,74.90
Kyle Pitts Sr.,TE,ATL,75.20
Jadarian Price,RB,SEA,75.60
Caleb Williams,QB,CHI,76.20
Rhamondre Stevenson,RB,NE,78
Tony Pollard,RB,TEN,78.80
Sam LaPorta,TE,DET,79.70
Michael Wilson,WR,ARI,82.30
Rico Dowdle,RB,PIT,83.40
Chuba Hubbard,RB,CAR,83.70
Chris Godwin Jr.,WR,TB,83.80
Tucker Kraft,TE,GB,83.90
Alec Pierce,WR,IND,83.90
Michael Pittman Jr.,WR,PIT,84.50
RJ Harvey,RB,DEN,86
Justin Herbert,QB,LAC,87.10
Trevor Lawrence,QB,JAX,88.30
Josh Downs,WR,IND,90.70
Wan'Dale Robinson,WR,TEN,92.50
Matthew Stafford,QB,LA,93.10
J.K. Dobbins,RB,DEN,96.90
Jakobi Meyers,WR,JAX,97.90
Kenny Gainwell,RB,TB,99.60
Quentin Johnston,WR,LAC,99.70
Brock Purdy,QB,SF,100.10
Stefon Diggs,WR,WAS,101.10
Travis Kelce,TE,KC,101.40
Jaxson Dart,QB,NYG,101.50
Patrick Mahomes II,QB,KC,102.50
Jordan Addison,WR,MIN,102.90
Jayden Reed,WR,GB,104.10
Makai Lemon,WR,PHI,104.20
George Kittle,TE,SF,104.60
Jonathon Brooks,RB,CAR,105.10
Jordyn Tyson,WR,NO,106
Kyle Monangai,RB,CHI,108
Bo Nix,QB,DEN,111.10
Aaron Jones Sr.,RB,MIN,111.30
Jared Goff,QB,DET,111.60
Blake Corum,RB,LA,112.40
Rachaad White,RB,WAS,113.20
Jacory Croskey-Merritt,RB,WAS,116.10
Dallas Goedert,TE,PHI,117
Jake Ferguson,TE,DAL,117.80
Khalil Shakir,WR,BUF,118.10
Jordan Mason,RB,MIN,119.60
Dalton Kincaid,TE,BUF,121.40
Matthew Golden,WR,GB,121.80
KC Concepcion,WR,CLE,122.80
Xavier Worthy,WR,KC,123.20
Isaiah Likely,TE,NYG,124.40
Romeo Doubs,WR,NE,124.60
Jalen Coker,WR,CAR,128
Baker Mayfield,QB,TB,128.30
Deebo Samuel Sr.,WR,SF,129.50
Mark Andrews,TE,BAL,130
Kyler Murray,QB,MIN,132.60
Jordan Love,QB,GB,136.20
Jayden Higgins,WR,HOU,137.10
Tyler Shough,QB,NO,139.90
Zach Charbonnet,RB,SEA,142
Rashid Shaheed,WR,SEA,144.50
Tyjae Spears,RB,TEN,144.90
Chris Rodriguez Jr.,RB,JAX,147.20
Tyler Allgeier,RB,ARI,147.30
Woody Marks,RB,HOU,148.90
De'Zhaun Stribling,WR,SF,149.10
Tyrone Tracy Jr.,RB,NYG,149.30
Denzel Boston,WR,CLE,150.90
Juwan Johnson,TE,NO,151.30
Sam Darnold,QB,SEA,151.40
Alvin Kamara,RB,NO,151.80
Hunter Henry,TE,NE,153.60
Oronde Gadsden II,TE,LAC,157.90
Jerry Jeudy,WR,CLE,158.30
Brenton Strange,TE,JAX,158.50
Malik Willis,QB,MIA,159.50
Jonah Coleman,RB,DEN,160.50
Chig Okonkwo,TE,WAS,162.10
Dylan Sampson,RB,CLE,162.40
Brian Robinson Jr.,RB,ATL,163.40
Keaton Mitchell,RB,LAC,164
Jalen McMillan,WR,TB,164.80
Jauan Jennings,WR,MIN,165.10
Isiah Pacheco,RB,DET,165.60
C.J. Stroud,QB,HOU,165.90
Tre Tucker,WR,LVR,167.10
Travis Hunter,WR,JAX,168.10
Tank Bigsby,RB,PHI,169.50
Daniel Jones,QB,IND,169.60
Jalen Nailor,WR,LVR,174.70
Omar Cooper Jr.,WR,NYJ,175.10
Dalton Schultz,TE,HOU,176.10
T.J. Hockenson,TE,MIN,176.20
Cam Ward,QB,TEN,176.70
Malik Washington,WR,MIA,177.80
Braelon Allen,RB,NYJ,178
Tank Dell,WR,HOU,180.20
Kenyon Sadiq,TE,NYJ,182.50
Adonai Mitchell,WR,NYJ,184.50
Mike Washington Jr.,RB,LVR,185.50
Keenan Allen,WR,IND,187.90
Tre' Harris,WR,LAC,188.30
Dontayvion Wicks,WR,PHI,189.10
Bryce Young,QB,CAR,189.90
MarShawn Lloyd,RB,GB,190
AJ Barner,TE,SEA,193.20
Emmett Johnson,RB,KC,194.10
Ryan Flournoy,WR,DAL,195.10
Ja'Kobi Lane,WR,BAL,195.60
Calvin Ridley,WR,TEN,196
Rashod Bateman,WR,BAL,196.70
James Conner,RB,ARI,197
Cyrus Allen,WR,KC,197.10
Kayshon Boutte,WR,NE,198.40
Cooper Kupp,WR,SEA,198.50
Nicholas Singleton,RB,TEN,201.80
Jacoby Brissett,QB,ARI,202.60
Jaylin Noel,WR,HOU,203.50
Ray Davis,RB,BUF,203.80
Pat Bryant,WR,DEN,204.10
Greg Dulcich,TE,MIA,205.60
Isaac TeSlaa,WR,DET,205.70
Zachariah Branch,WR,ATL,210
Caleb Douglas,WR,MIA,210
Aaron Rodgers,QB,PIT,210.30
Germie Bernard,WR,PIT,212.30
Fernando Mendoza,QB,LVR,212.50`;

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
