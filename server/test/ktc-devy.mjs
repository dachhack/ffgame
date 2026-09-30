// KTC devy board parsing (0400). Fixture is a trimmed copy of the real
// /devy-rankings row markup; no network.
import { parseKtcDevy, loadKtcDevy, statheadDevyRows, loadDevyBoard } from '../src/poll/ktcDevy.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const row = (rank, slug, name, team, pos, value) => `<div class="onePlayer">
  <div class="single-ranking-wrapper"><div class="single-ranking">
    <div class="rank-number">
        <p>${rank}</p>
    </div>
    <div class="player-name"><p>
        <a href="/devy-rankings/players/${slug}" target="_blank">${name}</a><span class="player-team">${team}</span>
    </p></div>
    <div class="position-team"><p class="position">${pos}</p></div>
    <div class="player-info"><p class="position">Tier 1</p></div>
    <div class="trend"><p class=" trend-down">4</p></div>
    <div class="value">
        <p>${value}</p>
    </div>
  </div></div>`;

const page0 = row(1, 'jeremiah-smith-1', 'Jeremiah Smith', 'OSU', 'WR1', 9999)
  + row(15, 'treydez-green-2', 'Trey&#39;Dez Green', 'LSU', 'TE1', 4230)
  + row(16, 'some-kicker-3', 'Some Kicker', 'ALA', 'PK1', 100);
const rows = parseKtcDevy(page0);
ok(rows.length === 2, `skill players kept, the kicker dropped (got ${rows.length})`);
ok(rows[0].name === 'Jeremiah Smith' && rows[0].pos === 'WR' && rows[0].school === 'OSU' && rows[0].rank === 1 && rows[0].value === 9999,
  'rank, name, position (without its number), school and value');
ok(rows[1].name === "Trey'Dez Green", 'HTML entities in names are decoded');

const pages = [page0, row(101, 'x-4', 'Kam Davis', 'UGA', 'RB40', 12), '<html>no rows</html>'];
let asked = 0;
const all = await loadKtcDevy(async () => pages[asked++]);
ok(all.length === 3 && asked === 3, `pages are read until one comes back empty (${all.length} rows, ${asked} pages)`);

// ── stathead's file (v0.570.2) ──
const sh = [
  { playerID: 2, playerName: 'Malachi Toney', position: 'WR', team: 'MIAMI', value: 6658, superflexValue: 7487 },
  { playerID: 1, playerName: 'Jeremiah Smith', position: 'WR', team: 'OSU', value: 9997, superflexValue: 9999 },
  { playerID: 3, playerName: 'A Kicker', position: 'K', team: 'ALA', value: 50 },
];
const shRows = statheadDevyRows(sh);
ok(shRows.length === 2 && shRows[0].name === 'Jeremiah Smith' && shRows[0].rank === 1 && shRows[1].rank === 2,
  'stathead rows are ranked by 1QB value, kickers dropped');
ok(shRows[1].school === 'MIAMI' && shRows[1].value === 6658, 'team → school, 1QB value kept');
const many = Array.from({ length: 30 }, (_, i) => ({ playerName: `P ${i}`, position: 'RB', team: 'X', value: 1000 - i }));
let scraped = 0;
const viaSh = await loadDevyBoard(() => {}, async () => many, async () => { scraped++; return ''; });
ok(viaSh.length === 30 && scraped === 0, 'stathead first: a full file means KTC is not read');
const viaKtc = await loadDevyBoard(() => {}, async () => { throw new Error('404'); }, async () => (scraped++ === 0 ? page0 : ''));
ok(viaKtc.length === 2 && scraped === 2, 'a missing stathead file falls back to KTC\'s page');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL KTC-DEVY TESTS PASSED');
