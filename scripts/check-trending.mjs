// Guard for THE TRENDING BOARD (0340). Offline — check:parity.
//
// The network half is not assertable here and does not need to be; what needs
// pinning is the MERGE and the ID RULE, because both are silent when wrong: a
// board that drops the drops feed reads as a recommendation, and a defense
// filed under 'TB' rather than 'tb-dst' simply never appears on a screen that
// keys by slug.
import { trendRows } from '../server/src/poll/trending.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

// A stand-in for the worker's player index: sleeper id → { slug }.
const idx = { sleeper: (id) => ({ '11435': { slug: 'emanuel-wilson' }, '9228': { slug: 'bryce-young' } })[id] ?? null };

{
  const rows = trendRows(
    [{ player_id: '11435', count: 1507383 }, { player_id: '9228', count: 770216 }],
    [{ player_id: '9228', count: 40000 }, { player_id: '10213', count: 335502 }],
    idx);
  const by = Object.fromEntries(rows.map((r) => [r.sleeper_id, r]));

  ok(rows.length === 3, `one row per player across both feeds, not one per feed entry (${rows.length})`);
  ok(by['11435'].adds === 1507383 && by['11435'].drops === 0,
    'a player only being added carries his adds and a zero, not a null');
  // CHURN IS NOT A SIGNAL. A player high in both directions is the league
  // arguing with itself, and a board that kept only adds would show him as a
  // recommendation.
  ok(by['9228'].adds === 770216 && by['9228'].drops === 40000,
    'a player in BOTH feeds keeps both counts on one row');
  ok(by['10213'].adds === 0 && by['10213'].drops === 335502, 'and a drop-only player is carried too');

  // ID-FIRST: an unplaceable row is still stored, so the count survives until
  // the next index refresh can claim it.
  ok(by['10213'].slug === null, 'a player the index cannot place keeps a null slug rather than being dropped');
  ok(by['11435'].slug === 'emanuel-wilson' && by['9228'].slug === 'bryce-young', 'and a placeable one is placed');
}

// A DEFENSE TRENDS UNDER ITS TEAM. Sleeper keys team defenses by abbreviation
// everywhere; ours are `<team>-dst`, so these place without the index.
{
  const rows = trendRows([], [{ player_id: 'TB', count: 526470 }, { player_id: 'SF', count: 12 }], idx);
  ok(rows.length === 2 && rows[0].slug === 'tb-dst' && rows[1].slug === 'sf-dst',
    `a team defense places itself as <team>-dst (${rows.map((r) => r.slug).join(', ')})`);
  ok(rows[0].drops === 526470, '…with its count intact');
}

// JUNK IS SKIPPED RATHER THAN STORED AS A ZERO ROW, which would occupy a slug
// and prune a real row on the next pull.
{
  const rows = trendRows(
    [{ player_id: '', count: 5 }, { count: 5 }, { player_id: '11435' }, { player_id: '9228', count: 0 },
     { player_id: '11435', count: 'lots' }, { player_id: '11435', count: 9 }],
    null, idx);
  ok(rows.length === 1 && rows[0].sleeper_id === '11435' && rows[0].adds === 9,
    `a missing id, a missing count, a zero and a non-number are all skipped (${rows.length} row)`);
  ok(trendRows(null, undefined, idx).length === 0, 'and two dead feeds compose nothing, not a throw');
}

// The index is optional — a worker that has not built one yet still records
// the counts rather than failing the sweep.
{
  const rows = trendRows([{ player_id: '11435', count: 9 }, { player_id: 'TB', count: 3 }], [], null);
  ok(rows.length === 2 && rows[0].slug === null && rows[1].slug === 'tb-dst',
    'with no player index at all, players go unplaced and defenses still place');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL TRENDING ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
