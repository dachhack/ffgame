// Guard for THE KICKER THAT WAS A WIDE RECEIVER (v0.474.0). Offline —
// check:parity.
//
// K and D/ST ride synthetic team-unit slugs — `bal-k`, `car-dst` — while the
// worker's player index is built from Sleeper's directory of real people and
// has never held an entry for one. `metaForSlug` answered null and
// `makePlayer` defaults a missing position to 'WR', so every kicker and every
// defense on a native roster was a wide receiver to the resolver.
//
// That broke exactly one thing and broke it silently: a best-ball K spot
// accepts only K and a best-ball D/ST spot only DEF, and the fill judges
// eligibility by that position. With every candidate mislabelled, those spots
// could never find anybody — they stayed empty and scored zero in the stored
// final, the weekly report, the standings and the seeding. A MANUAL K or D/ST
// pick still scored, which is why most leagues looked fine and only the one
// best-ball league was visibly short.
//
// The assertions below are the two halves of that sentence: the slug says what
// it is, and the resolver's own helper now asks.
import { slugMeta } from '../packages/core/src/data/slugMeta.ts';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

// ── the slug has always said what it is ──
ok(slugMeta('bal-k').pos === 'K', 'a `-k` slug is a KICKER');
ok(slugMeta('bal-k').team === 'BAL', '…and carries its team');
ok(slugMeta('car-dst').pos === 'DEF', 'a `-dst` slug is a DEFENSE');
ok(slugMeta('car-dst').team === 'CAR', '…and carries its team');
ok(slugMeta('sf-dst').pos === 'DEF' && slugMeta('sf-dst').team === 'SF',
  'a two-letter team resolves too — the suffix strip is by length, not by guess');
// The neutral answer for a genuinely unknown slug is unchanged, so nothing
// that relied on it moves.
ok(slugMeta('nobody-at-all').pos === 'WR',
  'an unknown slug still degrades to the same neutral WR it always did');

// ── and the resolver now asks it ──
const src = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
ok(/const meta = \(slug\) => playerIndex\?\.metaForSlug\(slug\) \?\? \(slug && !\(opts\.legacyTeamUnits && opts\.dryRun\) \? slugMeta\(slug\) : null\)/.test(src),
  'resolveMatchup falls back to slugMeta when the index has no entry');
// The diagnostic switch that turns the fallback off (v0.479.0) must be unable
// to reach a write: it is gated on dryRun inside the same expression, not by
// convention at the call site.
ok(/opts\.legacyTeamUnits && opts\.dryRun/.test(src),
  '…and the legacy WR rule can only ever apply to a dry run, never to a write');
ok(/import \{ slugMeta, normTeam \}/.test(src),
  '…using the import it already had');
// The landmine itself, named so nobody re-arms it by accident.
const eng = readFileSync(new URL('../server/src/engine.js', import.meta.url), 'utf8');
ok(/pos: pos \|\| 'WR'/.test(eng),
  "makePlayer's WR default is still there — the fix is to stop REACHING it, not to move it");

console.log(fails ? `\n${fails} TEAM-UNIT ASSERTION(S) FAILED` : '\nALL TEAM-UNIT ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
