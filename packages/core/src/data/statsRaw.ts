// Real 2025 NFL season totals pulled from the Stathead MCP (nflverse source).
// Stored verbatim as CSV and parsed at load — these numbers seed every
// simulated game in the demo, so the box-score "feel" is grounded in reality.

export const QB_CSV = `player_display_name,position,recent_team,games,passing_yards,passing_tds,interceptions,carries,rushing_yards,rushing_tds,fantasy_points_ppr
Josh Allen,QB,BUF,16,3668,25,10,112,579,14,364.62
Drake Maye,QB,NE,17,4394,31,8,103,450,4,351.96
Matthew Stafford,QB,LA,17,4707,46,8,29,1,0,350.38
Trevor Lawrence,QB,JAX,17,4007,29,12,82,359,9,338.18
Caleb Williams,QB,CHI,17,3942,27,7,77,383,3,318.18
Dak Prescott,QB,DAL,17,4552,30,10,53,177,2,313.78
Bo Nix,QB,DEN,17,3931,25,11,83,356,5,304.84
Jalen Hurts,QB,PHI,16,3224,25,6,105,421,8,301.06
Jared Goff,QB,DET,17,4564,34,8,19,45,0,297.06
Justin Herbert,QB,LAC,16,3727,26,13,83,498,2,286.88
Patrick Mahomes,QB,KC,14,3587,22,11,64,422,5,285.68
Baker Mayfield,QB,TB,17,3693,26,11,55,382,1,271.92
Jaxson Dart,QB,NYG,14,2272,15,5,86,487,9,241.58
Sam Darnold,QB,SEA,17,4048,25,14,35,95,0,235.42
Jordan Love,QB,GB,15,3381,23,6,47,199,0,235.14
Jacoby Brissett,QB,ARI,14,3366,23,8,38,168,1,227.44
Aaron Rodgers,QB,PIT,16,3322,24,7,21,61,1,227.08
Daniel Jones,QB,IND,13,3101,19,8,45,164,5,226.44
Bryce Young,QB,CAR,16,3011,23,11,54,216,2,218.04
Lamar Jackson,QB,BAL,13,2549,21,7,67,349,2,214.86
C.J. Stroud,QB,HOU,14,3041,19,8,48,209,1,208.54
Cam Ward,QB,TEN,17,3169,15,7,39,159,2,186.66
Brock Purdy,QB,SF,9,2167,20,10,33,147,3,177.38
Geno Smith,QB,LV,15,3025,19,17,41,109,0,173.90
Tua Tagovailoa,QB,MIA,14,2660,20,15,20,43,0,160.70
Tyler Shough,QB,NO,11,2384,10,6,45,186,3,157.96
Joe Flacco,QB,CIN,13,2479,15,10,21,35,1,146.66
Justin Fields,QB,NYJ,9,1259,7,1,71,383,4,142.66
Joe Burrow,QB,CIN,8,1809,17,5,14,41,0,134.46
Mac Jones,QB,SF,11,2151,13,6,36,60,0,130.04
Marcus Mariota,QB,WAS,10,1695,10,7,50,297,1,125.50
J.J. McCarthy,QB,MIN,10,1632,11,12,37,181,4,125.38
Michael Penix Jr.,QB,ATL,9,1982,9,3,21,70,1,120.28
Jayden Daniels,QB,WAS,7,1262,8,3,58,278,2,114.28
Kirk Cousins,QB,ATL,10,1721,10,5,14,7,1,103.54
Spencer Rattler,QB,NO,9,1586,8,5,31,167,0,99.14
Shedeur Sanders,QB,CLE,8,1400,7,10,21,169,1,84.90
Kyler Murray,QB,ARI,5,962,6,3,29,173,1,77.78
Carson Wentz,QB,MIN,5,1216,6,5,11,57,0,70.34
Dillon Gabriel,QB,CLE,10,937,7,2,14,86,0,70.08
Davis Mills,QB,HOU,6,915,5,1,13,60,1,68.60
Tyrod Taylor,QB,NYJ,6,779,5,5,27,143,1,59.46
Malik Willis,QB,GB,4,422,3,0,22,123,2,51.18
Russell Wilson,QB,NYG,6,831,3,3,18,106,0,49.84
Jake Browning,QB,CIN,5,771,6,8,9,39,1,48.74
Jameis Winston,QB,NYG,3,567,2,2,7,23,1,43.28
Tyler Huntley,QB,BAL,5,426,2,0,24,151,0,40.14
Quinn Ewers,QB,MIA,4,622,3,3,8,19,0,33.18
Philip Rivers,QB,IND,3,544,4,3,2,-1,0,31.66
Mitchell Trubisky,QB,BUF,4,313,4,0,9,6,0,31.12
Riley Leonard,QB,IND,5,415,2,3,6,27,2,31
Brady Cook,QB,NYJ,5,739,2,7,13,49,0,28.46
Josh Johnson,QB,WAS,3,372,1,2,12,55,1,24.38
Mason Rudolph,QB,PIT,5,310,2,2,7,6,0,15
Tanner McKee,QB,PHI,4,274,1,1,8,8,0,13.76
Trey Lance,QB,LAC,4,226,0,1,17,85,0,13.54
Joe Milton III,QB,DAL,4,183,1,2,5,50,0,10.32`;

