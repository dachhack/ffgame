// GENERATED — StatHead 2026 season projections (PPR projected points per game),
// baked for the native-league draft room's rankings + player cards. Source:
// Stathead MCP `get_projections` (veterans: 60% 2025 actual + 40% 2yr avg +
// age curve; rookies: rookie career model with pick-based Y1 discount).
//
// REFRESH alongside adp2026.ts: pull
//   get_projections { limit: 300, output_format: 'csv', fields: 'player_name,position,ppg' }
// via the Stathead MCP and replace PROJ_CSV. Names join to engine slugs via
// normName — the same convention as ADP and the live-scoring player index.
import { normName } from './players';

/** Model snapshot: veterans 2026-04-12 · rookies 2026-05-08 · pulled 2026-07-07. */
export const PROJ_AS_OF = '2026-07-07';

const PROJ_CSV = `Josh Allen,QB,23.50
Puka Nacua,WR,21.40
Jahmyr Gibbs,RB,21.10
Bijan Robinson,RB,20.80
Ja'Marr Chase,WR,20.70
Christian McCaffrey,RB,20.70
Jalen Hurts,QB,20.20
Jonathan Taylor,RB,20
Lamar Jackson,QB,19.90
Patrick Mahomes,QB,19.80
Amon-Ra St. Brown,WR,19.70
De'Von Achane,RB,19.60
Rashee Rice,WR,19.30
Brock Purdy,QB,19
Baker Mayfield,QB,18.70
Joe Burrow,QB,18.30
Jared Goff,QB,18.30
Bo Nix,QB,18.20
Dak Prescott,QB,18.20
Jayden Daniels,QB,18.10
Justin Herbert,QB,18.10
Trevor Lawrence,QB,18
Drake Maye,QB,17.90
Daniel Jones,QB,17.90
Jaxon Smith-Njigba,WR,17.80
CeeDee Lamb,WR,17.70
James Cook,RB,17.40
Jaxson Dart,QB,17.30
Kyren Williams,RB,17.20
Caleb Williams,QB,17.20
Matthew Stafford,QB,17.20
Trey McBride,TE,17.10
Kyler Murray,QB,17
Nico Collins,WR,16.60
Cam Skattebo,RB,16.50
Saquon Barkley,RB,16.40
Jordan Love,QB,16.10
A.J. Brown,WR,16
Jeremiyah Love,RB,16
Malik Nabers,WR,15.90
Josh Jacobs,RB,15.90
Drake London,WR,15.90
Derrick Henry,RB,15.80
Davante Adams,WR,15.60
Justin Jefferson,WR,15.40
Chase Brown,RB,15.40
Tee Higgins,WR,15.40
Travis Etienne,RB,15.40
Omarion Hampton,RB,15.10
George Pickens,WR,15.10
Justin Fields,QB,15.10
Brock Bowers,TE,15
Chris Olave,WR,15
C.J. Stroud,QB,14.90
Garrett Wilson,WR,14.60
Breece Hall,RB,14.60
Bucky Irving,RB,14.50
Ashton Jeanty,RB,14.40
Tyreek Hill,WR,14.40
George Kittle,TE,14.40
Tyler Shough,QB,14.40
Sam Darnold,QB,14.30
D'Andre Swift,RB,14.10
Tua Tagovailoa,QB,13.90
Courtland Sutton,WR,13.80
DeVonta Smith,WR,13.60
Zay Flowers,WR,13.60
Javonte Williams,RB,13.60
DK Metcalf,WR,13.30
Stefon Diggs,WR,13.30
Terry McLaurin,WR,13.10
Bryce Young,QB,13.10
Geno Smith,QB,13.10
J.K. Dobbins,RB,12.90
Ladd McConkey,WR,12.80
RJ Harvey,RB,12.70
Mike Evans,WR,12.60
DJ Moore,WR,12.60
Tetairoa McMillan,WR,12.60
Rico Dowdle,RB,12.60
J.J. McCarthy,QB,12.50
Aaron Rodgers,QB,12.50
Kyle Pitts,TE,12.40
Tucker Kraft,TE,12.40
Michael Pittman,WR,12.40
Rhamondre Stevenson,RB,12.40
Jameson Williams,WR,12.30
Jaylen Waddle,WR,12.30
Deebo Samuel,WR,12.30
Jakobi Meyers,WR,12.30
Wan'Dale Robinson,WR,12.20
Alvin Kamara,RB,12.10
James Conner,RB,12.10
TreVeyon Henderson,RB,12.10
Quinshon Judkins,RB,12.10
Jauan Jennings,WR,12.10
Christian Watson,WR,12
Sam LaPorta,TE,11.90
Jaylen Warren,RB,11.90
Kenneth Walker,RB,11.80
David Montgomery,RB,11.80
Keenan Allen,WR,11.70
Quentin Johnston,WR,11.70
Harold Fannin,TE,11.70
Michael Penix,QB,11.60
Michael Wilson,WR,11.60
Emeka Egbuka,WR,11.50
Carnell Tate,WR,11.50
Dallas Goedert,TE,11.40
Tony Pollard,RB,11.30
Jordan Addison,WR,11.30
Chuba Hubbard,RB,11.20
Tyrone Tracy,RB,11.20
Jayden Reed,WR,11.20
Rachaad White,RB,11.20
Alec Pierce,WR,11.20
Fernando Mendoza,QB,11.20
Tyler Warren,TE,11.10
Zach Charbonnet,RB,11
Cam Ward,QB,11
Khalil Shakir,WR,10.90
Phil Mafah,RB,10.90
Romeo Doubs,WR,10.80
Marvin Harrison,WR,10.70
Rome Odunze,WR,10.70
Rashid Shaheed,WR,10.70
Travis Kelce,TE,10.60
Jake Ferguson,TE,10.60
Shedeur Sanders,QB,10.60
Juwan Johnson,TE,10.60
David Njoku,TE,10.50
Hunter Henry,TE,10.50
Jadarian Price,RB,10.50
Spencer Rattler,QB,10.40
Jordyn Tyson,WR,10.40
Colston Loveland,TE,10.30
Dalton Kincaid,TE,10.10
Dalton Schultz,TE,10
Brian Thomas,WR,9.90
Josh Downs,WR,9.90
Parker Washington,WR,9.80
Jerry Jeudy,WR,9.70
Chris Godwin,WR,9.70
Ricky Pearsall,WR,9.60
Woody Marks,RB,9.60
Cooper Kupp,WR,9.50
Joe Flacco,QB,9.50
Xavier Worthy,WR,9.40
Mark Andrews,TE,9.40
Tyjae Spears,RB,9.40
T.J. Hockenson,TE,9.30
Darren Waller,TE,9.30
Travis Hunter,WR,9.10
Kyle Monangai,RB,9.10
Aaron Jones,RB,9
Calvin Ridley,WR,9
Cade Otton,TE,9
Makai Lemon,WR,9
Isiah Pacheco,RB,8.80
Jacory Croskey-Merritt,RB,8.80
Oronde Gadsden,TE,8.80
Kenyon Sadiq,TE,8.80
Jordan Mason,RB,8.70
Austin Ekeler,RB,8.70
Jalen McMillan,WR,8.70
AJ Barner,TE,8.70
Pat Freiermuth,TE,8.60
Keon Coleman,WR,8.50
Luther Burden,WR,8.50
Zach Ertz,TE,8.50
Tre Tucker,WR,8.40
KC Concepcion,WR,8.40
Quinn Ewers,QB,8.30
Jalen Coker,WR,8.20
Tory Horton,WR,8.10
Omar Cooper Jr.,WR,8.10
Evan Engram,TE,8
Brenton Strange,TE,8
Isaac Guerendo,RB,7.90
Troy Franklin,WR,7.90
Theo Johnson,TE,7.80
Tanner McKee,QB,7.80
Darnell Mooney,WR,7.70
Christian Kirk,WR,7.70
Kareem Hunt,RB,7.70
Russell Wilson,QB,7.70
Bam Knight,RB,7.70
Chris Rodriguez Jr.,RB,7.70
Devaughn Vele,WR,7.70
Jayden Higgins,WR,7.60
Tyler Allgeier,RB,7.60
Darius Slayton,WR,7.60
Kayshon Boutte,WR,7.60
Chimere Dike,WR,7.50
Trey Benson,RB,7.40
Cole Kmet,TE,7.40
Jawhar Jordan,RB,7.40
Chig Okonkwo,TE,7.30
Elic Ayomanor,WR,7.30
Adam Thielen,WR,7.20
Aidan O'Connell,QB,7.20
Najee Harris,RB,7.10
DeMario Douglas,WR,7.10
Calvin Austin,WR,7.10
Marvin Mims,WR,7
Taysom Hill,TE,7
Dillon Gabriel,QB,7
Xavier Legette,WR,6.90
Kimani Vidal,RB,6.90
Jerome Ford,RB,6.80
Isaiah Likely,TE,6.80
Mason Taylor,TE,6.80
Devin Neal,RB,6.70
Andrei Iosivas,WR,6.70
Nick Chubb,RB,6.60
Rashod Bateman,WR,6.60
Devin Singletary,RB,6.60
Justice Hill,RB,6.50
Tyler Higbee,TE,6.50
Cedric Tillman,WR,6.40
Mike Gesicki,TE,6.40
Miles Sanders,RB,6.40
Dontayvion Wicks,WR,6.30
Noah Fant,TE,6.30
Riley Leonard,QB,6.20
Tez Johnson,WR,6.20
Malik Washington,WR,6
Bhayshul Tuten,RB,5.90
Dylan Sampson,RB,5.80
Blake Corum,RB,5.80
Pat Bryant,WR,5.80
Jalen Tolbert,WR,5.80
Denzel Boston,WR,5.80
Ray Davis,RB,5.70
DeAndre Hopkins,WR,5.70
Gunnar Helm,TE,5.70
Ryan Flournoy,WR,5.60
Raheem Mostert,RB,5.50
Kendre Miller,RB,5.50
Antonio Gibson,RB,5.50
Isaac TeSlaa,WR,5.40
Brandin Cooks,WR,5.40
Tyler Lockett,WR,5.30
Tank Bigsby,RB,5.20
Michael Mayer,TE,5.10
Matthew Golden,WR,5
Jonnu Smith,TE,5
Dyami Brown,WR,5
Jordan Whittington,WR,5
Jaleel McLaughlin,RB,4.80
Ty Simpson,QB,4.80
Germie Bernard,WR,4.80
Ja'Tavion Sanders,TE,4.70
Terrance Ferguson,TE,4.70
Devontez Walker,WR,4.70
Isaiah Davis,RB,4.70
Adonai Mitchell,WR,4.60
Luke McCaffrey,WR,4.60
Darnell Washington,TE,4.50
De'Zhaun Stribling,WR,4.50
Tutu Atwell,WR,4.40
Xavier Hutchinson,WR,4.40
Braelon Allen,RB,4.30
Tre' Harris,WR,4.30
Keaton Mitchell,RB,4.30
Roman Wilson,WR,4.30
Brian Robinson,RB,4.20
Jaydon Blue,RB,4.10
Jaylen Wright,RB,4.10
Jackson Hawes,TE,4.10
Jaylin Noel,WR,4
Ronnie Bell,WR,4
Davis Allen,TE,3.90
Devin Culp,TE,3.90
Antonio Williams,WR,3.90
Brashard Smith,RB,3.70
Eli Stowers,TE,3.70
Xavier Restrepo,WR,3.60
Marquez Valdes-Scantling,WR,3.60
Luke Musgrave,TE,3.60
Kyle Williams,WR,3.50
Jaylin Lane,WR,3.40
Mitchell Evans,TE,3.40
Chris Bell,WR,3.40
Roschon Johnson,RB,3.30
Noah Gray,TE,3.30
Ben Sinnott,TE,3.30
Max Klare,TE,3.30
Chris Brazzell II,WR,3.30
Ollie Gordon,RB,3.20
Zachariah Branch,WR,3.10
Jack Bech,WR,3
Luke Schoonmaker,TE,3
Josh Whyle,TE,3
Cade Stover,TE,3
Moliki Matavao,TE,3
Marlin Klein,TE,3
Caleb Douglas,WR,3
Tyler Conklin,TE,2.90
Jimmy Horn Jr.,WR,2.90`;

/** Engine slug → 2026 projected PPR points per game. */
export const PROJ_2026: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const line of PROJ_CSV.split('\n')) {
    const c = line.split(',');
    if (c.length < 3) continue;
    const slug = normName(c[0]).replace(/\s+/g, '-');
    const ppg = parseFloat(c[2]);
    if (!slug || !Number.isFinite(ppg)) continue;
    if (!m.has(slug)) m.set(slug, ppg);
  }
  return m;
})();
