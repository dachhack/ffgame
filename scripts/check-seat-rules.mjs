// WHO EACH TEAM MAY TAKE (v0.659.0, 0460) — the client copy of the seat rule,
// held to the SQL's answers (seat_rule_error), and the migration held to the
// founder's scope: draft and waivers bind, trades and keepers don't, and the
// autodraft can never stall a draft on a rule that has run dry.
import fs from 'node:fs';
import { seatRuleAllows, seatRuleText, teamsLabel, normTeam } from '../packages/core/src/data/seatRules.ts';
import { NFL_DIVISIONS } from '../packages/core/src/data/kdst.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const rule = (r) => ({ roster_id: 1, positions: [], teams: [], ...r });
const nfc = NFL_DIVISIONS.filter((d) => d.conf === 'NFC').flatMap((d) => d.teams.map((t) => t.toUpperCase()));

// ── the founder's three examples ────────────────────────────────────────────
const te = rule({ positions: ['TE'] });
ok('TE only: Kittle yes', seatRuleAllows(te, { pos: 'TE', team: 'SF', exp: 9 }));
ok('TE only: Allen no', !seatRuleAllows(te, { pos: 'QB', team: 'BUF', exp: 8 }));
const nfcRule = rule({ teams: nfc });
ok('NFC only: a Rams player under Sleeper\'s LAR yes', seatRuleAllows(nfcRule, { pos: 'WR', team: 'LAR', exp: 3 }));
ok('NFC only: a Commanders player under WSH yes', seatRuleAllows(nfcRule, { pos: 'WR', team: 'WSH', exp: 3 }));
ok('NFC only: Bills no', !seatRuleAllows(nfcRule, { pos: 'QB', team: 'BUF', exp: 8 }));
ok('NFC only: a free agent (no team) no', !seatRuleAllows(nfcRule, { pos: 'RB', team: '', exp: 4 }));
const bears = rule({ teams: ['CHI'] });
ok('Bears only: Swift yes', seatRuleAllows(bears, { pos: 'RB', team: 'chi', exp: 6 }));
ok('Bears only: Kittle no', !seatRuleAllows(bears, { pos: 'TE', team: 'SF', exp: 9 }));

// ── combined, experience, college ───────────────────────────────────────────
const bearsTe = rule({ positions: ['TE'], teams: ['CHI'] });
ok('Bears TEs: Kmet yes, Swift no', seatRuleAllows(bearsTe, { pos: 'TE', team: 'CHI', exp: 6 }) && !seatRuleAllows(bearsTe, { pos: 'RB', team: 'CHI', exp: 6 }));
const rookies = rule({ min_exp: 0, max_exp: 0 });
ok('rookies: a rookie yes, a vet no', seatRuleAllows(rookies, { pos: 'WR', team: 'NYJ', exp: 0 }) && !seatRuleAllows(rookies, { pos: 'QB', team: 'BUF', exp: 8 }));
ok('rookies: unknown tenure refused (the pool\'s no-guess rule)', !seatRuleAllows(rookies, { pos: 'WR', team: 'NYJ', exp: null }));
ok('rookies: tenure not loaded on this screen is not judged', seatRuleAllows(rookies, { pos: 'WR', team: 'NYJ', exp: undefined }));
ok('college: held to positions only', seatRuleAllows(bearsTe, { slug: 'c-123', pos: 'TE', team: '' }) && !seatRuleAllows(bearsTe, { slug: 'c-123', pos: 'WR', team: '' }));
ok('no rule: everyone', seatRuleAllows(null, { pos: 'K', team: 'KC', exp: 1 }));

// ── what the rule is called ─────────────────────────────────────────────────
ok('label: the NFC is "NFC"', teamsLabel(nfc) === 'NFC');
ok('label: a division', teamsLabel(['CHI', 'DET', 'GB', 'MIN']) === 'NFC North');
ok('label: the Rams division under LAR still reads NFC West', teamsLabel(['ARI', 'LAR', 'SF', 'SEA']) === 'NFC West');
ok('label: one team is just its code', teamsLabel(['CHI']) === null);
ok('text: "TE · CHI"', seatRuleText(bearsTe) === 'TE · CHI', seatRuleText(bearsTe));
ok('text: rookies', seatRuleText(rookies) === 'rookies');
ok('norm: LAR/WSH/JAC/LVR', ['LAR', 'WSH', 'JAC', 'LVR'].map(normTeam).join() === 'LA,WAS,JAX,LV');

// ── the migration: where it bites, and where it must not ────────────────────
const sql = fs.readFileSync(new URL('../supabase/migrations/0460_seat_player_rules.sql', import.meta.url), 'utf8');
ok('sql: pos_cap_error asks the seat rule first', /return coalesce\(seat_rule_error\(p_league_id, p_roster_id, p_slug\),\s*_pos_cap_error_0460/.test(sql));
ok('sql: the pick checks the seat on the clock', /native_exec_pick[\s\S]*draft_on_clock\(d\)[\s\S]*seat_rule_error\(p_league_id, oc, p_slug\)/.test(sql));
ok('sql: an AUTO pick goes through when the rule ran dry', /not coalesce\(p_auto, false\) or _seat_rule_any_left/.test(sql));
ok('sql: autopick and the queue take eligible players', /create or replace function native_autopick_slug[\s\S]*seat_rule_error/.test(sql) && /create or replace function native_queue_pick[\s\S]*seat_rule_error/.test(sql));
ok('sql: trades and keepers are not touched', !/execute_trade|respond_trade|propose_trade|set_keepers/.test(sql.replace(/--.*$/gm, '')));
ok('sql: SQL team spelling matches the client\'s', /'LAR' then 'LA' when 'WSH' then 'WAS' when 'JAC' then 'JAX' when 'LVR' then 'LV'/.test(sql));
ok('sql: changing a rule is commissioner-only', /set_seat_player_rule[\s\S]*is_league_commish\(p_league_id\) or is_admin\(\)/.test(sql));

if (fails) { console.log(`\n${fails} SEAT-RULE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SEAT-RULE ASSERTIONS PASSED');