export const RB_CSV = `player_display_name,position,recent_team,games,carries,rushing_yards,rushing_tds,targets,receptions,receiving_yards,receiving_tds,fantasy_points_ppr
Christian McCaffrey,RB,SF,17,311,1202,10,129,102,924,7,416.60
Bijan Robinson,RB,ATL,17,287,1478,7,103,79,820,4,370.80
Jahmyr Gibbs,RB,DET,17,243,1223,13,94,77,616,5,366.90
Jonathan Taylor,RB,IND,17,323,1585,18,55,46,378,2,362.30
De'Von Achane,RB,MIA,16,238,1350,8,85,67,488,4,322.80
James Cook,RB,BUF,17,309,1621,12,40,33,291,2,302.20
Chase Brown,RB,CIN,17,232,1019,6,88,69,437,5,282.60
Derrick Henry,RB,BAL,17,307,1595,16,21,15,150,0,279.50
Kyren Williams,RB,LA,17,259,1252,10,50,36,281,3,263.30
Travis Etienne,RB,JAX,17,260,1107,7,52,36,292,6,253.90
Ashton Jeanty,RB,LV,17,266,975,5,73,55,346,5,245.10
Javonte Williams,RB,DAL,16,252,1201,11,51,35,137,2,242.80
Josh Jacobs,RB,GB,15,234,929,13,44,36,282,1,237.10
Saquon Barkley,RB,PHI,16,280,1140,7,50,37,273,2,232.30
D'Andre Swift,RB,CHI,16,223,1087,9,48,34,299,1,228.60
Kenneth Gainwell,RB,PIT,17,114,537,5,85,73,486,3,221.30
Jaylen Warren,RB,PIT,16,211,958,6,45,40,333,2,217.10
Rico Dowdle,RB,CAR,17,236,1076,6,50,39,297,1,216.30
Breece Hall,RB,NYJ,16,243,1065,4,48,36,350,1,207.66
RJ Harvey,RB,DEN,17,146,540,7,58,47,356,5,206.60
TreVeyon Henderson,RB,NE,17,180,911,9,42,35,221,1,206.20
Kenneth Walker III,RB,SEA,17,221,1027,5,36,31,282,0,191.90
Tony Pollard,RB,TEN,17,242,1082,5,41,33,206,0,185.80
Zach Charbonnet,RB,SEA,16,184,730,12,24,20,144,0,181.40
Rhamondre Stevenson,RB,NE,14,130,603,7,37,32,345,2,178.80
Quinshon Judkins,RB,CLE,14,230,827,7,36,26,171,0,169.80
David Montgomery,RB,DET,17,158,716,8,29,24,192,0,166.92
Tyrone Tracy Jr.,RB,NYG,15,176,740,2,48,36,288,2,160.80
Kyle Monangai,RB,CHI,17,169,783,5,30,18,164,0,146.70
Kareem Hunt,RB,KC,17,163,611,8,25,18,143,1,145.40
Woody Marks,RB,HOU,16,196,703,2,36,24,208,3,145.10
Rachaad White,RB,TB,17,132,572,4,45,40,218,0,143
Jacory Croskey-Merritt,RB,WAS,17,175,805,8,13,9,68,0,140.30
Bucky Irving,RB,TB,10,173,588,1,35,30,277,3,138.50
Omarion Hampton,RB,LAC,9,124,545,4,35,32,192,1,135.70
Jordan Mason,RB,MIN,16,159,758,6,16,14,51,0,128.90
Cam Skattebo,RB,NYG,8,101,410,5,32,24,207,2,127.70
Chuba Hubbard,RB,CAR,15,134,511,1,39,30,223,3,125.40
Tyler Allgeier,RB,ATL,17,143,514,8,16,14,96,0,123
Blake Corum,RB,LA,17,145,746,6,14,8,36,0,122.20
Aaron Jones,RB,MIN,12,132,548,2,41,28,199,1,118.70
Kimani Vidal,RB,LAC,13,155,643,3,22,16,136,1,117.90
J.K. Dobbins,RB,DEN,10,153,772,4,14,11,37,0,115.90
Tyjae Spears,RB,TEN,13,72,283,2,50,45,264,0,111.70
Devin Singletary,RB,NYG,17,119,437,5,19,18,151,0,108.80
Alvin Kamara,RB,NO,11,131,471,1,39,33,186,0,100.70
Ty Johnson,RB,BUF,17,50,200,3,33,24,263,2,100.30
Michael Carter,RB,ARI,13,92,333,1,45,33,267,0,99.00
Emanuel Wilson,RB,GB,17,125,496,3,17,15,99,0,94.50
Chris Rodriguez Jr.,RB,WAS,12,112,500,6,4,3,30,0,92
Sean Tucker,RB,TB,17,86,320,7,11,8,34,1,91.40
Bhayshul Tuten,RB,JAX,15,83,307,5,14,10,79,2,88.60
Nick Chubb,RB,HOU,15,122,506,3,20,13,67,0,88.30
Dylan Sampson,RB,CLE,15,65,175,0,40,33,271,2,87.60
Isiah Pacheco,RB,KC,13,118,462,1,26,19,101,1,87.30
Samaje Perine,RB,CIN,15,84,382,3,21,17,87,0,77.90
Jeremy McNichols,RB,WAS,16,44,221,1,31,25,196,0,72.70
Isaiah Davis,RB,NYJ,16,43,236,1,28,21,186,0,71.20
Justice Hill,RB,BAL,10,18,93,2,27,21,169,1,65.20
Ray Davis,RB,BUF,17,58,275,0,13,10,86,2,64.10
Brashard Smith,RB,KC,17,44,151,0,35,25,172,1,63.30
Brian Robinson,RB,SF,17,92,400,2,12,8,25,0,62.50
Devin Neal,RB,NO,9,57,206,2,19,17,104,0,60
Ollie Gordon II,RB,MIA,17,70,199,3,9,7,32,1,54.10
Tank Bigsby,RB,PHI,15,63,356,2,4,3,32,0,53.80
Jaylen Wright,RB,MIA,9,70,288,2,9,5,44,0,48.20
Jerome Ford,RB,CLE,13,24,73,0,32,26,103,0,43.60
Malik Davis,RB,DAL,10,52,250,2,5,2,16,0,40.60
Trey Benson,RB,ARI,4,29,160,0,16,13,64,0,35.40
James Conner,RB,ARI,3,32,95,1,9,8,38,1,33.30
Kendre Miller,RB,NO,7,47,193,1,5,5,30,0,33.30
Jaleel McLaughlin,RB,DEN,8,37,187,1,6,4,27,0,31.40
Raheem Mostert,RB,LV,12,22,104,0,12,12,70,0,29.40
LeQuint Allen Jr.,RB,JAX,16,23,94,0,11,10,54,0,24.80
Antonio Gibson,RB,NE,5,25,106,1,3,2,6,0,23.20`;

