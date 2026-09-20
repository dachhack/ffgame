// Guard for THE WEEKLY MATCHUP AUDIT (core data/weekAudit, v0.430.0).
//
// Founder: "Let's create a weekly audit of matchups for me." The database
// builds the payload (0302 admin_week_audit — its probes live in
// scripts/db/week-audit-probes.sql); this pins the shared READING of it: the
// activity grade a seat gets, the source line, the human share, and the text
// rendering the worker's CLI prints. Run: npx tsx scripts/check-week-audit.mjs
import {
  activityGrade, sourcesLine, humanShare, leagueLine, auditHeadline, auditText, SOURCE_LABEL,
} from '../packages/core/src/data/weekAudit.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

const act = (o = {}) => ({
  active: false, pick_edits: 0, txns: {}, txn_kinds: {}, claims: {}, claims_n: 0, chat: 0, shop: 0, shop_coin: 0,
  last_active_at: null, last_seen_at: null, ...o,
});
const lineup = (o = {}) => ({ expected: 8, fielded: 8, empty: 0, sources: { player: 8 }, out_started: [], bye_started: [], ...o });
const team = (o = {}) => ({
  roster_id: 1, team: 'Team', kind: 'human', controller: 'human', enrolled: true, manager: 'm@x', result: 'W', opp: 2,
  pf: 100, pa: 90, matchup_status: 'final', lineup: lineup(), activity: act(), ...o,
});

// ── the activity grade ──────────────────────────────────────────────────────
eq(activityGrade(team({ kind: 'ai' })), 'bot', 'an AI seat is a bot, never active or idle');
eq(activityGrade(team({ kind: 'agent' })), 'bot', 'an auto-managed seat is a bot');
eq(activityGrade(team({ kind: 'empty' })), 'open', 'an empty seat is open');
eq(activityGrade(team()), 'idle', 'a human who did nothing is idle');
eq(activityGrade(team({ activity: act({ pick_edits: 1 }) })), 'set-and-forget', 'one kind of thing, once → set & forget');
eq(activityGrade(team({ activity: act({ pick_edits: 3 }) })), 'active', 'three lineup touches → active');
eq(activityGrade(team({ activity: act({ pick_edits: 1, chat: 1 }) })), 'active', 'edits + chat → active');
eq(activityGrade(team({ activity: act({ claims_n: 1, shop: 1 }) })), 'active', 'a claim + a purchase → active');
eq(activityGrade(team({ activity: act({ txns: { ai: 3 } }) })), 'idle', 'moves the computer made do not make a human active');

// ── the lines ───────────────────────────────────────────────────────────────
eq(sourcesLine({ player: 3, auto: 2, ai: 1, agent: 0 }), '3 player · 2 computer · 1 ai', 'sources line: fixed order, zeros dropped');
eq(sourcesLine({}), '—', 'no sources → a dash');
eq(sourcesLine(null), '—', 'null sources → a dash');
eq(humanShare({ player: 6, auto: 2, ai: 2 }), 60, 'human share is player over everything');
eq(humanShare({}), null, 'no slots → no share');
eq(SOURCE_LABEL.auto, 'Computer', 'the worker fill reads as the computer');
eq(SOURCE_LABEL.agent, 'Auto-managed', 'an agent seat reads as auto-managed');

const league = {
  league_id: 'L1', name: 'Turf Warriors', provider: 'native', game_mode: 'drip', format: 'standard', lineup_policy: 'best_lineup',
  matchups: 2, finals: 2,
  seats: { total: 4, human: 2, ai: 1, agent: 1, empty: 0, active: 1 },
  lineup: { expected: 32, fielded: 27, empty: 5, out_started: 1, bye_started: 0, sources: { player: 12, auto: 4, agent: 5, ai: 6 } },
  activity: { pick_edits: 9, txns: { player: 2, ai: 1 }, claims: { player: 1, ai: 2 }, claims_won: { ai: 1 }, chat: 3, shop: 1 },
  teams: [
    team({ roster_id: 1, team: 'Humans', activity: act({ active: true, pick_edits: 9, txns: { player: 2 }, claims_n: 1, chat: 3, shop: 1 }) }),
    team({ roster_id: 2, team: 'Quiet', result: 'L', pf: 80, pa: 95, lineup: lineup({ fielded: 5, empty: 3, sources: { player: 0, auto: 4 }, out_started: [{ slug: 'out-man', source: 'auto' }] }) }),
    team({ roster_id: 3, team: 'Robots', kind: 'ai', controller: 'ai', result: 'W', lineup: lineup({ sources: { ai: 6 }, fielded: 6, empty: 2 }), activity: act({ txns: { ai: 1 }, claims_n: 2 }) }),
    team({ roster_id: 4, team: 'Ghosts', kind: 'agent', result: 'L', lineup: lineup({ sources: { agent: 5 }, fielded: 5, empty: 3 }) }),
  ],
};
eq(leagueLine(league), '1 of 2 humans active · 44% player-set · 5 empty slots · 1 OUT started', 'the league one-liner');

const audit = {
  ok: true, v: 1, week: 3, season: '2026', window: { from: '2026-09-22T03:00:00+00:00', to: '2026-09-29T03:00:00+00:00' }, slate_loaded: true,
  totals: { leagues: 1, matchups: 2, finals: 2, seats: league.seats, lineup: league.lineup, activity: league.activity },
  leagues: [league],
};
eq(auditHeadline(audit), 'week 3 · 1 league · 1 of 2 humans active · 44% player-set · 5 empty · 1 OUT started', 'the headline');
eq(auditHeadline({ ok: false, error: 'forbidden', week: null, season: null, leagues: [] }), 'forbidden', 'a refused audit says why');
eq(auditHeadline({ ok: true, week: null, season: '2026', leagues: [], note: 'no matchups to audit' }), 'no matchups to audit', 'an empty week says so');

const text = auditText(audit);
ok(text.startsWith('WEEKLY MATCHUP AUDIT — week 3'), 'the text opens with the headline');
ok(text.includes('Turf Warriors [drip · native]'), 'each league is named with its mode and provider');
ok(/Humans\s+ACTIVE\s+W 100\.0–90\.0\s+8 player/.test(text), 'a team row: name, grade, result, sources');
ok(/Quiet\s+IDLE\s+L 80\.0–95\.0\s+4 computer/.test(text) && text.includes('OUT: out-man') && text.includes('3 empty'), 'an idle seat shows its computer fill, its empties and its OUT starter');
ok(/Robots\s+BOT/.test(text) && /Ghosts\s+BOT/.test(text), 'bot seats are graded BOT');
ok(text.includes('claims: 1 player · 2 ai (won: 1 ai)'), 'the totals line splits claims by source and by who won');

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL WEEK-AUDIT ASSERTIONS PASSED');
