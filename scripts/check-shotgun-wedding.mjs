// SHOTGUN WEDDING (v0.653.0), checked in Node — the 2-for-2 the CPU picks.
//
// Founder: "the CPU creates a fair, 4 total player trade from opposing teams."
// What is worth a red check rather than a careful reading:
//   • the v0.654.1 rules (engine/shotgunWedding.ts): like for like, fair
//     player by player, not the stars, starter-level only, both lineups
//     hold, healthy — rebuilt after the founder read the first live preview:
//     "Those are really bad trades";
//   • the same inputs give the same wedding (a worker re-run files nothing
//     different), and a different seed can give a different one.
// Run: npx tsx scripts/check-shotgun-wedding.mjs
import { readFileSync } from 'node:fs';
import { weddingPlan, weddingCandidates } from '../packages/core/src/engine/shotgunWedding.ts';
import { leagueSlotDefs, optimalLineup } from '../packages/core/src/engine/classic.ts';
import { weddingStatusLine, weddingDeadlineLabel, VETO_RULES, DEADLINE_RULES } from '../packages/core/src/data/shotgunWedding.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const P = (id, pos, ppg, extra = {}) => ({ id, pos, ppg, ros: ppg * 12, ...extra });
const slots = leagueSlotDefs({ roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 } });
const byId = (list) => (id) => list.find((p) => p.id === id);
const STAR = new Set(['h-qb', 'h-wr1', 'a-qb', 'a-rb1']);

const home = [P('h-qb', 'QB', 20), P('h-rb1', 'RB', 18), P('h-rb2', 'RB', 13), P('h-rb3', 'RB', 11), P('h-rb4', 'RB', 4),
  P('h-wr1', 'WR', 19), P('h-wr2', 'WR', 14), P('h-wr3', 'WR', 12), P('h-wr4', 'WR', 3), P('h-te', 'TE', 10), P('h-te2', 'TE', 5),
  P('h-k', 'K', 9), P('h-def', 'DEF', 8)];
const away = [P('a-qb', 'QB', 21), P('a-rb1', 'RB', 18.5), P('a-rb2', 'RB', 12.6), P('a-rb3', 'RB', 10.4), P('a-rb4', 'RB', 3.5),
  P('a-wr1', 'WR', 16), P('a-wr2', 'WR', 14.5), P('a-wr3', 'WR', 11.5), P('a-wr4', 'WR', 2), P('a-te', 'TE', 9.5), P('a-te2', 'TE', 4),
  P('a-k', 'K', 8), P('a-def', 'DEF', 7)];
const lineupPpg = (roster) => {
  const spots = optimalLineup(slots, roster, (p) => p.ppg).spots;
  return spots.reduce((n, r) => n + (r.player ? r.player.ppg : 0), 0);
};
const after = (roster, gone, got) => roster.filter((p) => !gone.includes(p.id)).concat(got);

// ── THE RULES ──────────────────────────────────────────────────────────────
{
  const w = weddingPlan({ slots, home, away, seed: 'L|1|1v2' });
  ok('a plan comes back', !!w, w);
  const hs = w.homeGives.map(byId(home)); const as = w.awayGives.map(byId(away));
  ok('two each way, each from its own roster', hs.every(Boolean) && as.every(Boolean), w);
  ok('LIKE FOR LIKE: both sides send the same positions',
    hs.map((p) => p.pos).sort().join() === as.map((p) => p.pos).sort().join(), { hs, as });
  const sortP = (xs) => [...xs].sort((x, y) => x.pos.localeCompare(y.pos) || y.ppg - x.ppg);
  const gaps = sortP(hs).map((p, i) => Math.abs(p.ppg - sortP(as)[i].ppg));
  ok('FAIR PLAYER BY PLAYER: every paired gap inside the band', gaps.every((g) => g <= w.band + 1e-9) && w.worstPair === Math.round(Math.max(...gaps) * 10) / 10, { gaps, w });
  ok('NOT THE STARS: neither team\'s top two', ![...w.homeGives, ...w.awayGives].some((id) => STAR.has(id)), w);
  ok('no quarterback when nobody has a spare, never a kicker or defense', [...hs, ...as].every((p) => ['RB', 'WR', 'TE'].includes(p.pos)), w);
  ok('STARTER-LEVEL: no deep bench', ![...w.homeGives, ...w.awayGives].some((id) => /rb4|wr4|te2/.test(id)), w);
  const hDrop = lineupPpg(home) - lineupPpg(after(home, w.homeGives, as));
  const aDrop = lineupPpg(away) - lineupPpg(after(away, w.awayGives, hs));
  ok('BOTH LINEUPS HOLD: neither loses more than a point a game', hDrop <= 1 + 1e-9 && aDrop <= 1 + 1e-9, { hDrop, aDrop });
  ok('the plan reports what each side sends', w.homePpg === Math.round((hs[0].ppg + hs[1].ppg) * 10) / 10, w);
}

