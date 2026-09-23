// WHO IS HURT, FROM TWO SOURCES (v0.489.0), checked in Node.
//
// Founder: "I think Alec Pierce is out but he's listed as D in the platform."
//
// He was Doubtful on ESPN's report and Out on Sleeper's, seventeen hours
// fresher, and the platform polled ESPN alone. `injury_status` is not a badge:
// 0333 discounts a projection by it (O or IR to zero, D to a quarter), the
// lock's auto-fill treats O and IR as unavailable, and IR eligibility reads it.
// Shown D instead of O, Pierce was valued at a quarter of a player who could
// not be started at all.
//
// Two rules now decide the table, and both fail quietly if they drift:
//
//   • WHICH SOURCE WINS. Freshness first, the league's own platform on a tie,
//     and an explicit "Active" clears a designation the other feed is still
//     holding. Get this backwards in either direction and somebody starts a
//     player who cannot play, or benches one who can.
//   • THAT A DESIGNATION CAN END AT ALL. The poller only ever upserted, and
//     nothing else in the codebase deletes from that table — so a player
//     cleared in November stayed Out for ever. The prune is the fix and the
//     guard on the prune is what stops a short feed un-injuring the league.
import { readFileSync } from 'node:fs';
import { mapEspnAbbr, mapSleeperStatus, mergeInjury, INJURY_SEVERITY } from '../packages/core/src/data/injuryMerge';
import { normalizeInjuries } from './espn/injuries.mjs';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// ── READING EACH SOURCE'S VOCABULARY ───────────────────────────────────────
{
  ok('Sleeper Out/Doubtful/Questionable map straight across',
    mapSleeperStatus('Out') === 'O' && mapSleeperStatus('Doubtful') === 'D' && mapSleeperStatus('Questionable') === 'Q');
  ok('IR and PUP are both "gone beyond this Sunday"',
    mapSleeperStatus('IR') === 'IR' && mapSleeperStatus('PUP') === 'IR');
  ok('case and spacing do not matter', mapSleeperStatus('  out ') === 'O');
  // Absences that are not injuries must not enter a table whose consumers
  // apply an INJURY discount to what they find there.
  ok('a suspension is not an injury designation', mapSleeperStatus('Sus') === null);
  ok('nor is COVID, "did not report" or NA',
    mapSleeperStatus('COV') === null && mapSleeperStatus('DNR') === null && mapSleeperStatus('NA') === null);
  ok('nothing is nothing', mapSleeperStatus('') === null && mapSleeperStatus(null) === null);
  ok('ESPN abbreviations map, and Active survives as a statement',
    mapEspnAbbr('O') === 'O' && mapEspnAbbr('ir') === 'IR' && mapEspnAbbr('A') === 'A' && mapEspnAbbr('X') === null);
  ok('severity orders the way the consumers assume', INJURY_SEVERITY.IR > INJURY_SEVERITY.O
    && INJURY_SEVERITY.O > INJURY_SEVERITY.D && INJURY_SEVERITY.D > INJURY_SEVERITY.Q);
}

// ── THE CASE THIS WAS BUILT FOR ────────────────────────────────────────────
// Real values off both feeds, 2026-09-22.
{
  const espn = { status: 'D', at: '2026-09-22T01:03Z' };          // ESPN's report
  const sleeper = { status: 'O', at: 1790100059925 };             // Sleeper, 18:00Z
  const m = mergeInjury(espn, sleeper);
  ok('Alec Pierce comes out OUT, not doubtful', m?.status === 'O', m);
  ok('…credited to the source that actually said it', m?.source === 'sleeper', m);
  // ESPN's own minute-precision, second-less timestamps have to parse, or every
  // comparison silently falls through to the tiebreak.
  ok('an ESPN date with no seconds is still a date',
    mergeInjury({ status: 'O', at: '2026-09-22T23:59Z' }, { status: 'Q', at: 1 })?.status === 'O');
}

