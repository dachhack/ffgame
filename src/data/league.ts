import type { League, FantasyTeam, Player, Pos, ScheduleGame } from '../types';
import { statsForName, shortName, normName, teamForName, STAT_PLAYERS, type StatPlayer } from './players';

// ─────────────────────────────────────────────────────────────────────────
// PeakedInDynasty — real 2025 league (Sleeper id 1181483840740397056).
// 10-team Dynasty, 2QB. Standings, rosters and schedule are the genuine
// end-of-season data; the game layer on top is the Gridiron Clash demo.
// "Happy Campers" (dachhack) is YOU.
// ─────────────────────────────────────────────────────────────────────────

export const YOU_TEAM_ID = 'happy-campers';

type RawPlayer = [string, Pos];

interface RawTeam {
  id: string;
  name: string;
  owner: string;
  ownerId: string;
  seed: number;
  wins: number;
  losses: number;
  pf: number;
  pa: number;
  roster: RawPlayer[];
}

const RAW_TEAMS: RawTeam[] = [
  {
    id: 'happy-campers', name: 'Happy Campers', owner: 'dachhack', ownerId: '765446581272072192',
    seed: 1, wins: 11, losses: 3, pf: 2406.58, pa: 2009.78,
    roster: [
      ['Dak Prescott', 'QB'], ['Trevor Lawrence', 'QB'], ['Christian McCaffrey', 'RB'], ['Travis Etienne', 'RB'],
      ['DeVonta Smith', 'WR'], ['George Pickens', 'WR'], ['Terry McLaurin', 'WR'], ['Kyle Pitts', 'TE'],
      ['Wan\'Dale Robinson', 'WR'], ['Dallas Goedert', 'TE'], ['Jordan Addison', 'WR'], ['Brock Bowers', 'TE'],
      ['Josh Jacobs', 'RB'], ['Alvin Kamara', 'RB'], ['Caleb Williams', 'QB'], ['George Kittle', 'TE'],
      ['Christian Watson', 'WR'], ['Davante Adams', 'WR'], ['Tyrone Tracy', 'RB'], ['Chimere Dike', 'WR'],
      ['Cole Kmet', 'TE'], ['Baker Mayfield', 'QB'], ['Jaylin Noel', 'WR'], ['Cedric Tillman', 'WR'],
    ],
  },
  {
    id: 'coolaak', name: 'Coolaak', owner: 'Coolaak', ownerId: '737067142029148160',
    seed: 2, wins: 10, losses: 4, pf: 2496.46, pa: 2116.14,
    roster: [
      ['Jared Goff', 'QB'], ['Matthew Stafford', 'QB'], ['Jonathan Taylor', 'RB'], ['Breece Hall', 'RB'],
      ['Jakobi Meyers', 'WR'], ['Jaxon Smith-Njigba', 'WR'], ['Stefon Diggs', 'WR'], ['Trey McBride', 'TE'],
      ['Tyler Warren', 'TE'], ['Deebo Samuel', 'WR'], ['Travis Kelce', 'TE'], ['David Njoku', 'TE'],
      ['David Montgomery', 'RB'], ['Zach Ertz', 'TE'], ['Aaron Rodgers', 'QB'], ['Michael Penix', 'QB'],
      ['Braelon Allen', 'RB'], ['Ollie Gordon', 'RB'],
    ],
  },
  {
    id: 'next-year', name: 'There’s Always Next Year', owner: 'modus', ownerId: '316273968032018432',
    seed: 3, wins: 9, losses: 5, pf: 2380.54, pa: 2264.40,
    roster: [
      ['Bo Nix', 'QB'], ['Drake Maye', 'QB'], ['Jahmyr Gibbs', 'RB'], ['RJ Harvey', 'RB'],
      ['Ladd McConkey', 'WR'], ['Drake London', 'WR'], ['Ricky Pearsall', 'WR'], ['Harold Fannin', 'TE'],
      ['Ashton Jeanty', 'RB'], ['TreVeyon Henderson', 'RB'], ['Rashee Rice', 'WR'], ['Emeka Egbuka', 'WR'],
      ['J.J. McCarthy', 'QB'], ['Trey Benson', 'RB'], ['Isaiah Likely', 'TE'], ['Bhayshul Tuten', 'RB'],
      ['Brandon Aiyuk', 'WR'], ['Jayden Reed', 'WR'],
    ],
  },
  {
    id: 'rock-tunnel', name: 'Lost in Rock Tunnel', owner: 'KingChirp', ownerId: '737411069647142912',
    seed: 4, wins: 8, losses: 6, pf: 2404.48, pa: 2227,
    roster: [
      ['Jacoby Brissett', 'QB'], ['C.J. Stroud', 'QB'], ['De\'Von Achane', 'RB'], ['Chase Brown', 'RB'],
      ['Nico Collins', 'WR'], ['Jauan Jennings', 'WR'], ['Chris Olave', 'WR'], ['Jake Tonges', 'TE'],
      ['Bijan Robinson', 'RB'], ['Puka Nacua', 'WR'], ['Kyler Murray', 'QB'], ['Jayden Daniels', 'QB'],
      ['Malik Nabers', 'WR'], ['Sam LaPorta', 'TE'], ['Isiah Pacheco', 'RB'], ['Brian Thomas', 'WR'],
      ['Rhamondre Stevenson', 'RB'], ['Pat Freiermuth', 'TE'], ['Quentin Johnston', 'WR'], ['Jaxson Dart', 'QB'],
    ],
  },
  {
    id: 'skeptic-tank', name: '#1 Skeptic Tank', owner: 'betz4444', ownerId: '721059160816455680',
    seed: 5, wins: 7, losses: 7, pf: 2195.40, pa: 2079.98,
    roster: [
      ['Philip Rivers', 'QB'], ['Brady Cook', 'QB'], ['James Cook', 'RB'], ['Omarion Hampton', 'RB'],
      ['Xavier Worthy', 'WR'], ['Tee Higgins', 'WR'], ['Michael Wilson', 'WR'], ['Hunter Henry', 'TE'],
      ['Zay Flowers', 'WR'], ['Michael Pittman', 'WR'], ['Zach Charbonnet', 'RB'], ['Cam Skattebo', 'RB'],
      ['Marvin Harrison', 'WR'], ['Darnell Mooney', 'WR'], ['Justin Fields', 'QB'], ['Patrick Mahomes', 'QB'],
      ['Tua Tagovailoa', 'QB'], ['D\'Andre Swift', 'RB'], ['Daniel Jones', 'QB'], ['Theo Johnson', 'TE'],
    ],
  },
  {
    id: 'gadsden', name: '#1 Oronde Gadsden Enjoyer', owner: 'MarshallMustDie', ownerId: '564590438169468928',
    seed: 6, wins: 7, losses: 7, pf: 2134.68, pa: 2090.58,
    roster: [
      ['Bryce Young', 'QB'], ['Josh Allen', 'QB'], ['Jaylen Warren', 'RB'], ['Kareem Hunt', 'RB'],
      ['Ja\'Marr Chase', 'WR'], ['Alec Pierce', 'WR'], ['Amon-Ra St. Brown', 'WR'], ['Oronde Gadsden', 'TE'],
      ['Tetairoa McMillan', 'WR'], ['Blake Corum', 'RB'], ['Dalton Kincaid', 'TE'], ['Cooper Kupp', 'WR'],
      ['Jonnu Smith', 'TE'], ['Aaron Jones', 'RB'], ['Jordan Love', 'QB'], ['J.K. Dobbins', 'RB'],
      ['Travis Hunter', 'WR'], ['Brian Robinson', 'RB'], ['Shedeur Sanders', 'QB'],
    ],
  },
  {
    id: 'rizzler', name: '#1 Rizzler ✨E n e r g y✨', owner: 'TheMesso', ownerId: '201719736654888960',
    seed: 7, wins: 7, losses: 7, pf: 2005.20, pa: 2172.44,
    roster: [
      ['Cam Ward', 'QB'], ['Tyler Shough', 'QB'], ['Bucky Irving', 'RB'], ['Saquon Barkley', 'RB'],
      ['DK Metcalf', 'WR'], ['Rashid Shaheed', 'WR'], ['A.J. Brown', 'WR'], ['Jake Ferguson', 'TE'],
      ['Javonte Williams', 'RB'], ['Rico Dowdle', 'RB'], ['Matthew Golden', 'WR'], ['Garrett Wilson', 'WR'],
      ['Tucker Kraft', 'TE'], ['Tony Pollard', 'RB'], ['Rome Odunze', 'WR'], ['Geno Smith', 'QB'],
      ['Dalton Schultz', 'TE'], ['Jayden Higgins', 'WR'],
    ],
  },
  {
    id: 'spartandawgs', name: 'SpartanDawgs', owner: 'SpartanCards', ownerId: '641065208403525632',
    seed: 8, wins: 6, losses: 8, pf: 1896.56, pa: 2140.50,
    roster: [
      ['Joe Burrow', 'QB'], ['Justin Herbert', 'QB'], ['Kenneth Walker', 'RB'], ['Kyren Williams', 'RB'],
      ['Jameson Williams', 'WR'], ['CeeDee Lamb', 'WR'], ['DJ Moore', 'WR'], ['AJ Barner', 'TE'],
      ['Cade Otton', 'TE'], ['Woody Marks', 'RB'], ['Quinshon Judkins', 'RB'], ['Khalil Shakir', 'WR'],
      ['T.J. Hockenson', 'TE'], ['Rachaad White', 'RB'], ['Sam Darnold', 'QB'], ['Tre Tucker', 'WR'],
      ['Dylan Sampson', 'RB'], ['Spencer Rattler', 'QB'],
    ],
  },
  {
    id: 'happier-camper', name: 'Happier Camper', owner: 'PeakedInHighSkool', ownerId: '723227693008637952',
    seed: 9, wins: 5, losses: 9, pf: 1871.70, pa: 2055.16,
    roster: [
      ['Lamar Jackson', 'QB'], ['Jalen Hurts', 'QB'], ['Derrick Henry', 'RB'], ['Kenneth Gainwell', 'RB'],
      ['Justin Jefferson', 'WR'], ['Keenan Allen', 'WR'], ['Courtland Sutton', 'WR'], ['Colston Loveland', 'TE'],
      ['Juwan Johnson', 'TE'], ['Mark Andrews', 'TE'], ['James Conner', 'RB'], ['Brock Purdy', 'QB'],
      ['Chuba Hubbard', 'RB'], ['Evan Engram', 'TE'], ['Dillon Gabriel', 'QB'], ['Tre\' Harris', 'WR'],
      ['Jacory Croskey-Merritt', 'RB'], ['Taysom Hill', 'TE'],
    ],
  },
  {
    id: 'achilles', name: 'Achilles Heal Society', owner: 'CDicey', ownerId: '374789106846400512',
    seed: 10, wins: 0, losses: 14, pf: 1526.16, pa: 2161.78,
    roster: [
      ['Trey Lance', 'QB'], ['Kyle Monangai', 'RB'], ['Jordan Mason', 'RB'], ['Jaylen Waddle', 'WR'],
      ['Josh Downs', 'WR'], ['John Metchie', 'WR'], ['Chig Okonkwo', 'TE'], ['Brenton Strange', 'TE'],
      ['Nick Chubb', 'RB'], ['Keon Coleman', 'WR'], ['Tyler Lockett', 'WR'], ['Mike Evans', 'WR'],
      ['Marquise Brown', 'WR'], ['Jerry Jeudy', 'WR'], ['Troy Franklin', 'WR'], ['Deshaun Watson', 'QB'],
    ],
  },
];