// ── THE SEED ───────────────────────────────────────────────────────────────
{
  const a = weddingPlan({ slots, home, away, seed: 'L|3|1v2' });
  const b = weddingPlan({ slots, home, away, seed: 'L|3|1v2' });
  ok('the same seed gives the same wedding', JSON.stringify(a) === JSON.stringify(b));
  const shapes = new Set(Array.from({ length: 16 }, (_, i) => JSON.stringify(weddingPlan({ slots, home, away, seed: `L|${i}|1v2` }))));
  ok('different weeks do not all get the same wedding', shapes.size > 1, shapes.size);
}

// ── WHAT IT REFUSES ────────────────────────────────────────────────────────
{
  const hurt = away.map((p) => (p.id === 'a-wr2' ? { ...p, out: true } : p));
  const plans = Array.from({ length: 16 }, (_, i) => weddingPlan({ slots, home, away: hurt, seed: `L|${i}|hurt` })).filter(Boolean);
  ok('a player ruled out is never forced to move', plans.length > 0 && plans.every((w) => !w.awayGives.includes('a-wr2')), plans.length);
  // The v0.653.0 failure: a star plus a throw-in "balances" two mid players
  // on totals. With every pair matched by position and points, it can't.
  const starTeam = [P('s-qb', 'QB', 20), P('s-wr1', 'WR', 22), P('s-wr2', 'WR', 21), P('s-wr3', 'WR', 15), P('s-rb1', 'RB', 16), P('s-rb2', 'RB', 15.5), P('s-rb3', 'RB', 2), P('s-te', 'TE', 9)];
  const midTeam = [P('m-qb', 'QB', 19), P('m-wr1', 'WR', 23), P('m-wr2', 'WR', 22.5), P('m-wr3', 'WR', 9), P('m-rb1', 'RB', 9.5), P('m-rb2', 'RB', 8), P('m-rb3', 'RB', 7), P('m-te', 'TE', 4)];
  ok('no like-for-like pair inside a point and a half → no wedding, rather than a lopsided one',
    weddingPlan({ slots, home: starTeam, away: midTeam, seed: 's' }) === null);
  const twoQb = [...home, P('h-qb2', 'QB', 15.5)]; const twoQbA = [...away, P('a-qb2', 'QB', 15)];
  const qbPlans = Array.from({ length: 24 }, (_, i) => weddingPlan({ slots, home: twoQb, away: twoQbA, seed: `L|${i}|qb` })).filter(Boolean);
  ok('a quarterback can move when both teams roster a spare — and only for a quarterback',
    qbPlans.every((w) => !(w.homeGives.includes('h-qb2') !== w.awayGives.includes('a-qb2'))), qbPlans.map((w) => [w.homeGives, w.awayGives]));
  ok('fewer than two candidates → no wedding', weddingPlan({ slots, home: [P('only', 'RB', 12)], away, seed: 's' }) === null);
  const cands = weddingCandidates(slots, home, false).map((p) => p.id).sort();
  ok('the candidates: starters and near-starters, minus the stars, minus QB/K/DEF',
    JSON.stringify(cands) === JSON.stringify(['h-rb1', 'h-rb2', 'h-rb3', 'h-te', 'h-wr2', 'h-wr3'].sort()), cands);
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