// ── WHICH SOURCE WINS ──────────────────────────────────────────────────────
{
  const T1 = 1_000_000, T2 = 2_000_000;
  ok('one source silent: the other stands',
    mergeInjury({ status: 'O', at: T1 }, null)?.source === 'espn'
    && mergeInjury(null, { status: 'O', at: T1 })?.source === 'sleeper');
  ok('both silent: no designation', mergeInjury(null, null) === null && mergeInjury({ status: null }, { status: null }) === null);
  ok('agreement is recorded as agreement',
    mergeInjury({ status: 'Q', at: T1 }, { status: 'Q', at: T2 })?.source === 'espn+sleeper');
  ok('disagreement: the NEWER statement wins, whichever side it is',
    mergeInjury({ status: 'D', at: T1 }, { status: 'O', at: T2 })?.status === 'O'
    && mergeInjury({ status: 'O', at: T2 }, { status: 'Q', at: T1 })?.status === 'O');
  ok('…including when the newer one is LESS severe — that is the point',
    mergeInjury({ status: 'O', at: T1 }, { status: 'Q', at: T2 })?.status === 'Q');
  ok('with no clock to compare, the league\'s own platform breaks the tie',
    mergeInjury({ status: 'D' }, { status: 'O' })?.source === 'sleeper');
}

// ── "ACTIVE" IS A STATEMENT, NOT AN ABSENCE ────────────────────────────────
// 24 players on the day would have been benched by a naive "Sleeper wins" —
// men ESPN lists as Active while Sleeper still carries a flag.
{
  const T1 = 1_000_000, T2 = 2_000_000;
  ok('a FRESHER Active clears a stale flag', mergeInjury({ status: 'A', at: T2 }, { status: 'O', at: T1 }) === null);
  ok('a STALER Active does not — Sunday beats Wednesday',
    mergeInjury({ status: 'A', at: T1 }, { status: 'O', at: T2 })?.status === 'O');
  ok('an undated Active does not clear a dated designation',
    mergeInjury({ status: 'A' }, { status: 'O', at: T1 })?.status === 'O');
  ok('Active with nothing on the other side is simply healthy',
    mergeInjury({ status: 'A', at: T1 }, null) === null);
  ok('both sides Active is healthy too', mergeInjury({ status: 'A', at: T1 }, { status: 'A', at: T2 }) === null);
}

// ── THE FEED KEEPS ITS OLD SHAPE UNLESS ASKED ──────────────────────────────
// check:injuries and the CLI probe both read this normalizer; adding Actives to
// what they see would have changed a report that was right.
{
  const feed = { injuries: [{ team: { id: 11, displayName: 'Indianapolis Colts' }, injuries: [
    { athlete: { displayName: 'Alec Pierce' }, status: 'Doubtful', type: { abbreviation: 'D' }, date: '2026-09-22T01:03Z' },
    { athlete: { displayName: 'Josh Downs' }, status: 'Active', type: { abbreviation: 'A' }, date: '2026-09-22T03:00Z' },
  ] }] };
  const plain = normalizeInjuries(feed);
  ok('by default an Active is still dropped', Object.keys(plain).length === 1 && plain['alec-pierce']?.status === 'D', plain);
  const kept = normalizeInjuries(feed, undefined, { keepActive: true });
  ok('asked for them, they arrive as status A', kept['josh-downs']?.status === 'A', kept['josh-downs']);
  ok('…dated, or they could never clear anything', !!kept['josh-downs']?.date);
}

// ── A DESIGNATION HAS TO BE ABLE TO END ────────────────────────────────────
{
  const poller = readFileSync(new URL('../server/src/poll/injuries.js', import.meta.url), 'utf8');
  ok('the poller deletes what neither source designates any more',
    /from\('injury_status'\)\.delete\(\)/.test(poller));
  ok('…only when ESPN\'s report came back whole', /espnEntries >= PRUNE_FLOOR/.test(poller));
  ok('…and only with a Sleeper snapshot in hand', /sleeper != null && espnEntries/.test(poller));
  ok('a poll that cannot prune says so rather than looking clean',
    /prunedSkipped: !canPrune/.test(poller));
  // PostgREST puts an .in() list in the URL; a thousand slugs is a 414.
  ok('the delete is chunked', /i \+= 200/.test(poller));
  ok('Sleeper is fetched on its own slow clock, not the injury poll\'s',
    /SLEEPER_INJURY_MS/.test(poller) && /sleeperCache/.test(poller));
  // A prune deletes rows the whole product reads. The tick's log line is the
  // only window on it, and a bare count cannot tell a poll that cleared forty
  // designations from one that was not allowed to clear any.
  const tick = readFileSync(new URL('../server/src/index.js', import.meta.url), 'utf8');
  ok('the tick logs what the poll actually did', /prune SKIPPED/.test(tick) && /cleared/.test(tick));
  ok('…naming both sources, so a missing one is visible',
    /espn \$\{r\.espn\}, sleeper/.test(tick));
}

if (fails) { console.log(`\n${fails} INJURY MERGE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL INJURY MERGE ASSERTIONS PASSED');