function buildPlayer(name: string, pos: Pos): Player {
  const stats = statsForName(name, pos);
  return {
    id: normName(name).replace(/\s+/g, '-'),
    name: shortName(name),
    full: name,
    pos,
    team: teamForName(name),
    stats,
  };
}

// Global player registry (id -> Player) and per-team rosters.
const PLAYERS: Record<string, Player> = {};
const TEAMS: FantasyTeam[] = RAW_TEAMS.map((rt) => {
  const ids: string[] = [];
  for (const [name, pos] of rt.roster) {
    const p = buildPlayer(name, pos);
    PLAYERS[p.id] = p;
    ids.push(p.id);
  }
  const t: FantasyTeam = {
    id: rt.id, name: rt.name, owner: rt.owner, ownerId: rt.ownerId,
    seed: rt.seed, wins: rt.wins, losses: rt.losses, pf: rt.pf, pa: rt.pa,
    roster: ids,
  };
  return t;
});

// ── Real 14-week schedule (home = first listed in each matchup) ──
type RawGame = [number, string, string, number, number]; // week, teamA, teamB, scoreA, scoreB
const RAW_SCHEDULE: RawGame[] = [
  [1, 'rock-tunnel', 'achilles', 172.04, 142.26], [1, 'happier-camper', 'skeptic-tank', 179.24, 145.18], [1, 'gadsden', 'happy-campers', 139.58, 144.4], [1, 'rizzler', 'spartandawgs', 122.56, 116.14], [1, 'coolaak', 'next-year', 128.8, 134.32],
  [2, 'rock-tunnel', 'happier-camper', 196.2, 127.04], [2, 'gadsden', 'rizzler', 184.5, 161.4], [2, 'happy-campers', 'next-year', 161.34, 144.94], [2, 'spartandawgs', 'coolaak', 129.52, 181.56], [2, 'achilles', 'skeptic-tank', 111.08, 120.06],
  [3, 'rock-tunnel', 'skeptic-tank', 147.84, 160.8], [3, 'happier-camper', 'achilles', 190.06, 116.64], [3, 'gadsden', 'spartandawgs', 142.94, 146.82], [3, 'rizzler', 'next-year', 163.22, 143.84], [3, 'happy-campers', 'coolaak', 140.16, 133.76],
  [4, 'rock-tunnel', 'happy-campers', 182.94, 163.84], [4, 'happier-camper', 'next-year', 142.98, 187.86], [4, 'gadsden', 'achilles', 146.84, 124.86], [4, 'rizzler', 'coolaak', 173.2, 158.02], [4, 'spartandawgs', 'skeptic-tank', 112.5, 200.54],
  [5, 'rock-tunnel', 'gadsden', 162.14, 175.54], [5, 'happier-camper', 'coolaak', 147.94, 197.5], [5, 'rizzler', 'skeptic-tank', 199.72, 147.54], [5, 'happy-campers', 'achilles', 181.44, 145.58], [5, 'spartandawgs', 'next-year', 144.78, 147.7],
  [6, 'rock-tunnel', 'next-year', 225.24, 184.4], [6, 'happier-camper', 'rizzler', 95.86, 122.64], [6, 'gadsden', 'skeptic-tank', 123.86, 159.86], [6, 'happy-campers', 'spartandawgs', 205.38, 142.56], [6, 'coolaak', 'achilles', 168.96, 145.78],
  [7, 'rock-tunnel', 'coolaak', 152.9, 216.22], [7, 'happier-camper', 'spartandawgs', 146.06, 148.92], [7, 'gadsden', 'next-year', 174.08, 183.84], [7, 'rizzler', 'achilles', 141.18, 118.24], [7, 'happy-campers', 'skeptic-tank', 195.68, 178.06],
  [8, 'rock-tunnel', 'rizzler', 151.94, 155.06], [8, 'happier-camper', 'happy-campers', 147.3, 122.3], [8, 'gadsden', 'coolaak', 169.52, 194.34], [8, 'spartandawgs', 'achilles', 113.92, 97.54], [8, 'skeptic-tank', 'next-year', 201.94, 207.76],
  [9, 'rock-tunnel', 'spartandawgs', 178.46, 173.58], [9, 'happier-camper', 'gadsden', 119.56, 169.44], [9, 'rizzler', 'happy-campers', 114.26, 238.3], [9, 'coolaak', 'skeptic-tank', 179.66, 165.08], [9, 'achilles', 'next-year', 107.7, 164.28],
  [10, 'rock-tunnel', 'achilles', 204.04, 107.96], [10, 'happier-camper', 'skeptic-tank', 123.26, 109.06], [10, 'gadsden', 'happy-campers', 113.28, 184.82], [10, 'rizzler', 'spartandawgs', 120, 141.82], [10, 'coolaak', 'next-year', 266.6, 226.2],
  [11, 'rock-tunnel', 'happier-camper', 172.6, 114.22], [11, 'gadsden', 'rizzler', 162.64, 125.88], [11, 'happy-campers', 'next-year', 164.04, 139.34], [11, 'spartandawgs', 'coolaak', 96.2, 181.7], [11, 'achilles', 'skeptic-tank', 76.62, 147.78],
  [12, 'rock-tunnel', 'skeptic-tank', 138.68, 161.82], [12, 'happier-camper', 'achilles', 131.58, 63.8], [12, 'gadsden', 'spartandawgs', 116.08, 136.8], [12, 'rizzler', 'next-year', 122.62, 185.74], [12, 'happy-campers', 'coolaak', 197.4, 186.48],
  [13, 'rock-tunnel', 'happy-campers', 172.1, 156.66], [13, 'happier-camper', 'next-year', 115.84, 164.22], [13, 'gadsden', 'achilles', 128.78, 98.5], [13, 'rizzler', 'coolaak', 147.16, 164.06], [13, 'spartandawgs', 'skeptic-tank', 147.78, 133.88],
  [14, 'rock-tunnel', 'gadsden', 147.36, 187.6], [14, 'happier-camper', 'coolaak', 90.76, 138.8], [14, 'rizzler', 'skeptic-tank', 136.3, 163.8], [14, 'happy-campers', 'achilles', 150.82, 69.6], [14, 'spartandawgs', 'next-year', 145.22, 166.1],
];

