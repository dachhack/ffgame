// SHOTGUN WEDDING (v0.653.0), checked in Node — the 2-for-2 the CPU picks.
//
// Founder: "the CPU creates a fair, 4 total player trade from opposing teams."
// What is worth a red check rather than a careful reading:
//   • FAIR means the trade grader's own "close to even" — a wedding the app
//     then grades as lopsided is the CPU contradicting itself in public;
//   • two each way, nobody worth nothing, never strip a team of a spot it
//     could field;
//   • the same inputs give the same wedding (a worker re-run files nothing
//     different), and a different seed can give a different one.
// Run: npx tsx scripts/check-shotgun-wedding.mjs
import { readFileSync } from 'node:fs';
import { weddingPlan } from '../packages/core/src/engine/shotgunWedding.ts';
import { evenBand } from '../packages/core/src/data/tradeGrade.ts';
import { leagueSlotDefs } from '../packages/core/src/engine/classic.ts';
import { weddingStatusLine, weddingDeadlineLabel, VETO_RULES, DEADLINE_RULES } from '../packages/core/src/data/shotgunWedding.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const P = (id, pos, value, points = value + 100) => ({ id, pos, value, points });
const slots = leagueSlotDefs({ roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 } });
const valueOf = (all) => (id) => all.find((p) => p.id === id)?.value ?? 0;

const home = [P('h-qb', 'QB', 40), P('h-rb1', 'RB', 90), P('h-rb2', 'RB', 60), P('h-rb3', 'RB', 25), P('h-wr1', 'WR', 85),
  P('h-wr2', 'WR', 55), P('h-wr3', 'WR', 20), P('h-te', 'TE', 30), P('h-bench', 'WR', 0)];
const away = [P('a-qb', 'QB', 45), P('a-rb1', 'RB', 80), P('a-rb2', 'RB', 50), P('a-rb3', 'RB', 30), P('a-wr1', 'WR', 95),
  P('a-wr2', 'WR', 65), P('a-wr3', 'WR', 15), P('a-te', 'TE', 35), P('a-bench', 'RB', 0)];

// ── THE SHAPE AND THE FAIRNESS ─────────────────────────────────────────────
{
  const w = weddingPlan({ slots, home, away, seed: 'L|1|1v2' });
  ok('a plan comes back', !!w, w);
  ok('two each way', w?.homeGives.length === 2 && w?.awayGives.length === 2, w);
  ok('home gives home players, away gives away players',
    w?.homeGives.every((s) => s.startsWith('h-')) && w?.awayGives.every((s) => s.startsWith('a-')), w);
  const hv = w.homeGives.map(valueOf(home)).reduce((a, b) => a + b, 0);
  const av = w.awayGives.map(valueOf(away)).reduce((a, b) => a + b, 0);
  ok('the two sides sit inside the trade grader\'s even band', Math.abs(hv - av) <= evenBand(hv, av), { hv, av });
  ok('…and the plan reports them', w.homeValue === hv && w.awayValue === av && w.scale === 'value', w);
  ok('nobody worth nothing is in it', ![...w.homeGives, ...w.awayGives].some((s) => s.endsWith('bench')), w);
  ok('neither quarterback moves — each team has only one', !w.homeGives.includes('h-qb') && !w.awayGives.includes('a-qb'), w);
  ok('…nor either tight end', !w.homeGives.includes('h-te') && !w.awayGives.includes('a-te'), w);
  ok('it is a weighty pair, not two scrubs', hv + av >= 150, { hv, av });
}

// ── THE SEED ───────────────────────────────────────────────────────────────
{
  const a = weddingPlan({ slots, home, away, seed: 'L|3|1v2' });
  const b = weddingPlan({ slots, home, away, seed: 'L|3|1v2' });
  ok('the same seed gives the same wedding', JSON.stringify(a) === JSON.stringify(b));
  const shapes = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(weddingPlan({ slots, home, away, seed: `L|${i}|1v2` }))));
  ok('different weeks do not all get the same wedding', shapes.size > 1, shapes.size);
}

// ── THIN ROSTERS AND NO DEAL ───────────────────────────────────────────────
{
  const thin = [P('t-qb', 'QB', 30), P('t-rb1', 'RB', 0, 120), P('t-rb2', 'RB', 0, 110), P('t-wr1', 'WR', 0, 115), P('t-wr2', 'WR', 0, 100), P('t-te', 'TE', 0, 80), P('t-flex', 'WR', 0, 90)];
  const w = weddingPlan({ slots, home: thin, away, seed: 'L|1|thin' });
  ok('a roster with one player over replacement falls back to raw points for both sides', w?.scale === 'points', w);
  ok('…still two each way', w?.homeGives.length === 2 && w?.awayGives.length === 2, w);
  const lopsided = [P('x1', 'RB', 400), P('x2', 'WR', 380), P('x-qb', 'QB', 300), P('x-te', 'TE', 250), P('x-rb', 'RB', 200), P('x-wr', 'WR', 200), P('x-wr2', 'WR', 190)];
  const scrubs = [P('y1', 'RB', 1, 1), P('y2', 'WR', 1, 1), P('y-qb', 'QB', 1, 1), P('y-te', 'TE', 1, 1), P('y-rb', 'RB', 1, 1), P('y-wr', 'WR', 1, 1), P('y-wr2', 'WR', 1, 1)];
  ok('no fair pair → no wedding, rather than an unfair one', weddingPlan({ slots, home: lopsided, away: scrubs, seed: 's' }) === null);
  ok('fewer than two players → no wedding', weddingPlan({ slots, home: [P('only', 'RB', 50)], away, seed: 's' }) === null);
}

