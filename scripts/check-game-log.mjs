// THE GAME LOG, checked in Node — and specifically that it agrees with the
// BOARD to the decimal, every week of the season.
//
// This lives in check:parity because the log is the second consumer of the
// classic scorer, reached by a different route: the board scores from the
// engine's play cache (week-major, installed one week at a time), the card
// scores from the baked season (player-major, all fourteen weeks at once). A
// log that quoted a week differently than the matchup that played it would be
// a lie nobody could catch by eye — the numbers are plausible either way.
//
// Since v0.285.0 the log's source is public/pbp/season.json, so the re-pivot
// itself is under test here: if genSeasonLog.mjs ever drops a field a scorer
// reads, the week-by-week agreement below is what notices.
import { readFileSync } from 'node:fs';
import { installRealWeek } from '../packages/core/src/data/realPbp';
import { classicPoints } from '../packages/core/src/engine/classic';
import { buildGameLog } from '../packages/core/src/data/gameLog';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const rd = (f) => JSON.parse(readFileSync(new URL(`../public/pbp/${f}`, import.meta.url)));
const season = rd('season.json');

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });
/** The season as the CARD reads it: playerSeasonLog's output for one slug. */
const logRows = (slug) => Object.fromEntries(
  Object.entries(season.pbp[slug] ?? {}).map(([w, plays]) => [Number(w), plays]));

// ── THE BAKE COVERS THE SEASON ─────────────────────────────────────────────
// The bug this whole version fixes: a card that showed one week because its
// source held one week. If the re-pivot ever loses weeks, it fails here first.
ok('the season log is version 1', season.v === 1, season.v);
ok('the season log carries all fourteen weeks',
  season.weeks.length === 14 && season.weeks[0] === 1 && season.weeks[13] === 14, season.weeks);
ok('every week file has a matching week in the bake',
  season.weeks.every((w) => Object.values(season.pbp).some((byWeek) => byWeek[String(w)]?.length)), season.weeks);
ok('the bake holds hundreds of players, not a handful', Object.keys(season.pbp).length > 300, Object.keys(season.pbp).length);

const CASES = [
  ['saquon-barkley', 'RB', 'PHI'],
  ['josh-allen', 'QB', 'BUF'],
  ['jamarr-chase', 'WR', 'CIN'],
];
const SCORING = { ppr: 1 };

// ── THE LOG AGREES WITH THE BOARD, WEEK BY WEEK ────────────────────────────
// Every week the bake has, scored both ways: the board off its installed play
// cache, the card off the re-pivot. Fourteen weeks × three players is the
// assertion that earns this script's place in the battery.
for (const w of season.weeks) installRealWeek(w, rd(`w${w}.json`));

for (const [slug, pos, team] of CASES) {
  const log = buildGameLog({ id: slug, name: slug, pos, team }, logRows(slug), SCORING);
  ok(`${slug}: the log runs the whole season, not one week`, log.length >= 10, log.length);
  const off = log.filter((r) => !near(r.points, classicPoints(mk(slug, pos, team), r.week, SCORING)));
  ok(`${slug}: every week agrees with the board to the decimal`, off.length === 0,
    off.map((r) => ({ week: r.week, log: r.points, board: classicPoints(mk(slug, pos, team), r.week, SCORING) })));
  ok(`${slug}: every week carries a statline`, log.every((r) => typeof r.line === 'string' && r.line.length > 0));
  ok(`${slug}: he played somewhere other than week 1`, log.some((r) => r.week > 1 && !r.blank), log.map((r) => r.week));
}

// ── THE LEAGUE'S OWN RULES MOVE THE NUMBER ─────────────────────────────────
// A log printed under default scoring in a league that doesn't use it is the
// whole point of the feature, so prove the table actually reaches it.
{
  const player = { id: 'saquon-barkley', name: 'saquon-barkley', pos: 'RB', team: 'PHI' };
  const rows = logRows('saquon-barkley');
  const total = (sc) => buildGameLog(player, rows, sc).reduce((n, r) => n + r.points, 0);
  const base = total({ ppr: 1 });
  ok('a league that pays 12 per rushing TD scores higher than one paying 6', total({ ppr: 1, rushTd: 12 }) > base);
  ok('zeroing rush yards lowers it', total({ ppr: 1, rushYd: 0 }) < base);
  ok('…and the board agrees with the same table, week 1',
    near(buildGameLog(player, rows, { ppr: 1, rushTd: 12 })[0].points,
      classicPoints(mk('saquon-barkley', 'RB', 'PHI'), 1, { ppr: 1, rushTd: 12 })));
}

// ── DRIP: a statline, and NO points ────────────────────────────────────────
{
  const log = buildGameLog({ id: 'josh-allen', name: 'josh-allen', pos: 'QB', team: 'BUF' }, logRows('josh-allen'), null);
  ok('a drip league prints no points column', log.every((r) => r.points === null));
  ok('…but still prints the statline', log[0].line.length > 0, log[0].line);
}

// ── A WEEK HE DIDN'T PLAY ──────────────────────────────────────────────────
{
  const log = buildGameLog({ id: 'saquon-barkley', name: 'saquon-barkley', pos: 'RB', team: 'PHI' }, { 7: [] }, { ppr: 1 });
  ok('an empty week is marked blank and scores zero', log[0].blank === true && log[0].points === 0, log[0]);
}

if (fails) { console.log(`\n${fails} GAME-LOG ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL GAME-LOG ASSERTIONS PASSED');