const SCHEDULE: ScheduleGame[] = RAW_SCHEDULE.map(([week, homeId, awayId, homeScore, awayScore]) => ({
  week, homeId, awayId, homeScore, awayScore,
}));

export const LEAGUE: League = {
  id: '1181483840740397056',
  name: 'PeakedInDynasty',
  format: 'Dynasty · 2QB · 10-team',
  season: 2025,
  teams: TEAMS,
  schedule: SCHEDULE,
};

export const REG_SEASON_WEEKS = 14;

export function getPlayer(id: string): Player | undefined {
  return PLAYERS[id];
}

export function getTeam(id: string): FantasyTeam | undefined {
  return TEAMS.find((t) => t.id === id);
}

export function teamRoster(teamId: string): Player[] {
  const t = getTeam(teamId);
  if (!t) return [];
  return t.roster.map((id) => PLAYERS[id]).filter(Boolean);
}

/** All players rostered league-wide (for waiver-wire exclusion). */
export function allRosteredIds(): Set<string> {
  const s = new Set<string>();
  for (const t of TEAMS) for (const id of t.roster) s.add(id);
  return s;
}

/** Top available free agents (in stats DB, not on any roster). */
export function freeAgents(limit = 24): StatPlayer[] {
  const rostered = allRosteredIds();
  return STAT_PLAYERS
    .filter((sp) => !rostered.has(normName(sp.name).replace(/\s+/g, '-')))
    .sort((a, b) => b.ppr - a.ppr)
    .slice(0, limit);
}