export const WR_CSV = `player_display_name,position,recent_team,games,targets,receptions,receiving_yards,receiving_tds,carries,rushing_yards,rushing_tds,fantasy_points_ppr
Puka Nacua,WR,LA,16,166,129,1715,10,10,105,1,375
Jaxon Smith-Njigba,WR,SEA,17,163,119,1793,10,7,36,0,359.90
Amon-Ra St. Brown,WR,DET,17,172,117,1401,11,3,9,0,324.00
Ja'Marr Chase,WR,CIN,16,185,125,1412,8,3,14,0,313.60
George Pickens,WR,DAL,17,137,93,1429,9,0,0,0,291.90
Chris Olave,WR,NO,16,156,100,1163,9,1,-3,0,268.00
Zay Flowers,WR,BAL,17,118,86,1211,5,10,62,1,243.30
Nico Collins,WR,HOU,15,120,71,1117,6,2,15,1,226.20
Davante Adams,WR,LA,14,114,60,789,14,0,0,0,222.90
Michael Wilson,WR,ARI,17,126,78,1006,7,0,0,0,220.60
A.J. Brown,WR,PHI,15,121,78,1003,7,0,0,0,220.30
Jameson Williams,WR,DET,17,102,65,1117,7,6,12,0,219.90
Courtland Sutton,WR,DEN,17,124,74,1017,7,0,0,0,219.70
Wan'Dale Robinson,WR,NYG,16,140,92,1014,4,3,5,0,217.90
Tetairoa McMillan,WR,CAR,17,122,70,1014,7,0,0,0,213.40
Tee Higgins,WR,CIN,15,98,59,846,11,0,0,0,211.60
Stefon Diggs,WR,NE,17,102,85,1013,4,0,0,0,210.30
Michael Pittman,WR,IND,17,111,80,784,7,0,0,0,202.40
Drake London,WR,ATL,12,112,68,919,7,0,0,0,201.90
DeVonta Smith,WR,PHI,17,113,77,1008,4,0,0,0,201.80
Justin Jefferson,WR,MIN,17,141,84,1048,2,2,7,0,201.50
CeeDee Lamb,WR,DAL,13,117,75,1077,3,1,2,0,200.90
Emeka Egbuka,WR,TB,17,127,63,938,6,2,9,0,195.70
Jaylen Waddle,WR,MIA,16,100,64,910,6,2,28,0,194.12
Deebo Samuel Sr.,WR,WAS,16,99,72,727,5,17,75,1,188.20
DK Metcalf,WR,PIT,15,99,59,850,6,2,12,1,187.20
Parker Washington,WR,JAX,16,95,58,847,5,7,0,0,184.70
Alec Pierce,WR,IND,15,84,47,1003,6,0,0,0,183.30
Keenan Allen,WR,LAC,17,122,81,777,4,0,0,0,182.70
Ladd McConkey,WR,LAC,16,106,66,789,6,0,0,0,180.90
Troy Franklin,WR,DEN,17,104,65,709,6,5,12,0,177.10
Jakobi Meyers,WR,JAX,16,110,75,835,3,5,13,0,175.80
Jauan Jennings,WR,SF,15,90,55,643,9,0,0,0,173.30
DJ Moore,WR,CHI,17,85,50,682,6,15,79,1,172.18
Quentin Johnston,WR,LAC,13,84,51,735,8,2,7,0,171.20
Khalil Shakir,WR,BUF,16,95,72,719,4,1,5,0,166.40
Romeo Doubs,WR,GB,16,85,55,724,6,0,0,0,165.40
Tre Tucker,WR,LV,17,92,57,696,5,11,51,0,161.70
Rashid Shaheed,WR,SEA,18,92,59,687,2,9,69,0,156.60
Rashee Rice,WR,KC,8,78,53,571,5,5,20,1,150.10
Rome Odunze,WR,CHI,12,90,44,661,6,0,0,0,146.10
Brian Thomas Jr.,WR,JAX,14,91,48,707,2,3,21,1,138.80
Josh Downs,WR,IND,16,88,58,566,4,2,-2,0,138.40
Marquise Brown,WR,KC,16,74,49,587,5,0,0,0,137.70
Jordan Addison,WR,MIN,14,79,42,610,3,2,81,1,135.10
Christian Watson,WR,GB,10,55,35,611,6,1,3,0,132.40
Jayden Higgins,WR,HOU,17,68,41,525,6,0,0,0,129.50
Chimere Dike,WR,TEN,17,74,48,423,4,11,18,0,128.10
Luther Burden III,WR,CHI,15,60,47,652,2,6,37,0,127.90
Marvin Harrison Jr.,WR,ARI,12,73,41,608,4,0,0,0,127.80
Kayshon Boutte,WR,NE,14,46,33,551,6,0,0,0,124.10
Jerry Jeudy,WR,CLE,17,106,50,602,2,1,5,0,120.70
Cooper Kupp,WR,SEA,16,70,47,593,2,0,0,0,116.30
Terry McLaurin,WR,WAS,10,60,38,582,3,0,0,0,114.20
Mack Hollins,WR,NE,14,65,46,550,2,1,4,0,113.40
Xavier Worthy,WR,KC,14,73,42,532,1,11,87,0,109.90
Keon Coleman,WR,BUF,12,59,38,404,4,0,0,0,102.40
Garrett Wilson,WR,NYJ,7,59,36,395,4,0,0,0,99.50
Darius Slayton,WR,NYG,14,63,37,538,1,0,0,0,98.80
Marvin Mims Jr.,WR,DEN,15,51,37,322,1,12,78,1,95.00
Jalen Coker,WR,CAR,11,43,33,394,3,0,0,0,90.40
Xavier Legette,WR,CAR,15,64,35,363,3,1,0,0,89.30
Ricky Pearsall,WR,SF,9,53,36,528,0,2,-2,0,88.60
Adonai Mitchell,WR,NYJ,16,74,33,453,2,1,-4,0,87.90
Calvin Austin III,WR,PIT,14,55,31,372,3,0,0,0,86.20
Mike Evans,WR,TB,8,62,30,368,3,0,0,0,84.80
Chris Godwin Jr.,WR,TB,9,51,33,360,2,0,0,0,83
Isaac TeSlaa,WR,DET,14,27,16,239,6,0,0,0,75.90
John Metchie III,WR,NYJ,13,48,33,274,2,3,-5,0,71.90
Matthew Golden,WR,GB,14,44,29,361,0,10,49,0,70
Tre Harris,WR,LAC,16,43,30,324,1,2,10,0,69.40
Jaylin Noel,WR,HOU,17,35,26,292,2,6,12,0,68.40
Tyler Lockett,WR,LV,17,55,32,291,1,0,0,0,67.10
Cedric Tillman,WR,CLE,12,39,21,270,2,0,0,0,60`;

