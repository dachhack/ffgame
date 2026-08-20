// WHICH REGULAR-SEASON WEEK GETS MIRRORED (v0.320.0), checked in Node.
//
// In check:parity because the failure it guards is silent and annual: for the
// six weeks of preseason, Sleeper's `week` is the PRESEASON week (2, with
// season_type "pre") and ESPN's un-parameterised regular-season week drifts
// forward with the calendar — so the worker mirrors rosters into weeks nobody
// can open while week 1, the week every manager opens on day one, goes
// unwritten. Nothing errors. The only symptom is a
// stale roster at the first lock of the season, by which point it is too late
// to notice.
//
// The instants and payloads below are real, taken from the live feeds on
// 2026-08-20: Sleeper reported `{week: 2, season_type: "pre"}`, ESPN reported
// week 3 (having reported 2 the day before), and regular-season week 1 kicks
// off 2026-09-10T00:20Z.
import { regularWeekFrom, REG_SEASON_WEEKS } from '../packages/core/src/data/seasonWeek';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const W1_KICK = Date.parse('2026-09-10T00:20:00Z');   // real, from ESPN week=1
const AUG20 = Date.parse('2026-08-20T14:00:00Z');     // the day this was found
const SEP09 = Date.parse('2026-09-09T18:00:00Z');     // hours before week 1 locks

// ── THE BUG, PINNED ────────────────────────────────────────────────────────
{
  // EXACTLY what production was doing on the day: Sleeper says week 2 with
  // season_type "pre" — that is PRESEASON week 2 — and the old rule read the
  // number without the type and mirrored regular-season week 2.
  const real = regularWeekFrom({
    sleeperWeek: 2, sleeperSeasonType: 'pre', espnWeek: 3,
    week1KickoffMs: W1_KICK, nowMs: AUG20,
  });
  ok('a PRESEASON week number is never read as a regular-season week',
    real.week === 1, real);
  ok('…and the reason names the guard rather than Sleeper', /preseason/.test(real.reason), real.reason);
  // The preseason marches on; none of it may move the mirrored week.
  const march = [1, 2, 3, 4].map((w) => regularWeekFrom({
    sleeperWeek: w, sleeperSeasonType: 'pre', espnWeek: w + 1,
    week1KickoffMs: W1_KICK, nowMs: AUG20,
  }).week);
  ok('every preseason week still mirrors week 1', march.every((w) => w === 1), march);
  ok('an "off" season_type is not trusted either',
    regularWeekFrom({ sleeperWeek: 5, sleeperSeasonType: 'off', espnWeek: 5,
      week1KickoffMs: W1_KICK, nowMs: AUG20 }).week === 1);
  ok('a MISSING season_type is treated as untrusted, not as regular',
    regularWeekFrom({ sleeperWeek: 2, espnWeek: 3, week1KickoffMs: W1_KICK, nowMs: AUG20 }).week === 1);

  // Exactly what production looked like if Sleeper were down: ESPN drifting at 3.
  const r = regularWeekFrom({ sleeperWeek: 0, espnWeek: 3, week1KickoffMs: W1_KICK, nowMs: AUG20 });
  ok('preseason mirrors WEEK 1, not ESPN\'s drifting number', r.week === 1, r);
  ok('…and says why, so the log explains itself', /preseason/.test(r.reason), r.reason);
}
{
  // The drift itself must not move the answer — this is the whole point.
  const at = (espnWeek) => regularWeekFrom({ sleeperWeek: 0, espnWeek, week1KickoffMs: W1_KICK, nowMs: AUG20 }).week;
  ok('the answer is 1 whatever ESPN drifts to', [1, 2, 3, 4, 5, 9].every((w) => at(w) === 1),
    [1, 2, 3, 4, 5, 9].map(at));
}
{
  // Hours before the first lock, still preseason by kickoff → still week 1.
  const r = regularWeekFrom({ sleeperWeek: 0, espnWeek: 6, week1KickoffMs: W1_KICK, nowMs: SEP09 });
  ok('the day of the first lock, before kickoff, is still week 1', r.week === 1, r);
}

// ── SLEEPER WINS ONCE IT HAS AN ANSWER ─────────────────────────────────────
{
  const r = regularWeekFrom({ sleeperWeek: 1, sleeperSeasonType: 'regular', espnWeek: 6, week1KickoffMs: W1_KICK, nowMs: SEP09 });
  ok('Sleeper outranks ESPN the moment it reports a week', r.week === 1 && /sleeper/.test(r.reason), r);
  const mid = regularWeekFrom({ sleeperWeek: 7, sleeperSeasonType: 'regular', espnWeek: 7, week1KickoffMs: W1_KICK, nowMs: W1_KICK + 40 * 86400e3 });
  ok('…and in season it simply passes through', mid.week === 7, mid);
  // Sleeper wins even before kickoff — if it says 1 it is not guessing.
  const early = regularWeekFrom({ sleeperWeek: 1, sleeperSeasonType: 'regular', espnWeek: 3, week1KickoffMs: W1_KICK, nowMs: AUG20 });
  ok('Sleeper outranks the preseason guard too', early.week === 1 && /sleeper/.test(early.reason), early);
}

// ── AFTER KICKOFF THE GUARD STANDS ASIDE ───────────────────────────────────
{
  const inSeason = W1_KICK + 8 * 86400e3;              // week 2-ish, Sleeper down
  const r = regularWeekFrom({ sleeperWeek: 0, espnWeek: 2, week1KickoffMs: W1_KICK, nowMs: inSeason });
  ok('once week 1 has kicked off, ESPN is trusted again', r.week === 2 && r.reason === 'espn', r);
}

// ── DEGENERATE INPUT MUST NOT PRODUCE A WEEK THAT MIRRORS NOTHING ──────────
{
  ok('an unknown week-1 kickoff falls back to ESPN rather than stalling',
    regularWeekFrom({ sleeperWeek: 0, espnWeek: 4, week1KickoffMs: null, nowMs: AUG20 }).week === 4);
  ok('no sources at all still yields a mirrorable week',
    regularWeekFrom({ sleeperWeek: null, espnWeek: null, week1KickoffMs: null, nowMs: AUG20 }).week === 1);
  // THE CLAMP IS NOT DECORATION: an out-of-range week mirrors nothing at all,
  // silently, because no such week exists to write.
  const over = regularWeekFrom({ sleeperWeek: 0, espnWeek: 23, week1KickoffMs: null, nowMs: AUG20 });
  ok('a week past the end of the season is clamped', over.week === REG_SEASON_WEEKS, over);
  ok('the postseason keeps Sleeper authoritative',
    regularWeekFrom({ sleeperWeek: 19, sleeperSeasonType: 'post', espnWeek: null,
      week1KickoffMs: null, nowMs: AUG20 }).week === REG_SEASON_WEEKS);
  ok('…and the clamp is visible in the reason', /clamped/.test(over.reason), over.reason);
  ok('a nonsense Sleeper week is ignored rather than trusted',
    regularWeekFrom({ sleeperWeek: -3, sleeperSeasonType: 'regular', espnWeek: 5, week1KickoffMs: null, nowMs: AUG20 }).week === 5);
  ok('a fractional week never reaches the database',
    Number.isInteger(regularWeekFrom({ sleeperWeek: 4.7, sleeperSeasonType: 'regular', espnWeek: null, week1KickoffMs: null, nowMs: AUG20 }).week));
}

if (fails) { console.log(`\n${fails} SEASON-WEEK ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SEASON-WEEK ASSERTIONS PASSED');
