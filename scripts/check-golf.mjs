// GOLF MODE + THE ZERO-FILL RULE (v0.303.0), checked in Node.
//
// This lives in check:parity because golf is a setting that inverts the meaning
// of a number the WORKER writes and the BOARD draws, and the two have to agree
// about it to the decimal. A board that renders "you're ahead" over a total the
// resolver will score as a loss is the worst class of bug this project can
// ship: nothing errors, and the league sees a result it cannot reproduce.
//
// The cases that earn their keep: the zero-fill fires on an empty spot and on a
// scoreless one and NOWHERE ELSE; it is never paid before the spot is settled;
// golf inverts what "best lineup" means without touching a single score; and a
// league with neither setting is bit-for-bit what it was before this existed.
import { readFileSync } from 'node:fs';
import { classicSlotsFromSpec, resolveClassicMatchup, optimalLineup } from '../packages/core/src/engine/classic';
import { buildMatchupBoard } from '../packages/core/src/engine/matchupBoard';
import { setLeagueGolf, clearLeagueGolf, leagueIsGolf, betterScore, golfValue, zeroFill } from '../packages/core/src/engine/golf';
import { clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { installRealWeek } from '../packages/core/src/data/realPbp';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const WEEK = 1;
installRealWeek(WEEK, JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url))));
clearLeagueScoring();
clearLeagueGolf();

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });
const RB = mk('saquon-barkley', 'RB', 'PHI');
const QB = mk('josh-allen', 'QB', 'BUF');
// A real slug the week-1 bake has nothing for, so he genuinely scores zero.
const GHOST = mk('probe-ghost-player', 'RB', 'KC');

const spec = (a, b) => classicSlotsFromSpec([a, b]);
const side = (picks, roster) => ({ picks, roster, hasLineup: true, bestball: [] });

// ── THE ZERO-FILL FIRES ON AN EMPTY SPOT ───────────────────────────────────
{
  const slots = spec({ pos: ['QB'] }, { pos: ['RB'], zero_pts: 10 });
  ok('the spec carries the rule to the slot', slots[1].zeroPts === 10 && slots[0].zeroPts === undefined,
    slots.map((d) => d.zeroPts));
  const r = resolveClassicMatchup(
    side([{ slot: 'S1', player: QB }], [QB]),      // S2 left EMPTY
    side([{ slot: 'S1', player: QB }], [QB]),
    WEEK, { ppr: 1 }, slots);
  const qbOnly = resolveClassicMatchup(
    side([{ slot: 'S1', player: QB }], [QB]), side([{ slot: 'S1', player: QB }], [QB]),
    WEEK, { ppr: 1 }, spec({ pos: ['QB'] }, { pos: ['RB'] })).home;
  ok('an UNFILLED spot with the rule banks its points', near(r.home, qbOnly + 10), { got: r.home, qbOnly });
  ok('…and it produces a row, with no player in it',
    r.slots.some((x) => x.side === 'home' && x.slot === 'S2' && x.slug === null && x.score === 10),
    r.slots.filter((x) => x.side === 'home'));
}

// ── AND ON A SPOT WHOSE PLAYER SCORED NOTHING ──────────────────────────────
{
  const slots = spec({ pos: ['QB'] }, { pos: ['RB'], zero_pts: 10 });
  const r = resolveClassicMatchup(
    side([{ slot: 'S1', player: QB }, { slot: 'S2', player: GHOST }], [QB, GHOST]),
    side([{ slot: 'S1', player: QB }], [QB]),
    WEEK, { ppr: 1 }, slots);
  const row = r.slots.find((x) => x.side === 'home' && x.slot === 'S2');
  ok('a player who scored nothing takes the fill, and keeps his name on the row',
    row?.score === 10 && row?.slug === GHOST.id, row);
}

// ── AND NOWHERE ELSE ───────────────────────────────────────────────────────
{
  const withRule = spec({ pos: ['RB'], zero_pts: 10 }, { pos: ['QB'] });
  const without = spec({ pos: ['RB'] }, { pos: ['QB'] });
  const play = (slots) => resolveClassicMatchup(
    side([{ slot: 'S1', player: RB }, { slot: 'S2', player: QB }], [RB, QB]),
    side([{ slot: 'S2', player: QB }], [QB]), WEEK, { ppr: 1 }, slots).home;
  ok('a spot whose player SCORED is untouched by the rule', near(play(withRule), play(without)),
    { withRule: play(withRule), without: play(without) });
  const none = spec({ pos: ['QB'] }, { pos: ['RB'] });
  const r = resolveClassicMatchup(
    side([{ slot: 'S1', player: QB }], [QB]), side([{ slot: 'S1', player: QB }], [QB]),
    WEEK, { ppr: 1 }, none);
  ok('an empty spot with NO rule still produces nothing',
    !r.slots.some((x) => x.slot === 'S2'), r.slots.map((x) => x.slot));
}

// ── A BEST-BALL SPOT CANNOT CARRY THE RULE ─────────────────────────────────
{
  const slots = classicSlotsFromSpec([{ pos: ['RB'], zero_pts: 10, bb: true }]);
  ok('the spec drops a zero-fill from a best-ball spot — the two are mutually exclusive',
    slots[0].zeroPts === undefined, slots[0]);
}