export const TE_CSV = `player_display_name,position,recent_team,games,targets,receptions,receiving_yards,receiving_tds,fantasy_points_ppr
Trey McBride,TE,ARI,17,169,126,1239,11,315.90
Kyle Pitts,TE,ATL,17,118,88,928,5,210.80
Travis Kelce,TE,KC,17,108,76,851,5,193.20
Tyler Warren,TE,IND,17,112,76,817,4,188.50
Jake Ferguson,TE,DAL,17,102,82,600,8,188.10
Harold Fannin Jr.,TE,CLE,16,107,72,731,6,186.40
Dallas Goedert,TE,PHI,15,82,60,591,11,185.10
Juwan Johnson,TE,NO,17,102,77,889,3,179.90
Hunter Henry,TE,NE,17,87,60,768,7,178.80
Dalton Schultz,TE,HOU,17,106,82,777,3,177.70
Brock Bowers,TE,LV,12,86,64,680,7,176.20
Colston Loveland,TE,CHI,16,82,58,713,6,165.10
George Kittle,TE,SF,11,69,57,628,7,161.50
AJ Barner,TE,SEA,17,68,52,519,6,147.30
Oronde Gadsden II,TE,LAC,15,69,49,664,3,131.40
Mark Andrews,TE,BAL,17,70,48,422,5,131.00
Theo Johnson,TE,NYG,15,74,45,528,5,127.80
Zach Ertz,TE,WAS,13,72,50,504,4,126.40
Dalton Kincaid,TE,BUF,12,49,39,571,5,126.10
Chig Okonkwo,TE,TEN,17,79,56,560,2,124.00
Cade Otton,TE,TB,15,81,59,572,1,122.20
Brenton Strange,TE,JAX,12,60,46,540,3,118.00
Tucker Kraft,TE,GB,8,44,32,489,6,117.20
Pat Freiermuth,TE,PIT,15,54,41,486,4,113.60
T.J. Hockenson,TE,MIN,15,66,51,438,3,112.80
Sam LaPorta,TE,DET,9,49,40,489,3,106.90
Dawson Knox,TE,BUF,16,49,36,417,4,103.70
Evan Engram,TE,DEN,16,76,50,461,1,102.80
Jake Tonges,TE,SF,10,46,34,293,5,93.30
Mason Taylor,TE,NYJ,13,65,44,369,1,88.90
Darren Waller,TE,MIA,9,34,24,283,6,88.70
David Njoku,TE,CLE,11,48,33,293,4,86.30
Jonnu Smith,TE,PIT,17,54,38,222,2,85.20
Cole Kmet,TE,CHI,16,48,30,347,2,78.70
Noah Fant,TE,CIN,13,41,34,288,3,74.80
Michael Mayer,TE,LV,13,50,35,328,1,73.80
Tyler Higbee,TE,LA,10,36,25,281,3,71.10
Mike Gesicki,TE,CIN,12,42,28,307,2,70.70
Isaiah Likely,TE,BAL,12,36,27,307,1,61.70
Austin Hooper,TE,NE,13,26,21,263,2,59.30
Elijah Higgins,TE,ARI,17,37,30,301,0,58.10
Ja'Tavion Sanders,TE,CAR,12,34,29,190,1,54
Terrance Ferguson,TE,LA,11,25,11,231,3,52.10
Luke Musgrave,TE,GB,13,31,24,252,0,49.20
Noah Gray,TE,KC,14,37,21,178,0,38.80`;
