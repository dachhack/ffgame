// THE INJURY SWAP (v0.738.0, 0531) — what the boards offer, and what the
// server is asked to enforce.
//
// Founder: "What's a fair way for a swap that won't break the game? We don't
// want to have users put in a player and swap them last minute as way to
// trick their opponents." This pins core/data/injurySwap: the swap is
// offered only in the locked hour, only for Out / IR, only once; the bench
// is same position, same window, active roster, not already fielded; every
// server refusal has words; and the migration carries each rule and puts the
// Player Swap card back after kickoff.
// Run: tsx scripts/check-injury-swap.mjs
import { readFileSync } from 'node:fs';
import { injurySwapOffered, injurySwapCandidates, injurySwapRefusal, isRuledOut } from '../packages/core/src/data/injurySwap';
import { aimSpotOk } from '../packages/core/src/data/aimRules';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

ok('Out and IR rule a player out; Questionable, Doubtful and healthy do not',
  isRuledOut('O') && isRuledOut('IR') && !isRuledOut('Q') && !isRuledOut('D') && !isRuledOut(null) && !isRuledOut(undefined));
const offer = (phase, status, swapped = false) => injurySwapOffered({ phase, status, swapped });
ok('offered in the locked hour for an Out starter', offer('locked', 'O') && offer('locked', 'IR'));
ok('not before the lock (the lineup is still yours), not once it kicks, not at final', !offer('setup', 'O') && !offer('live', 'O') && !offer('final', 'O'));
ok('not for a Questionable or healthy starter', !offer('locked', 'Q') && !offer('locked', null));
ok('once per spot', !offer('locked', 'O', true));

const roster = [
  { slug: 'rb-bench', pos: 'RB' }, { slug: 'rb-fielded', pos: 'RB' }, { slug: 'rb-late', pos: 'RB' },
  { slug: 'rb-ir', pos: 'RB' }, { slug: 'rb-taxi', pos: 'RB' }, { slug: 'wr-bench', pos: 'WR' }, { slug: 'rb-anywin', pos: 'rb' },
];
const win = { 'rb-bench': 'early', 'rb-fielded': 'early', 'rb-late': 'late', 'rb-ir': 'early', 'rb-taxi': 'early', 'wr-bench': 'early', 'rb-anywin': 'any' };
const grp = { 'rb-ir': 'ir', 'rb-taxi': 'taxi' };
const c = injurySwapCandidates(roster, { outPos: 'RB', win: 'early', windowOf: (s) => win[s], groupOf: (s) => grp[s] ?? 'bench', fielded: new Set(['rb-fielded']) });
ok('the bench is same position, this window, active roster, not already fielded', c.map((p) => p.slug).join() === 'rb-bench', c.map((p) => p.slug));
ok('another position has its own bench', injurySwapCandidates(roster, { outPos: 'wr', win: 'early', windowOf: (s) => win[s], groupOf: () => 'bench', fielded: new Set() }).map((p) => p.slug).join() === 'wr-bench');

const sql = readFileSync(new URL('../supabase/migrations/0531_injury_swap.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const fn = sql.slice(sql.indexOf('create or replace function injury_swap('), sql.indexOf('create or replace function apply_targeted'));
const codes = [...fn.matchAll(/'error', '([^']+)'/g)].map((m) => m[1]);
ok('every refusal the server can give has its own words', codes.length >= 12 && codes.filter((x) => !['no matchup', 'forbidden', 'bad payload', 'not a drip league', 'window has no kickoff', 'same player'].includes(x))
  .every((x) => !injurySwapRefusal(x).startsWith('The swap was refused')), codes.filter((x) => injurySwapRefusal(x).startsWith('The swap was refused')));
ok('the server gates the locked hour: after the lock, before the kickoff', /window_locks_at\(m\.week, p_win\) > now\(\)/.test(fn) && /kick <= now\(\)/.test(fn));
ok('the server reads the injury report, Out or IR only', /from injury_status where player_slug = pick\.player_slug/.test(fn) && /st not in \('O', 'IR'\)/.test(fn));
ok('the server checks position, window, roster and lineup itself', /upper\(out_pos\) <> upper\(in_pos\)/.test(fn) && /in_win <> p_win/.test(fn) && /'not your player'/.test(fn) && /'already in your lineup'/.test(fn));
ok('once per spot is a table the seat cannot write', /primary key \(matchup_id, app_user_id, game_window, roster_slot\)/.test(sql) && /enable row level security/.test(sql)
  && !/create policy[^;]*injury_swap_log[^;]*for (insert|update|delete|all)/i.test(sql));
ok('the metric is not touched', !/set[^;]*metric_id\s*=/.test(fn));
const at = sql.slice(sql.indexOf('create or replace function apply_targeted'));
ok('the Player Swap card waits for kickoff again, server and boards',
  /p_powerup_id in \('metric-swap', 'player-swap', 'mulligan'\) then\s+if m\.status <> 'live'/.test(at) && !/window not locked/.test(at)
  && !aimSpotOk('player-swap', 'locked', 'you', { mine: true, theirs: false }));

if (fails) { console.log(`\n${fails} INJURY-SWAP ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL INJURY-SWAP ASSERTIONS PASSED');
