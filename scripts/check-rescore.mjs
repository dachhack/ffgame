// THE COMMISSIONER'S RE-SCORE (0353) — the rules both screens and the worker
// share, pinned so a console cannot call a 0.04 wobble a change, read a tie as
// a win, or offer APPLY on a drip league the SQL would refuse.
import { readFileSync } from 'node:fs';
import { rescoreDiff, rescoreResult, rescoreHeadline, autofillWarning, winnerOf, sideLine } from '../packages/core/src/data/rescore';

let fails = 0;
const ok = (c, m, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${c || got === undefined ? '' : ` — got ${JSON.stringify(got)}`}`); if (!c) fails++; };

ok(!rescoreDiff({ home: 100, away: 90 }, { home: 100.04, away: 90 }).moved, 'a rounding wobble is not a change');
ok(rescoreDiff({ home: 100, away: 90 }, { home: 100.1, away: 90 }).moved, 'a tenth is');
ok(rescoreDiff({ home: 100, away: 98 }, { home: 97, away: 99.5 }).flipped, 'a new winner is a flip');
ok(!rescoreDiff({ home: 100, away: 98 }, { home: 99, away: 98 }).flipped, 'the same winner by less is not');
ok(rescoreDiff({ home: 100, away: 98 }, { home: 98, away: 98 }).flipped, 'a win becoming a tie is a flip');
const un = rescoreDiff({ home: null, away: null }, { home: 10, away: 12 });
ok(un.moved && !un.flipped, 'an unstamped final moves but cannot flip', un);
ok(winnerOf({ home: 1, away: null }) === null, 'no winner without both scores');
const r = rescoreResult([
  { id: 'a', home_roster_id: 1, away_roster_id: 2, was: { home: 100, away: 98 }, now: { home: 97, away: 99.5 } },
  { id: 'b', home_roster_id: 3, away_roster_id: 4, was: { home: 80, away: 90 }, now: { home: 80, away: 90 } },
], [{ roster_id: 4, team: 'Fours' }]);
ok(r.changed === 1 && r.flipped === 1, 'the result counts what moved and what flipped', r);
ok(rescoreHeadline(r, false) === '1 of 2 matchups would move, and 1 result would change hands.', 'preview headline', rescoreHeadline(r, false));
ok(rescoreHeadline(r, true) === '1 of 2 matchups moved, and 1 result changed hands.', 'applied headline', rescoreHeadline(r, true));
ok(rescoreHeadline(rescoreResult([r.matchups[1]]), false).startsWith('No change'), 'nothing to change says so');
ok(/Fours saved no lineup/.test(autofillWarning(r) ?? ''), 'the no-lineup seat is named');
ok(autofillWarning(rescoreResult([])) === null, 'no warning when every seat saved one');
ok(sideLine('A', 100, 100) === 'A 100.0' && sideLine('A', 100, 97) === 'A 100.0 → 97.0', 'a side line shows an arrow only when it moved');

// The SQL gates the consoles rely on.
const sql = readFileSync('supabase/migrations/0353_the_commissioner_rescores_a_week.sql', 'utf8');
ok(/game_mode', 'drip'\) <> 'classic'/.test(sql), 'the request refuses anything but classic');
ok(/interval '30 minutes'/.test(sql) && /'changed'\)::int, 0\) > 0/.test(sql), 'apply needs a fresh preview that found a change');
ok(/revoke all on function rescore_finish\(bigint, jsonb, text\) from public, anon, authenticated;/.test(sql)
  && /grant execute on function rescore_finish\(bigint, jsonb, text\) to service_role;/.test(sql), 'only the worker closes a request');
const worker = readFileSync('server/src/rescore.js', 'utf8');
ok(/dryRun: true/.test(worker) && /restamp: true, leagueId: r\.league_id/.test(worker), 'the worker previews dry and applies to one league');
ok(/game_mode \?\? 'drip'\) !== 'classic'/.test(worker), 'and refuses drip itself');

console.log(fails ? `\n${fails} FAILED` : '\nALL RESCORE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
