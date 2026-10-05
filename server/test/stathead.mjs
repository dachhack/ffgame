// The Stathead client's pure parts (v0.633.0): the crosswalk coverage rule a
// pool is checked by before a sport switches provider. Run from server/:
// `npx tsx test/stathead.mjs`.
import { crosswalkCoverage, statheadSportOf } from '../src/stathead.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

const xw = [
  { player_id: 'nhl-8478402', full_name: 'Connor McDavid', nhl_id: '8478402', sleeper_id: '5001' },
  { player_id: 'nba-3945274', full_name: 'Luka Doncic', espn_id: '3945274', sleeper_id: '1658' },
  { player_id: 'wnba-3917450', full_name: "A'ja Wilson", espn_id: '3917450', sleeper_id: null },
  { player_id: 'mlb-660271', full_name: 'Shohei Ohtani', mlb_id: '660271' },
];
const nhl = crosswalkCoverage('nhl', ['nhl-8478402', 'nhl-999'], xw);
ok(nhl.found.length === 1 && nhl.found[0].player_id === 'nhl-8478402' && nhl.missing.join() === 'nhl-999', 'NHL keys are the league id: a direct match, a miss reported');
const nba = crosswalkCoverage('nba', ['nba-1658', 'nba-7'], xw);
ok(nba.found.length === 1 && nba.found[0].player_id === 'nba-3945274' && nba.missing.join() === 'nba-7', 'NBA keys are Sleeper ids and resolve through the crosswalk to the ESPN-keyed player');
const wnba = crosswalkCoverage('wnba', ['wnba-3917450'], xw);
ok(wnba.found.length === 1 && wnba.found[0].player_id === 'wnba-3917450', 'WNBA keys are ESPN ids: a direct match');
const mlb = crosswalkCoverage('mlb', ['mlb-660271', 'nba-1658'], xw);
ok(mlb.found.length === 1 && mlb.missing.join() === 'nba-1658', 'a key of another sport never resolves');
ok(crosswalkCoverage('nhl', [], xw).found.length === 0 && crosswalkCoverage('nhl', ['nhl-1'], []).missing.join() === 'nhl-1', 'empty pool, empty crosswalk');
ok(statheadSportOf('epl') === 'epl', 'the six sport ids are shared');

console.log(fails ? `\n${fails} FAILED` : '\nall stathead checks passed');
process.exit(fails ? 1 : 0);
