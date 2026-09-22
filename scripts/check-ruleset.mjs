// Guard for WHOSE RULES ARE LOADED (v0.473.0). Offline — check:parity.
//
// Founder, reading the new league summaries: "Are we applying all of the league
// scoring adjustments in the report and matchup summary?" The report and the
// summaries do not score at all — they read totals the resolver already
// computed — so the answer there is yes by construction. The place that DOES
// score, and the place the question turned out to be about, is the live board.
//
// Two things went wrong there and both are silent, which is why they get
// assertions rather than a comment:
//
//   1. THE SCORING CACHE HAD NO OWNER. `setLeagueFlags` has always recorded
//      which league its rows belong to; `setLeagueScoring` recorded nothing, so
//      a board could score league B's players under league A's adjustments for
//      as long as B's fetch took, then settle on a different number.
//
//   2. `ppr` HAS TWO HOMES and the two sides picked different winners — the
//      clients asked `leagueCatalogOf` (catalog last, so a deliberately-set
//      catalog value wins), the server spread `ppr` last (settings_json wins).
//      A league whose copies disagree was scored one way and displayed another.
import {
  setLeagueScoring, clearLeagueScoring, scoringLeague, leagueScoring,
} from '../packages/core/src/engine/leagueScoring.ts';
import { leagueCatalogOf } from '../packages/core/src/engine/projScoring.ts';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

// ── 1. the cache knows whose rules it holds ──
clearLeagueScoring();
ok(scoringLeague() === null, 'a cleared cache speaks for nobody');
setLeagueScoring({ tdBonus: 2 }, 'league-A');
ok(scoringLeague() === 'league-A', 'an install records the league it is for');
ok(leagueScoring().tdBonus === 2, '…and the adjustments themselves still land');
setLeagueScoring({ tdBonus: 5 }, 'league-B');
ok(scoringLeague() === 'league-B' && leagueScoring().tdBonus === 5,
  'a second install replaces both the rules and the owner');
clearLeagueScoring();
ok(scoringLeague() === null && leagueScoring().tdBonus === 0,
  'clearing drops the owner too — a stale name over default rules is its own lie');
// An install with no league is still allowed (tests, the sim), and answers
// null rather than pretending to be whichever league asked last.
setLeagueScoring({ tdBonus: 1 });
ok(scoringLeague() === null, 'an install that does not say answers null, not the previous league');
clearLeagueScoring();

// ── 2. both boards refuse to score under someone else's rules ──
for (const [name, path] of [
  ['app', '../apps/mobile/src/ui/ClassicBoard.tsx'],
  ['web', '../src/screens/ClassicBoard.tsx'],
]) {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  ok(src.includes('scoringLeague()') && src.includes('flagsLeague()'),
    `${name} board asks BOTH caches whose rules they hold`);
  ok(/rulesReady/.test(src), `${name} board has a rules-ready gate`);
  ok(/state === 'loading' \|\| !rulesReady/.test(src),
    `${name} board waits on that gate before it paints a score`);
  // The install has to say who it is for, or the gate can never open.
  ok(/setLeagueScoring\(parseScoring\(sc\), [\w.?]+\)/.test(src),
    `${name} board names the league when it installs scoring`);
}

// ── 3. one rule for which ppr wins ──
ok(leagueCatalogOf({ ppr: 1, scoring: { ppr: 0.5 } }).ppr === 0.5,
  'a deliberately-set catalog ppr beats settings_json — the 0209 rule');
ok(leagueCatalogOf({ ppr: 0.5, scoring: {} }).ppr === 0.5,
  '…and with no catalog copy, settings_json is what there is');
ok(leagueCatalogOf({ ppr: null, scoring: { ppr: 1 } }).ppr === 1,
  '…and a null settings_json ppr does not erase the catalog');
{
  // The server must ask that function rather than spreading ppr itself, which
  // is the shape that disagreed with the clients.
  const src = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
  ok(src.includes('leagueCatalogOf(gameMode)'),
    'the resolver builds its classic catalog with leagueCatalogOf');
  ok(!/ppr: gameMode\.ppr/.test(src),
    'and no longer spreads `ppr: gameMode.ppr` last, which made settings_json win');
  ok(/setLeagueScoring\(scoringKnobs, matchup\.league_id\)/.test(src),
    'the resolver names the league on every scoring install too');
}

console.log(fails ? `\n${fails} RULESET ASSERTION(S) FAILED` : '\nALL RULESET ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
