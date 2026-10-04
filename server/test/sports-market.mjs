// The sport market's pure parts (v0.627.0): the ADP pages, ESPN's calendar,
// the team aliases and the name match. Run: `npx tsx test/sports-market.mjs`.
import { readFileSync } from 'node:fs';
import { parseFantasyProsAdp, espnCalendar, espnSeasonId, feedTeam, matchAdp } from '../src/poll/sportMarket.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const fx = (f) => readFileSync(new URL(`./fixtures/sports/${f}`, import.meta.url), 'utf8');

for (const [sport, first, team, pos] of [['nba', 'Nikola Jokic', 'DEN', 'C'], ['nhl', 'Nathan MacKinnon', 'COL', 'C'], ['mlb', 'Shohei Ohtani', 'LAD', 'SP']]) {
  const rows = parseFantasyProsAdp(fx(`fp-adp-${sport}.html`), sport);
  ok(rows.length === 40, `${sport}: 40 rows parsed (${rows.length})`);
  ok(rows[0].name === first && rows[0].team === team && rows[0].pos[0] === pos, `${sport}: the first row is ${first} ${team} ${pos} (${rows[0].name} ${rows[0].team} ${rows[0].pos})`);
  ok(rows.every((r) => Number.isFinite(r.adp) && r.adp > 0) && rows[0].adp <= rows[39].adp, `${sport}: every row has an ADP and the first is earliest (${rows[0].adp} → ${rows[39].adp})`);
  ok(rows.every((r) => /^[A-Z]{2,4}$/.test(r.team)), `${sport}: every team is a 2–4 letter code`);
}
const nhl = parseFantasyProsAdp(fx('fp-adp-nhl.html'), 'nhl');
ok(nhl.some((r) => r.team === 'TBL') && !nhl.some((r) => r.team === 'TB'), 'NHL: TB reads as the feed\'s TBL');
ok(parseFantasyProsAdp(fx('fp-adp-mlb.html'), 'mlb')[0].pos.join('/') === 'SP/DH', 'MLB: a two-way player keeps both positions');
ok(parseFantasyProsAdp('<html>nothing</html>', 'nba').length === 0, 'a page without the table yields no rows');

ok(feedTeam('nhl', 'nj') === 'NJD' && feedTeam('nba', 'GS') === 'GSW' && feedTeam('mlb', 'ChW') === 'CWS' && feedTeam('mlb', 'Ari') === 'AZ' && feedTeam('nba', 'BOS') === 'BOS', 'team aliases → feed tricodes; unknown codes pass upper-cased');
ok(espnSeasonId('nba', '2026') === 2027 && espnSeasonId('nhl', '2026') === 2027 && espnSeasonId('mlb', '2026') === 2026, 'ESPN names NBA/NHL seasons by the year they end');

for (const [g, sport] of [['fhl', 'nhl'], ['fba', 'nba'], ['flb', 'mlb']]) {
  const cal = espnCalendar(JSON.parse(fx(`espn-schedule-${g}.json`)), sport);
  ok(cal.length > 0 && cal.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.gameDate) && x.home !== x.away && /^[A-Z]{2,4}$/.test(x.home)), `${sport}: calendar rows have ET dates and feed teams (${cal.length} games, first ${cal[0]?.gameDate} ${cal[0]?.away}@${cal[0]?.home})`);
  ok(new Set(cal.map((x) => x.srcId)).size === cal.length, `${sport}: each game once, though the payload lists it under both teams`);
}
const nhlCal = espnCalendar(JSON.parse(fx('espn-schedule-fhl.json')), 'nhl');
ok(nhlCal.some((x) => x.home === 'NJD' || x.away === 'NJD') && !nhlCal.some((x) => x.home === 'NJ' || x.away === 'NJ'), 'NHL calendar: ESPN\'s NJ is the feed\'s NJD');

// the match: exact name+team, surname+initial on the team, then a unique name
const dir = [
  { player_key: 'nhl-1', full_name: 'Nathan MacKinnon', team: 'COL', alt_ids: null },
  { player_key: 'nhl-2', full_name: 'Connor McDavid', team: 'EDM', alt_ids: null },
  { player_key: 'nhl-3', full_name: 'Nikita Kucherov', team: 'TBL', alt_ids: null },
  { player_key: 'nhl-4', full_name: 'Sebastian Aho', team: 'CAR', alt_ids: null },
  { player_key: 'nhl-5', full_name: 'Sebastian Aho', team: 'NYI', alt_ids: null },
  { player_key: 'nhl-6', full_name: 'Macklin Celebrini', team: 'SJS', alt_ids: null },
];
const m = matchAdp([
  { name: 'Nathan MacKinnon', team: 'COL', adp: 1.5 }, { name: 'C. McDavid', team: 'EDM', adp: 1.5 },
  { name: 'Nikita Kucherov', team: 'TBL', adp: 3.5 }, { name: 'Sebastian Aho', team: 'CAR', adp: 40 },
  { name: 'Macklin Celebrini', team: 'BOS', adp: 3.5 }, { name: 'Nobody Here', team: 'COL', adp: 200 },
  { name: 'Sebastian Aho', team: 'PHI', adp: 300 },
], dir);
ok(m.rows.length === 5 && m.rows.find((r) => r.key === 'nhl-2')?.adp === 1.5, 'surname + initial on the team matches');
ok(m.rows.find((r) => r.key === 'nhl-6')?.adp === 3.5, 'a unique name matches even on the wrong team (a trade the page missed)');
ok(m.rows.find((r) => r.key === 'nhl-4')?.adp === 40 && !m.rows.find((r) => r.key === 'nhl-5'), 'a shared name needs the team; the second Aho on a third team is dropped');
ok(m.unmatched.length === 2, `the rest are reported (${m.unmatched.map((u) => u.name).join(', ')})`);

console.log(fails ? `\n${fails} FAILED` : '\nall sport market checks passed');
if (fails) process.exit(1);
