// Regenerate src/data/injuries.ts from a raw Stathead pull (scripts/injuries_raw.txt).
//
// The raw file has two sections:
//   WEEKLY
//   week,full_name,status        (status = O|D|Q ; weeks 1..14)
//   IR
//   full_name,ir_from_week       (genuine season-ending IR; applies from that week on)
//
// Names are mapped to player slugs with the SAME normName the app uses to build
// player ids, and only league-rostered players are kept — so slugs line up with
// the real PBP keys. Usage: node scripts/genInjuries.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const RAW = join(here, 'injuries_raw.txt');
const OUT = join(here, '..', 'src', 'data', 'injuries.ts');

// Must match src/data/players.ts normName exactly (so slugs == app player ids).
function normName(raw) {
  return raw
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const slug = (n) => normName(n).replace(/\s+/g, '-');

// League skill-position rosters (from src/data/league.ts) — the valid slug set.
const LEAGUE_NAMES = [
  'Dak Prescott','Trevor Lawrence','Christian McCaffrey','Travis Etienne','DeVonta Smith','George Pickens','Terry McLaurin','Kyle Pitts',"Wan'Dale Robinson",'Dallas Goedert','Jordan Addison','Brock Bowers','Josh Jacobs','Alvin Kamara','Caleb Williams','George Kittle','Christian Watson','Davante Adams','Tyrone Tracy','Chimere Dike','Cole Kmet','Baker Mayfield','Jaylin Noel','Cedric Tillman',
  'Jared Goff','Matthew Stafford','Jonathan Taylor','Breece Hall','Jakobi Meyers','Jaxon Smith-Njigba','Stefon Diggs','Trey McBride','Tyler Warren','Deebo Samuel','Travis Kelce','David Njoku','David Montgomery','Zach Ertz','Aaron Rodgers','Michael Penix','Braelon Allen','Ollie Gordon',
  'Bo Nix','Drake Maye','Jahmyr Gibbs','RJ Harvey','Ladd McConkey','Drake London','Ricky Pearsall','Harold Fannin','Ashton Jeanty','TreVeyon Henderson','Rashee Rice','Emeka Egbuka','J.J. McCarthy','Trey Benson','Isaiah Likely','Bhayshul Tuten','Brandon Aiyuk','Jayden Reed',
  'Jacoby Brissett','C.J. Stroud',"De'Von Achane",'Chase Brown','Nico Collins','Jauan Jennings','Chris Olave','Jake Tonges','Bijan Robinson','Puka Nacua','Kyler Murray','Jayden Daniels','Malik Nabers','Sam LaPorta','Isiah Pacheco','Brian Thomas','Rhamondre Stevenson','Pat Freiermuth','Quentin Johnston','Jaxson Dart',
  'Philip Rivers','Brady Cook','James Cook','Omarion Hampton','Xavier Worthy','Tee Higgins','Michael Wilson','Hunter Henry','Zay Flowers','Michael Pittman','Zach Charbonnet','Cam Skattebo','Marvin Harrison','Darnell Mooney','Justin Fields','Patrick Mahomes','Tua Tagovailoa',"D'Andre Swift",'Daniel Jones','Theo Johnson',
  'Bryce Young','Josh Allen','Jaylen Warren','Kareem Hunt',"Ja'Marr Chase",'Alec Pierce','Amon-Ra St. Brown','Oronde Gadsden','Tetairoa McMillan','Blake Corum','Dalton Kincaid','Cooper Kupp','Jonnu Smith','Aaron Jones','Jordan Love','J.K. Dobbins','Travis Hunter','Brian Robinson','Shedeur Sanders',
  'Cam Ward','Tyler Shough','Bucky Irving','Saquon Barkley','DK Metcalf','Rashid Shaheed','A.J. Brown','Jake Ferguson','Javonte Williams','Rico Dowdle','Matthew Golden','Garrett Wilson','Tucker Kraft','Tony Pollard','Rome Odunze','Geno Smith','Dalton Schultz','Jayden Higgins',
  'Joe Burrow','Justin Herbert','Kenneth Walker','Kyren Williams','Jameson Williams','CeeDee Lamb','DJ Moore','AJ Barner','Cade Otton','Woody Marks','Quinshon Judkins','Khalil Shakir','T.J. Hockenson','Rachaad White','Sam Darnold','Tre Tucker','Dylan Sampson','Spencer Rattler',
  'Lamar Jackson','Jalen Hurts','Derrick Henry','Kenneth Gainwell','Justin Jefferson','Keenan Allen','Courtland Sutton','Colston Loveland','Juwan Johnson','Mark Andrews','James Conner','Brock Purdy','Chuba Hubbard','Evan Engram','Dillon Gabriel',"Tre' Harris",'Jacory Croskey-Merritt','Taysom Hill',
  'Trey Lance','Kyle Monangai','Jordan Mason','Jaylen Waddle','Josh Downs','John Metchie','Chig Okonkwo','Brenton Strange','Nick Chubb','Keon Coleman','Tyler Lockett','Mike Evans','Marquise Brown','Jerry Jeudy','Troy Franklin','Deshaun Watson',
];
const VALID = new Set(LEAGUE_NAMES.map(slug));

const raw = readFileSync(RAW, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
let section = null;
const weekly = {}; // week -> { slug: status }
const irFrom = {}; // slug -> week
let skipped = [];
for (const line of raw) {
  if (line === 'WEEKLY') { section = 'w'; continue; }
  if (line === 'IR') { section = 'ir'; continue; }
  if (line.startsWith('week,') || line.startsWith('full_name,')) continue; // header echoes
  const parts = line.split(',').map((s) => s.trim());
  if (section === 'w') {
    const [wk, name, status] = [parts[0], parts.slice(1, -1).join(' '), parts[parts.length - 1]];
    const w = Number(wk); const s = status?.[0]?.toUpperCase();
    if (!w || !['O', 'D', 'Q'].includes(s)) continue;
    const sl = slug(name);
    if (!VALID.has(sl)) { skipped.push(`W ${name} -> ${sl}`); continue; }
    (weekly[w] ||= {})[sl] = s;
  } else if (section === 'ir') {
    const wk = Number(parts[parts.length - 1]);
    const name = parts.slice(0, -1).join(' ');
    if (!wk) continue;
    const sl = slug(name);
    if (!VALID.has(sl)) { skipped.push(`IR ${name} -> ${sl}`); continue; }
    irFrom[sl] = Math.max(1, Math.min(14, wk));
  }
}

// Serialize, sorted for stable diffs.
const weekObj = (m) => '{ ' + Object.keys(m).sort().map((k) => `'${k}': '${m[k]}'`).join(', ') + ' }';
const weeklyLines = Object.keys(weekly).map(Number).sort((a, b) => a - b)
  .map((w) => `  ${w}: ${weekObj(weekly[w])},`).join('\n');
const irLines = Object.keys(irFrom).sort().map((k) => `'${k}': ${irFrom[k]}`).join(', ');

const out = `// Weekly NFL injury-report designations (Out/Doubtful/Questionable) and genuine
// season-ending IR for league-rostered players, keyed by player slug.
// REAL 2025 data — generated from Stathead get_injuries + get_rosters via
// scripts/genInjuries.mjs. Do not hand-edit; re-run the generator instead.
export type InjuryStatus = 'O' | 'D' | 'Q' | 'IR';

// Per-week game-status designations (the official Out/Doubtful/Questionable report).
export const INJURIES: Record<number, Record<string, 'O' | 'D' | 'Q'>> = {
${weeklyLines}
};

// Genuine season-ending IR, week-aware: slug -> the first week the player was on
// IR. It applies from that week onward (earlier weeks fall back to the weekly
// report above), so a player who landed on IR midseason isn't flagged for the
// weeks he actually played.
export const IR_FROM: Record<string, number> = { ${irLines} };

// IR (from its start week) takes precedence; else the week's designation; else null.
export function injuryFor(week: number, slug: string): InjuryStatus | null {
  const ir = IR_FROM[slug];
  if (ir != null && week >= ir) return 'IR';
  return INJURIES[week]?.[slug] ?? null;
}
`;

writeFileSync(OUT, out);
const wkCount = Object.values(weekly).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`wrote ${OUT}`);
console.log(`weekly designations: ${wkCount} across ${Object.keys(weekly).length} weeks`);
console.log(`season IR players: ${Object.keys(irFrom).length}`);
if (skipped.length) console.log(`skipped (not in league set): ${skipped.length}\n  ` + skipped.join('\n  '));