// ── THE WORKER AND THE SQL SAY THE SAME THINGS ─────────────────────────────
{
  const js = readFileSync(new URL('../server/src/shotgun.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/0453_shotgun_wedding.sql', import.meta.url), 'utf8');
  ok('the worker files through shotgun_propose', /rpc\('shotgun_propose'/.test(js));
  ok('the worker carries out the deadline through shotgun_sweep', /rpc\('shotgun_sweep'/.test(js));
  ok('the worker seeds by league, week and matchup', /seed: `\$\{lg\.id\}\|\$\{(week|wk)\}\|/.test(js));
  ok('the SQL deadline is 8 PM Eastern', /time '20:00'\) at time zone 'America\/New_York'/.test(sql));
  ok('the SQL asks golf_beats who won, so a golf league\'s low score holds the veto', /golf_beats\(p_league_id, mu\.home_final, mu\.away_final\)/.test(sql));
  ok('drop_lock_reason asks the wedding first', /coalesce\(_wedding_lock\(p_league_id, p_slug\), case/.test(sql));
}

// ── THE HOUSE RULES' WORDS (0454) ─────────────────────────────────────────
{
  const base = {
    id: 'w', week: 6, status: 'pending', deadline: '2026-10-14T00:00:00Z', note: null,
    home: { roster: 1, team: 'Home FC', score: 120, gives: [] }, away: { roster: 2, team: 'Away FC', score: 100, gives: [] },
    winner: 1, counter: null, my_seat: null, can_decline: false, can_counter: false, can_accept: false, rosters: null,
  };
  const now = Date.parse('2026-10-13T14:00:00Z');
  ok('the deadline reads in Eastern time', weddingDeadlineLabel('2026-10-14T00:00:00Z') === '8 PM ET Tue', weddingDeadlineLabel('2026-10-14T00:00:00Z'));
  ok('noon Thursday reads as 12 PM', weddingDeadlineLabel('2026-10-15T16:00:00Z') === '12 PM ET Thu', weddingDeadlineLabel('2026-10-15T16:00:00Z'));
  const w = weddingStatusLine({ ...base, veto: 1, veto_rule: 'winner' }, now);
  ok('"winner": names the winner, who won', w === 'Goes through at 8 PM ET Tue unless Home FC, who won 120–100, calls it off.', w);
  const l = weddingStatusLine({ ...base, veto: 2, veto_rule: 'loser' }, now);
  ok('"loser": names the loser, who lost', l === 'Goes through at 8 PM ET Tue unless Away FC, who lost 120–100, calls it off.', l);
  const n = weddingStatusLine({ ...base, veto: null, veto_rule: 'none' }, now);
  ok('"none": nobody can call it off', /nobody can call this one off/.test(n), n);
  const t = weddingStatusLine({ ...base, winner: null, veto: null, veto_rule: 'winner', home: { ...base.home, score: 90 }, away: { ...base.away, score: 90 } }, now);
  ok('a tie under "winner": nobody can', /it was a tie \(90–90\), so nobody can call it off/.test(t), t);
  const d = weddingStatusLine({ ...base, status: 'declined', veto: 2, veto_rule: 'loser' }, now);
  ok('a decline names whoever held the veto', d.startsWith('💔 Away FC called it off'), d);
  ok('three veto rules and three deadlines, as the SQL knows them',
    VETO_RULES.map((x) => x.id).join() === 'winner,loser,none' && DEADLINE_RULES.map((x) => x.id).join() === 'tue20,wed20,thu12');
  const sql54 = readFileSync(new URL('../supabase/migrations/0454_shotgun_wedding_house_rules.sql', import.meta.url), 'utf8');
  ok('0454 accepts exactly those', /v not in \('winner', 'loser', 'none'\)/.test(sql54) && /d not in \('tue20', 'wed20', 'thu12'\)/.test(sql54));
  ok('0454 clamps the deadline to an hour before the next kickoff', /dl := next_kick - interval '1 hour'/.test(sql54));
}

if (fails) { console.log(`\n${fails} SHOTGUN WEDDING ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SHOTGUN WEDDING ASSERTIONS PASSED');