// ── SETTLED-ONLY, ON A LIVE BOARD ──────────────────────────────────────────
// The resolver runs on finals, so it always pays. The BOARD must not pay a
// player who is still on the field at zero — a total that walks backwards when
// he catches a pass is worse than one that arrives late.
{
  const slots = spec({ pos: ['RB'], zero_pts: 10 }, { pos: ['QB'], zero_pts: 10 });
  const entry = (live, proj, state) => ({ slug: 'x', name: 'X', pos: 'RB', team: 'KC', live, proj, state, kickoff: null, opponent: null, injury: null, roof: null, primetime: false });
  const mkSide = (starters) => ({ rosterId: 1, team: 'T', avatar: null, starters, bench: [], ir: [], taxi: [], record: null });
  const b = buildMatchupBoard({
    week: WEEK, locked: true, slots, labelFor: (d) => d.slot,
    home: mkSide({ S1: entry(0, 12, 'live'), S2: entry(0, 8, 'done') }),
    away: mkSide({ S1: entry(5, 5, 'done'), S2: null }),
  });
  ok('a player still playing at zero is NOT paid the fill yet', near(b.home.live, 10), b.home.live);
  ok('…and one whose game is DONE at zero is', b.home.live === 10 && b.away.live === 15,
    { home: b.home.live, away: b.away.live });
  ok('an EMPTY spot is settled from the first whistle', near(b.away.live, 15), b.away.live);
  ok('the projection uses the fill only where the projection is zero', near(b.home.projected, 22),
    b.home.projected);
}

// ── GOLF INVERTS WHO IS AHEAD, AND NOTHING ELSE ────────────────────────────
{
  const slots = spec({ pos: ['RB'] }, { pos: ['QB'] });
  const home = side([{ slot: 'S1', player: RB }], [RB]);
  const away = side([{ slot: 'S2', player: QB }], [QB]);
  clearLeagueGolf();
  const normal = resolveClassicMatchup(home, away, WEEK, { ppr: 1 }, slots);
  setLeagueGolf(true);
  const golf = resolveClassicMatchup(home, away, WEEK, { ppr: 1 }, slots);
  ok('golf changes not one point of the score itself',
    near(normal.home, golf.home) && near(normal.away, golf.away),
    { normal: [normal.home, normal.away], golf: [golf.home, golf.away] });
  ok('…only which of them is winning', betterScore(1, 2) && !betterScore(2, 1) && leagueIsGolf());
  clearLeagueGolf();
  ok('and off again, the bigger number wins', betterScore(2, 1) && !betterScore(1, 2));
  ok('a tie is nobody’s win, either way',
    !betterScore(5, 5) && (setLeagueGolf(true), !betterScore(5, 5)));
  clearLeagueGolf();
}

// ── GOLF INVERTS WHAT "BEST LINEUP" MEANS ──────────────────────────────────
{
  const slots = spec({ pos: ['RB'] }, { pos: ['RB'] });
  const a = { id: 'a', pos: 'RB', team: 'KC' }, b = { id: 'b', pos: 'RB', team: 'KC' }, c = { id: 'c', pos: 'RB', team: 'KC' };
  const value = { a: 20, b: 10, c: 3 };
  clearLeagueGolf();
  const hi = optimalLineup(slots, [a, b, c], (p) => value[p.id]).spots.map((s) => s.player?.id);
  ok('a normal league starts the two biggest', hi.join() === 'a,b', hi);
  setLeagueGolf(true);
  const lo = optimalLineup(slots, [a, b, c], (p) => value[p.id]).spots.map((s) => s.player?.id);
  ok('a golf league starts the two smallest', lo.join() === 'c,b', lo);
  const withZero = optimalLineup(slots, [a, b, { id: 'z', pos: 'RB', team: 'KC' }], (p) => value[p.id] ?? 0)
    .spots.map((s) => s.player?.id);
  ok('a player worth ZERO is not a low score, it is an absence — he sits behind everyone',
    withZero.join() === 'b,a', withZero);
  clearLeagueGolf();
}

// ── THE PRIMITIVES ─────────────────────────────────────────────────────────
{
  clearLeagueGolf();
  ok('golfValue is the identity in a normal league', golfValue(7) === 7 && golfValue(0) === 0);
  setLeagueGolf(true);
  ok('…and orders smaller-is-better in golf', golfValue(3) > golfValue(9) && golfValue(0) < golfValue(9));
  clearLeagueGolf();
  ok('zeroFill without a rule is the identity', zeroFill(0) === 0 && zeroFill(4, null) === 4);
  ok('zeroFill pays only a settled zero',
    zeroFill(0, 10) === 10 && zeroFill(0, 10, false) === 0 && zeroFill(4, 10) === 4);
}

// ── THE WORKER HAS TO KNOW TOO ─────────────────────────────────────────────
// This is the assertion that would have caught v0.303.0's real gap: the boards
// installed golf and the worker never did, so a golf league's auto-slot and
// seat agents would have set the HIGHEST-scoring lineup while the board it sits
// under previewed the lowest. Every worker path reads the league through
// `modeOfSettings`, so the flag surviving that mapper is the one property that
// makes the rest reachable.
{
  const { modeOfSettings } = await import('../server/src/resolve.js');
  const on = modeOfSettings({ game_mode: 'classic', golf: true });
  const off = modeOfSettings({ game_mode: 'classic' });
  ok('the worker\u2019s league mapper carries the golf flag', on.golf === true, on);
  ok('\u2026and defaults it to false rather than undefined', off.golf === false, off);
}

if (fails) { console.log(`\n${fails} GOLF ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL GOLF ASSERTIONS PASSED');
