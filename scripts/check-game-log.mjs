// THE GAME LOG (v0.284.0), checked in Node — and specifically that it agrees
// with the BOARD to the decimal.
//
// This lives in check:parity because the log is the second consumer of the
// classic scorer, reached by a different route: the board scores from the
// engine's play cache, the card scores from rows it fetched itself. A log that
// quoted a week differently than the matchup that played it would be a lie
// nobody could catch by eye — the numbers are plausible either way.
//
// The cases that earn their keep: the two routes agreeing over a real week, the
// league's OWN scoring actually moving the log's number, and drip's rule that a
// league with no classic table prints a statline and no points.
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

const WEEK = 1;
const w = JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url)));
installRealWeek(WEEK, w);

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });

// The baked week as the CARD would have fetched it: rows out of the same
// source, keyed by week, in live_play's column shape.
const rowsFor = (slug) => ({
  [WEEK]: (w.pbp[slug] ?? []).map((p) => ({
    player_slug: slug, c: p.c, t: p.t ?? null, pid: p.pid ?? null, k: p.k, y: p.y, td: p.td ?? 0,
    ca: p.ca ?? 0, tg: p.tg ?? 0, to: p.to ?? null, fd: p.fd ?? null, cp: p.cp ?? null, ic: p.ic ?? null,
    sk: p.sk ?? null, rk: p.rk ?? null, tt: p.tt ?? null, hf: p.hf ?? null, p6: p.p6 ?? null,
  })),
});

const CASES = [
  ['saquon-barkley', 'RB', 'PHI'],
  ['josh-allen', 'QB', 'BUF'],
];
const SCORING = { ppr: 1 };

for (const [slug, pos, team] of CASES) {
  const player = mk(slug, pos, team);
  const board = classicPoints(player, WEEK, SCORING);          // the board's route (play cache)
  const log = buildGameLog({ id: slug, name: slug, pos, team }, rowsFor(slug), SCORING);
  ok(`${slug}: the log has the week`, log.length === 1 && log[0].week === WEEK, log);
  ok(`${slug}: the log agrees with the board to the decimal`, near(log[0].points, board), { log: log[0].points, board });
  ok(`${slug}: the week carries a statline`, typeof log[0].line === 'string' && log[0].line.length > 0, log[0].line);
  ok(`${slug}: the week is not blank`, log[0].blank === false);
}

// ── THE LEAGUE'S OWN RULES MOVE THE NUMBER ─────────────────────────────────
// A log printed under default scoring in a league that doesn't use it is the
// whole point of the feature, so prove the table actually reaches it.
{
  const player = { id: 'saquon-barkley', name: 'saquon-barkley', pos: 'RB', team: 'PHI' };
  const base = buildGameLog(player, rowsFor('saquon-barkley'), { ppr: 1 })[0].points;
  const rich = buildGameLog(player, rowsFor('saquon-barkley'), { ppr: 1, rushTd: 12 })[0].points;
  ok('a league that pays 12 per rushing TD scores higher than one paying 6', rich > base, { base, rich });
  const flat = buildGameLog(player, rowsFor('saquon-barkley'), { ppr: 1, rushYd: 0 })[0].points;
  ok('zeroing rush yards lowers it', flat < base, { base, flat });
  ok('…and the board agrees with the same table',
    near(rich, classicPoints(mk('saquon-barkley', 'RB', 'PHI'), WEEK, { ppr: 1, rushTd: 12 })));
}

// ── DRIP: a statline, and NO points ────────────────────────────────────────
{
  const log = buildGameLog({ id: 'josh-allen', name: 'josh-allen', pos: 'QB', team: 'BUF' }, rowsFor('josh-allen'), null);
  ok('a drip league prints no points column', log[0].points === null);
  ok('…but still prints the statline', log[0].line.length > 0, log[0].line);
}

// ── A WEEK HE DIDN'T PLAY ──────────────────────────────────────────────────
{
  const log = buildGameLog({ id: 'saquon-barkley', name: 'saquon-barkley', pos: 'RB', team: 'PHI' }, { 7: [] }, { ppr: 1 });
  ok('an empty week is marked blank and scores zero', log[0].blank === true && log[0].points === 0, log[0]);
}

if (fails) { console.log(`\n${fails} GAME-LOG ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL GAME-LOG ASSERTIONS PASSED');
