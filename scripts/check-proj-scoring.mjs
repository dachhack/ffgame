// LEAGUE-AWARE PROJECTIONS (v0.308.0), checked in Node.
//
// This lives in check:parity because the whole point of the change is that the
// PROJECTED and the LIVE number on one board finally obey one rulebook. Two
// scorers disagreeing about a league's own rules is the failure this project
// keeps finding in different clothes — it doesn't error, and the league sees a
// number it cannot reproduce.
//
// The cases that earn their keep: the INVARIANT (a standard-catalog league is
// unchanged to the decimal, so shipping this moves nothing that was right), the
// catalog moving the right players and only them, the scoped layers landing in
// the order the live scorer applies them, and every no-data path falling back
// to the bake rather than to zero.
import { PROJ_2026 } from '../packages/core/src/data/proj2026';
import { PROJ_LINES } from '../packages/core/src/data/projStats2026';
import {
  projectedPoints, leagueProjRatio, projTdsPerWeek, scoreProjLine,
  setLeagueProjScoring, clearLeagueProjScoring,
} from '../packages/core/src/engine/projScoring';
import { setLeagueScoring, clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { DEFAULT_CLASSIC_SCORING } from '../packages/core/src/engine/classic';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const P = (id, pos) => ({ id, pos, team: null });
const QB = P('josh-allen', 'QB'), WR = P('jamarr-chase', 'WR');
const RB = P('jahmyr-gibbs', 'RB'), TE = P('brock-bowers', 'TE');

clearLeagueScoring(); clearLeagueProjScoring();

ok('the bake and the stat lines both loaded (else every case below is vacuous)',
  PROJ_2026.size > 400 && Object.keys(PROJ_LINES).length > 300,
  [PROJ_2026.size, Object.keys(PROJ_LINES).length]);

// ── THE INVARIANT ──────────────────────────────────────────────────────────
// A league on the standard catalog with no scoped rules must get exactly the
// baked number. This is what makes the change safe to ship: every league that
// was right stays right, to the decimal.
for (const p of [QB, WR, RB, TE]) {
  ok(`standard catalog leaves ${p.id} exactly as baked`,
    projectedPoints(p) === PROJ_2026.get(p.id), [projectedPoints(p), PROJ_2026.get(p.id)]);
}

// ── THE CATALOG MOVES THE RIGHT PLAYERS, AND ONLY THEM ─────────────────────
{
  setLeagueProjScoring({ passTd: 6 });                 // default 4
  const q = projectedPoints(QB), r = projectedPoints(RB);
  ok('a 6-point passing TD raises the QB', q > PROJ_2026.get(QB.id), q);
  ok('…and leaves a running back alone', r === PROJ_2026.get(RB.id), r);

  setLeagueProjScoring({ ppr: 0 });                    // default 1
  ok('standard (0 PPR) cuts a target-heavy receiver hard',
    projectedPoints(WR) < PROJ_2026.get(WR.id) * 0.75, projectedPoints(WR));
  ok('…and does not touch a QB who catches nothing',
    projectedPoints(QB) === PROJ_2026.get(QB.id));

  setLeagueProjScoring({ teRec: 0.5 });                // TE premium
  ok('a TE premium raises the tight end', projectedPoints(TE) > PROJ_2026.get(TE.id));
  ok('…and only the tight end', projectedPoints(WR) === PROJ_2026.get(WR.id));

  // A knob the stat line cannot see is not guessed at.
  setLeagueProjScoring({ rush100: 3 });
  ok('a milestone bonus the line cannot see leaves the projection alone',
    projectedPoints(RB) === PROJ_2026.get(RB.id) && leagueProjRatio(RB.id, 'RB') === 1);
  clearLeagueProjScoring();
}

// ── NO DATA MEANS NO ADJUSTMENT, NEVER ZERO ────────────────────────────────
{
  setLeagueProjScoring({ ppr: 0, passTd: 8 });
  ok('a player with no stat line keeps his baked projection',
    leagueProjRatio('probe-unknown-player', 'WR') === 1);
  // A kicker's line is all zeros: it scores nothing under either catalog, so
  // the ratio is undefined and must fall back rather than divide by zero.
  ok('an all-zero line falls back to 1 rather than dividing by zero',
    scoreProjLine({ passYd: 0, passTd: 0, int: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 },
      'K', DEFAULT_CLASSIC_SCORING) === 0);
  clearLeagueProjScoring();
}

// ── THE SCOPED LAYERS, IN THE LIVE SCORER'S ORDER ──────────────────────────
{
  const base = PROJ_2026.get(RB.id);
  setLeagueScoring({ scoped: [{ pos: ['RB'], bonusMult: 1.5 }] });
  ok('a scoped multiplier reaches the projection', near(projectedPoints(RB), base * 1.5),
    projectedPoints(RB));
  ok('…and not a player outside its scope', projectedPoints(WR) === PROJ_2026.get(WR.id));

  setLeagueScoring({ scoped: [{ pos: ['RB'], bonusPts: 3 }] });
  ok('flat points add', near(projectedPoints(RB), base + 3));

  // The per-TD bonus is the one that needed the stat line: it has to be paid
  // against PROJECTED touchdowns, per week.
  setLeagueScoring({ scoped: [{ pos: ['RB'], tdBonus: 2 }] });
  const tds = projTdsPerWeek(RB.id);
  ok('projected touchdowns per week are a real number', tds > 0 && tds < 3, tds);
  ok('a per-TD bonus pays against projected touchdowns',
    near(projectedPoints(RB), base + 2 * tds), [projectedPoints(RB), base + 2 * tds]);

  // THE SPOT. A rule scoped to a lineup spot pays in that spot and nowhere
  // else — the same contract the live scorer follows.
  setLeagueScoring({ scoped: [{ slot: ['S7'], bonusMult: 2 }] });
  ok('a spot-scoped rule pays in its spot', near(projectedPoints(RB, 'S7'), base * 2));
  ok('…and not in another spot', projectedPoints(RB, 'S2') === base);
  ok('…and not outside a lineup at all', projectedPoints(RB) === base);
  clearLeagueScoring();
}

// ── THE CATALOG AND THE SCOPED RULES COMPOSE ───────────────────────────────
{
  setLeagueProjScoring({ ppr: 0 });
  setLeagueScoring({ scoped: [{ pos: ['WR'], bonusMult: 2 }] });
  const ratio = leagueProjRatio(WR.id, 'WR');
  ok('catalog then scoped, in that order',
    near(projectedPoints(WR), PROJ_2026.get(WR.id) * ratio * 2), projectedPoints(WR));
  clearLeagueScoring(); clearLeagueProjScoring();
  ok('and clearing both restores the bake', projectedPoints(WR) === PROJ_2026.get(WR.id));
}

if (fails) { console.log(`\n${fails} PROJ-SCORING ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PROJ-SCORING ASSERTIONS PASSED');