/** A team's week-by-week results from its own POV across the regular season. */
export interface TeamResult { week: number; oppId: string; ptsFor: number; ptsAgainst: number; result: 'W' | 'L' | 'T'; }
export function teamResults(teamId: string): TeamResult[] {
  const out: TeamResult[] = [];
  for (let w = 1; w <= REG_SEASON_WEEKS; w++) {
    const g = gameForTeam(teamId, w);
    if (!g) continue;
    const result = g.ptsFor > g.ptsAgainst ? 'W' : g.ptsFor < g.ptsAgainst ? 'L' : 'T';
    out.push({ week: w, oppId: g.oppId, ptsFor: g.ptsFor, ptsAgainst: g.ptsAgainst, result });
  }
  return out;
}

/** The schedule game for a given team in a given week, normalized to that team's POV. */
export function gameForTeam(teamId: string, week: number): { oppId: string; ptsFor: number; ptsAgainst: number } | null {
  const g = SCHEDULE.find((x) => x.week === week && (x.homeId === teamId || x.awayId === teamId));
  if (!g) return null;
  if (g.homeId === teamId) return { oppId: g.awayId, ptsFor: g.homeScore, ptsAgainst: g.awayScore };
  return { oppId: g.homeId, ptsFor: g.awayScore, ptsAgainst: g.homeScore };
}
